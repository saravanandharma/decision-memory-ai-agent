"""
services/extractor.py — Multi-model AI extraction service via OpenRouter.

What this file does:
    Takes raw text (from typed input, an uploaded file, or an audio transcript)
    and uses open-source AI models via OpenRouter to extract one or more
    structured decision records from it.

────────────────────────────────────────────────────────────────────
TWO-MODEL EXTRACTION STRATEGY
────────────────────────────────────────────────────────────────────

Layer 1 — Hermes 3 (Llama-3.1 8B)  [short text ≤ EXTRACT_LONG_THRESHOLD words]
    NousResearch's Hermes 3 is fine-tuned specifically for structured
    JSON output and instruction-following. At 8 billion parameters it is
    the fastest and cheapest option here. Most family decisions are captured
    as short notes or voice memos — Hermes 3 handles these perfectly.

Layer 2 — Mistral Small 4 (24B)    [long text > EXTRACT_LONG_THRESHOLD words]
    Mistral Small's 24B parameter count gives it a larger effective context
    window and better accuracy on lengthy inputs like meeting transcripts,
    uploaded documents, or long email threads. The extra cost is justified
    because missing a decision buried at paragraph 12 of a long document
    defeats the purpose of the app.

Model selection logic:
    word_count = len(text.split())
    model = EXTRACT_LONG_MODEL if word_count > threshold else EXTRACT_MODEL

────────────────────────────────────────────────────────────────────
WHY OPENROUTER?
────────────────────────────────────────────────────────────────────
OpenRouter (https://openrouter.ai) is an API gateway that provides
OpenAI-compatible access to hundreds of AI models — including Hermes 3,
Mistral Small, Nous-Hermes-2, and Kimi K2 — through a single API key.

We use the standard `openai` Python SDK and point it at OpenRouter's
base URL. This means no custom SDK, no vendor lock-in, and easy model
switching by just changing an environment variable.

────────────────────────────────────────────────────────────────────
STRUCTURED OUTPUT VIA FUNCTION CALLING
────────────────────────────────────────────────────────────────────
Both models support OpenAI-compatible function/tool calling. We define
a `record_decision` function with an exact JSON Schema. The model is
required to call this function for every decision it finds, filling in
all fields. This is far more reliable than asking the model to "output
JSON" in prose, which can include commentary, wrong field names, or
invalid JSON.

How it works:
    1. Send text to the model with the record_decision tool definition.
    2. Set tool_choice="required" so the model MUST call the function.
    3. Parse each tool_call from response.choices[0].message.tool_calls.
    4. Validate with Pydantic's DecisionExtract model.
    5. Filter out any result where is_decision=False.

How it fits in the system:
    ingest router → extract_decisions(text) → list[DecisionExtract]
    The ingest router then saves each extracted decision to all three databases.
"""

import json
from openai import OpenAI

from config import settings
from models.schema import DecisionExtract


# ---------------------------------------------------------------------------
# OpenRouter client
# ---------------------------------------------------------------------------
# The openai SDK is used with OpenRouter's base URL, giving us access to
# Hermes 3 and Mistral Small through the familiar OpenAI API format.
# HTTP-Referer and X-Title are optional headers recommended by OpenRouter
# for analytics and to identify your app in their dashboard.
client = OpenAI(
    base_url=settings.OPENROUTER_BASE_URL,
    api_key=settings.OPENROUTER_API_KEY,
    default_headers={
        "HTTP-Referer": "https://decision-memory-agent.local",
        "X-Title": "Decision Memory Agent",
    },
)


# ---------------------------------------------------------------------------
# Tool definition — the structured output schema models must fill in
# ---------------------------------------------------------------------------
# This defines a "function" in OpenAI tool-calling format. The model reads
# the descriptions and fills in each property from the input text.
# 'parameters' in OpenAI format is equivalent to 'input_schema' in Anthropic format.
EXTRACT_TOOL = {
    "type": "function",       # OpenAI tool type — always "function" for now
    "function": {
        "name": "record_decision",
        "description": "Record a single decision extracted from the provided content. Call this function once for each distinct decision found.",
        "parameters": {
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "Short title summarising the decision (5-10 words)"
                },
                "summary": {
                    "type": "string",
                    "description": "One paragraph summary of what was decided"
                },
                "rationale": {
                    "type": "string",
                    "description": "Why this decision was made — the reasoning behind it"
                },
                "alternatives_considered": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Other options that were considered but not chosen"
                },
                "risks_accepted": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Known risks or downsides accepted along with this decision"
                },
                "assumptions": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Assumptions this decision depends on being true"
                },
                "unresolved_questions": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Open questions that were not answered when the decision was made"
                },
                "owners": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Names of people responsible for or who made this decision"
                },
                "dissenters": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Names of people who opposed or disagreed with this decision"
                },
                "related_systems": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Systems, products, areas, or topics affected by this decision"
                },
                "tags": {
                    "type": "array",
                    "items": {"type": "string"},
                    # Concrete tag examples steer both models toward consistent,
                    # reusable tags rather than one-off phrases.
                    "description": "Lowercase topic tags. Use from: lifestyle, health, family, education, work, finance, technology, parenting, travel, home, relationship, legal, medical, etc."
                },
                "is_decision": {
                    "type": "boolean",
                    # Generous definition — the app is for a family, not an
                    # engineering team. Everyday choices count as decisions.
                    "description": (
                        "True if the content describes ANY kind of choice or decision — "
                        "personal, family, lifestyle, health, parenting, work, finance, or technical. "
                        "Examples that ARE decisions: a child choosing to play outside instead of watching TV, "
                        "postponing a loan application for cash flow reasons, "
                        "choosing a restaurant, deciding to change schools. "
                        "Set False ONLY for pure factual statements with no choice at all "
                        "(e.g. 'the weather was sunny' or 'the meeting lasted one hour')."
                    ),
                },
            },
            # All fields required — missing fields cause Pydantic validation to fail
            # and the result is silently dropped rather than partially saved.
            "required": [
                "title", "summary", "rationale", "alternatives_considered",
                "risks_accepted", "assumptions", "unresolved_questions",
                "owners", "dissenters", "related_systems", "tags", "is_decision",
            ],
        },
    },
}


