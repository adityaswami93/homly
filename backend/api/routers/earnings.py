from fastapi import APIRouter, Request, HTTPException, UploadFile, File, Form
from supabase import create_client
import os

from api.dependencies.limiter import limiter
from agents.earnings_agent import extract_text_from_pdf, analyse_earnings

router = APIRouter()
supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))


@router.post("/analyse-earnings")
@limiter.limit("5/minute")
async def analyse_earnings_endpoint(
    request: Request,
    file: UploadFile = File(...),
    ticker: str = Form(default=""),
):
    user_id = request.state.user["sub"]
    pdf_bytes = await file.read()

    MAX_PDF_SIZE = 10 * 1024 * 1024  # 10MB
    if len(pdf_bytes) > MAX_PDF_SIZE:
        raise HTTPException(status_code=400, detail="PDF too large. Maximum size is 10MB.")

    transcript_text = extract_text_from_pdf(pdf_bytes)

    if not transcript_text.strip():
        raise HTTPException(status_code=400, detail="Could not extract text from PDF")

    analysis = analyse_earnings(transcript_text, ticker)

    supabase.table("earnings_analyses").insert({
        "user_id": user_id,
        "ticker": ticker.upper(),
        "analysis": analysis,
        "transcript_length": len(transcript_text)
    }).execute()

    return {"ticker": ticker.upper(), "analysis": analysis}
