"""
db/database.py — SQLite database layer for the Decision Memory Agent.

What this file does:
    Provides all read/write operations against the SQLite database.
    SQLite stores two tables:
      - users: registered family members (id, name, email, hashed password).
      - decisions: the full structured records for every captured decision.

Why SQLite?
    SQLite is a file-based database that requires no separate server process.
    It is ideal for a small, self-hosted family app where simplicity beats
    scalability. The database is a single file at settings.DB_PATH.

Why async (aiosqlite)?
    FastAPI is an async framework. If we used the standard synchronous sqlite3
    library, every database call would block the entire server — no other
    request could be served while waiting for the disk. aiosqlite wraps sqlite3
    in a thread pool so the event loop stays free.

Why store lists as JSON strings?
    SQLite has no native array type. Fields like 'tags', 'owners', and
    'alternatives_considered' are stored as JSON strings (e.g. '["tag1","tag2"]')
    and decoded back into Python lists by _row_to_dict when read.

How it fits in the system:
    - Called by ingest router to save new decisions.
    - Called by decisions router to list, fetch, and delete decisions.
    - Called by the Hermes agent to fetch full decision detail by ID.
    - Called by auth router / main.py to manage users.
"""

from __future__ import annotations
# 'from __future__ import annotations' enables the newer PEP 563 annotation
# style. This allows writing `dict | None` as a return type hint in Python 3.9
# without a runtime error (Python 3.10+ supports this syntax natively).

import aiosqlite
import os
import json
import uuid
from datetime import datetime

from config import settings


# ---------------------------------------------------------------------------
# Database initialisation
# ---------------------------------------------------------------------------

async def init_db():
    """
    Create the database file and all required tables if they do not exist yet.

    This is called once at application startup (from main.py lifespan).
    'CREATE TABLE IF NOT EXISTS' makes this safe to call on every restart —
    it will do nothing if the tables already exist.

    No parameters. No return value.
    """
    # Ensure the data directory exists before SQLite tries to create the file.
    os.makedirs(settings.DATA_DIR, exist_ok=True)

    async with aiosqlite.connect(settings.DB_PATH) as db:
        # --- Users table ---
        # Stores one row per registered family member.
        # 'id' is a UUID string (not an integer) so that IDs are globally
        # unique and safe to expose in URLs without leaking row counts.
        await db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                hashed_password TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # --- Decisions table ---
        # Stores one row per extracted decision.
        # Array-valued fields (alternatives_considered, tags, etc.) are stored
        # as JSON strings because SQLite has no native array type.
        # 'created_by' is a foreign key linking each decision to the user who
        # submitted it — useful for filtering and attribution.
        await db.execute("""
            CREATE TABLE IF NOT EXISTS decisions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                summary TEXT NOT NULL,
                rationale TEXT NOT NULL,
                raw_text TEXT NOT NULL,
                alternatives_considered TEXT NOT NULL DEFAULT '[]',
                risks_accepted TEXT NOT NULL DEFAULT '[]',
                assumptions TEXT NOT NULL DEFAULT '[]',
                unresolved_questions TEXT NOT NULL DEFAULT '[]',
                owners TEXT NOT NULL DEFAULT '[]',
                dissenters TEXT NOT NULL DEFAULT '[]',
                related_systems TEXT NOT NULL DEFAULT '[]',
                tags TEXT NOT NULL DEFAULT '[]',
                source_type TEXT NOT NULL DEFAULT 'text',
                source_ref TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_by TEXT NOT NULL,
                FOREIGN KEY (created_by) REFERENCES users(id)
            )
        """)

        # Commit both table creations as a single transaction.
        await db.commit()


# ---------------------------------------------------------------------------
# Decision CRUD
# ---------------------------------------------------------------------------

