# Telemetry retention & deletion path

**Policy (obs spec §3/§6):** raw signals (`otel_traces`, `otel_logs`,
`otel_metrics_*`, `otel_traces_trace_id_ts`) — 30 days; rollups/projections
(`otel_traces_recent`, `otel_traces_summary`, `events_per_minute`,
`issue_activity_daily`, `otel_exceptions`) — 90 days. Numbers revisited per
table once real volume is visible (spec §10).

**Enforcement:** table-level `TTL` with `ttl_only_drop_parts = 1` — expiry
drops whole parts, no row rewrites. Single-node DDL:
`schema/single-node-otel.sql` (mounted as compose init). HA DDL:
`schema/ha-replicated-otel.sql` + `migrations/008_full_retention_ttls.sql`.

**On-demand deletion (per-project purge — run against every table):**

    ALTER TABLE superlog.otel_traces
      DELETE WHERE ResourceAttributes['superlog.project_id'] = {project:String};
    ALTER TABLE superlog.otel_logs
      DELETE WHERE ResourceAttributes['superlog.project_id'] = {project:String};
    -- repeat for otel_metrics_gauge/sum/summary/histogram/exp_histogram
    -- (same predicate), then the rollups by their project_id column:
    ALTER TABLE superlog.events_per_minute DELETE WHERE project_id = {project:String};
    ALTER TABLE superlog.issue_activity_daily DELETE WHERE project_id = {project:String};
    ALTER TABLE superlog.otel_exceptions DELETE WHERE project_id = {project:String};
    ALTER TABLE superlog.otel_traces_recent DELETE WHERE project_id = {project:String};
    ALTER TABLE superlog.otel_traces_summary DELETE WHERE project_id = {project:String};

Mutations are async: verify completion with
`SELECT * FROM system.mutations WHERE is_done = 0`. Full teardown:
`docker compose -f infra/docker-compose.yml down -v` drops the
`clickhouse_data` volume.
