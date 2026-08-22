import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from contextlib import asynccontextmanager
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

from api.middleware.auth import AuthMiddleware
from api.dependencies.limiter import limiter
from api.routers import (
    expenses, setup, internal, settings, messages, households,
    reimbursements, analytics, insights, insurance, webhook, budgets, query, recipe, pantry, waitlist,
    reminders, commands, savings, mcp_data, mcp_keys, tasks,
)
from api.routers import admin as admin_router
from mcp_server.remote import remote_mcp

# Built once at import time so remote_mcp.session_manager exists by the time
# lifespan() below references it (it's only created lazily on this call).
mcp_streamable_app = remote_mcp.streamable_http_app()


@asynccontextmanager
async def lifespan(app: FastAPI):
    from services.whatsapp_scheduler import create_scheduler, refresh_summaries
    # The remote MCP server (mcp_server/remote.py) needs its session manager's
    # task group running before it can handle any request, even in stateless
    # mode — mounting its ASGI app alone doesn't start that; see api/main.py's
    # mount call below for why it can't just run its own lifespan instead.
    async with remote_mcp.session_manager.run():
        scheduler = create_scheduler()
        scheduler.start()
        refresh_summaries(scheduler)
        logger.info("[startup] WhatsApp scheduler + MCP session manager started")
        yield
        scheduler.shutdown()
        logger.info("[shutdown] WhatsApp scheduler stopped")


app = FastAPI(title="Homly API", lifespan=lifespan)

app.add_middleware(AuthMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://homly-six.vercel.app",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled error on {request.method} {request.url.path}: {exc}")
    return JSONResponse(status_code=500, content={"detail": "An internal error occurred"})


app.include_router(expenses.router)
app.include_router(setup.router)
app.include_router(internal.router)
app.include_router(settings.router)
app.include_router(messages.router)
app.include_router(households.router)
app.include_router(reimbursements.router)
app.include_router(analytics.router)
app.include_router(insights.router)
app.include_router(admin_router.router)
app.include_router(insurance.router)
app.include_router(webhook.router)
app.include_router(query.router)
app.include_router(budgets.router)
app.include_router(recipe.router)
app.include_router(pantry.router)
app.include_router(waitlist.router)
app.include_router(reminders.router)
app.include_router(commands.router)
app.include_router(savings.router)
app.include_router(mcp_data.router)
app.include_router(mcp_keys.router)
app.include_router(tasks.router)

# Remote MCP server (Streamable HTTP) — the connector URL a household enters
# in Claude is https://<this backend>/mcp/server/<their key>; see
# mcp_server/remote.py for why the key lives in the path instead of a header.
app.mount("/mcp/server/{key}", mcp_streamable_app)


@app.get("/")
def root():
    return {"status": "Homly API running"}
