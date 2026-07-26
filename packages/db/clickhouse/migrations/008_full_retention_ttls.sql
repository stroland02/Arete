-- Full retention pass (obs spec §3/§6 gate 3): raw signals 30d, rollups 90d.
-- Extends 006 (which capped only the trace-list rollups at 30d): rollups move
-- 30d -> 90d per spec; every raw otel_* table gains its missing 30d TTL.
-- MODIFY TTL is idempotent; ttl_only_drop_parts=1 enforces via part drops.

-- Raw signal tables: 30 days.
ALTER TABLE superlog.otel_traces ON CLUSTER superlog_ha MODIFY TTL toDateTime(Timestamp) + toIntervalDay(30);
ALTER TABLE superlog.otel_logs ON CLUSTER superlog_ha MODIFY TTL TimestampTime + toIntervalDay(30);
ALTER TABLE superlog.otel_metrics_gauge ON CLUSTER superlog_ha MODIFY TTL toDateTime(TimeUnix) + toIntervalDay(30);
ALTER TABLE superlog.otel_metrics_sum ON CLUSTER superlog_ha MODIFY TTL toDateTime(TimeUnix) + toIntervalDay(30);
ALTER TABLE superlog.otel_metrics_summary ON CLUSTER superlog_ha MODIFY TTL toDateTime(TimeUnix) + toIntervalDay(30);
ALTER TABLE superlog.otel_metrics_histogram ON CLUSTER superlog_ha MODIFY TTL toDateTime(TimeUnix) + toIntervalDay(30);
ALTER TABLE superlog.otel_metrics_exp_histogram ON CLUSTER superlog_ha MODIFY TTL toDateTime(TimeUnix) + toIntervalDay(30);
ALTER TABLE superlog.otel_traces_trace_id_ts ON CLUSTER superlog_ha MODIFY TTL Start + toIntervalDay(30);
-- Rollups / projections: 90 days.
ALTER TABLE superlog.otel_traces_recent ON CLUSTER superlog_ha MODIFY TTL toDateTime(ts) + toIntervalDay(90);
ALTER TABLE superlog.otel_traces_summary ON CLUSTER superlog_ha MODIFY TTL toDateTime(fromUnixTimestamp64Nano(end_unix_nano)) + toIntervalDay(90);
ALTER TABLE superlog.events_per_minute ON CLUSTER superlog_ha MODIFY TTL minute + toIntervalDay(90);
ALTER TABLE superlog.issue_activity_daily ON CLUSTER superlog_ha MODIFY TTL day + toIntervalDay(90);
ALTER TABLE superlog.otel_exceptions ON CLUSTER superlog_ha MODIFY TTL toDateTime(Timestamp) + toIntervalDay(90);
