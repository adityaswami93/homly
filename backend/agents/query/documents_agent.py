"""Chat access to photos the assistant has read (services/documents.py).

This is what makes a photo referable in a *later* conversation. The 6-hour
transcript in services/conversation.py only holds "[sent a photo]" plus the
assistant's reply; once that window has moved on, "what did the school letter
say about the excursion?" or "what was the account number on the SP bill?"
needs the stored reading — this agent searches it.

`forget` is the household's way to remove one ("forget that photo"). Search
and recent are read-only and exposed to the proactive monitor, so it can
notice a deadline in a letter coming up; forget is not.
"""
import logging

from agents.base_agent import AgentManifest, AgentResult, BaseQueryAgent
from services import documents

logger = logging.getLogger(__name__)

MANIFEST = AgentManifest(
    name="documents",
    tool_name="query_documents",
    description=(
        "Photos the household sent the assistant earlier and it read — letters, bills, notices, "
        "invitations, appointment cards, screenshots. Searches them, lists the most recent ones, "
        "returns one in full (all its text and key facts), or forgets one. Use this whenever "
        "someone refers to a photo, letter, bill or screenshot they sent before."
    ),
    intents=[
        {"name": "search", "description": "Find read photos matching params.query (words likely in the text)"},
        {"name": "recent", "description": "The most recently read photos (params.limit, default 5)"},
        {"name": "get", "description": "One read photo in full — its text and key facts (params.document_id)"},
        {"name": "forget", "description": "Delete a read photo (params.document_id) when the household asks"},
    ],
    params_schema={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "search: words to look for"},
            "document_id": {"type": "string"},
            "limit": {"type": "integer"},
        },
    },
    examples=["what did the school letter say about the excursion?"],
)

# Full text is capped in the tool result — a long letter is still useful, but
# a 20k-character scan would crowd out everything else in the supervisor's context.
_MAX_TEXT_IN_RESULT = 4000


def _brief(d: dict) -> str:
    when = (d.get("created_at") or "")[:10]
    who = f" by {d['sender_name']}" if d.get("sender_name") else ""
    line = f"[{d['id']}] {d.get('title')} — sent {when}{who}"
    if d.get("summary"):
        line += f": {d['summary']}"
    return line


def _facts(d: dict) -> str:
    return "; ".join(f"{f['label']}: {f['value']}" for f in d.get("key_facts") or [] if isinstance(f, dict))


class DocumentsQueryAgent(BaseQueryAgent):
    @property
    def manifest(self) -> AgentManifest:
        return MANIFEST

    def handle(self, intent: str, params: dict, household_id: str,
               sender_name: str | None = None, sender_phone: str | None = None) -> AgentResult:
        params = params or {}
        try:
            if intent in ("search", "recent"):
                limit = max(1, min(int(params.get("limit") or 5), 10))
                rows = (documents.search_documents(household_id, params.get("query") or "", limit)
                        if intent == "search" else documents.recent_documents(household_id, limit))
                if not rows:
                    nl = "No matching photos found." if intent == "search" else "No photos have been read yet."
                    return AgentResult("documents", True, intent, {"documents": []}, nl)
                lines = []
                for d in rows:
                    line = _brief(d)
                    facts = _facts(d)
                    if facts:
                        line += f" | {facts}"
                    lines.append(line)
                return AgentResult("documents", True, intent, {"documents": rows}, "\n".join(lines))

            if intent == "get":
                doc = documents.get_document(household_id, params.get("document_id") or "")
                if not doc:
                    return AgentResult("documents", False, intent, {}, "I can't find that photo any more.")
                text = (doc.get("extracted_text") or "")[:_MAX_TEXT_IN_RESULT]
                nl = _brief(doc)
                if _facts(doc):
                    nl += f"\nKey facts: {_facts(doc)}"
                if text:
                    nl += f"\nFull text:\n{text}"
                doc.pop("search_tsv", None)
                return AgentResult("documents", True, intent, {"document": doc}, nl)

            if intent == "forget":
                ok = documents.delete_document(household_id, params.get("document_id") or "")
                return AgentResult("documents", ok, intent, {},
                                   "Done — I've forgotten that photo." if ok else "I can't find that photo.")
        except Exception as e:
            logger.exception("Documents agent failed intent=%s household_id=%s", intent, household_id)
            return AgentResult("documents", False, intent, {"error": str(e)}, f"Sorry, I couldn't do that: {e}")
        return AgentResult("documents", False, intent, {}, "Unknown intent.")
