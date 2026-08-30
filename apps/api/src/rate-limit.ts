import { createHmac } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { config } from './config.js';
import type { Repository } from './repository.js';

function clientKey(headers: { get(name: string): string | null }): string {
  if (config.TRUST_PROXY === 'true') {
    const forwarded = headers.get('cf-connecting-ip') ?? headers.get('x-real-ip') ?? headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  return 'unidentified-direct-client';
}

export function rateLimit(repository: Repository, input: { namespace: string; limit: number; windowSeconds: number }): MiddlewareHandler {
  return async (context, next) => {
    const identity = createHmac('sha256', config.RATE_LIMIT_SECRET).update(clientKey(context.req.raw.headers)).digest('hex');
    const result = await repository.consumeRateLimit(`${input.namespace}:${identity}`, input.limit, input.windowSeconds);
    context.header('RateLimit-Limit', String(input.limit)); context.header('RateLimit-Remaining', String(result.remaining)); context.header('RateLimit-Reset', String(Math.ceil(new Date(result.resetAt).getTime() / 1000)));
    if (!result.allowed) { context.header('Retry-After', String(Math.max(1, Math.ceil((new Date(result.resetAt).getTime() - Date.now()) / 1000)))); return context.json({ error: 'rate_limited', message: 'Too many requests. Try again later.' }, 429); }
    return next();
  };
}
