from __future__ import annotations
# 'from __future__ import annotations' allows Python 3.9 to use `X | None`
# type hint syntax without a runtime error.

"""
db/vector_db.py — ChromaDB vector store for semantic search over decisions.

What this file does:
    Stores a text embedding for each decision, enabling semantic similarity
    search. When a user asks "what decisions did we make about our health?",
    the vector search finds decisions whose meaning is close to the question —
    even if the exact words don't match.

Why a vector database?
    Traditional keyword search (like SQL LIKE '%health%') only matches
    exact words. Vector search converts text into a list of numbers (an
    "embedding") that captures meaning. Two pieces of text with similar
    meaning will have embeddings that are close together in that number-space,
    even if they use different words. This makes it much better for
    natural language queries.

Why ChromaDB?
    ChromaDB is an embedded vector database (like SQLite for vectors) —
    no separate server required. It persists data to disk and supports the
    same query interface as hosted solutions like Pinecone. For a small
    family app, it's the simplest option with zero infrastructure overhead.

Why cosine similarity?
    Cosine similarity measures the angle between two vectors — it's a better
    match quality metric for text than Euclidean (straight-line) distance,
    because it's not affected by the overall length of the text.

DefaultEmbeddingFunction — first-run note:
    ChromaDB's DefaultEmbeddingFunction uses a small local model
    (all-MiniLM-L6-v2) from the sentence-transformers library. The first
    time it is called, it downloads this model from the internet (~80MB).
    Subsequent calls are instant because the model is cached locally.
    This means the very first ingest or query may be slow.

How it fits in the system:
    - Called by ingest router (via add_decision) after each new decision is saved.
    - Called by the Hermes agent (via semantic_search) to find relevant decisions.
    - Called by decisions router (via remove_decision) when a decision is deleted.
"""

import os
import chromadb
from chromadb.utils import embedding_functions

from config import settings


# ---------------------------------------------------------------------------
# Module-level singleton — one ChromaDB client for the whole process
# ---------------------------------------------------------------------------
# We reuse a single client instance rather than opening a new connection
# on every request. This avoids repeated file I/O and model loading overhead.

_client: chromadb.ClientAPI | None = None

# The name of the ChromaDB collection where decisions are stored.
# A collection is roughly equivalent to a table in SQL or an index in Elasticsearch.
COLLECTION_NAME = "decisions"


def get_collection() -> chromadb.Collection:
    """
    Return the ChromaDB 'decisions' collection, initialising the client
    on the first call.

    The collection is created if it doesn't already exist (get_or_create_collection).
    The same embedding function is passed on every call so ChromaDB knows
    how to convert query text to a vector for searching.

    Returns:
        A chromadb.Collection object ready for upsert/query/delete operations.

    Note on DefaultEmbeddingFunction:
        This function uses a locally-run sentence-transformer model.
        The first call may trigger a model download (~80MB). All subsequent
        calls are fast because the model is cached on disk.
    """
    global _client

    # Lazy initialisation — only open the database on first use.
    if _client is None:
        # Ensure the storage directory exists before ChromaDB tries to use it.
        os.makedirs(settings.VECTOR_DIR, exist_ok=True)

        # PersistentClient stores vectors on disk at the given path.
        # Use chromadb.Client() for an in-memory store that doesn't persist
        # (useful for tests), but PersistentClient is what we want in production.
        _client = chromadb.PersistentClient(path=settings.VECTOR_DIR)

    # DefaultEmbeddingFunction wraps the all-MiniLM-L6-v2 sentence-transformer
    # model. It converts any text string into a 384-dimensional float vector.
    # We recreate this object each call — it's lightweight (the model is cached).
    ef = embedding_functions.DefaultEmbeddingFunction()

    # get_or_create_collection is idempotent: creates the collection on first
    # run, returns the existing one on all subsequent runs.
    # 'hnsw:space': 'cosine' tells ChromaDB to use cosine similarity when
    # measuring how close two embeddings are (vs. Euclidean distance, which
    # is the default). Cosine is better for text similarity.
    return _client.get_or_create_collection(
        name=COLLECTION_NAME,
        embedding_function=ef,
        metadata={"hnsw:space": "cosine"},
    )


