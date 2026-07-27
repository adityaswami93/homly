import os

from langchain_openai import ChatOpenAI

# OpenRouter is an OpenAI-compatible endpoint, not Anthropic's native Messages API, so
# this goes through ChatOpenAI pointed at OpenRouter rather than ChatAnthropic — the
# adapter's name/slot in the factory is unchanged, only the transport underneath it.
#
# Default is Sonnet, not Opus — Opus is off the table for now. Override per-deployment
# via AGENT_MODEL without touching this file (see services/llm/factory.py).
#
# NOTE: this slug is OpenRouter's naming convention (anthropic/claude-<name>), not
# Anthropic's own model ID — could not verify it against OpenRouter's live catalog from
# this environment (outbound access to openrouter.ai is blocked here). Confirm this
# resolves to Claude Sonnet 5 before relying on it; a wrong slug fails loudly (400) on
# first call rather than silently, but override via AGENT_MODEL either way if it's off.
DEFAULT_MODEL = "anthropic/claude-sonnet-5"


def build() -> ChatOpenAI:
    # Opus 4.7+/Sonnet 5/Fable 5 reject non-default temperature/top_p/top_k with a 400 —
    # omit sampling params entirely rather than pinning one that only some models accept.
    return ChatOpenAI(
        model=os.getenv("AGENT_MODEL", DEFAULT_MODEL),
        api_key=os.getenv("OPENROUTER_API_KEY"),
        base_url="https://openrouter.ai/api/v1",
    )
