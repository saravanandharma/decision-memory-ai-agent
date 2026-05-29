"""
services/transcriber.py — Audio-to-text transcription using faster-whisper.

What this file does:
    Converts an audio file (MP3, WAV, M4A, etc.) into a plain text transcript
    that can then be passed to the extractor service to find decisions.

Why local transcription (not an API)?
    Whisper runs entirely on the user's machine — no audio data is sent to any
    third-party service. This is important for a family app where recordings
    may contain private conversations. It's also free: no per-minute API cost.

Why faster-whisper (not openai-whisper)?
    faster-whisper is a re-implementation of OpenAI's Whisper model that runs
    significantly faster (2-4x) and uses less memory by using CTranslate2
    under the hood. The models are the same — just the runtime is optimised.

Why lazy import (import inside the function)?
    faster-whisper is an optional dependency — users who don't need audio
    transcription should not have to install it. By importing it inside the
    function, the rest of the app works fine even if faster-whisper is not
    installed. We return a helpful error message instead of crashing.

Model size tradeoffs:
    "tiny.en"   — Fastest, smallest (75MB), least accurate. Good for development.
    "base.en"   — Slightly larger (142MB), noticeably more accurate. Recommended.
    "small.en"  — 466MB, good balance of speed and accuracy.
    "medium.en" — 1.5GB, high accuracy, slow on CPU.
    "large-v2"  — 3GB, best accuracy, very slow on CPU.
    The ".en" suffix means English-only — faster than multilingual models.
    Set WHISPER_MODEL in config.py or .env to change the model used.

How it fits in the system:
    ingest router (audio upload) → transcriber.transcribe(path) → raw text
    → extractor.extract_decisions(text) → structured decision records
"""

import os
from config import settings


def transcribe(audio_path: str) -> str:
    """
    Transcribe an audio file to text using the faster-whisper library.

    Parameters:
        audio_path: Absolute or relative path to the audio file on disk.
                    The file must already be saved before calling this function.
                    Supported formats: MP3, MP4, WAV, M4A, OGG, WEBM
                    (anything that faster-whisper's ffmpeg backend can decode).

    Returns:
        A plain text string of the transcribed speech.
        If transcription is disabled or faster-whisper is not installed,
        returns an error message string starting with '[' — the ingest router
        checks for this prefix and raises an HTTP 422 error with the message.

    Behaviour:
        - Returns an error string (not raises) for configuration/install issues.
          This makes it easy for the caller to check if something went wrong.
        - Segments (sentence-like chunks from Whisper) are joined with spaces
          to produce a single continuous transcript string.
    """
    # Check if transcription is turned on in config before loading the model.
    # This allows users to disable transcription without uninstalling the library.
    if not settings.ENABLE_TRANSCRIPTION:
        return "[Transcription disabled — set ENABLE_TRANSCRIPTION=true to enable]"

    # Lazy import — only attempt to load faster-whisper when actually needed.
    # If it's not installed, we return a friendly error message rather than
    # crashing with an ImportError traceback.
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        return "[faster-whisper not installed — run: pip install faster-whisper]"

    # Load the Whisper model.
    # device="cpu" — run on CPU (no GPU required).
    # compute_type="int8" — use 8-bit integer arithmetic instead of 32-bit
    #   floating point. This is much faster and uses less memory with only a
    #   tiny drop in accuracy. It's the recommended setting for CPU inference.
    model = WhisperModel(settings.WHISPER_MODEL, device="cpu", compute_type="int8")

    # transcribe() returns:
    #   segments — an iterable of TranscriptionSegment objects (each with .text,
    #              .start, .end timestamps, etc.)
    #   _        — audio info metadata (duration, language, etc.) — not needed here
    # beam_size=5 is the default and gives a good balance of speed vs. accuracy.
    # Higher beam_size = more accurate but slower (tries more candidate sequences).
    segments, _ = model.transcribe(audio_path, beam_size=5)

    # Join all segment texts into one continuous string.
    # Each segment is roughly a sentence or phrase. We strip() each one first
    # to remove leading/trailing whitespace that Whisper sometimes adds.
    return " ".join(segment.text.strip() for segment in segments)
