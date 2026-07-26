"""Renders an incident's runtime context into the fix author's prompt.

This is the agent-side half of obs spec §3's "telemetry-fed investigations" —
the last unshipped Phase 2 bullet. Until now the fix pipeline saw the
repository and the work item's static code evidence, and nothing about what
actually happened at runtime. The spans, logs and exceptions that ARE the
incident stopped at the dashboard.

THE ONE RULE THIS MODULE EXISTS TO ENFORCE. Empty signal lists have three
completely different meanings, and only one of them is "nothing was wrong":

  granted     — we queried, and the window really was quiet.
  denied      — the platform gate refused; NOTHING was queried. Says nothing
                about whether anything was wrong.
  unavailable — the telemetry backend could not answer. Same.

Rendering the last two as "no errors were observed" would hand the author model
a false premise, and a model given a false premise writes a confident patch for
a problem nobody ever saw. So each state gets its own sentence, and the two
non-answers explicitly decline to characterise the system's health.

The same reasoning applies to the caps: the webhook trims the sample to a prompt
budget (fix/incident-signals.ts), and a trimmed sample shown as complete invites
"only one service was affected". When rows were dropped, the count is stated.
"""

from arete_agents.models.fix import FixSignals

_HEADER = "Runtime context — the incident that opened this work item"

# Repeated from the evidence section's guard, deliberately: observed telemetry
# is input to reason from, never licence to invent more of it.
_NO_INVENT = (
    "Treat the signals above as observed fact. Do not invent additional spans, "
    "logs, exceptions or stack traces that were not given to you."
)


def _describe_absence(signals: FixSignals) -> str:
    """The sentence for a signal set with nothing in it. Three states, three
    sentences — see the module docstring for why this must never collapse."""
    if signals.availability == "denied":
        return (
            "Telemetry for this incident is NOT AVAILABLE to this installation: "
            "the platform access gate refused, so no telemetry was queried at all. "
            "This says nothing about whether the system was healthy — treat the "
            "runtime behaviour as simply unknown, and reason from the code evidence."
        )
    if signals.availability == "unavailable":
        return (
            "Telemetry for this incident COULD NOT BE READ: the observability "
            "backend did not answer. This says nothing about whether the system was "
            "healthy — treat the runtime behaviour as simply unknown, and reason "
            "from the code evidence."
        )
    return (
        "Telemetry was queried for this window and returned "
        "no error spans, logs or exceptions. The alert fired, but no errors were "
        "recorded around it — consider whether this is a latency or saturation "
        "problem rather than a failure, or whether the failing path is uninstrumented."
    )


def render_signals(signals: FixSignals | None) -> str:
    """The prompt section for an incident's runtime context, or "" when no
    incident opened this work item.

    Empty string rather than an empty section: most work items are scan-born,
    and a "Runtime context: none" heading would imply an incident was looked for
    and its telemetry checked, which for a scan finding never happened.
    """
    if signals is None:
        return ""

    scope = f" on {signals.service}" if signals.service else ""
    lines = [
        _HEADER,
        f"Alert: {signals.alert_name} ({signals.severity}, {signals.status}){scope}",
        f"Summary: {signals.summary}",
        f"Fired at: {signals.starts_at}"
        + (f", resolved at {signals.resolved_at}" if signals.resolved_at else ""),
        "",
    ]

    has_any = bool(signals.spans or signals.logs or signals.exceptions)
    if not has_any:
        lines.append(_describe_absence(signals))
        return "\n".join(lines)

    if signals.exceptions:
        lines.append("Exceptions in this window (most frequent first):")
        lines += [
            f"- {e.exception_type}: {e.exception_message} "
            f"[{e.service}, {e.occurrences}x, last seen {e.last_seen}]"
            for e in signals.exceptions
        ]
        lines.append("")

    if signals.spans:
        lines.append("Failed operations (error spans, newest first):")
        lines += [
            f"- {s.span_name} [{s.service}] {s.status_message} "
            f"({s.duration_ms:.0f}ms, trace {s.trace_id}, at {s.timestamp})"
            for s in signals.spans
        ]
        lines.append("")

    if signals.logs:
        lines.append("Error-level logs (newest first):")
        lines += [
            f"- {line.timestamp} [{line.service}/{line.severity}] {line.body}"
            for line in signals.logs
        ]
        lines.append("")

    dropped = signals.omitted
    if dropped.spans or dropped.logs or dropped.exceptions:
        # Stated, never silent: the sample above is partial, and the model must
        # not read it as the complete picture of the incident.
        lines.append(
            "NOTE: this is a capped sample, not the full window — "
            f"{dropped.spans} further error spans, {dropped.logs} logs and "
            f"{dropped.exceptions} exception groups were omitted. Do not conclude "
            "that the services and errors listed above are the only ones affected."
        )
        lines.append("")

    if signals.availability == "unavailable":
        # Partial reads are possible: the gate passed, some queries answered, at
        # least one did not. Say so rather than presenting a partial window as
        # whole.
        lines.append(
            "NOTE: part of the telemetry read failed, so the signals above may be "
            "incomplete for reasons unrelated to what happened."
        )
        lines.append("")

    lines.append(_NO_INVENT)
    return "\n".join(lines)
