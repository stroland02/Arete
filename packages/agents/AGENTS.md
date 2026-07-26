# arete-agents steering

- **Observability:** the ONLY telemetry bootstrap is
  `src/arete_agents/observability.py::init_observability()` (called from
  `server.py`, in-worker). Never construct exporters/providers elsewhere.
  Unset `OTEL_EXPORTER_OTLP_ENDPOINT` == telemetry off; telemetry failures
  must never crash the service.
- **Logging:** structlog through `configure_structlog()`; no new bare
  `print()` in server code. Secrets are censored by
  `observability.censor_processor` — extend `BLOCKLIST_KEYS`/value patterns
  (and their tests) when the log surface grows; §5 of the obs spec is frozen.
- **Metrics:** dimensions are closed low-cardinality sets (role, outcome,
  provider, model). Repo names, PR numbers, installation ids, SHAs → span
  attributes only, NEVER metric dimensions (review-blocking).
- **Debugging:** use the `debug-from-telemetry` skill
  (`.claude/skills/debug-from-telemetry/SKILL.md`) — query Jaeger/ClickHouse
  before guessing.