def add_decision(decision_id: str, title: str, summary: str, rationale: str, tags: list[str]):
    """
    Add (or update) a decision's embedding in the vector store.

    The text stored for each decision is a concatenation of its most
    semantically rich fields: title, summary, rationale, and tags.
    This gives the embedding model the best chance of capturing the
    full meaning of the decision.

    Parameters:
        decision_id: The UUID of the decision (used as the ChromaDB document ID).
        title:       The short decision title.
        summary:     One-paragraph summary of what was decided.
        rationale:   Why the decision was made.
        tags:        List of topic tags (e.g. ["health", "family"]).

    Note:
        'upsert' creates the document if it doesn't exist, or updates it
        if a document with the same ID already exists. This makes re-ingesting
        the same content idempotent.
    """
    collection = get_collection()

    # Build a single text string to embed. Combining all meaningful fields
    # gives the embedding model more context than just the title alone.
    # The format doesn't need to be human-readable — it's only for the
    # embedding model to process.
    text = f"{title}. {summary}. {rationale}. Tags: {', '.join(tags)}"

    collection.upsert(
        ids=[decision_id],
        documents=[text],
        # Metadata is stored alongside the embedding and returned in query results.
        # We store title and tags here so search results can be displayed without
        # a separate database lookup in the simplest cases.
        metadatas=[{"title": title, "tags": ",".join(tags)}],
    )


def semantic_search(query: str, limit: int = 5) -> list[dict]:
    """
    Find decisions whose meaning is most similar to the given query text.

    ChromaDB embeds the query string using the same model used for storage,
    then finds the stored documents whose embeddings are closest (by cosine
    similarity) to the query embedding.

    Parameters:
        query: A natural language question or description.
        limit: Maximum number of results to return (default 5).

    Returns:
        A list of dicts, each with:
            id      — decision UUID
            title   — decision title
            score   — similarity score from 0.0 (no match) to 1.0 (perfect match)
            excerpt — first 200 characters of the stored text

    Note on the score:
        ChromaDB returns 'distances' (lower = more similar when using cosine
        distance). We convert to a similarity score with `1 - distance`
        so that higher scores mean better matches (more intuitive for display).

    Note on min(limit, collection.count()):
        ChromaDB raises an error if you request more results (n_results) than
        documents exist in the collection. We clamp the limit to the actual
        collection size to avoid this error on a nearly-empty database.
    """
    collection = get_collection()
    try:
        results = collection.query(
            query_texts=[query],
            # Prevent requesting more results than exist in the collection.
            n_results=min(limit, collection.count()),
        )

        # If the collection is empty or no results matched, return early.
        if not results["ids"][0]:
            return []

        # ChromaDB returns parallel lists: ids[0][i], distances[0][i], etc.
        # The [0] index selects the results for the first (and only) query.
        return [
            {
                "id": results["ids"][0][i],
                "title": results["metadatas"][0][i].get("title", ""),
                # Convert distance to similarity: distance=0 → score=1.0 (perfect match)
                "score": 1 - results["distances"][0][i],
                # Truncate the stored text to a short excerpt for display.
                "excerpt": results["documents"][0][i][:200],
            }
            for i in range(len(results["ids"][0]))
        ]
    except Exception:
        # If ChromaDB raises (e.g. collection is empty, or a model error),
        # return an empty list rather than crashing the query endpoint.
        return []


def remove_decision(decision_id: str):
    """
    Remove a decision's embedding from the vector store.

    Called when a decision is deleted so the vector store stays in sync
    with the SQLite database.

    Parameters:
        decision_id: The UUID of the decision to remove.
    """
    collection = get_collection()
    try:
        collection.delete(ids=[decision_id])
    except Exception:
        # If the ID doesn't exist in ChromaDB (e.g. it was never indexed),
        # ignore the error — the end result (ID not present) is the same.
        pass
