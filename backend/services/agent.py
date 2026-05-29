"""
services/agent.py — Hermes query agent using open-source models via OpenRouter.

What this file does:
    Implements the 'Hermes' agent that answers natural language questions about
    past decisions. When a user asks "why did we postpone the GTV application?",
    Hermes searches through stored decisions and returns a cited answer.

────────────────────────────────────────────────────────────────────
TWO-MODEL QUERY STRATEGY
────────────────────────────────────────────────────────────────────

Layer 3 — Nous-Hermes-2-Mixtral-8x7B  [standard queries]
    The primary model for the Hermes ReAct agent. NousResearch's
    Nous-Hermes-2 fine-tune on Mixtral's 8x7B MoE (Mixture-of-Experts)
    architecture gives it strong reasoning at low cost. The Hermes
    instruction format is baked in — it reliably follows the ReAct
    loop and calls tools correctly.

    Used for: most questions, all queries by default.

Layer 4 — Kimi K2 Thinking by Moonshot AI  [complex / multi-hop queries]
    A frontier reasoning model with an internal chain-of-thought
    "thinking" step. Invoked automatically when Layer 3 reaches its
    maximum iteration limit without producing an answer — meaning the
    question is too complex for the standard model.

    Also invoked when FORCE_DEEP_QUERY=true in config (for testing or
    when the user explicitly wants deeper reasoning on every query).

    Used for: multi-hop questions, causal chains ("which decision caused
    this problem?"), questions spanning many decisions.

────────────────────────────────────────────────────────────────────
THE ReAct LOOP (Reasoning + Acting)
────────────────────────────────────────────────────────────────────

The ReAct pattern is a standard technique for AI agents:

  1. THINK  — The model reads the question and decides what to do next.
  2. ACT    — The model calls one or more tools to gather information.
  3. OBSERVE — The model reads the tool results.
  4. REPEAT — Steps 1-3 repeat until the model has enough information.
  5. ANSWER — The model writes its final answer (finish_reason = "stop").

The loop runs for at most MAX_ITERATIONS rounds on the primary model.
If it hasn't answered by then, we re-run the full question on Kimi K2
Thinking (Layer 4) with a higher iteration limit.

────────────────────────────────────────────────────────────────────
THREE TOOLS AVAILABLE TO HERMES
────────────────────────────────────────────────────────────────────

  search_graph      — Fast keyword search in the Kuzu graph DB.
                      Finds decisions by person name, system name, or tag.
  semantic_search   — Meaning-based search in the ChromaDB vector store.
                      Finds decisions by semantic similarity to the question.
  get_decision_detail — Fetches the full structured record for one decision
                        by its UUID from SQLite.

Typical query flow:
  User: "Why did we choose PostgreSQL?"
    → semantic_search("PostgreSQL choice rationale")
    → search_graph("PostgreSQL")
    → get_decision_detail("<uuid>")
    → Final answer with citation

────────────────────────────────────────────────────────────────────
OPENAI SDK FORMAT DIFFERENCES (vs Anthropic format)
────────────────────────────────────────────────────────────────────

The OpenAI / OpenRouter API uses a different format for tool interactions
than the Anthropic API. Key differences:

  Anthropic                        │  OpenAI (used here)
  ─────────────────────────────────┼────────────────────────────────────
  stop_reason = "tool_use"         │  finish_reason = "tool_calls"
  stop_reason = "end_turn"         │  finish_reason = "stop"
  content = list of blocks         │  choices[0].message
  block.type == "tool_use"         │  message.tool_calls[i]
  block.input (dict)               │  tool_call.function.arguments (str)
  {"type": "tool_result", ...}     │  {"role": "tool", "tool_call_id": ...}
    in a user message              │    as a separate message

How it fits in the system:
    query router → agent.query(question) → dict(answer, sources, thinking_steps)
"""

from __future__ import annotations

import json
from openai import OpenAI

from config import settings
from db import graph_db, vector_db, database


