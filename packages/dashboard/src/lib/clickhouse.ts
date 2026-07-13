import { createClient } from '@clickhouse/client';

// Reusing existing environment variable or defaulting to the local docker-compose setup
export const clickhouse = createClient({
  url: process.env.CLICKHOUSE_URL || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'superlog',
  password: process.env.CLICKHOUSE_PASSWORD || 'superlog',
  database: process.env.CLICKHOUSE_DB || 'superlog',
});
