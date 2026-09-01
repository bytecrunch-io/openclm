import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import type { Integration } from '@bytecrunch/contracts-domain';
import { z } from 'zod';
import { config } from './config.js';
import type { Repository } from './repository.js';

const issuer = 'urn:bytecrunch:contracts';
const audience = 'urn:bytecrunch:contracts:integration-api';
const signingKey = new TextEncoder().encode(config.SESSION_SECRET);
const TokenRequestSchema = z.object({ grant_type: z.literal('client_credentials'), scope: z.string().optional(), client_id: z.string().optional(), client_secret: z.string().optional() });

export type IntegrationClient = { integration: Integration; scopes: string[] };

declare module 'hono' {
  interface ContextVariableMap {
    integrationClient: IntegrationClient;
  }
}

const secretHash = (value: string) => createHash('sha256').update(value).digest('hex');
export const hashIntegrationSecret = secretHash;

function clientCredentials(context: Context): { clientId: string; clientSecret: string } | undefined {
  const authorization = context.req.header('authorization');
  if (authorization?.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      if (separator > 0) return { clientId: decoded.slice(0, separator), clientSecret: decoded.slice(separator + 1) };
    } catch { return undefined; }
  }
  return undefined;
}

function validSecret(provided: string, expectedHash: string | null): boolean {
  if (!expectedHash) return false;
  const actual = Buffer.from(secretHash(provided)); const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function registerIntegrationOAuthRoutes(app: Hono, repository: Repository): void {
  app.post('/oauth/token', async (context) => {
    const contentType = context.req.header('content-type') ?? '';
    if (!contentType.includes('application/x-www-form-urlencoded')) return context.json({ error: 'invalid_request', error_description: 'Use application/x-www-form-urlencoded.' }, 400);
    const parsed = TokenRequestSchema.safeParse(await context.req.parseBody());
    if (!parsed.success) return context.json({ error: 'invalid_request', error_description: 'grant_type must be client_credentials.' }, 400);
    const form = parsed.data; const basic = clientCredentials(context);
    const clientId = basic?.clientId ?? form.client_id ?? '';
    const clientSecret = basic?.clientSecret ?? form.client_secret ?? '';
    const limited = await repository.consumeRateLimit(`oauth-client:${clientId || 'unknown'}`, 30, 900);
    if (!limited.allowed) return context.json({ error: 'temporarily_unavailable', error_description: 'Too many token requests.' }, 429);
    const integration = clientId ? await repository.findIntegrationByClientId(clientId) : undefined;
    if (!integration || !validSecret(clientSecret, integration.clientSecretHash)) {
      return context.json({ error: 'invalid_client', error_description: 'Client authentication failed.' }, 401, { 'www-authenticate': 'Basic realm="ByteCrunch Contracts"' });
    }
    const requested = typeof form.scope === 'string' ? form.scope.split(' ').filter(Boolean) : integration.scopes;
    if (requested.some((scope) => !integration.scopes.includes(scope as Integration['scopes'][number]))) return context.json({ error: 'invalid_scope' }, 400);
    const token = await new SignJWT({ entity_id: integration.tenantId, integration_id: integration.id, integration_key: integration.key, scope: requested.join(' '), jti: randomUUID() })
      .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' }).setIssuer(issuer).setAudience(audience).setSubject(integration.clientId!).setIssuedAt().setExpirationTime('5m').sign(signingKey);
    return context.json({ access_token: token, token_type: 'Bearer', expires_in: 300, scope: requested.join(' ') }, 200, { 'cache-control': 'no-store', pragma: 'no-cache' });
  });
}

export function integrationAuthMiddleware(repository: Repository, requiredScope: Integration['scopes'][number]): MiddlewareHandler {
  return async (context, next) => {
    const authorization = context.req.header('authorization');
    if (!authorization?.startsWith('Bearer ')) return context.json({ error: 'unauthorized', message: 'An integration access token is required.' }, 401);
    try {
      const { payload } = await jwtVerify(authorization.slice(7), signingKey, { algorithms: ['HS256'], issuer, audience });
      const integration = await repository.findIntegration(String(payload.entity_id), String(payload.integration_key));
      if (!integration || integration.id !== payload.integration_id || integration.clientId !== payload.sub) throw new Error('Integration no longer exists.');
      const scopes = String(payload.scope ?? '').split(' ').filter(Boolean);
      if (!scopes.includes(requiredScope)) return context.json({ error: 'insufficient_scope', message: `The '${requiredScope}' scope is required.` }, 403);
      context.set('integrationClient', { integration, scopes });
      return next();
    } catch {
      return context.json({ error: 'unauthorized', message: 'The integration access token is invalid or expired.' }, 401);
    }
  };
}

export function integrationClient(context: Context): IntegrationClient { return context.get('integrationClient'); }
