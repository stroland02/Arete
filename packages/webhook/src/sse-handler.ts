import type { Request, Response } from 'express';
import { Redis } from 'ioredis';
import { logger } from './logger.js';

const log = logger.child({ component: 'sse' });

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

/**
 * Real-Time Metric Streaming (SSE)
 * Subscribes to the 'agent_metrics' Redis PubSub channel and pushes live
 * LangGraph agent state/throughput metrics to the frontend dashboard.
 */
export function handleMetricsStream(req: Request, res: Response) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*', // Allow frontend to connect
  });

  // Create a dedicated Redis subscriber connection per client
  const subscriber = new Redis(redisUrl);
  
  subscriber.subscribe('agent_metrics', (err) => {
    if (err) {
      log.error({ err }, 'Failed to subscribe to agent_metrics');
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
    } else {
      res.write(`event: connected\ndata: ${JSON.stringify({ status: 'listening' })}\n\n`);
    }
  });

  subscriber.on('message', (channel, message) => {
    if (channel === 'agent_metrics') {
      res.write(`data: ${message}\n\n`);
    }
  });

  // Ping every 15 seconds to keep connection alive
  const keepAlive = setInterval(() => {
    res.write(':\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(keepAlive);
    subscriber.disconnect();
  });
}
