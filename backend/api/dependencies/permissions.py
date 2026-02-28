from fastapi import Request

def require_auth(request: Request):
    return request.state.user
