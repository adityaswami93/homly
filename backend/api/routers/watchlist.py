from fastapi import APIRouter, Request, HTTPException
from supabase import create_client
import os

from api.dependencies.limiter import limiter

router = APIRouter()
supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))


@router.get("/watchlist")
def get_watchlist(request: Request):
    user_id = request.state.user["sub"]
    response = supabase.table("watchlist")\
        .select("*")\
        .eq("user_id", user_id)\
        .execute()
    return response.data


@router.post("/watchlist")
@limiter.limit("30/minute")
def add_to_watchlist(request: Request, item: dict):
    item["user_id"] = request.state.user["sub"]
    try:
        response = supabase.table("watchlist").insert(item).execute()
        return response.data
    except Exception as e:
        if "23505" in str(e):
            raise HTTPException(status_code=409, detail="Symbol already in watchlist")
        raise HTTPException(status_code=500, detail="Something went wrong")


@router.delete("/watchlist/{item_id}")
def remove_from_watchlist(item_id: str, request: Request):
    user_id = request.state.user["sub"]
    # Check ownership first
    item = supabase.table("watchlist")\
        .select("user_id")\
        .eq("id", item_id)\
        .execute()
    if not item.data:
        raise HTTPException(status_code=404, detail="Item not found")
    if item.data[0]["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    supabase.table("watchlist").delete().eq("id", item_id).execute()
    return {"status": "deleted"}
