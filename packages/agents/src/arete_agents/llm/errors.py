"""Provider-error classification — turn a raw LLM exception into an honest,
user-actionable result instead of a silent 500/timeout.

The trigger for this module: a user connected an Anthropic key with a $0 balance
and every call returned `400 invalid_request_error — "Your credit balance is too
low..."`, but the app swallowed it into a generic non-response. Classifying the
error lets callers (chat, the specialist fan-out) surface the real reason AND
skip retries on non-retryable failures (a broken key or empty balance won't fix
itself on attempt #2 — retrying just adds latency).

No provider SDKs are imported here: we read status codes / message text
duck-typed, so this works for anthropic, openai, gemini, and langchain wrappers
alike without coupling to any one client.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

ErrorKind = Literal[
    "credit_balance",
    "invalid_api_key",
    "rate_limit",
    "model_not_found",
    "timeout",
    "transient",
    "unknown",
]


@dataclass(frozen=True)
class ProviderError:
    """A classified provider failure. ``message`` is safe to show a user — for
    known kinds we pass the provider's own wording through (it is already
    actionable) plus a short remedy; ``retryable`` gates whether a caller should
    try again or fail fast."""

    kind: ErrorKind
    message: str
    retryable: bool


def _status_code(exc: BaseException) -> int | None:
    for attr in ("status_code", "http_status", "code"):
        val = getattr(exc, attr, None)
        if isinstance(val, int):
            return val
    resp = getattr(exc, "response", None)
    if resp is not None:
        val = getattr(resp, "status_code", None)
        if isinstance(val, int):
            return val
    return None


def classify_provider_error(exc: BaseException) -> ProviderError:
    """Map a raw exception raised by an LLM call to a ProviderError. Unknown
    shapes fall back to a non-retryable ``unknown`` carrying the raw message, so
    nothing is hidden — the caller still surfaces a real reason."""
    raw = str(exc)
    low = raw.lower()
    status = _status_code(exc)

    # Billing / balance — the incident that motivated this. Anthropic returns it
    # as a 400 invalid_request_error, so we key on the message, not the status.
    if "credit balance is too low" in low or ("billing" in low and "low" in low):
        return ProviderError(
            "credit_balance",
            "Your AI provider account is out of credits. Add credits in your "
            "provider's billing settings, or switch to Local · Ollama in "
            "Connections → AI Models.",
            retryable=False,
        )

    # Auth — a bad/expired/revoked key. Never retry.
    if status in (401, 403) or "invalid x-api-key" in low or "invalid api key" in low or (
        "authentication" in low and "error" in low
    ):
        return ProviderError(
            "invalid_api_key",
            "The AI model API key was rejected. Check the key in Connections → "
            "AI Models, or switch to Local · Ollama.",
            retryable=False,
        )

    # Unknown/misspelled model id. Not retryable — the request is malformed.
    if status == 404 or "model not found" in low or "does not exist" in low:
        return ProviderError(
            "model_not_found",
            "The selected model isn't available for this account. Pick a "
            "different model in Connections → AI Models.",
            retryable=False,
        )

    # Rate limit — retryable with backoff.
    if status == 429 or "rate limit" in low or "overloaded" in low:
        return ProviderError(
            "rate_limit",
            "The AI provider is rate-limiting requests. Retrying shortly.",
            retryable=True,
        )

    # Timeout — retryable.
    if "timeout" in low or "timed out" in low:
        return ProviderError(
            "timeout",
            "The AI provider took too long to respond. Retrying shortly.",
            retryable=True,
        )

    # Transient server-side error — retryable.
    if status is not None and status >= 500:
        return ProviderError(
            "transient",
            "The AI provider had a temporary error. Retrying shortly.",
            retryable=True,
        )

    # Anything else — surface the raw message, but don't retry blindly.
    return ProviderError("unknown", raw or "The AI model call failed.", retryable=False)