async def save_decision(decision_data: dict, user_id: str) -> str:
    """
    Insert a new decision record into the database.

    Parameters:
        decision_data: A dictionary with all extracted decision fields.
                       Expected keys: title, summary, rationale, raw_text,
                       alternatives_considered, risks_accepted, assumptions,
                       unresolved_questions, owners, dissenters,
                       related_systems, tags, source_type, source_ref.
        user_id:       The UUID of the user submitting the decision.

    Returns:
        The newly created decision's UUID string.

    Note:
        List-valued fields are serialised to JSON strings before storage.
        They are deserialised back to lists when read via _row_to_dict.
    """
    # Generate a UUID for this decision. Using uuid4 (random) rather than
    # uuid1 (time-based) avoids leaking the server's MAC address.
    decision_id = str(uuid.uuid4())

    async with aiosqlite.connect(settings.DB_PATH) as db:
        await db.execute("""
            INSERT INTO decisions (
                id, title, summary, rationale, raw_text,
                alternatives_considered, risks_accepted, assumptions,
                unresolved_questions, owners, dissenters, related_systems,
                tags, source_type, source_ref, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            decision_id,
            decision_data["title"],
            decision_data["summary"],
            decision_data["rationale"],
            decision_data.get("raw_text", ""),
            # Convert Python lists to JSON strings for SQLite storage.
            json.dumps(decision_data.get("alternatives_considered", [])),
            json.dumps(decision_data.get("risks_accepted", [])),
            json.dumps(decision_data.get("assumptions", [])),
            json.dumps(decision_data.get("unresolved_questions", [])),
            json.dumps(decision_data.get("owners", [])),
            json.dumps(decision_data.get("dissenters", [])),
            json.dumps(decision_data.get("related_systems", [])),
            json.dumps(decision_data.get("tags", [])),
            decision_data.get("source_type", "text"),
            decision_data.get("source_ref"),  # May be None — that's fine
            user_id,
        ))
        await db.commit()

    return decision_id


async def get_decisions(limit: int = 50, offset: int = 0) -> list:
    """
    Fetch a paginated list of all decisions, newest first.

    Parameters:
        limit:  Maximum number of decisions to return (default 50).
        offset: How many decisions to skip — used for pagination.
                Page 2 with limit=50 would use offset=50.

    Returns:
        A list of decision dicts, each with all fields including
        'creator_name' from the joined users table.

    Note:
        JOIN with users adds 'creator_name' so the frontend can display
        who submitted each decision without a separate lookup.
    """
    async with aiosqlite.connect(settings.DB_PATH) as db:
        # aiosqlite.Row allows accessing columns by name (row["title"])
        # instead of by position (row[1]), making the code more readable.
        db.row_factory = aiosqlite.Row
        async with db.execute("""
            SELECT d.*, u.name as creator_name
            FROM decisions d
            JOIN users u ON d.created_by = u.id
            ORDER BY d.created_at DESC
            LIMIT ? OFFSET ?
        """, (limit, offset)) as cursor:
            rows = await cursor.fetchall()
            # _row_to_dict decodes the JSON string fields back into Python lists.
            return [_row_to_dict(row) for row in rows]


async def get_decision(decision_id: str) -> dict | None:
    """
    Fetch a single decision by its UUID.

    Parameters:
        decision_id: The UUID string of the decision to fetch.

    Returns:
        A dict with all decision fields (including creator_name),
        or None if no decision with that ID exists.
    """
    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("""
            SELECT d.*, u.name as creator_name
            FROM decisions d
            JOIN users u ON d.created_by = u.id
            WHERE d.id = ?
        """, (decision_id,)) as cursor:
            row = await cursor.fetchone()
            # fetchone returns None if no row matched — we propagate that.
            return _row_to_dict(row) if row else None


async def get_decisions_by_ids(ids: list[str]) -> list:
    """
    Fetch multiple decisions by a list of UUIDs in a single query.

    Used by the Hermes agent when it has collected several candidate IDs
    from graph/vector search and needs their full records.

    Parameters:
        ids: A list of decision UUID strings.

    Returns:
        A list of decision dicts (may be shorter than `ids` if some IDs
        don't exist in the database).
    """
    # Guard against an empty list — an empty IN() clause is invalid SQL.
    if not ids:
        return []

    # Build a parameter placeholder string like "?,?,?" for the IN clause.
    # We cannot use a single ? for a list — SQLite requires one ? per value.
    placeholders = ",".join("?" * len(ids))

    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            f"SELECT d.*, u.name as creator_name FROM decisions d JOIN users u ON d.created_by = u.id WHERE d.id IN ({placeholders})",
            ids,
        ) as cursor:
            rows = await cursor.fetchall()
            return [_row_to_dict(row) for row in rows]


async def delete_decision(decision_id: str):
    """
    Delete a decision from the SQLite database.

    Parameters:
        decision_id: The UUID of the decision to delete.

    Note:
        This only removes the record from SQLite. The caller (decisions router)
        is also responsible for removing the decision from the graph DB
        (graph_db.remove_decision_from_graph) and the vector DB
        (vector_db.remove_decision) to keep all three stores in sync.
    """
    async with aiosqlite.connect(settings.DB_PATH) as db:
        await db.execute("DELETE FROM decisions WHERE id = ?", (decision_id,))
        await db.commit()


# ---------------------------------------------------------------------------
# User CRUD
# ---------------------------------------------------------------------------

async def create_user(user_data: dict) -> str:
    """
    Insert a new user record into the database.

    Parameters:
        user_data: A dict with keys: name, email, hashed_password.
                   The password must already be hashed before calling this
                   function — never pass a plain-text password.

    Returns:
        The newly created user's UUID string.
    """
    user_id = str(uuid.uuid4())
    async with aiosqlite.connect(settings.DB_PATH) as db:
        await db.execute(
            "INSERT INTO users (id, name, email, hashed_password) VALUES (?, ?, ?, ?)",
            (user_id, user_data["name"], user_data["email"], user_data["hashed_password"]),
        )
        await db.commit()
    return user_id


async def get_user_by_email(email: str) -> dict | None:
    """
    Look up a user by their email address.

    Used during login (to find who is trying to sign in) and during
    registration (to check if the email is already taken).

    Parameters:
        email: The email address to search for.

    Returns:
        A dict with all user fields, or None if not found.
    """
    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM users WHERE email = ?", (email,)) as cursor:
            row = await cursor.fetchone()
            return dict(row) if row else None


async def get_user_by_id(user_id: str) -> dict | None:
    """
    Look up a user by their UUID.

    Used by get_current_user in auth.py to verify that the user referenced
    in a JWT token still exists in the database (they could have been deleted
    after the token was issued).

    Parameters:
        user_id: The UUID string to search for.

    Returns:
        A dict with all user fields, or None if not found.
    """
    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM users WHERE id = ?", (user_id,)) as cursor:
            row = await cursor.fetchone()
            return dict(row) if row else None


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _row_to_dict(row) -> dict:
    """
    Convert a SQLite row object into a plain Python dict with list fields
    properly decoded from their JSON string representation.

    Parameters:
        row: An aiosqlite.Row object (or any dict-like object).

    Returns:
        A plain dict where list-valued fields (tags, owners, etc.) are
        Python lists rather than raw JSON strings.

    Why this function exists:
        SQLite has no array type, so list fields are stored as JSON strings
        like '["tag1","tag2"]'. Before returning data to callers or the API,
        we decode them back into real Python lists so callers never have to
        think about the JSON serialisation detail.
    """
    # Convert the row to a plain dict first (aiosqlite.Row supports this).
    d = dict(row)

    # These are all the fields stored as JSON arrays in the database.
    # We iterate over them and decode each one that is still a string.
    for field in [
        "alternatives_considered", "risks_accepted", "assumptions",
        "unresolved_questions", "owners", "dissenters", "related_systems", "tags",
    ]:
        # Only parse if the value is a string — it might already be a list
        # if someone pre-decoded it elsewhere.
        if isinstance(d.get(field), str):
            d[field] = json.loads(d[field])

    return d
