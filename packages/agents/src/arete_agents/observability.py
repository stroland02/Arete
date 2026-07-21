"""Single OpenTelemetry bootstrap + redaction point for arete-agents.

Owns (obs spec §5/§7, Lane B): redaction primitives, the in-process span
scrubber, the structlog censor/bridge (Task 7), histogram Views, and
init_observability() (Task 5). server.py calls init_observability() exactly
once at import time — inside the uvicorn worker process.
"""

from __future__ import annotations

import logging
import re

from opentelemetry.sdk.trace import ReadableSpan, SpanProcessor
from opentelemetry.trace.status import Status

_logger = logging.getLogger(__name__)

# --- §5 redaction conventions (FROZEN — spec amendment required to change) ---

REDACTED = "[REDACTED]"

BLOCKLIST_KEYS: tuple[str, ...] = (
    "authorization",
    "x-api-key",
    "api_key",
    "token",
    "secret",
    "password",
    "cookie",
    "set-cookie",
)

# Blocked keys match as whole '-'/'_'/'.'-delimited segments, never bare
# substrings: "gen_ai.usage.input_tokens" must NOT match "token".
_BLOCKED_KEY_RES: tuple[re.Pattern[str], ...] = tuple(
    re.compile(rf"(?:^|[^a-z0-9])({re.escape(key)})(?:$|[^a-z0-9])")
    for key in BLOCKLIST_KEYS
)

# Value patterns (§5): bearer tokens, sk-/ghs_/ghp_-style key shapes,
# [?&]key= / [?&]api_key= in URLs.
_VALUE_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"(?i)\bbearer\s+[a-z0-9._~+/=\-]+"), REDACTED),
    (re.compile(r"\bsk-[A-Za-z0-9_\-]{8,}\b"), REDACTED),
    (re.compile(r"\bgh[ps]_[A-Za-z0-9]{16,}\b"), REDACTED),
    (re.compile(r"(?i)([?&](?:api_)?key=)[^&#\s]+"), r"\1" + REDACTED),
)

_URL_ATTR_KEYS = ("http.url", "url.full")


def scrub_text(value: str) -> str:
    """Mask every §5 secret-shaped substring in ``value``."""
    for pattern, replacement in _VALUE_PATTERNS:
        value = pattern.sub(replacement, value)
    return value


def is_blocked_key(key: str) -> bool:
    """True when ``key`` contains a §5 blocklisted name as a whole segment."""
    lowered = key.lower()
    return any(regex.search(lowered) for regex in _BLOCKED_KEY_RES)


class ScrubbingSpanProcessor(SpanProcessor):
    """In-process span scrubber (§5: redaction at every sink).

    Registered FIRST on the TracerProvider so on_end mutates the span before
    the (later-registered) batch processor hands it to the OTLP exporter.
    Scrubs: URL query strings on http.url/url.full (the Superlog Gemini
    ``?key=`` incident class), blocklisted attribute keys, secret-shaped
    values in string attributes, exception-event attributes, and the span
    status description. Never raises — a scrubbing bug loses the scrub for
    that span, never the span pipeline or the app.
    """

    def on_start(self, span, parent_context=None) -> None:  # pragma: no cover
        pass

    def on_end(self, span: ReadableSpan) -> None:
        try:
            if span._attributes:
                span._attributes = {
                    key: self._scrub_attribute(key, value)
                    for key, value in span._attributes.items()
                }
            for event in span._events:
                if event.attributes:
                    event._attributes = {
                        key: self._scrub_attribute(key, value)
                        for key, value in event.attributes.items()
                    }
            status = span._status
            if status is not None and status.description:
                scrubbed = scrub_text(status.description)
                if scrubbed != status.description:
                    span._status = Status(status.status_code, scrubbed)
        except Exception:
            _logger.warning(
                "span scrubber failed; span exported unscrubbed", exc_info=True
            )

    @staticmethod
    def _scrub_attribute(key: str, value):
        if is_blocked_key(key):
            return REDACTED
        if isinstance(value, str):
            if key in _URL_ATTR_KEYS:
                return value.split("?", 1)[0]
            return scrub_text(value)
        if isinstance(value, (list, tuple)):
            return tuple(
                (
                    (element.split("?", 1)[0] if key in _URL_ATTR_KEYS else scrub_text(element))
                    if isinstance(element, str)
                    else element
                )
                for element in value
            )
        return value

    def shutdown(self) -> None:  # pragma: no cover
        pass

    def force_flush(self, timeout_millis: int = 30_000) -> bool:  # pragma: no cover
        return True