# ---------------------------------------------------------------------------
# System prompt — defines the model's role and decision-detection behaviour
# ---------------------------------------------------------------------------
# Sent as the system message on every extraction call. Tells the model who it
# is and what counts as a "decision" in a family context (much broader than
# the typical engineering/business definition).
SYSTEM_PROMPT = """You are a decision memory assistant for a family app.
Your job is to extract ANY kind of decision from text — personal, family, lifestyle, parenting, health, finance, work, or technical.

A decision is any deliberate choice made between alternatives, large or small:
- A child choosing to play outside instead of watching TV ✓
- Postponing a loan application because of cash flow concerns ✓
- A family deciding which restaurant to visit ✓
- A parent deciding to limit screen time ✓
- Choosing React Native over Flutter for a project ✓
- Someone deciding to take a walk instead of staying indoors ✓

Only set is_decision=false for pure factual statements with absolutely no choice involved.
Examples that are NOT decisions: "it rained today", "the meeting lasted one hour", "John is 8 years old".

Be generous with your interpretation — if there is a person, a choice, and even an implied reason, it is a decision.
Extract the person's name as the owner. Infer the rejected alternative even if not explicitly stated.
Call record_decision once for each distinct decision you find in the text."""


# ---------------------------------------------------------------------------
# Model selection — choose between Hermes 3 and Mistral Small based on length
# ---------------------------------------------------------------------------

def _select_model(text: str) -> str:
    """
    Choose which extraction model to use based on the length of the input text.

    Short texts (≤ EXTRACT_LONG_THRESHOLD words) use Hermes 3 (Layer 1):
        Fast and cheap. Most family decisions are short notes.

    Long texts (> EXTRACT_LONG_THRESHOLD words) use Mistral Small 4 (Layer 2):
        Better accuracy on lengthy meeting transcripts or uploaded documents.

    Parameters:
        text: The raw input text.

    Returns:
        The OpenRouter model ID string to use for this extraction call.
    """
    word_count = len(text.split())
    if word_count > settings.EXTRACT_LONG_THRESHOLD:
        # Long text: switch to Mistral Small 4 (24B) for better accuracy
        return settings.EXTRACT_LONG_MODEL
    # Short text: use Hermes 3 (8B) for speed and cost efficiency
    return settings.EXTRACT_MODEL


# ---------------------------------------------------------------------------
# Main extraction function
# ---------------------------------------------------------------------------

def extract_decisions(text: str) -> list[DecisionExtract]:
    """
    Extract all decisions from a block of text using the appropriate model.

    A single document may contain multiple decisions (e.g. meeting notes that
    capture several choices), so this function returns a list. The model is
    instructed to call record_decision once per decision found.

    Parameters:
        text: The raw text to analyse. Any length is supported — the model
              selection logic handles short vs. long inputs automatically.

    Returns:
        A list of validated DecisionExtract objects.
        Returns an empty list if no decisions are found in the text.

    How it works step by step:
        1. Count words to decide which model to use (Hermes 3 or Mistral Small).
        2. Send the text to that model via OpenRouter using the openai SDK.
        3. The model calls record_decision once for each decision it finds.
        4. We iterate over tool_calls in the response and parse each one.
        5. Each result is validated with Pydantic's DecisionExtract model.
        6. Results where is_decision=False are discarded.

    Note on tool_choice="required":
        Setting tool_choice="required" tells the model it MUST call at least
        one tool. Without this, some models may respond with plain text instead
        of calling the function. However, if the text contains no decisions,
        the model will still call record_decision with is_decision=False — we
        filter those out at step 6.
    """
    # Step 1: select the right model for this text length
    model = _select_model(text)

    # Step 2: call the model via OpenRouter
    response = client.chat.completions.create(
        model=model,
        max_tokens=4096,
        messages=[
            # System message: defines the model's role and decision criteria
            {"role": "system", "content": SYSTEM_PROMPT},
            # User message: the actual text to extract from
            {"role": "user", "content": (
                f"Extract all decisions from the following content. "
                f"Call record_decision once for each distinct decision found.\n\n{text}"
            )},
        ],
        tools=[EXTRACT_TOOL],
        # "required" forces at least one tool call.
        # The model calls record_decision for every decision it finds.
        tool_choice="required",
    )

    # Step 3: parse each tool call from the response
    decisions = []
    message = response.choices[0].message

    # tool_calls is None if the model chose not to call any tools (shouldn't
    # happen with tool_choice="required", but we guard anyway).
    for tool_call in (message.tool_calls or []):
        if tool_call.function.name != "record_decision":
            # Skip any unexpected tool calls (defensive programming)
            continue
        try:
            # Parse the JSON arguments string into a Python dict
            raw = json.loads(tool_call.function.arguments)

            # Validate the dict against our Pydantic model.
            # This catches hallucinated fields, wrong types, etc.
            data = DecisionExtract(**raw)

            # Filter out non-decisions (model may return is_decision=False
            # to explain why it skipped some content)
            if data.is_decision:
                decisions.append(data)

        except Exception:
            # If JSON parsing or Pydantic validation fails, skip this result.
            # One bad extraction should not prevent saving the valid ones.
            pass

    return decisions
