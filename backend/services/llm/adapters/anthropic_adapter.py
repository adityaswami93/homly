import os

from langchain_anthropic import ChatAnthropic

DEFAULT_MODEL = "claude-opus-4-8"


def build() -> ChatAnthropic:
    # Opus 4.7+/Sonnet 5/Fable 5 reject non-default temperature/top_p/top_k with a 400 —
    # omit sampling params entirely rather than pinning one that only some models accept.
    return ChatAnthropic(
        model=os.getenv("AGENT_MODEL", DEFAULT_MODEL),
        api_key=os.getenv("ANTHROPIC_API_KEY"),
    )
