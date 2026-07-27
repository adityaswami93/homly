import importlib
import os
from functools import lru_cache

from langchain_core.language_models import BaseChatModel

# Provider name -> adapter module. Add a new provider by writing
# services/llm/adapters/<name>_adapter.py with a build() -> BaseChatModel
# function and registering it here — nothing else in the codebase changes.
_ADAPTERS = {
    "anthropic": "services.llm.adapters.anthropic_adapter",
}


@lru_cache(maxsize=None)
def get_chat_model(provider: str | None = None) -> BaseChatModel:
    """Return the LangChain chat model LangGraph agents bind tools to.

    Provider is chosen via AGENT_LLM_PROVIDER (default "anthropic"), not hardcoded,
    so switching models is a config change rather than an edit to agent code.
    """
    provider = provider or os.getenv("AGENT_LLM_PROVIDER", "anthropic")
    module_path = _ADAPTERS.get(provider)
    if not module_path:
        raise ValueError(f"Unknown AGENT_LLM_PROVIDER: {provider!r}. Available: {list(_ADAPTERS)}")
    adapter = importlib.import_module(module_path)
    return adapter.build()
