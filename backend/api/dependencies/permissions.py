from fastapi import Request, HTTPException
import os

ADMIN_EMAIL = os.getenv("DIGEST_EMAIL")

def require_admin(request: Request):
    user = request.state.user
    if user.get("email") != ADMIN_EMAIL:
        raise HTTPException(status_code=403, detail="Admin only")
    return user

def require_auth(request: Request):
    return request.state.user