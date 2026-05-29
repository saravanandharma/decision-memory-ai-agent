"""
routers/decisions.py — Endpoints for listing, fetching, and deleting decisions.

What this file does:
    Provides three CRUD endpoints for managing stored decisions:
    - GET  /decisions          — List all decisions (paginated, newest first).
    - GET  /decisions/{id}     — Fetch a single decision by its UUID.
    - DELETE /decisions/{id}   — Delete a decision from all three databases.

Why all three databases on delete?
    When a decision is ingested, it is saved to SQLite (structured data),
    Kuzu graph DB (relationships), and ChromaDB (vector embeddings).
    When it is deleted, it must be removed from ALL three so the stores
    stay in sync. A stale entry in the vector store, for example, would
    cause Hermes to surface deleted decisions in search results.

Authentication:
    All endpoints require a valid Bearer token via Depends(get_current_user).
    Currently, any authenticated user can see and delete any decision.
    In a future version you might add per-user or per-family ownership
    restrictions.

How it fits in the system:
    Frontend decision list/detail/delete → this router → db/database.py
                                                       → db/graph_db.py
                                                       → db/vector_db.py
"""

from fastapi import APIRouter, Depends, HTTPException

from db import database, graph_db, vector_db
from routers.auth import get_current_user


# All routes in this file are under /decisions.
router = APIRouter(prefix="/decisions", tags=["decisions"])


@router.get("")
async def list_decisions(
    limit: int = 50,
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
):
    """
    Return a paginated list of all decisions, ordered newest first.

    Parameters:
        limit:        Maximum number of decisions to return per page (default 50).
        offset:       Number of decisions to skip — used for pagination.
                      To get page 2 with limit=50, use offset=50.
        current_user: Injected by the auth dependency (validates the token).

    Returns:
        A list of decision dicts. Each dict includes all stored fields
        plus 'creator_name' (from a JOIN with the users table).

    Example usage:
        GET /decisions           → first 50 decisions
        GET /decisions?limit=10  → first 10 decisions
        GET /decisions?limit=10&offset=10 → decisions 11-20
    """
    return await database.get_decisions(limit=limit, offset=offset)


@router.get("/{decision_id}")
async def get_decision(decision_id: str, current_user: dict = Depends(get_current_user)):
    """
    Fetch a single decision by its UUID.

    Parameters:
        decision_id:  The UUID string of the decision to fetch.
                      Provided as a URL path segment, e.g. /decisions/abc123.
        current_user: Injected by the auth dependency.

    Raises:
        404: If no decision with the given ID exists in the database.

    Returns:
        A single decision dict with all stored fields plus creator_name.
    """
    decision = await database.get_decision(decision_id)
    if not decision:
        raise HTTPException(status_code=404, detail="Decision not found")
    return decision


@router.delete("/{decision_id}")
async def delete_decision(decision_id: str, current_user: dict = Depends(get_current_user)):
    """
    Delete a decision from all three databases (SQLite, graph, vector).

    The decision must be removed from all three stores to keep them in sync:
    - SQLite: the primary record.
    - Kuzu graph DB: the Decision node and all its edges.
    - ChromaDB: the vector embedding.

    If we only deleted from SQLite, the Hermes agent could still find the
    deleted decision via graph or semantic search and try to look it up —
    causing confusing 'decision not found' errors.

    Parameters:
        decision_id:  The UUID of the decision to delete.
        current_user: Injected by the auth dependency.

    Raises:
        404: If the decision doesn't exist (checked before attempting deletion).

    Returns:
        {"deleted": decision_id} — confirms which ID was deleted.
    """
    # Verify the decision exists before attempting to delete it.
    # This gives a clear 404 error rather than a silent no-op.
    decision = await database.get_decision(decision_id)
    if not decision:
        raise HTTPException(status_code=404, detail="Decision not found")

    # Delete from SQLite (primary structured store).
    await database.delete_decision(decision_id)

    # Delete from Kuzu graph (removes the Decision node + all its edges).
    graph_db.remove_decision_from_graph(decision_id)

    # Delete from ChromaDB (removes the vector embedding).
    vector_db.remove_decision(decision_id)

    # Return the deleted ID so the client can confirm which item was removed.
    return {"deleted": decision_id}
