import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass

from supabase import create_client

from agents.base_agent import AgentResult, BaseQueryAgent
from agents.query.grocery_agent import GroceryQueryAgent
from agents.query.insurance_query_agent import InsuranceQueryAgent
from services.llm_client import get_completion, get_tool_completion

logger = logging.getLogger(__name__)

_supabase = None


def _db():
    global _supabase
    if _supabase is None:
        _supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))
    return _supabase


# ── agent registry ────────────────────────────────────────────────────────────
# Add new agents here; everything else is automatic.
_AGENTS: list[BaseQueryAgent] = [
    GroceryQueryAgent(),
    InsuranceQueryAgent(),
]
_AGENT_MAP: dict[str, BaseQueryAgent] = {a.manifest.tool_name: a for a in _AGENTS}

_ROUTER_SYSTEM = (
    "You are a household assistant router. Given a user's query, decide which specialist "
    "agents to call. For compound queries that span multiple domains, call multiple agents. "
    "Always extract the most specific intent and parameters you can infer from the query."
)

_SYNTH_SYSTEM = (
    "You are a helpful household assistant. Synthesise the provided data into a clear, "
    "conversational answer. Use SGD currency. Be specific with numbers. 2-4 sentences max."
)


@dataclass
class QueryResponse:
    response: str
    sources: list[dict]
    handled: bool


def _log_query(household_id: str, query: str, agents_called: list[str], handled: bool) -> None:
    try:
        _db().table("query_logs").insert(
            {
                "household_id": household_id,
                "query": query,
                "agents_called": agents_called,
                "handled": handled,
            }
        ).execute()
    except Exception as e:
        logger.warning(f"[router] query log failed: {e}")


def run_query(
    query: str,
    household_id: str,
    context: list[dict] | None = None,
) -> QueryResponse:
    tools = [a.as_tool() for a in _AGENTS]
    messages = list(context or []) + [{"role": "user", "content": query}]

    # Phase 1: route — LLM selects which agent tools to call
    routing_msg = get_tool_completion(messages, tools, system=_ROUTER_SYSTEM)

    if not routing_msg.tool_calls:
        _log_query(household_id, query, [], False)
        return QueryResponse(
            response=(
                "I'm not sure how to answer that. "
                "Try asking about your grocery spending, insurance policies, or expense summaries."
            ),
            sources=[],
            handled=False,
        )

    # Phase 2: parse tool calls, then dispatch all agents in parallel
    calls: list[tuple[str, BaseQueryAgent, str, dict]] = []  # (tool_name, agent, intent, params)
    agents_called: list[str] = []

    for tool_call in routing_msg.tool_calls:
        name = tool_call.function.name
        try:
            args = json.loads(tool_call.function.arguments)
        except json.JSONDecodeError:
            logger.warning(f"[router] bad tool args for {name}")
            continue
        agent = _AGENT_MAP.get(name)
        if not agent:
            logger.warning(f"[router] unknown agent tool: {name}")
            continue
        agents_called.append(name)
        calls.append((name, agent, args.get("intent", ""), args.get("params", {})))

    results: list[AgentResult] = []
    if calls:
        with ThreadPoolExecutor(max_workers=len(calls)) as pool:
            futures = {
                pool.submit(agent.handle, intent, params, household_id): name
                for name, agent, intent, params in calls
            }
            for future in as_completed(futures):
                try:
                    results.append(future.result())
                except Exception as e:
                    logger.error(f"[router] agent {futures[future]} raised: {e}")

    handled = any(r.handled for r in results)

    if not results:
        _log_query(household_id, query, [], False)
        return QueryResponse(
            response="I couldn't find an agent to handle your query.",
            sources=[],
            handled=False,
        )

    # Phase 3: synthesise
    handled_results = [r for r in results if r.handled]
    if len(handled_results) == 1:
        # Single result — use the agent's own NL summary directly (saves an LLM call)
        response = handled_results[0].natural_language
    elif handled_results:
        agent_summaries = "\n".join(
            f"[{r.agent}/{r.intent}]: {r.natural_language}" for r in handled_results
        )
        response = get_completion(
            prompt=f'User asked: "{query}"\n\nAgent findings:\n{agent_summaries}',
            system=_SYNTH_SYSTEM,
        )
    else:
        response = "I found relevant data but wasn't able to produce an answer."

    sources = [
        {"agent": r.agent, "intent": r.intent, "handled": r.handled, "data": r.data}
        for r in results
    ]
    _log_query(household_id, query, agents_called, handled)

    return QueryResponse(response=response, sources=sources, handled=handled)
