from __future__ import annotations
# 'from __future__ import annotations' allows `str | None` and `list[...]`
# type hints to work on Python 3.9 without importing them from `typing`.

"""
routers/ingest.py — Content ingestion endpoints.

What this file does:
    Provides three endpoints for adding new content to the decision memory:
    - POST /ingest/text  — Accept raw typed text and extract decisions from it.
    - POST /ingest/file  — Accept an uploaded text/markdown file.
    - POST /ingest/audio — Accept an audio recording, transcribe it, then extract decisions.

    All three converge on the same internal _process_text function, which:
    1. Calls the Claude Haiku extractor to find structured decisions in the text.
    2. Saves each decision to SQLite (structured storage).
    3. Adds each decision to the Kuzu graph DB (relationship storage).
    4. Adds each decision to ChromaDB (semantic search).
    5. Returns the saved decision records to the client.

Why three separate endpoints instead of one?
    Each input type requires different pre-processing:
    - Text: ready to use immediately.
    - Files: need to be read and decoded from bytes to a string.
    - Audio: need to be saved to disk and transcribed before processing.
    Separating them keeps each endpoint simple and focused.

Why save to THREE databases?
    Each database serves a different query pattern:
    - SQLite: structured queries (list all, filter by date, fetch by ID).
    - Kuzu graph: relationship traversal (who made this? what systems are affected?).
    - ChromaDB: semantic search (find decisions about similar topics).
    Together they let the Hermes agent answer a wide variety of questions.

How it fits in the system:
    Frontend → POST /ingest/* → this router → extractor → [SQLite + Kuzu + ChromaDB]
"""

import os
import aiofiles
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form

from config import settings
from models.schema import DecisionCreate, DecisionResponse
from db import database, graph_db, vector_db
from services import extractor, transcriber
from routers.auth import get_current_user


# ---------------------------------------------------------------------------
# Router setup
# ---------------------------------------------------------------------------

# All routes in this file are under /ingest.
router = APIRouter(prefix="/ingest", tags=["ingest"])

# Allowed file extensions for document and audio uploads.
# Checking extensions is a basic safety measure — it prevents users from
# accidentally uploading binary files that the text decoder can't handle,
# or audio formats that faster-whisper doesn't support.
ALLOWED_AUDIO = {".mp3", ".mp4", ".wav", ".m4a", ".ogg", ".webm"}
ALLOWED_DOCS = {".txt", ".md", ".pdf"}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/text", response_model=list[DecisionResponse])
async def ingest_text(body: DecisionCreate, current_user: dict = Depends(get_current_user)):
    """
    Extract decisions from a plain text string submitted by the user.

    This is the simplest ingestion path — the user types or pastes text
    directly and we extract decisions from it immediately.

    Parameters:
        body:         DecisionCreate with raw_text, source_type, and optional source_ref.
        current_user: Injected by the auth dependency — identifies who is submitting.

    Returns:
        A list of DecisionResponse objects (one per extracted decision).
        Returns an empty list if no decisions are found in the text.
    """
    return await _process_text(body.raw_text, body.source_type, body.source_ref, current_user["id"])