# ---------------------------------------------------------------------------
# OpenRouter client
# ---------------------------------------------------------------------------
# The openai SDK is pointed at OpenRouter's base URL.
# Both Nous-Hermes-2 (Layer 3) and Kimi K2 (Layer 4) are accessed through
# this single client by passing different model IDs.
client = OpenAI(
    base_url=settings.OPENROUTER_BASE_URL,
    api_key=settings.OPENROUTER_API_KEY,
    default_headers={
        "HTTP-Referer": "https://decision-memory-agent.local",
        "X-Title": "Decision Memory Agent",
    },
)

# Maximum tool-call iterations for the standard model (Layer 3).
# If this limit is reached without a final answer, the question is
# escalated to Kimi K2 Thinking (Layer 4).
MAX_ITERATIONS = 8

# Higher limit for Kimi K2 Thinking (Layer 4) — it may need more steps
# for complex multi-hop reasoning chains.
MAX_ITERATIONS_DEEP = 12


# ---------------------------------------------------------------------------
# System prompt — defines Hermes's role, tools, and search strategy
# ---------------------------------------------------------------------------
HERMES_SYSTEM = """You are Hermes, a decision memory agent for a family app.
Your job is to answer questions about decisions made by the family — why they were made, what alternatives were considered, who was involved, and what risks were accepted.

You have three tools available:
- search_graph: finds decisions related to a person name, system name, or topic keyword via graph traversal
- semantic_search: finds semantically similar decisions using vector search (best for meaning-based questions)
- get_decision_detail: fetches the full structured record of a specific decision by its UUID

Strategy:
1. "Why did we choose X?" → semantic_search first, then get_decision_detail on top results
2. "Who decided X?" or "Who opposed X?" → search_graph with the person name
3. "What decisions affect X system?" → search_graph with the system name
4. "What risks did we accept?" → semantic_search for "risks" or "accepted risk"
5. Always call get_decision_detail on any promising result to read the full record before answering
6. Cite sources by decision title and date in your final answer

If no relevant decisions are found, say so clearly rather than guessing."""


# ---------------------------------------------------------------------------
# Tool definitions — OpenAI function-calling format
# ---------------------------------------------------------------------------
# These are the three tools Hermes can call during its reasoning loop.
# The model reads the descriptions to decide when and how to use each one.
HERMES_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_graph",
            "description": (
                "Search the decision knowledge graph by person name, system name, or topic keyword. "
                "Returns a list of matching decision IDs and titles. "
                "Best for: finding decisions involving a specific person, affecting a specific system, "
                "or tagged with a specific topic."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The person name, system name, or keyword to search for",
                    }
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "semantic_search",
            "description": (
                "Find decisions whose meaning is semantically similar to the query using vector search. "
                "Best for: natural language questions where you don't know the exact person or system name. "
                "Returns decision IDs, titles, and similarity scores."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Natural language description of what you are looking for",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of results to return (default: 5)",
                        "default": 5,
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_decision_detail",
            "description": (
                "Fetch the full structured record of a specific decision by its UUID. "
                "Returns all fields: title, summary, rationale, alternatives, risks, owners, etc. "
                "Always call this after search_graph or semantic_search to read the full content "
                "before writing your final answer."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "decision_id": {
                        "type": "string",
                        "description": "The UUID of the decision to fetch",
                    }
                },
                "required": ["decision_id"],
            },
        },
    },
]


# ---------------------------------------------------------------------------
# Tool dispatcher — maps tool names to database functions
# ---------------------------------------------------------------------------

