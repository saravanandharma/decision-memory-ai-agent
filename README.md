# Decision Memory Agent — Hermes

> **Your family's second brain for decisions.**
> Capture any decision — personal, family, or work — in any format (text, file, or voice recording). Ask natural language questions later and get cited answers.

---

## Table of Contents

1. [What Is This?](#what-is-this)
2. [How It Works](#how-it-works)
3. [Architecture Overview](#architecture-overview)
4. [Tech Stack](#tech-stack)
5. [Project Structure](#project-structure)
6. [Prerequisites](#prerequisites)
7. [Quick Start](#quick-start)
8. [Environment Variables](#environment-variables)
9. [API Reference](#api-reference)
10. [The AI Pipeline (How Decisions Are Extracted)](#the-ai-pipeline)
11. [The Hermes Query Agent](#the-hermes-query-agent)
12. [Database Design](#database-design)
13. [Running on Mobile (iOS & Android)](#running-on-mobile)
14. [Deploying to Production (Railway)](#deploying-to-production)
15. [Estimated Monthly Cost](#estimated-monthly-cost)
16. [Troubleshooting](#troubleshooting)
17. [Extending the App](#extending-the-app)

---

## What Is This?

Most families and small teams make important decisions every day — choosing schools, postponing investments, switching tools, accepting health risks — and forget the *why* within weeks.

**Decision Memory Agent** solves this by acting as a persistent, searchable memory for every decision. You capture decisions in any format; the AI extracts and structures them automatically; later you can ask questions like:

- *"Why did we postpone the GTV application?"*
- *"What risks did we accept when we moved Mahith to the new school?"*
- *"Who opposed the decision to switch to solar panels?"*

---

## How It Works

```
You type / upload / record
        ↓
Layer 1: Hermes 3 (short text)  OR  Layer 2: Mistral Small 4 (long text)
extracts structure: title, rationale, risks, owners, alternatives…
        ↓
Saved to 3 databases
(SQLite + Kuzu graph + ChromaDB vectors)
        ↓
Ask questions later
        ↓
Layer 3: Nous-Hermes-2 searches all 3 databases
  ↓ (if too complex)
Layer 4: Kimi K2 Thinking does deep multi-hop reasoning
        ↓
Cited answer returned
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                   FRONTEND (Expo)                    │
│  Web  ·  iOS  ·  Android  (single codebase)         │
│                                                      │
│  Login  →  Feed  →  Ask Hermes  →  Add Decision     │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP / REST
┌──────────────────────▼──────────────────────────────┐
│                  BACKEND (FastAPI)                   │
│                                                      │
│  /auth/*      JWT-based auth + invite codes          │
│  /ingest/*    Text · File · Audio ingestion          │
│  /decisions/* List · Fetch · Delete                  │
│  /query       Hermes agent (ReAct loop)              │
└──────┬─────────────┬───────────────┬────────────────┘
       │             │               │
┌──────▼──┐   ┌──────▼──┐   ┌───────▼────┐
│ SQLite  │   │  Kuzu   │   │ ChromaDB   │
│ (users, │   │ (graph  │   │ (vector    │
│decisions│   │  DB)    │   │  search)   │
└─────────┘   └─────────┘   └────────────┘

   AI Services — all via OpenRouter (single API key)
   ├── Layer 1: Hermes 3 (Llama-3.1 8B)      → fast extraction (short text)
   ├── Layer 2: Mistral Small 4 (24B)         → deep extraction (long text)
   ├── Layer 3: Nous-Hermes-2-Mixtral-8x7B   → standard Hermes queries
   └── Layer 4: Kimi K2 Thinking             → complex multi-hop reasoning

   Audio — local, free
   └── faster-whisper (tiny.en model, runs in Docker container)
```

---

## Tech Stack

### Backend

| Layer | Technology | Why |
|---|---|---|
| Web framework | **FastAPI** (Python) | Async, auto-generates API docs, excellent typing support |
| AI gateway | **OpenRouter** | Unified OpenAI-compatible API for all four open-source models; single API key |
| Layer 1 — Fast extraction | **Hermes 3** (Llama-3.1 8B · NousResearch) | Fine-tuned for structured JSON / function-calling; fastest and cheapest for short text |
| Layer 2 — Deep extraction | **Mistral Small 4** (24B · Mistral AI) | Better long-context accuracy for meeting transcripts and uploaded documents |
| Layer 3 — Standard queries | **Nous-Hermes-2-Mixtral-8x7B** (NousResearch) | MoE architecture; reliable tool-use for the ReAct agent loop |
| Layer 4 — Complex reasoning | **Kimi K2 Thinking** (Moonshot AI) | Frontier reasoning model with built-in chain-of-thought; handles multi-hop questions |
| Structured storage | **SQLite** + `aiosqlite` | Zero-config file database; async-friendly |
| Graph storage | **Kuzu** (embedded graph DB) | SQLite equivalent for graphs; enables relationship queries |
| Vector storage | **ChromaDB** (embedded) | Semantic similarity search; no server required |
| Audio transcription | **faster-whisper** (local) | Free, runs on CPU in Docker, no API cost |
| Authentication | **bcrypt** + **python-jose** | Industry-standard password hashing + JWT tokens |
| Settings | **pydantic-settings** | Validated environment variable loading |

### Frontend

| Layer | Technology | Why |
|---|---|---|
| Framework | **Expo** (React Native) | Single codebase for iOS, Android, and Web |
| Routing | **Expo Router v3** | File-based routing; typed routes |
| HTTP client | **axios** | Interceptor support for auto-attaching JWT tokens |
| Storage | **AsyncStorage** | Persistent token storage that survives app restarts |
| Icons | **@expo/vector-icons** | Ionicons set included; no extra setup |

---

## Project Structure

```
Decision-Memory-Agent/
│
├── .env.prod                    # Your API keys and config (git-ignored)
├── .env.example                 # Template showing all required variables
├── .gitignore                   # Excludes .env, data/, node_modules/
├── docker-compose.yml           # One-command local backend startup
│
├── backend/
│   ├── main.py                  # FastAPI app entry point; startup + CORS + routing
│   ├── config.py                # All settings — four model IDs, paths, security
│   ├── requirements.txt         # Python dependencies (uses openai SDK for OpenRouter)
│   ├── Dockerfile               # Containerises the backend
│   │
│   ├── models/
│   │   └── schema.py            # Pydantic models for requests, responses, AI output
│   │
│   ├── db/
│   │   ├── database.py          # SQLite operations (users + decisions)
│   │   ├── graph_db.py          # Kuzu graph operations (nodes + edges)
│   │   └── vector_db.py         # ChromaDB semantic search operations
│   │
│   ├── services/
│   │   ├── extractor.py         # Layer 1+2: Hermes 3 / Mistral Small 4 extraction
│   │   ├── agent.py             # Layer 3+4: Nous-Hermes-2 / Kimi K2 ReAct agent
│   │   └── transcriber.py       # faster-whisper audio transcription
│   │
│   └── routers/
│       ├── auth.py              # /auth/* — register, login, me + JWT utilities
│       ├── ingest.py            # /ingest/* — text, file, audio ingestion
│       ├── decisions.py         # /decisions/* — list, get, delete
│       └── query.py             # /query — Hermes natural language Q&A
│
├── frontend/
│   ├── app.json                 # Expo configuration (bundle IDs, plugins)
│   ├── package.json             # npm dependencies
│   ├── tsconfig.json            # TypeScript configuration
│   ├── babel.config.js          # Babel / Metro bundler config
│   ├── metro.config.js          # Metro bundler config (extends expo default)
│   ├── expo-env.d.ts            # Expo-generated type declarations
│   │
│   ├── constants/
│   │   └── Colors.ts            # Dark-theme colour palette (single source of truth)
│   │
│   ├── services/
│   │   └── api.ts               # All backend API calls (axios + JWT interceptor)
│   │
│   ├── components/
│   │   ├── DecisionCard.tsx     # Card shown in the feed for each decision
│   │   └── MessageBubble.tsx    # Chat bubble for Hermes Q&A screen
│   │
│   └── app/                     # Expo Router file-based routing
│       ├── _layout.tsx          # Root layout — always renders <Stack> first
│       ├── index.tsx            # Entry point — redirects to login or feed
│       ├── login.tsx            # Login + registration screen
│       ├── decision/
│       │   └── [id].tsx         # Full decision detail screen
│       └── (tabs)/
│           ├── _layout.tsx      # Tab bar layout with 3 tabs
│           ├── index.tsx        # Tab 1: Decision feed
│           ├── ask.tsx          # Tab 2: Ask Hermes
│           └── add.tsx          # Tab 3: Add decision (text/file/record)
│
└── data/                        # Runtime data (git-ignored, Docker volume)
    ├── decisions.db             # SQLite database
    ├── graph.kuzu               # Kuzu graph database file
    ├── vectors/                 # ChromaDB vector store
    └── uploads/                 # Uploaded audio/document files
```

---

## Prerequisites

| Tool | Minimum version | Install |
|---|---|---|
| Docker Desktop | 24+ | [docker.com](https://www.docker.com/products/docker-desktop/) |
| Node.js | 18+ | [nodejs.org](https://nodejs.org) |
| npm | 9+ | bundled with Node.js |
| Expo Go app | latest | App Store / Google Play (for physical device testing) |
| OpenRouter API key | — | [openrouter.ai/keys](https://openrouter.ai/keys) — free to create |

---

## Quick Start

### Step 1 — Clone and configure

```bash
git clone <your-repo-url>
cd Decision-Memory-Agent

# Copy the example config and fill in your API key
cp .env.example .env.prod
```

Open `.env.prod` and set at minimum:
```bash
OPENROUTER_API_KEY=sk-or-...   # Required — get free at openrouter.ai/keys
FAMILY_INVITE_CODE=family2024  # Change this to something only your family knows
SECRET_KEY=<random-64-char-string>  # Run: openssl rand -hex 32
```

### Step 2 — Start the backend

```bash
docker compose up --build
```

The first build takes 3–5 minutes (downloads Python, installs packages).
On success you will see:
```
[seed] Test user created — email: test@family.com  password: test1234
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000
```

Verify it's healthy:
```bash
curl http://localhost:8000/health
# → {"status":"ok","app":"Decision Memory Agent"}
```

### Step 3 — Start the frontend

```bash
cd frontend
npm install
npx expo start
```

Then press:
- **`w`** — Open in your web browser (http://localhost:8081)
- **`i`** — Open in iOS Simulator (requires Xcode on Mac)
- **`a`** — Open in Android Emulator (requires Android Studio)
- **Scan the QR code** — Open in Expo Go on your physical phone

### Step 4 — Log in

Use the test account seeded automatically on first start:
```
Email:    test@family.com
Password: test1234
```

Or register a new account with the invite code from your `.env.prod`.

---

## Environment Variables

All variables live in `.env.prod` at the project root.

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENROUTER_API_KEY` | ✅ Yes | — | Your OpenRouter API key (access to all 4 models) |
| `FAMILY_INVITE_CODE` | ✅ Yes | `family2024` | Code required to register |
| `SECRET_KEY` | ✅ Yes | *(insecure default)* | JWT signing key — generate a random one |
| `EXTRACT_MODEL` | No | `nousresearch/hermes-3-llama-3.1-8b` | Layer 1: fast extraction (short text) |
| `EXTRACT_LONG_MODEL` | No | `mistralai/mistral-small-3.1-24b-instruct` | Layer 2: deep extraction (long text) |
| `EXTRACT_LONG_THRESHOLD` | No | `1500` | Word count above which Layer 2 is used |
| `QUERY_MODEL` | No | `nousresearch/nous-hermes-2-mixtral-8x7b-dpo` | Layer 3: standard Hermes queries |
| `QUERY_DEEP_MODEL` | No | `moonshotai/kimi-k2` | Layer 4: complex / multi-hop reasoning |
| `FORCE_DEEP_QUERY` | No | `false` | Always use Kimi K2 for every query |
| `WHISPER_MODEL` | No | `tiny.en` | Whisper model for audio transcription |
| `ENABLE_TRANSCRIPTION` | No | `true` | Set `false` to disable audio transcription |
| `ACCESS_TOKEN_EXPIRE_DAYS` | No | `30` | How long login tokens stay valid |
| `DATA_DIR` | No | `./data` | Root directory for all persistent data |
| `DB_PATH` | No | `./data/decisions.db` | SQLite database file path |
| `GRAPH_PATH` | No | `./data/graph.kuzu` | Kuzu graph database file path |
| `VECTOR_DIR` | No | `./data/vectors` | ChromaDB storage directory |
| `UPLOAD_DIR` | No | `./data/uploads` | Uploaded audio/file storage |

> **⚠️ Security note:** Never commit `.env.prod` to git. The `.gitignore` already excludes it.

---

## API Reference

All endpoints except `/health` require a `Authorization: Bearer <token>` header.
Get a token from `/auth/login` or `/auth/register`.

Interactive API docs are available at **http://localhost:8000/docs** when the backend is running.

### Auth

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/auth/register` | Register with `{name, email, password, invite_code}` |
| `POST` | `/auth/login` | Login with `{email, password}`, returns JWT token |
| `GET` | `/auth/me` | Returns current user profile |

### Decisions

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/decisions` | List all decisions (newest first). Query params: `limit`, `offset` |
| `GET` | `/decisions/{id}` | Get one decision by UUID |
| `DELETE` | `/decisions/{id}` | Delete a decision from all 3 databases |

### Ingest

| Method | Endpoint | Body | Description |
|---|---|---|---|
| `POST` | `/ingest/text` | `{raw_text, source_type?, source_ref?}` | Extract decisions from text |
| `POST` | `/ingest/file` | multipart file (.txt/.md/.pdf) | Upload and extract from file |
| `POST` | `/ingest/audio` | multipart file (.mp3/.wav/.m4a/…) | Transcribe and extract from audio |

### Query

| Method | Endpoint | Body | Description |
|---|---|---|---|
| `POST` | `/query` | `{question}` | Ask Hermes a natural language question |

---

## The AI Pipeline

### Four-model extraction strategy

When you submit text (typed, uploaded, or transcribed), the backend runs:

```
Raw text
    │
    ├── word_count ≤ 1500?  → Layer 1: Hermes 3 (Llama-3.1 8B)
    │                           Fast, cheap, tuned for structured JSON
    │
    └── word_count > 1500?  → Layer 2: Mistral Small 4 (24B)
                                Better long-context accuracy for transcripts/docs
    │
    ▼
Tool call: record_decision({ title, rationale, risks, owners, alternatives, ... })
    │
    ▼
DecisionExtract validated by Pydantic
    │  filter: is_decision == True
    │
    ├──▶ SQLite (database.py)     — full structured record
    ├──▶ Kuzu graph (graph_db.py) — nodes + edges for relationships
    └──▶ ChromaDB (vector_db.py)  — embedding for semantic search
```

### Why function-calling for structured output?

Asking a model to "output JSON" is unreliable — it may add prose, use wrong field names, or produce malformed JSON. Function-calling forces the model to fill in an exact schema via the `record_decision` tool definition. This gives valid, typed output every time across all four models.

### What gets extracted

Every decision record contains:

| Field | Example |
|---|---|
| `title` | "Postpone GTV application for 4 months" |
| `summary` | One-paragraph description of the decision |
| `rationale` | Why the decision was made |
| `alternatives_considered` | Options that were rejected |
| `risks_accepted` | Known downsides accepted |
| `assumptions` | What the decision depends on being true |
| `unresolved_questions` | Open questions left unanswered |
| `owners` | People responsible |
| `dissenters` | People who opposed |
| `related_systems` | Systems/areas affected |
| `tags` | Topic tags (finance, health, family…) |

### What counts as a decision?

The extraction prompt is deliberately generous for family use:

- ✅ *"Mahith went to play outside since he had concerns about watching TV"*
- ✅ *"We decided to postpone the GTV application for cash flow reasons"*
- ✅ *"Leadership approved the 4-day work week starting Q3"*
- ✅ *"After debate, we chose React Native over Flutter"*
- ❌ *"It rained today"* — pure fact, no choice
- ❌ *"The meeting lasted one hour"* — observation, no decision

---

## The Hermes Query Agent

Hermes uses the **ReAct** (Reasoning + Acting) pattern with two-stage escalation.

### Two-stage model escalation

```
User question
    │
    ▼ Stage 1 — Nous-Hermes-2-Mixtral-8x7B (Layer 3)
    │   Up to 8 tool-call iterations
    │   ├── Tool: search_graph(keyword)          → Kuzu graph
    │   ├── Tool: semantic_search(question)      → ChromaDB vectors
    │   └── Tool: get_decision_detail(uuid)      → SQLite
    │
    ├── Answered within 8 steps → return answer ✓
    │
    └── Reached limit without answer
            │
            ▼ Stage 2 — Kimi K2 Thinking (Layer 4)
                Up to 12 tool-call iterations (fresh start)
                Same 3 tools available
                Built-in chain-of-thought handles complex multi-hop questions
                    │
                    ▼
                Final answer with citations
                + sources list (decision titles)
                + thinking_steps log (which model called which tool)
```

### The three tools

| Tool | When Hermes uses it | Searches |
|---|---|---|
| `search_graph` | Person/system/tag keyword lookup | Kuzu graph DB |
| `semantic_search` | Meaning-based natural language search | ChromaDB vectors |
| `get_decision_detail` | Fetch full record once ID is known | SQLite |

### Force deep reasoning

Set `FORCE_DEEP_QUERY=true` in `.env.prod` to always use Kimi K2 Thinking for every query. Useful for testing or when all questions are complex.

---

## Database Design

### SQLite — structured records

```sql
users
  id TEXT (UUID PK)
  name TEXT
  email TEXT (UNIQUE)
  hashed_password TEXT
  created_at TIMESTAMP

decisions
  id TEXT (UUID PK)
  title TEXT
  summary TEXT
  rationale TEXT
  raw_text TEXT               -- original unprocessed input
  alternatives_considered TEXT  -- JSON array string
  risks_accepted TEXT           -- JSON array string
  assumptions TEXT              -- JSON array string
  unresolved_questions TEXT     -- JSON array string
  owners TEXT                   -- JSON array string
  dissenters TEXT               -- JSON array string
  related_systems TEXT          -- JSON array string
  tags TEXT                     -- JSON array string
  source_type TEXT              -- "text" | "document" | "audio"
  source_ref TEXT               -- filename or label
  created_at TIMESTAMP
  created_by TEXT (FK → users.id)
```

### Kuzu — relationship graph

```
Nodes:    Decision · Person · System · Risk · Tag
Edges:    MADE_BY · OPPOSED_BY · AFFECTS · HAS_RISK · HAS_TAG
```

Example paths:
```
(Decision "Switch to solar") -[MADE_BY]→    (Person "Dad")
(Decision "Switch to solar") -[OPPOSED_BY]→ (Person "Mum")
(Decision "Switch to solar") -[AFFECTS]→    (System "Electricity budget")
(Decision "Switch to solar") -[HAS_TAG]→    (Tag "energy")
```

### ChromaDB — vector embeddings

Each decision is stored as a 384-dimensional embedding of its `title + summary + rationale + tags`. The model used is **all-MiniLM-L6-v2** (downloaded automatically on first use, ~80MB).

---

## Running on Mobile

### iOS Simulator (Mac only)

```bash
cd frontend
npx expo start --ios
```

Requires Xcode to be installed.

### Android Emulator

```bash
cd frontend
npx expo start --android
```

Requires Android Studio and a running emulator.

### Physical Device (Expo Go)

1. Install **Expo Go** from the App Store or Google Play
2. Run `npx expo start` in the frontend directory
3. Scan the QR code shown in the terminal

> **Note:** For the app to reach your backend from a physical device, your phone and computer must be on the same Wi-Fi network. Update `API_URL` in `frontend/services/api.ts` to use your computer's local IP address (e.g. `http://192.168.1.42:8000`).

---

## Deploying to Production (Railway)

[Railway](https://railway.app) is the cheapest hosted option for this backend (~$5/month).

### Step 1 — Push your code to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/yourname/decision-memory-agent.git
git push -u origin main
```

### Step 2 — Create a Railway project

1. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
2. Select your repository
3. Railway detects the `Dockerfile` automatically

### Step 3 — Set environment variables

In the Railway dashboard → your service → Variables, add:
- `OPENROUTER_API_KEY`
- `FAMILY_INVITE_CODE`
- `SECRET_KEY`

### Step 4 — Add a persistent volume

In Railway → your service → Volumes:
- Mount path: `/app/data`

This ensures your SQLite, Kuzu, and ChromaDB data persists across deployments.

### Step 5 — Update the frontend API URL

In `frontend/services/api.ts` (or `app.json` extra.apiUrl):
```typescript
const API_URL = "https://your-app.railway.app";
```

---

## Estimated Monthly Cost

All costs are approximate based on moderate family usage (~10 decisions/day, ~20 questions/day).

| Component | Model | Cost |
|---|---|---|
| Railway hosting | — | ~$5/month |
| Short extraction | Hermes 3 (Llama-3.1 8B) via OpenRouter | ~$0.50/month |
| Long extraction | Mistral Small 4 (24B) via OpenRouter | ~$0.50/month |
| Standard queries | Nous-Hermes-2-Mixtral-8x7B via OpenRouter | ~$1–2/month |
| Complex queries | Kimi K2 Thinking via OpenRouter | ~$1–2/month |
| Audio transcription | faster-whisper (local, in Docker) | **Free** |
| ChromaDB · Kuzu · SQLite | embedded databases | **Free** |
| **Total** | | **~$8–10/month** |

> OpenRouter pricing is pay-per-token with no subscription. Actual costs depend on usage.
> Check current prices at [openrouter.ai/models](https://openrouter.ai/models).

---

## Troubleshooting

### Backend won't start

```bash
docker logs $(docker ps -q --filter "expose=8000") --tail=50
```

**Common causes:**
- `OPENROUTER_API_KEY` not set → add it to `.env.prod`
- Port 8000 already in use → `lsof -i :8000` then kill the process

---

### "Database path cannot be a directory" (Kuzu error)

**Cause:** The `./data/graph` directory was pre-created, but Kuzu 0.9+ stores the database as a single file, not a directory.

**Fix:**
```bash
rm -rf data/graph data/graph.kuzu
docker compose up --build
```

---

### Login fails with 500 Internal Server Error

```bash
docker compose down
docker compose up --build
```

---

### "No decisions found" when adding text

The text must contain an actual choice. Add context about what was chosen and why:

❌ `"We talked about the project today"`
✅ `"We decided to use React over Vue because our team knows it better"`

---

### Hermes gives wrong or empty answers

- Make sure at least a few decisions have been added first
- ChromaDB downloads an embedding model (~80MB) on first use — the first query may be slow
- Try setting `FORCE_DEEP_QUERY=true` to escalate to Kimi K2 for all queries
- Check backend logs: `docker logs $(docker ps -q --filter "expose=8000") --tail=30`

---

### OpenRouter returns a 401 error

Your `OPENROUTER_API_KEY` is invalid or not set. Get a free key at [openrouter.ai/keys](https://openrouter.ai/keys).

---

### A specific model is unavailable

OpenRouter model IDs can change. Check [openrouter.ai/models](https://openrouter.ai/models) for current IDs and update in `.env.prod`. All four model variables are individually configurable.

---

### Frontend can't reach backend on physical device

Update the API URL to your machine's local IP:
```typescript
// frontend/services/api.ts
const API_URL = "http://192.168.1.XX:8000";  // replace with your IP
```

Find your IP: `ipconfig getifaddr en0` (Mac) or `hostname -I` (Linux).

---

## Extending the App

### Add a new decision field

1. Add the field to `DecisionExtract` in `backend/models/schema.py`
2. Add the field to `EXTRACT_TOOL` parameters in `backend/services/extractor.py`
3. Add a column to the `decisions` table in `backend/db/database.py` → `init_db()`
4. Update `save_decision()` and `_row_to_dict()` in `database.py`
5. Display the field in `frontend/app/decision/[id].tsx`

### Add a new graph relationship

1. Add a new edge table in `graph_db._init_schema()`:
   ```python
   "CREATE REL TABLE IF NOT EXISTS CAUSED(FROM Decision TO Decision)"
   ```
2. Populate the edge in `add_decision_to_graph()` when relevant data is available
3. Add a search query for the new relationship in `search_graph()`

### Swap to a different model

All four models are individually configurable via `.env.prod`. Any OpenRouter-compatible model ID works:
```bash
# Use a different extraction model
EXTRACT_MODEL=meta-llama/llama-3.1-8b-instruct

# Use GPT-4o for queries
QUERY_MODEL=openai/gpt-4o

# Use Claude Sonnet for deep reasoning
QUERY_DEEP_MODEL=anthropic/claude-sonnet-4-6
```

### Add email notifications

Add a new service file `backend/services/notifier.py` using `sendgrid` or `resend`, then call it from `routers/ingest.py` after `_process_text`.

---

## Test Credentials

A test account is automatically created on first startup:

| Field | Value |
|---|---|
| Email | `test@family.com` |
| Password | `test1234` |
| Invite code | `family2024` (for registering new accounts) |

> Remove the test user seed block from `backend/main.py` before sharing the app publicly.

---

## Licence

MIT — free to use, modify, and distribute.