@router.post("/file", response_model=list[DecisionResponse])
async def ingest_file(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """
    Upload a text or markdown file and extract decisions from its contents.

    The file is read entirely into memory, decoded from bytes to a UTF-8
    string, then processed the same way as plain text input.

    Parameters:
        file:         The uploaded file (must be .txt, .md, or .pdf).
        current_user: Injected by the auth dependency.

    Raises:
        400: If the file extension is not in ALLOWED_DOCS.

    Returns:
        A list of DecisionResponse objects.

    Note:
        'errors="ignore"' in the UTF-8 decode silently skips any bytes that
        can't be decoded as UTF-8 (e.g. from a file with mixed encoding).
        This is safer than crashing, though some characters may be lost.
    """
    # Extract and normalise the file extension (e.g. ".TXT" → ".txt").
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_DOCS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")

    # Read the full file contents into memory as bytes, then decode to string.
    content = await file.read()
    text = content.decode("utf-8", errors="ignore")

    # Use the original filename as source_ref so we can trace the decision
    # back to the document it came from.
    return await _process_text(text, "document", file.filename, current_user["id"])


@router.post("/audio", response_model=list[DecisionResponse])
async def ingest_audio(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """
    Upload an audio recording, transcribe it to text, then extract decisions.

    Audio ingestion has an extra step compared to text/file ingestion:
    the audio file must be saved to disk first (faster-whisper reads from
    a file path, not from an in-memory buffer), then transcribed.

    Parameters:
        file:         The uploaded audio file (must be .mp3, .mp4, .wav, .m4a,
                      .ogg, or .webm).
        current_user: Injected by the auth dependency.

    Raises:
        400: If the audio format is not supported.
        422: If transcription fails (disabled, not installed, or audio error).
              The error message from transcriber.transcribe starts with '['
              to distinguish it from a real transcript.

    Returns:
        A list of DecisionResponse objects extracted from the transcript.
    """
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_AUDIO:
        raise HTTPException(status_code=400, detail=f"Unsupported audio type: {ext}")

    # Ensure the uploads directory exists.
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)

    # Save the uploaded audio file to disk.
    # faster-whisper requires a file path (it uses ffmpeg under the hood),
    # so we can't pass the raw bytes directly — we must write to disk first.
    save_path = os.path.join(settings.UPLOAD_DIR, file.filename)
    async with aiofiles.open(save_path, "wb") as f:
        await f.write(await file.read())

    # Transcribe the saved audio file to text.
    text = transcriber.transcribe(save_path)

    # transcriber.transcribe returns a special error string (starting with '[')
    # instead of raising an exception, to allow the caller to handle it cleanly.
    # We surface it as an HTTP 422 (Unprocessable Entity) so the frontend
    # can display the message to the user.
    if text.startswith("["):  # error/warning message from transcriber
        raise HTTPException(status_code=422, detail=text)

    return await _process_text(text, "audio", file.filename, current_user["id"])


# ---------------------------------------------------------------------------
# Shared processing logic
# ---------------------------------------------------------------------------

async def _process_text(text: str, source_type: str, source_ref: str | None, user_id: str) -> list:
    """
    Extract decisions from text and save them to all three databases.

    This is the core ingestion logic shared by all three endpoint handlers.
    It is intentionally an internal function (prefixed with _) — external
    callers should use the public endpoint handlers above.

    Parameters:
        text:        The raw text to extract decisions from.
        source_type: One of "text", "document", "audio" — how the content arrived.
        source_ref:  Optional filename or label identifying the source.
        user_id:     UUID of the authenticated user submitting the content.

    Returns:
        A list of dicts representing the saved decisions (as returned by
        database.get_decision — includes all fields like created_at, creator_name).

    Raises:
        400: If the text is too short to extract anything meaningful from.

    Why minimum 20 characters?
        Very short inputs (e.g. "ok", "yes") are never meaningful decisions and
        would just waste an API call to Claude. 20 characters is a practical
        minimum for any meaningful content.
    """
    # Reject content that is too short to contain a real decision.
    if len(text.strip()) < 20:
        raise HTTPException(status_code=400, detail="Content too short to extract decisions from")

    # Send the text to Claude Haiku for structured extraction.
    # Returns a list of DecisionExtract objects (one per detected decision).
    decisions = extractor.extract_decisions(text)

    # If no decisions were found, return an empty list.
    # This is not an error — it's valid for a piece of text to contain no decisions.
    if not decisions:
        return []

    saved = []
    for d in decisions:
        # Convert the Pydantic model to a plain dict for database storage.
        data = d.model_dump()

        # Add fields that come from the request context (not from Claude's extraction).
        data["raw_text"] = text          # Store original text for future reference
        data["source_type"] = source_type
        data["source_ref"] = source_ref

        # --- Save to SQLite (primary structured store) ---
        # This is the source of truth. It stores the full record and returns
        # a UUID that we use to link the same decision in the other databases.
        decision_id = await database.save_decision(data, user_id)

        # --- Add to Kuzu graph DB (relationship store) ---
        # Creates Decision, Person, System, Risk, and Tag nodes + edges.
        # Enables graph traversal queries: "who made decisions about X?"
        graph_db.add_decision_to_graph(decision_id, d.title, data)

        # --- Add to ChromaDB vector store (semantic search) ---
        # Creates an embedding of the title, summary, rationale, and tags.
        # Enables semantic similarity search: "find decisions about health".
        vector_db.add_decision(decision_id, d.title, d.summary, d.rationale, d.tags)

        # Fetch the full saved record from SQLite to include created_at,
        # creator_name, and other fields populated by the database on insert.
        full = await database.get_decision(decision_id)
        saved.append(full)

    return saved
