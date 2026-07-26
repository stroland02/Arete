"""The healing agent's runtime context must reach the prompt HONESTLY.

`FixSignals.availability` distinguishes three things that all look like "no
signals" if you only count rows: the platform gate refused (nobody looked), the
telemetry backend could not answer (we asked, no reply), and the window was
genuinely quiet (we looked, nothing there). An author model told "no errors were
observed" when the truth is "nobody was allowed to look" will write a confident
patch for a problem it never saw — so these tests pin that the rendered text
never collapses them, and never presents a capped sample as complete.
"""

from arete_agents.fix_signals import render_signals
from arete_agents.models.fix import (
    FixSignalException,
    FixSignalLog,
    FixSignalOmitted,
    FixSignals,
    FixSignalSpan,
)

SPAN = FixSignalSpan(
    timestamp="2026-07-22T10:01:00.000Z",
    service="arete-webhook",
    spanName="review.run",
    traceId="4bf92f3577b34da6a3ce929d0e0e4736",
    statusMessage="upstream timeout",
    durationMs=1234.5,
)

LOG = FixSignalLog(
    timestamp="2026-07-22T10:01:05.000Z",
    service="arete-webhook",
    severity="ERROR",
    body="failed to enqueue review job",
    traceId="4bf92f3577b34da6a3ce929d0e0e4736",
)

EXC = FixSignalException(
    exceptionType="ConnectionError",
    exceptionMessage="redis unreachable",
    service="arete-worker",
    occurrences=17,
    lastSeen="2026-07-22T10:02:00.000Z",
)


def _signals(**overrides) -> FixSignals:
    base = dict(
        incidentId="inc-1",
        alertName="AreteReviewErrorRate",
        severity="critical",
        status="firing",
        summary="Review error rate above 10% for 10m",
        startsAt="2026-07-22T10:00:00.000Z",
        service="arete-webhook",
        availability="granted",
    )
    base.update(overrides)
    return FixSignals(**base)


def test_no_incident_renders_nothing() -> None:
    """A scan-born work item has no incident. The prompt must not gain an empty
    'runtime context' section implying one was checked."""
    assert render_signals(None) == ""


def test_denied_says_nobody_looked_and_never_claims_absence() -> None:
    text = render_signals(_signals(availability="denied")).lower()
    assert "not available" in text or "could not be read" in text
    # The cardinal sin: reporting an access outcome as a data outcome.
    assert "no errors" not in text
    assert "nothing was wrong" not in text


def test_unavailable_is_distinct_from_denied() -> None:
    denied = render_signals(_signals(availability="denied"))
    unavailable = render_signals(_signals(availability="unavailable"))
    assert denied != unavailable
    assert "no errors" not in unavailable.lower()


def test_granted_and_empty_says_the_window_was_quiet() -> None:
    """The one case where 'nothing was observed' is a true statement."""
    text = render_signals(_signals(availability="granted")).lower()
    assert "no error spans, logs or exceptions" in text


def test_renders_spans_logs_and_exceptions() -> None:
    text = render_signals(_signals(spans=[SPAN], logs=[LOG], exceptions=[EXC]))
    assert "review.run" in text
    assert "upstream timeout" in text
    assert "failed to enqueue review job" in text
    assert "ConnectionError" in text
    assert "redis unreachable" in text
    assert "17" in text  # occurrence count


def test_reports_what_the_caps_dropped() -> None:
    """A truncated sample presented as complete invites the model to conclude
    'only one service was affected'."""
    text = render_signals(
        _signals(spans=[SPAN], omitted=FixSignalOmitted(spans=40, logs=80, exceptions=0))
    )
    assert "40" in text and "80" in text


def test_says_nothing_about_dropped_rows_when_nothing_was_dropped() -> None:
    text = render_signals(_signals(spans=[SPAN]))
    assert "omitted" not in text.lower()


def test_carries_the_incident_identity_and_alert() -> None:
    text = render_signals(_signals(spans=[SPAN]))
    assert "AreteReviewErrorRate" in text
    assert "Review error rate above 10% for 10m" in text
    assert "arete-webhook" in text


def test_instructs_the_model_not_to_invent_beyond_the_signals() -> None:
    """Same guard the evidence section already carries: observed telemetry is
    input, not licence to fabricate more of it."""
    text = render_signals(_signals(spans=[SPAN])).lower()
    assert "do not invent" in text or "never invent" in text
