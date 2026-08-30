import type { MiddlewareHandler } from 'hono';
import type { DeliveryQueueStats } from './repository.js';

const requests = new Map<string, number>();
const duration = new Map<string, { count: number; seconds: number }>();

export const metricsMiddleware: MiddlewareHandler = async (context, next) => {
  const started = performance.now(); try { await next(); } finally {
  const route = context.req.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id').replace(/\/(agr|part|artifact|inv|note|whd)_[^/]+/g, '/:id');
  const key = `${context.req.method}|${route}|${Math.floor(context.res.status / 100)}xx`;
  requests.set(key, (requests.get(key) ?? 0) + 1);
  const timing = duration.get(key) ?? { count: 0, seconds: 0 }; timing.count += 1; timing.seconds += (performance.now() - started) / 1000; duration.set(key, timing);
  }
};

const label = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
export function renderMetrics(queueStats?: DeliveryQueueStats): string {
  const lines = ['# HELP bytecrunch_http_requests_total HTTP requests processed.', '# TYPE bytecrunch_http_requests_total counter'];
  for (const [key, value] of requests) { const [method, route, status] = key.split('|'); lines.push(`bytecrunch_http_requests_total{method="${label(method!)}",route="${label(route!)}",status_class="${status}"} ${value}`); }
  lines.push('# HELP bytecrunch_http_request_duration_seconds_sum Total HTTP request duration.', '# TYPE bytecrunch_http_request_duration_seconds_sum counter');
  for (const [key, value] of duration) { const [method, route, status] = key.split('|'); const labels = `method="${label(method!)}",route="${label(route!)}",status_class="${status}"`; lines.push(`bytecrunch_http_request_duration_seconds_sum{${labels}} ${value.seconds}`, `bytecrunch_http_request_duration_seconds_count{${labels}} ${value.count}`); }
  lines.push(`bytecrunch_process_uptime_seconds ${process.uptime()}`, `bytecrunch_process_resident_memory_bytes ${process.memoryUsage().rss}`);
  if (queueStats) {
    lines.push('# HELP bytecrunch_delivery_queue_items Delivery records by channel and status.', '# TYPE bytecrunch_delivery_queue_items gauge');
    for (const [channel, stats] of Object.entries(queueStats)) {
      lines.push(`bytecrunch_delivery_queue_items{channel="${channel}",status="pending"} ${stats.pending}`);
      lines.push(`bytecrunch_delivery_queue_items{channel="${channel}",status="failed"} ${stats.failed}`);
      lines.push(`bytecrunch_delivery_queue_items{channel="${channel}",status="dead_letter"} ${stats.deadLetter}`);
      const age = stats.oldestQueuedAt ? Math.max(0, (Date.now() - new Date(stats.oldestQueuedAt).getTime()) / 1000) : 0;
      lines.push(`bytecrunch_delivery_oldest_queued_age_seconds{channel="${channel}"} ${age}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
