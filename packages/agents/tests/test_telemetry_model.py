from datetime import datetime, timezone

from arete_agents.models.telemetry import TelemetrySnapshot


def test_telemetry_snapshot_minimal_fields():
    snap = TelemetrySnapshot(
        provider="github_actions",
        source_ref="acme/api",
        summary_text="12 of 15 recent CI runs passed.",
        fetched_at=datetime(2026, 7, 10, tzinfo=timezone.utc),
    )
    assert snap.provider == "github_actions"
    assert snap.metrics == {}
    assert snap.links == []


def test_telemetry_snapshot_with_metrics_and_links():
    snap = TelemetrySnapshot(
        provider="posthog",
        source_ref="production-app",
        summary_text="Checkout funnel conversion dropped 8% this week.",
        metrics={"conversion_rate": 0.42, "sample_size": 1200.0},
        links=["https://app.posthog.com/insights/abc123"],
        fetched_at=datetime(2026, 7, 10, tzinfo=timezone.utc),
    )
    assert snap.metrics["conversion_rate"] == 0.42
    assert snap.links == ["https://app.posthog.com/insights/abc123"]
