# @arete/telemetry

OTel bootstrap + pino factory + redaction core for all TS services. The §5
conventions (service names, span tree, metric namespace, redaction blocklist,
histogram boundaries) are FROZEN by
`docs/superpowers/specs/2026-07-20-superlog-observability-integration-design.md`
— do not rename anything here without a spec amendment.

Before instrumenting a feature, follow `.claude/skills/instrument-every-feature/SKILL.md`.

Rules of the package:
- `initTelemetry()` must NEVER throw — every code path try/catch-wrapped,
  one warning, boolean return. There is a test for this; keep it green.
- Anything exported here runs before app code via `--import`; keep imports
  side-effect-free except in `init.ts`.
- The canary scrub tests (`scrub-processor.test.ts`, `logger.test.ts`) are a
  Phase-1 security gate (spec §6): grow them whenever the redaction surface grows.
