"""
models/schema.py — Pydantic data models (schemas) for the Decision Memory Agent.

What this file does:
    Defines the shape of every piece of data that flows through the API:
    - What a decision looks like when it is extracted from text (DecisionExtract).
    - What a client must send to create a decision (DecisionCreate).
    - What the API returns for a decision (DecisionResponse).
    - What a query request/response looks like (QueryRequest, QueryResponse).
    - What user registration/login/token data looks like.

Why it exists:
    Pydantic models serve two purposes:
    1. Validation — if a field is missing or the wrong type, Pydantic raises an
       error before the bad data reaches your business logic.
    2. Documentation — FastAPI reads these models to generate the interactive
       API docs at /docs automatically.

    Having all models in one file makes it easy to see the full data contract
    of the API at a glance.

How it fits in the system:
    - The extractor service (services/extractor.py) returns DecisionExtract objects.
    - The ingest router (routers/ingest.py) accepts DecisionCreate, returns DecisionResponse.
    - The query router (routers/query.py) accepts QueryRequest, returns QueryResponse.
    - The auth router (routers/auth.py) uses UserCreate, UserLogin, and Token.
"""

from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from enum import Enum


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class SourceType(str, Enum):
    """
    The medium from which a decision was captured.

    Inheriting from both str and Enum means the value is stored as a plain
    string in the database (e.g. "text"), not as an enum integer — which makes
    the data readable without knowing the code.
    """
    text = "text"           # Typed directly into the UI
    document = "document"   # Uploaded text or markdown file
    audio = "audio"         # Uploaded audio recording (transcribed first)
    email = "email"         # Reserved for future email parsing
    chat = "chat"           # Reserved for future chat log parsing


# ---------------------------------------------------------------------------
# AI extraction model
# ---------------------------------------------------------------------------

class DecisionExtract(BaseModel):
    """
    The structured data Claude extracts from raw text for a single decision.

    This model mirrors the JSON schema defined in EXTRACT_TOOL inside
    services/extractor.py. When Claude calls the 'record_decision' tool,
    its output is validated against this model.

    All list fields default to an empty list (not None) so the rest of the
    code can safely iterate over them without None-checks everywhere.
    """

    # A short, human-readable title summarising the decision (5-10 words).
    title: str = Field(description="Short title of the decision (5-10 words)")

    # One paragraph explaining what was decided.
    summary: str = Field(description="One paragraph summary of the decision made")

    # The reasoning behind the decision — the "why", not just the "what".
    # This is arguably the most valuable field: years later you want to know
    # WHY a choice was made, not just that it was made.
    rationale: str = Field(description="Why this decision was made — the reasoning")

    # Other options that were considered but rejected. Useful for understanding
    # the decision space and avoiding revisiting options that were already ruled out.
    alternatives_considered: List[str] = Field(default_factory=list, description="Other options that were considered")

    # Risks the decision-makers were aware of and chose to accept anyway.
    risks_accepted: List[str] = Field(default_factory=list, description="Known risks accepted with this decision")

    # Things assumed to be true when the decision was made. If these assumptions
    # turn out to be wrong, the decision may need revisiting.
    assumptions: List[str] = Field(default_factory=list, description="Assumptions this decision depends on")

    # Questions that were still open at the time of the decision. Useful for
    # follow-up and identifying decisions that may be incomplete.
    unresolved_questions: List[str] = Field(default_factory=list, description="Open questions not yet answered")

    # People who are responsible for this decision and its outcomes.
    owners: List[str] = Field(default_factory=list, description="People responsible for this decision")

    # People who disagreed with or opposed the decision. Recording dissent
    # provides a balanced historical record and respects minority views.
    dissenters: List[str] = Field(default_factory=list, description="People who opposed or disagreed")

    # Systems, products, services, or areas of life that the decision affects.
    related_systems: List[str] = Field(default_factory=list, description="Systems, products, or areas affected")

    # Topic tags for grouping and filtering (e.g. "health", "finance", "family").
    tags: List[str] = Field(default_factory=list, description="Relevant topic tags")

    # A gating flag: True means the content actually contains a decision.
    # Claude sets this to False for pure factual statements (e.g. "it rained today")
    # so the extractor can skip saving non-decisions without any additional logic.
    is_decision: bool = Field(description="True only if content contains a real actionable decision")


# ---------------------------------------------------------------------------
# API request/response models
# ---------------------------------------------------------------------------

class DecisionCreate(BaseModel):
    """
    The body a client sends to the POST /ingest/text endpoint.

    raw_text is the only required field — the rest have sensible defaults.
    """

    # The full text to extract decisions from. Can be a sentence, a paragraph,
    # or a multi-page document.
    raw_text: str

    # How the text was captured. Defaults to 'text' (typed input).
    source_type: SourceType = SourceType.text

    # An optional reference string — e.g. a filename, URL, or email subject.
    # Stored for traceability so you can trace a decision back to its source.
    source_ref: Optional[str] = None


class DecisionResponse(BaseModel):
    """
    The shape of a decision object returned by the API.

    Used as the response_model in the ingest and decisions routers, which tells
    FastAPI to validate the response and include only these fields (stripping
    any internal fields like raw database row data).
    """
    id: str
    title: str
    summary: str
    rationale: str
    alternatives_considered: List[str]
    risks_accepted: List[str]
    assumptions: List[str]
    unresolved_questions: List[str]
    owners: List[str]
    dissenters: List[str]
    related_systems: List[str]
    tags: List[str]
    source_type: str
    source_ref: Optional[str]
    created_at: str        # ISO 8601 timestamp string from SQLite
    created_by: str        # User ID of the person who ingested this decision


class QueryRequest(BaseModel):
    """The body sent to POST /query."""

    # A free-form natural language question, e.g. "Why did we choose ChromaDB?"
    question: str


class QueryResponse(BaseModel):
    """
    The response from the Hermes query agent.

    answer: The agent's final natural-language answer.
    sources: The decisions the agent consulted (id + title), so the user
             can drill in for more detail.
    thinking_steps: A log of which tools the agent called and with what
                    arguments — useful for debugging and transparency.
    """
    answer: str
    sources: List[dict]          # Each dict has at least {"id": ..., "title": ...}
    thinking_steps: List[str]    # E.g. ['Calling semantic_search({"query": "..."})', ...]


# ---------------------------------------------------------------------------
# Authentication models
# ---------------------------------------------------------------------------

class UserCreate(BaseModel):
    """
    Body for POST /auth/register.

    invite_code is required to prevent open registration — only people
    who know the family invite code can create an account.
    """
    name: str
    email: str
    password: str       # Plain text; hashed before storage (never stored as-is)
    invite_code: str    # Must match FAMILY_INVITE_CODE in config.py


class UserLogin(BaseModel):
    """Body for POST /auth/login."""
    email: str
    password: str   # Plain text; compared against the stored bcrypt hash


class Token(BaseModel):
    """
    Response returned after a successful login or registration.

    The frontend stores access_token and sends it in the Authorization header
    on every subsequent request:
        Authorization: Bearer <access_token>

    user_name and user_id are included so the frontend can display the user's
    name without making a separate /auth/me call.
    """
    access_token: str   # Signed JWT string
    token_type: str     # Always "bearer" — part of the OAuth2 spec
    user_name: str
    user_id: str