async def _dispatch_tool(name: str, inputs: dict) -> dict:
    """
    Execute the named tool with the given inputs and return the result.

    This is the bridge between the model's tool call and our actual database
    functions. The result is serialised to JSON and returned to the model
    as the tool response.

    Parameters:
        name:   The tool name (one of "search_graph", "semantic_search",
                "get_decision_detail").
        inputs: The arguments the model provided, parsed from JSON.

    Returns:
        A dict that will be JSON-serialised and sent back to the model.
        Always returns a dict (never raises) so the model can react gracefully.
    """
    if name == "search_graph":
        results = graph_db.search_graph(inputs["query"])
        return {"results": results, "count": len(results)}

    if name == "semantic_search":
        results = vector_db.semantic_search(
            inputs["query"], limit=inputs.get("limit", 5)
        )
        return {"results": results, "count": len(results)}

    if name == "get_decision_detail":
        decision = await database.get_decision(inputs["decision_id"])
        if decision:
            return {"decision": decision}
        return {"error": "Decision not found"}

    return {"error": f"Unknown tool: {name}"}


# ---------------------------------------------------------------------------
# ReAct loop — single run with a given model
# ---------------------------------------------------------------------------

async def _run_react_loop(
    question: str,
    model: str,
    max_iterations: int,
    existing_sources: list[dict],
    existing_steps: list[str],
) -> dict | None:
    """
    Run the ReAct (Reasoning + Acting) loop for a single model.

    Sends the question to the specified model and iterates until either:
    - The model produces a final answer (finish_reason = "stop")  → returns dict
    - The maximum iteration count is reached                      → returns None

    Returning None signals to the caller that this model couldn't answer and
    the question should be escalated to the next model (Layer 4).

    Parameters:
        question:         The user's natural language question.
        model:            The OpenRouter model ID to use for this run.
        max_iterations:   Maximum number of tool-call rounds before giving up.
        existing_sources: Accumulated sources list (modified in place).
        existing_steps:   Accumulated thinking steps log (modified in place).

    Returns:
        A dict with keys 'answer', 'sources', 'thinking_steps' on success.
        None if the iteration limit was reached without a final answer.
    """
    # Start the conversation with the user's question.
    messages: list[dict] = [
        {"role": "system", "content": HERMES_SYSTEM},
        {"role": "user", "content": question},
    ]

    for iteration in range(max_iterations):
        # Call the model for one step of reasoning
        response = client.chat.completions.create(
            model=model,
            max_tokens=4096,
            messages=messages,
            tools=HERMES_TOOLS,
            # "auto" lets the model decide when it has enough info to stop calling tools.
            # When it's ready to answer, it sets finish_reason="stop" instead of "tool_calls".
            tool_choice="auto",
        )

        choice = response.choices[0]

        # ── Case 1: Model has finished reasoning and is giving the final answer ──
        if choice.finish_reason == "stop":
            answer = choice.message.content or "I could not find relevant decisions to answer your question."
            return {
                "answer": answer,
                "sources": existing_sources,
                "thinking_steps": existing_steps,
            }

        # ── Case 2: Model wants to call one or more tools ──
        if choice.finish_reason == "tool_calls":
            tool_calls = choice.message.tool_calls or []

            # Process each tool call and collect results
            tool_result_messages = []
            for tool_call in tool_calls:
                func_name = tool_call.function.name
                # The arguments come as a JSON string — parse it to a dict
                try:
                    func_args = json.loads(tool_call.function.arguments)
                except json.JSONDecodeError:
                    func_args = {}

                # Log the tool call for transparency
                existing_steps.append(
                    f"[{model.split('/')[-1]}] Calling {func_name}({json.dumps(func_args)})"
                )

                # Execute the tool and get the result
                result = await _dispatch_tool(func_name, func_args)

                # Collect sources for citation in the final answer
                if func_name in ("search_graph", "semantic_search"):
                    for r in result.get("results", []):
                        if r.get("id") not in {s.get("id") for s in existing_sources}:
                            existing_sources.append({"id": r["id"], "title": r.get("title", "")})
                elif func_name == "get_decision_detail" and "decision" in result:
                    d = result["decision"]
                    if d["id"] not in {s.get("id") for s in existing_sources}:
                        existing_sources.append({"id": d["id"], "title": d["title"]})

                # Build the tool result message in OpenAI format.
                # In OpenAI's API, tool results are separate messages with role="tool",
                # each matched to its tool_call by tool_call_id.
                # This is different from Anthropic's format where tool results are
                # embedded in a user message as {"type": "tool_result", ...}.
                tool_result_messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,   # Must match the tool_call's id
                    "content": json.dumps(result),   # Result as JSON string
                })

            # Append the model's response (which contains the tool_use blocks)
            # to the conversation history so the model can see what it already asked.
            # We convert to dict format expected by the messages list.
            messages.append({
                "role": "assistant",
                "content": choice.message.content,   # May be None if model only called tools
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        },
                    }
                    for tc in tool_calls
                ],
            })

            # Append all tool results to the conversation.
            # Each result is a separate message (unlike Anthropic where they're batched).
            messages.extend(tool_result_messages)

    # Reached max_iterations without a final answer — signal caller to escalate
    return None


