"""
routers/query.py — Natural language query endpoint for the Hermes agent.

What this file does:
    Provides a single endpoint:
    - POST /query — Send a natural language question to the Hermes AI agent
                    and receive a cited answer about past decisions.

Why a separate router for just one endpoint?
    Consistency and separation of concerns. Each area of functionality has its
    own router file. Even though this file is small, keeping it separate makes
    the codebase predictable — a developer can look in routers/query.py and
    know exactly where the query logic starts.

How it fits in the system:
    Frontend question box → POST /query → this router → agent.query(question)
                                                       → graph_db + vector_db + SQLite
                                                       → Claude Sonnet (Hermes)
                                                       → answer with sources

Authentication:
    The endpoint requires a valid Bearer token. Unauthenticated users cannot
    query the decision memory.

See services/agent.py for the full Hermes ReAct loop implementation.
"""

from fastapi import APIRouter, Depends

from models.schema import QueryRequest, QueryResponse
from services.agent import query as hermes_query
from routers.auth import get_current_user


# All routes in this file are under /query.
router = APIRouter(prefix="/query", tags=["query"])


@router.post("", response_model=QueryResponse)
async def ask_hermes(body: QueryRequest, current_user: dict = Depends(get_current_user)):
    """
    Send a natural language question to the Hermes agent and get an answer.

    Hermes uses a ReAct loop (think → search → observe → answer) with three
    tools: graph search, semantic vector search, and full decision detail fetch.
    It returns a cited answer based on the stored decision records.

    Parameters:
        body:         QueryRequest with a 'question' string field.
                      Example: {"question": "Why did we decide to switch schools?"}
        current_user: Injected by the auth dependency (validates the Bearer token).

    Returns:
        QueryResponse with three fields:
            answer         — The agent's final natural-language answer.
            sources        — List of decisions consulted: [{"id": ..., "title": ...}]
            thinking_steps — What tools the agent called, in order.
                             Useful for debugging or building a "show reasoning" UI.

    Note:
        This endpoint can take several seconds to respond because it involves
        multiple round-trips to the Claude API and database queries. Consider
        showing a loading indicator in the frontend.
    """
    # Delegate entirely to the Hermes agent in services/agent.py.
    # The agent runs the ReAct loop and returns a dict with answer/sources/thinking_steps.
    result = await hermes_query(body.question)

    # Unpack the dict into the QueryResponse Pydantic model.
    # FastAPI will validate the fields and serialise them to JSON for the response.
    return QueryResponse(**result)
