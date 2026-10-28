"""Read photos — dashboard endpoints (JWT).

Browse, search and delete what the WhatsApp assistant has read and kept
(services/documents.py). There is deliberately no upload endpoint: reading a
photo ends in a *question* to the group ("what should I do with this?"), and
that conversation lives in WhatsApp. See documents/042-photo-memory-and-vouchers.
"""
from typing import Optional

from fastapi import APIRouter, HTTPException, Request

from services import documents

router = APIRouter()


def _household_id(request: Request) -> str:
    household_id = request.state.user.get("household_id")
    if not household_id:
        raise HTTPException(status_code=403, detail="No household found")
    return household_id


@router.get("/documents")
def list_documents(request: Request, q: Optional[str] = None, limit: int = 50):
    household_id = _household_id(request)
    rows = documents.list_documents(household_id, q, max(1, min(limit, 100)))
    return {"documents": rows, "retention_days": documents.RETENTION_DAYS}


@router.get("/documents/{document_id}")
def get_document(document_id: str, request: Request):
    household_id = _household_id(request)
    doc = documents.get_document(household_id, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    doc.pop("search_tsv", None)
    doc["image_url"] = documents.signed_url(doc.get("image_path"))
    return {"document": doc}


@router.delete("/documents/{document_id}")
def delete_document(document_id: str, request: Request):
    household_id = _household_id(request)
    if not documents.delete_document(household_id, document_id):
        raise HTTPException(status_code=404, detail="Not found")
    return {"deleted": True}
