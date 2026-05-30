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
<<<<<<< HEAD
    reimbursements, analytics, insights, insurance, webhook, budgets, query, recipe, pantry, waitlist,
)
from api.routers import admin as admin_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    from services.whatsapp_scheduler import create_scheduler, refresh_summaries
    scheduler = create_scheduler()
    scheduler.start()
    refresh_summaries(scheduler)
    logger.info("[startup] WhatsApp scheduler started")
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


@app.get("/")
def root():
    return {"status": "Homly API running"}