# ---------------------------------------------------------------------------
# Main query function — orchestrates Layer 3 and Layer 4
# ---------------------------------------------------------------------------

async def query(question: str) -> dict:
    """
    Answer a natural language question about stored decisions using Hermes.

    This is the main entry point called by the query router.

    Parameters:
        question: A free-form natural language question, e.g.
                  "Why did we postpone the GTV application?"

    Returns:
        A dict with three keys:
            answer         — The final answer as a natural language string.
            sources        — List of decisions consulted: [{"id": ..., "title": ...}, ...]
            thinking_steps — Log of each tool call: ["[nous-hermes-2] Calling search_graph(...)", ...]

    Two-stage escalation:
        Stage 1 — Nous-Hermes-2-Mixtral-8x7B (Layer 3):
            Runs the ReAct loop for up to MAX_ITERATIONS rounds.
            If it produces an answer, we return it directly.
            Cost: low. Speed: fast.

        Stage 2 — Kimi K2 Thinking (Layer 4):
            Triggered if Layer 3 reaches its iteration limit OR if
            FORCE_DEEP_QUERY=true in config.
            Runs the ReAct loop for up to MAX_ITERATIONS_DEEP rounds.
            Cost: higher. Reasoning: deeper.
            The thinking_steps log shows which model each tool call came from.
    """
    sources: list[dict] = []
    thinking_steps: list[str] = []

    # ── Stage 1: Standard query with Nous-Hermes-2-Mixtral-8x7B (Layer 3) ──
    # Skip Stage 1 if FORCE_DEEP_QUERY is enabled (always use Kimi K2)
    if not settings.FORCE_DEEP_QUERY:
        result = await _run_react_loop(
            question=question,
            model=settings.QUERY_MODEL,      # Nous-Hermes-2-Mixtral-8x7B
            max_iterations=MAX_ITERATIONS,
            existing_sources=sources,
            existing_steps=thinking_steps,
        )
        if result is not None:
            # Layer 3 answered successfully — return without escalating
            return result

        # Layer 3 hit its limit — log the escalation for transparency
        thinking_steps.append(
            f"[escalation] {settings.QUERY_MODEL} reached {MAX_ITERATIONS} iterations. "
            f"Escalating to {settings.QUERY_DEEP_MODEL} (Kimi K2 Thinking)."
        )

    # ── Stage 2: Deep reasoning with Kimi K2 Thinking (Layer 4) ──
    # Fresh conversation — Kimi K2 starts from scratch with the original question.
    # We pass the same accumulated sources/steps lists so the log stays complete.
    result = await _run_react_loop(
        question=question,
        model=settings.QUERY_DEEP_MODEL,     # Kimi K2 Thinking
        max_iterations=MAX_ITERATIONS_DEEP,
        existing_sources=sources,
        existing_steps=thinking_steps,
    )

    if result is not None:
        return result

    # Both models reached their limits — return a fallback message.
    # This should be very rare with well-formed questions.
    return {
        "answer": (
            "I was unable to find a confident answer within the reasoning limit. "
            "Try rephrasing your question or adding more specific details."
        ),
        "sources": sources,
        "thinking_steps": thinking_steps,
    }
