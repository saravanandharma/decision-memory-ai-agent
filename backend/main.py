"""
main.py — Application entry point for the Decision Memory Agent backend.

What this file does:
    - Creates the FastAPI application instance.
    - Registers all route groups (auth, ingest, decisions, query).
    - Runs one-time startup logic via the 'lifespan' context manager:
        - Creates the directories the app needs (data, vectors, uploads).
        - Initialises the SQLite database tables.
        - Seeds a development test user so you can log in immediately on first run.
    - Configures CORS so the frontend (running on a different port or domain) can
      make requests to this backend.

Why it exists:
    FastAPI requires one 'app' object to serve as the root of the web application.
    This file owns that object and wires everything together. Think of it as the
    main() function of the whole backend.

How it fits in the system:
    Frontend → (HTTP) → main.py (routes) → routers/*.py → services/*.py / db/*.py
"""

import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from db.database import init_db, get_user_by_email, create_user
from routers import auth, ingest, decisions, query
from routers.auth import hash_password

# ---------------------------------------------------------------------------
# Development test credentials
# ---------------------------------------------------------------------------
# Hard-coded test account so developers can log in immediately without having
# to go through the registration flow. Never use real credentials here.
# In production you would remove this block entirely.
TEST_USER = {"name": "Test User", "email": "test@family.com", "password": "test1234"}


# ---------------------------------------------------------------------------
# Lifespan context manager — startup and shutdown logic
# ---------------------------------------------------------------------------
# FastAPI replaced the old @app.on_event("startup") decorator with a 'lifespan'
# context manager. Everything before `yield` runs at startup; everything after
# runs at shutdown (we have nothing to clean up here, so after yield is empty).
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Runs once when the server starts (before it accepts any requests).

    Steps performed:
    1. Create the directories we need (data storage, vector DB, file uploads).
    2. Create SQLite tables if they don't already exist.
    3. Seed the test user on first run so login works without manual registration.

    The `yield` in the middle is the point where FastAPI starts serving traffic.
    """

    # Create directories the app needs to store files.
    # We deliberately DO NOT create GRAPH_PATH here — Kuzu 0.9+ stores the
    # graph as a single file (not a directory). If we pre-created that path
    # as a directory with makedirs, Kuzu would fail with a confusing error
    # because it would find a directory where it expects to create a file.
    for path in [settings.DATA_DIR, settings.VECTOR_DIR, settings.UPLOAD_DIR]:
        os.makedirs(path, exist_ok=True)

    # Create SQLite tables (users, decisions) if they don't exist yet.
    # This is safe to call every time — it uses CREATE TABLE IF NOT EXISTS.
    await init_db()

    # Seed a test user on first run so the app is immediately usable.
    # We check first to avoid a duplicate-email error on subsequent restarts.
    if not await get_user_by_email(TEST_USER["email"]):
        await create_user({
            "name": TEST_USER["name"],
            "email": TEST_USER["email"],
            # Store a hashed password — NEVER store plain text passwords.
            "hashed_password": hash_password(TEST_USER["password"]),
        })
        print(f"[seed] Test user created — email: {TEST_USER['email']}  password: {TEST_USER['password']}")

    # Yield hands control back to FastAPI, which begins accepting HTTP requests.
    # Code placed after yield would run on shutdown (not needed here).
    yield


# ---------------------------------------------------------------------------
# FastAPI application instance
# ---------------------------------------------------------------------------
# 'title' shows up in the auto-generated API docs at /docs.
# 'lifespan' wires in our startup logic defined above.
app = FastAPI(title=settings.APP_NAME, version="1.0.0", lifespan=lifespan)

# ---------------------------------------------------------------------------
# CORS middleware
# ---------------------------------------------------------------------------
# CORS (Cross-Origin Resource Sharing) is a browser security feature that blocks
# requests from one domain (e.g. http://localhost:3000) to another
# (e.g. http://localhost:8000) unless the server explicitly allows it.
# allow_origins=["*"] permits ALL origins — fine for development, but in
# production you should restrict this to your actual frontend domain, e.g.:
#   allow_origins=["https://yourapp.com"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in production to your domain
    allow_credentials=True,  # allows cookies / auth headers to be sent
    allow_methods=["*"],     # allows GET, POST, DELETE, etc.
    allow_headers=["*"],     # allows Authorization, Content-Type, etc.
)

# ---------------------------------------------------------------------------
# Register routers (groups of related API endpoints)
# ---------------------------------------------------------------------------
# Each router lives in its own file under routers/ and handles one area of
# functionality. Including them here attaches their routes to the main app.
app.include_router(auth.router)        # /auth/register, /auth/login, /auth/me
app.include_router(ingest.router)      # /ingest/text, /ingest/file, /ingest/audio
app.include_router(decisions.router)   # /decisions, /decisions/{id}
app.include_router(query.router)       # /query


# ---------------------------------------------------------------------------
# Health check endpoint
# ---------------------------------------------------------------------------
@app.get("/health")
async def health():
    """
    Simple liveness check used by load balancers, Docker health checks, or
    monitoring tools to confirm the server is running.

    Returns a JSON object with status 'ok' and the app name.
    """
    return {"status": "ok", "app": settings.APP_NAME}
