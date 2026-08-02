from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class AgentManifest:
    name: str
    tool_name: str
    description: str
    intents: list[dict]   # [{name, description}]
    params_schema: dict   # JSON Schema for the params object


@dataclass
class AgentResult:
    agent: str
    handled: bool
    intent: str | None
    data: dict
    natural_language: str


class BaseQueryAgent(ABC):
    @property
    @abstractmethod
    def manifest(self) -> AgentManifest: ...

    @abstractmethod
    def handle(self, intent: str, params: dict, household_id: str,
               sender_name: str | None = None, sender_phone: str | None = None) -> AgentResult: ...

    def as_tool(self) -> dict:
        m = self.manifest
        intent_docs = "\n".join(f"  - {i['name']}: {i['description']}" for i in m.intents)
        return {
            "type": "function",
            "function": {
                "name": m.tool_name,
                "description": f"{m.description}\n\nAvailable intents:\n{intent_docs}",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "intent": {
                            "type": "string",
                            "enum": [i["name"] for i in m.intents],
                            "description": "The specific query intent to execute",
                        },
                        "params": m.params_schema,
                    },
                    "required": ["intent", "params"],
                },
            },
        }
