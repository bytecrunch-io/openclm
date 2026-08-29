import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Context, MiddlewareHandler } from 'hono';
import { config } from './config.js';

export interface AuthUser {
  id: string;
  authSubjectId: string;
  authProvider: 'dev' | 'oidc';
  authIssuer: string;
  email: string;
  name: string;
  tenantId: string;
  scopes: string[];
}

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

type OidcMetadata = {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
};

let metadataPromise: Promise<OidcMetadata> | undefined;
const secret = new TextEncoder().encode(config.SESSION_SECRET);

function internalUrl(publicUrl: string): string {
  if (!config.OIDC_INTERNAL_ISSUER_URL) return publicUrl;
  const publicIssuer = new URL(config.OIDC_ISSUER_URL);
  const internalIssuer = new URL(config.OIDC_INTERNAL_ISSUER_URL);
  const target = new URL(publicUrl);
  if (target.origin === publicIssuer.origin) {
    target.protocol = internalIssuer.protocol;
    target.host = internalIssuer.host;
  }
  return target.toString();
}

async function getMetadata(): Promise<OidcMetadata> {
  metadataPromise ??= fetch(`${config.OIDC_INTERNAL_ISSUER_URL ?? config.OIDC_ISSUER_URL}/.well-known/openid-configuration`)
    .then(async (response) => {
      if (!response.ok) throw new Error(`OIDC discovery failed with ${response.status}`);
      return response.json() as Promise<OidcMetadata>;
    });
  return metadataPromise;
}

async function signPayload(payload: Record<string, unknown>, expiresIn: string | number): Promise<string> {
  return new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(expiresIn).sign(secret);
}

async function readSession(token: string): Promise<AuthUser> {
  const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
  return {
    id: String(payload.sub),
    authSubjectId: String(payload.sub),
    authProvider: 'oidc',
    authIssuer: String(payload.issuer ?? config.OIDC_ISSUER_URL),
    email: String(payload.email),
    name: String(payload.name),
    tenantId: String(payload.tenantId ?? 'bytecrunch'),
    scopes: Array.isArray(payload.scopes) ? payload.scopes.map(String) : [],
  };
}

export function authMiddleware(): MiddlewareHandler {
  return async (context, next) => {
    if (config.AUTH_MODE === 'dev') {
      context.set('user', {
        id: config.DEV_USER_ID,
        authSubjectId: config.DEV_USER_ID,
        authProvider: 'dev',
        authIssuer: 'bytecrunch-local',
        email: config.DEV_USER_EMAIL,
        name: config.DEV_USER_NAME,
        tenantId: 'bytecrunch',
        scopes: ['*'],
      } satisfies AuthUser);
      return next();
    }

    const bearer = context.req.header('authorization');
    if (bearer?.startsWith('Bearer ')) {
      try {
        const metadata = await getMetadata();
        const jwks = createRemoteJWKSet(new URL(internalUrl(metadata.jwks_uri)));
        const { payload } = await jwtVerify(bearer.slice(7), jwks, {
          issuer: config.OIDC_ISSUER_URL,
          audience: config.OIDC_CLIENT_ID,
        });
        context.set('user', {
          id: String(payload.sub),
          authSubjectId: String(payload.sub),
          authProvider: 'oidc',
          authIssuer: config.OIDC_ISSUER_URL,
          email: String(payload.email ?? `${payload.sub}@service.local`),
          name: String(payload.name ?? payload.preferred_username ?? payload.sub),
          tenantId: String(payload.tenant_id ?? 'bytecrunch'),
          scopes: String(payload.scope ?? '').split(' ').filter(Boolean),
        } satisfies AuthUser);
        return next();
      } catch {
        return context.json({ error: 'unauthorized', message: 'The bearer token is invalid.' }, 401);
      }
    }

    const session = getCookie(context, 'bc_contracts_session');
    if (!session) return context.json({ error: 'unauthorized', message: 'Sign in is required.' }, 401);
    try {
      context.set('user', await readSession(session));
      return next();
    } catch {
      deleteCookie(context, 'bc_contracts_session');
      return context.json({ error: 'unauthorized', message: 'The session has expired.' }, 401);
    }
  };
}

export function currentUser(context: Context): AuthUser {
  return context.get('user') as AuthUser;
}

export function registerAuthRoutes(app: import('hono').Hono): void {
  app.get('/auth/login', async (context) => {
    if (config.AUTH_MODE === 'dev') return context.redirect(config.WEB_URL);
    const metadata = await getMetadata();
    const state = randomBytes(24).toString('base64url');
    const nonce = randomBytes(24).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const authState = await signPayload({ state, nonce, verifier }, '10m');
    setCookie(context, 'bc_contracts_auth_state', authState, {
      httpOnly: true, sameSite: 'Lax', secure: config.OIDC_REDIRECT_URI.startsWith('https://'), path: '/', maxAge: 600,
    });
    const url = new URL(metadata.authorization_endpoint);
    url.searchParams.set('client_id', config.OIDC_CLIENT_ID);
    url.searchParams.set('redirect_uri', config.OIDC_REDIRECT_URI);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid profile email');
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return context.redirect(url.toString());
  });

  app.get('/auth/callback', async (context) => {
    const code = context.req.query('code');
    const returnedState = context.req.query('state');
    const stateCookie = getCookie(context, 'bc_contracts_auth_state');
    if (!code || !returnedState || !stateCookie) return context.text('Invalid authentication response.', 400);
    try {
      const { payload: authState } = await jwtVerify(stateCookie, secret, { algorithms: ['HS256'] });
      if (authState.state !== returnedState) throw new Error('State does not match');
      const metadata = await getMetadata();
      const response = await fetch(internalUrl(metadata.token_endpoint), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: config.OIDC_REDIRECT_URI,
          client_id: config.OIDC_CLIENT_ID,
          client_secret: config.OIDC_CLIENT_SECRET,
          code_verifier: String(authState.verifier),
        }),
      });
      if (!response.ok) throw new Error(`Token endpoint returned ${response.status}`);
      const tokens = await response.json() as { id_token: string };
      const jwks = createRemoteJWKSet(new URL(internalUrl(metadata.jwks_uri)));
      const { payload } = await jwtVerify(tokens.id_token, jwks, {
        issuer: config.OIDC_ISSUER_URL,
        audience: config.OIDC_CLIENT_ID,
      });
      if (payload.nonce !== authState.nonce) throw new Error('Nonce does not match');
      const session = await new SignJWT({
        email: payload.email,
        name: payload.name ?? payload.preferred_username,
        tenantId: payload.tenant_id ?? 'bytecrunch',
        scopes: ['agreements:read', 'agreements:write', 'templates:write', 'webhooks:manage'],
      }).setProtectedHeader({ alg: 'HS256' }).setSubject(String(payload.sub)).setIssuedAt().setExpirationTime('8h').sign(secret);
      setCookie(context, 'bc_contracts_session', session, {
        httpOnly: true, sameSite: 'Lax', secure: config.WEB_URL.startsWith('https://'), path: '/', maxAge: 28_800,
      });
      deleteCookie(context, 'bc_contracts_auth_state');
      return context.redirect(config.WEB_URL);
    } catch (error) {
      return context.text(`Authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 401);
    }
  });

  app.post('/auth/logout', (context) => {
    deleteCookie(context, 'bc_contracts_session', { path: '/' });
    return context.json({ ok: true });
  });

  app.get('/auth/me', authMiddleware(), (context) => context.json(currentUser(context)));
}
