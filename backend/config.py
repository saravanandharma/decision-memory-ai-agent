"""
config.py — Centralised configuration for the Decision Memory Agent backend.

What this file does:
    Defines every configurable value the app needs — API keys, file paths,
    model names, security settings — in one place using Pydantic's
    BaseSettings class.

Why it exists:
    Hard-coding values like database paths or API keys inside business logic
    makes the app hard to change and impossible to keep secure. Instead, all
    configuration lives here. Values are loaded from environment variables or
    a .env file, so different environments (dev, production) can use different
    values without changing any code.

How it fits in the system:
    Every other module imports `settings` from this file:
        from config import settings
        settings.OPENROUTER_API_KEY  # etc.
    This means there is a single source of truth for all configuration.

────────────────────────────────────────────────────────────────────
AI MODEL ARCHITECTURE — Four models across four layers
────────────────────────────────────────────────────────────────────

All models are accessed via OpenRouter (https://openrouter.ai), which
provides a unified OpenAI-compatible API for hundreds of open-source
and commercial models. A single OPENROUTER_API_KEY unlocks all of them.

  Layer 1 — Fast extraction (short text ≤ EXTRACT_LONG_THRESHOLD words)
  -----------------------------------------------------------------------
  Model : Hermes 3 (Llama-3 8B) by NousResearch
  ID    : nousresearch/hermes-3-llama-3.1-8b
  Why   : Hermes 3 is specifically fine-tuned for instruction-following and
          structured JSON / function-calling output. At 8B parameters it is
          the fastest and cheapest option for extraction tasks that need
          precise schema adherence without heavy reasoning.

  Layer 2 — Deep extraction (long text > EXTRACT_LONG_THRESHOLD words)
  -----------------------------------------------------------------------
  Model : Mistral Small 4 by Mistral AI
  ID    : mistralai/mistral-small-3.1-24b-instruct
  Why   : At 24B parameters Mistral Small handles longer contexts (meeting
          transcripts, uploaded documents) far more accurately than the 8B
          Hermes model. The larger context window reduces the chance of key
          decision details being missed in lengthy inputs.

  Layer 3 — Standard query / agent reasoning
  -----------------------------------------------------------------------
  Model : Nous-Hermes-2-Mixtral-8x7B by NousResearch
  ID    : nousresearch/nous-hermes-2-mixtral-8x7b-dpo
  Why   : The Mixtral MoE (Mixture-of-Experts) architecture gives this model
          strong reasoning at low cost. It is extensively fine-tuned on the
          Hermes instruction format, making it reliable for the multi-step
          ReAct agent loop that Hermes uses to answer questions.

  Layer 4 — Complex / multi-hop query reasoning
  -----------------------------------------------------------------------
  Model : Kimi K2 Thinking by Moonshot AI
  ID    : moonshotai/kimi-k2
  Why   : Kimi K2 is a frontier-class reasoning model with a built-in
          "thinking" step (chain-of-thought). It excels at complex queries
          that require multi-hop reasoning — e.g. "which decision caused the
          budget overrun and who was responsible for it?" Invoked automatically
          when the standard agent reaches its tool-call limit.

────────────────────────────────────────────────────────────────────
Pydantic BaseSettings:
    Automatically reads values from environment variables whose names match
    the field names (case-insensitive). Falls back to the default if the
    variable is not set. Fields with no default (e.g. OPENROUTER_API_KEY)
    will cause the app to refuse to start unless provided.
"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # ------------------------------------------------------------------
    # General application settings
    # ------------------------------------------------------------------

    # Human-readable name shown in API docs and the health check endpoint.
    APP_NAME: str = "Decision Memory Agent"

    # SECRET_KEY is used to sign JWT tokens. Anyone who knows this value can
    # forge authentication tokens, so use a long random string in production.
    # Generate one with: openssl rand -hex 32
    SECRET_KEY: str = "change-this-in-production-use-a-long-random-string"

    # HS256 is a symmetric JWT algorithm — the same key signs and verifies.
    ALGORITHM: str = "HS256"

    # How long a login token stays valid before the user must log in again.
    ACCESS_TOKEN_EXPIRE_DAYS: int = 30

    # ------------------------------------------------------------------
    # OpenRouter API — single key for all four AI models
    # ------------------------------------------------------------------

    # Your OpenRouter API key.
    # Required — the app will refuse to start without it.
    # Get one for free at: https://openrouter.ai/keys
    OPENROUTER_API_KEY: str

    # OpenRouter's API base URL. Uses the OpenAI-compatible /v1 endpoint
    # so we can use the standard openai Python SDK without modification.
    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1"

    # ------------------------------------------------------------------
    # Layer 1 — Fast extraction model (short text)
    # ------------------------------------------------------------------
    # Hermes 3 (Llama-3.1 8B) by NousResearch.
    # Used when input text is EXTRACT_LONG_THRESHOLD words or fewer.
    # Fastest and cheapest of the four models. Fine-tuned for structured
    # JSON / function-calling output.
    EXTRACT_MODEL: str = "nousresearch/hermes-3-llama-3.1-8b"

    # ------------------------------------------------------------------
    # Layer 2 — Deep extraction model (long text)
    # ------------------------------------------------------------------
    # Mistral Small 4 (24B) by Mistral AI.
    # Used when input text exceeds EXTRACT_LONG_THRESHOLD words.
    # The larger 24B model handles long meeting transcripts and uploaded
    # documents more accurately than the 8B Hermes model.
    EXTRACT_LONG_MODEL: str = "mistralai/mistral-small-3.1-24b-instruct"

    # Word count threshold that triggers the switch from Hermes 3 to
    # Mistral Small. Texts with more than this many words use the deeper
    # model. 1500 words ≈ ~10 minutes of speech ≈ ~3 pages of text.
    EXTRACT_LONG_THRESHOLD: int = 1500

    # ------------------------------------------------------------------
    # Layer 3 — Standard query / agent model
    # ------------------------------------------------------------------
    # Nous-Hermes-2-Mixtral-8x7B by NousResearch.
    # The primary model for the Hermes ReAct query agent.
    # Mixtral's MoE architecture gives strong reasoning at low cost.
    # Reliable for the multi-step tool-use loop.
    QUERY_MODEL: str = "nousresearch/nous-hermes-2-mixtral-8x7b-dpo"

    # ------------------------------------------------------------------
    # Layer 4 — Complex reasoning model
    # ------------------------------------------------------------------
    # Kimi K2 Thinking by Moonshot AI.
    # Used automatically when the standard agent (Layer 3) cannot answer
    # within its iteration limit, or when FORCE_DEEP_QUERY=true.
    # Kimi K2 has an internal chain-of-thought "thinking" step that handles
    # multi-hop questions that require deeper reasoning.
    QUERY_DEEP_MODEL: str = "moonshotai/kimi-k2"

    # Set to true to always use Kimi K2 (Layer 4) for queries instead of
    # falling back to it only on complex cases.
    FORCE_DEEP_QUERY: bool = False

    # ------------------------------------------------------------------
    # Registration / access control
    # ------------------------------------------------------------------

    # A simple shared code required at registration time.
    # Only people with this code can create accounts.
    FAMILY_INVITE_CODE: str = "family2024"

    # ------------------------------------------------------------------
    # Storage paths
    # ------------------------------------------------------------------

    # Root directory for all persistent data files.
    DATA_DIR: str = "./data"

    # SQLite database file — stores users and full decision records.
    DB_PATH: str = "./data/decisions.db"

    # Kuzu graph database file path.
    # IMPORTANT: Kuzu 0.9+ stores the database as a SINGLE FILE, not a
    # directory. Never pre-create this path with makedirs. Let Kuzu create it.
    GRAPH_PATH: str = "./data/graph.kuzu"

    # ChromaDB vector store directory.
    VECTOR_DIR: str = "./data/vectors"

    # Directory for uploaded audio / document files awaiting processing.
    UPLOAD_DIR: str = "./data/uploads"

    # ------------------------------------------------------------------
    # Audio transcription settings
    # ------------------------------------------------------------------

    # Whisper model size. "tiny.en" is fastest (free, CPU-only).
    # Options: tiny.en · base.en · small.en · medium.en · large-v2
    WHISPER_MODEL: str = "tiny.en"

    # Set to False to disable audio transcription entirely.
    ENABLE_TRANSCRIPTION: bool = True

    class Config:
        # Pydantic tries these files in order — first match wins per variable.
        # Allows running from inside backend/ (.env) or repo root (.env.prod).
        env_file = (".env", "../.env.prod", ".env.prod")


# ---------------------------------------------------------------------------
# Singleton instance — imported by all other modules as `from config import settings`
# ---------------------------------------------------------------------------
# Pydantic validates all fields when this line executes. A missing required
# field (like OPENROUTER_API_KEY) raises a clear error at startup rather than
# at the moment the key is first used.
settings = Settings()
