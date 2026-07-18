import os

from langchain_anthropic import ChatAnthropic

DEFAULT_MODEL = "claude-opus-4-8"


def build() -> ChatAnthropic:
    return ChatAnthropic(
        model=os.getenv("AGENT_MODEL", DEFAULT_MODEL),
        api_key=os.getenv("ANTHROPIC_API_KEY"),
        temperature=0,
    )
