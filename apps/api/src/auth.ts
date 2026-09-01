import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Context, MiddlewareHandler } from 'hono';
import { ExternalPrincipalSchema } from '@bytecrunch/contracts-domain';
import { config } from './config.js';
import type { Repository } from './repository.js';
import { enterpriseOidcConnection, participantOidcConnection } from './integration-plugins.js';
import { assertExternalUrlAllowed } from './webhooks.js';
import { hashInvitationToken, setExternalSession } from './external-auth.js';

export interface AuthUser {
  id: string;
  authSubjectId: string;
  authProvider: 'dev' | 'oidc';
  authIssuer: string;
  email: string;
  emailVerified: boolean;
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
      const discovered = await response.json() as OidcMetadata;
      return {
        ...discovered,
        ...(config.OIDC_AUTHORIZATION_ENDPOINT ? { authorization_endpoint: config.OIDC_AUTHORIZATION_ENDPOINT } : {}),
        ...(config.OIDC_TOKEN_ENDPOINT ? { token_endpoint: config.OIDC_TOKEN_ENDPOINT } : {}),
        ...(config.OIDC_JWKS_URI ? { jwks_uri: config.OIDC_JWKS_URI } : {}),
      };
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
    emailVerified: Boolean(payload.emailVerified),
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
        emailVerified: true,
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
          emailVerified: Boolean(payload.email_verified),
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

const entityCallbackUri = () => new URL('/auth/entity-callback', config.OIDC_REDIRECT_URI).toString();
const participantCallbackUri = () => new URL('/auth/participant-callback', config.OIDC_REDIRECT_URI).toString();

async function entityMetadata(repository: Repository, entityId: string): Promise<{ metadata: OidcMetadata; issuer: string; clientId: string; clientSecret: string; emailDomains: string[] }> {
  const connection = await enterpriseOidcConnection(repository, entityId); if (!connection) throw new Error('Enterprise SSO is not enabled for this entity.');
  const issuer = String(connection.issuerUrl).replace(/\/$/, ''); await assertExternalUrlAllowed(issuer, 'OIDC issuer'); const discoveryIssuer = issuer === config.OIDC_ISSUER_URL.replace(/\/$/, '') && config.OIDC_INTERNAL_ISSUER_URL ? config.OIDC_INTERNAL_ISSUER_URL.replace(/\/$/, '') : issuer; const response = await fetch(`${discoveryIssuer}/.well-known/openid-configuration`); if (!response.ok) throw new Error(`OIDC discovery failed with ${response.status}`);
  const discovered = await response.json() as OidcMetadata;
  return { issuer, clientId: String(connection.clientId), clientSecret: String(connection.clientSecret), emailDomains: Array.isArray(connection.emailDomains) ? connection.emailDomains.map(String) : [], metadata: { ...discovered, ...(connection.authorizationEndpoint ? { authorization_endpoint: String(connection.authorizationEndpoint) } : {}), ...(connection.tokenEndpoint ? { token_endpoint: String(connection.tokenEndpoint) } : {}), ...(connection.jwksUri ? { jwks_uri: String(connection.jwksUri) } : {}) } };
}

async function participantMetadata(repository: Repository, entityId: string): Promise<{ metadata: OidcMetadata; issuer: string; clientId: string; clientSecret: string; identityProviderId: string }> {
  const connection = await participantOidcConnection(repository, entityId); if (!connection) throw new Error('Participant OIDC is not enabled for this entity.');
  const issuer = connection.issuerUrl.replace(/\/$/, ''); await assertExternalUrlAllowed(issuer, 'OIDC issuer');
  const response = await fetch(`${issuer}/.well-known/openid-configuration`); if (!response.ok) throw new Error(`OIDC discovery failed with ${response.status}`);
  const discovered = await response.json() as OidcMetadata;
  const metadata = { ...discovered, ...(connection.authorizationEndpoint ? { authorization_endpoint: connection.authorizationEndpoint } : {}), ...(connection.tokenEndpoint ? { token_endpoint: connection.tokenEndpoint } : {}), ...(connection.jwksUri ? { jwks_uri: connection.jwksUri } : {}) };
  await Promise.all([metadata.authorization_endpoint, metadata.token_endpoint, metadata.jwks_uri].map((url) => assertExternalUrlAllowed(url, 'OIDC endpoint')));
  return { metadata, issuer, clientId: connection.clientId, clientSecret: connection.clientSecret, identityProviderId: connection.installationId };
}

export function registerAuthRoutes(app: import('hono').Hono, repository: Repository): void {
  app.get('/auth/login', async (context) => {
    if (config.AUTH_MODE === 'dev') return context.redirect(config.WEB_URL);
    const metadata = await getMetadata();
    const state = randomBytes(24).toString('base64url');
    const nonce = randomBytes(24).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const requestedReturnTo = context.req.query('returnTo');
    const returnTo = requestedReturnTo?.startsWith('/') && !requestedReturnTo.startsWith('//') ? requestedReturnTo : '/';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const authState = await signPayload({ state, nonce, verifier, returnTo }, '10m');
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

  app.get('/auth/sso/:entitySlug', async (context) => {
    const entity = await repository.findCustomerEntityBySlug(context.req.param('entitySlug'));
    if (!entity) return context.text('Customer entity not found.', 404);
    try {
      const connection = await entityMetadata(repository, entity.id); const state = randomBytes(24).toString('base64url'); const nonce = randomBytes(24).toString('base64url'); const verifier = randomBytes(48).toString('base64url');
      const requestedReturnTo = context.req.query('returnTo'); const returnTo = requestedReturnTo?.startsWith('/') && !requestedReturnTo.startsWith('//') ? requestedReturnTo : '/'; const challenge = createHash('sha256').update(verifier).digest('base64url');
      const authState = await signPayload({ state, nonce, verifier, returnTo, entityId: entity.id }, '10m');
      setCookie(context, 'bc_contracts_auth_state', authState, { httpOnly: true, sameSite: 'Lax', secure: entityCallbackUri().startsWith('https://'), path: '/', maxAge: 600 });
      const url = new URL(connection.metadata.authorization_endpoint); url.searchParams.set('client_id', connection.clientId); url.searchParams.set('redirect_uri', entityCallbackUri()); url.searchParams.set('response_type', 'code'); url.searchParams.set('scope', 'openid profile email'); url.searchParams.set('state', state); url.searchParams.set('nonce', nonce); url.searchParams.set('code_challenge', challenge); url.searchParams.set('code_challenge_method', 'S256');
      return context.redirect(url.toString());
    } catch (error) { return context.text(error instanceof Error ? error.message : 'Enterprise SSO could not be started.', 409); }
  });

  app.get('/auth/participant/:entitySlug', async (context) => {
    const entity = await repository.findCustomerEntityBySlug(context.req.param('entitySlug')); const token = context.req.query('integrationToken');
    if (!entity || !token || token.length < 20) return context.text('The signing handoff is invalid.', 400);
    const handoff = await repository.getIntegrationSessionByTokenHash(hashInvitationToken(token));
    if (!handoff || handoff.tenantId !== entity.id || !['pending', 'authenticating'].includes(handoff.status) || new Date(handoff.expiresAt).getTime() <= Date.now()) return context.text('The signing handoff is invalid or has expired.', 410);
    const configuredIntegration = (await repository.listIntegrations(entity.id)).find((item) => item.id === handoff.integrationId);
    if (!configuredIntegration || configuredIntegration.mappingStrategy !== 'shared_oidc') return context.text('This integration does not use participant OIDC.', 409);
    try {
      const connection = await participantMetadata(repository, entity.id); const state = randomBytes(24).toString('base64url'); const nonce = randomBytes(24).toString('base64url'); const verifier = randomBytes(48).toString('base64url'); const challenge = createHash('sha256').update(verifier).digest('base64url');
      const authState = await signPayload({ state, nonce, verifier, entityId: entity.id, integrationSessionId: handoff.id, tokenHash: handoff.tokenHash }, '10m');
      setCookie(context, 'bc_contracts_participant_auth_state', authState, { httpOnly: true, sameSite: 'Lax', secure: participantCallbackUri().startsWith('https://'), path: '/auth', maxAge: 600 });
      handoff.status = 'authenticating'; await repository.saveIntegrationSession(handoff);
      const url = new URL(connection.metadata.authorization_endpoint); url.searchParams.set('client_id', connection.clientId); url.searchParams.set('redirect_uri', participantCallbackUri()); url.searchParams.set('response_type', 'code'); url.searchParams.set('scope', 'openid profile email'); url.searchParams.set('state', state); url.searchParams.set('nonce', nonce); url.searchParams.set('code_challenge', challenge); url.searchParams.set('code_challenge_method', 'S256');
      return context.redirect(url.toString());
    } catch (error) { return context.text(error instanceof Error ? error.message : 'Participant authentication could not be started.', 409); }
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
      if (typeof payload.email !== 'string' || payload.email_verified !== true) throw new Error('A verified email address is required');
      const session = await new SignJWT({
        email: payload.email,
        emailVerified: Boolean(payload.email_verified),
        name: payload.name ?? payload.preferred_username,
        tenantId: payload.tenant_id ?? 'bytecrunch',
        scopes: ['agreements:read', 'agreements:write', 'templates:write', 'webhooks:manage'],
      }).setProtectedHeader({ alg: 'HS256' }).setSubject(String(payload.sub)).setIssuedAt().setExpirationTime('8h').sign(secret);
      setCookie(context, 'bc_contracts_session', session, {
        httpOnly: true, sameSite: 'Lax', secure: config.WEB_URL.startsWith('https://'), path: '/', maxAge: 28_800,
      });
      deleteCookie(context, 'bc_contracts_auth_state');
      const returnUrl = new URL(String(authState.returnTo ?? '/'), config.WEB_URL);
      return context.redirect(returnUrl.origin === new URL(config.WEB_URL).origin ? returnUrl.toString() : config.WEB_URL);
    } catch (error) {
      return context.text(`Authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 401);
    }
  });

  app.get('/auth/entity-callback', async (context) => {
    const code = context.req.query('code'); const returnedState = context.req.query('state'); const stateCookie = getCookie(context, 'bc_contracts_auth_state');
    if (!code || !returnedState || !stateCookie) return context.text('Invalid authentication response.', 400);
    try {
      const { payload: authState } = await jwtVerify(stateCookie, secret, { algorithms: ['HS256'] }); if (authState.state !== returnedState || typeof authState.entityId !== 'string') throw new Error('State does not match');
      const connection = await entityMetadata(repository, authState.entityId); const response = await fetch(internalUrl(connection.metadata.token_endpoint), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: entityCallbackUri(), client_id: connection.clientId, client_secret: connection.clientSecret, code_verifier: String(authState.verifier) }) });
      if (!response.ok) throw new Error(`Token endpoint returned ${response.status}`); const tokens = await response.json() as { id_token: string }; const jwks = createRemoteJWKSet(new URL(internalUrl(connection.metadata.jwks_uri))); const { payload } = await jwtVerify(tokens.id_token, jwks, { issuer: connection.issuer, audience: connection.clientId });
      if (payload.nonce !== authState.nonce) throw new Error('Nonce does not match'); if (typeof payload.email !== 'string' || payload.email_verified !== true) throw new Error('A verified email address is required'); const emailDomain = payload.email.toLowerCase().split('@')[1] ?? ''; if (!connection.emailDomains.includes(emailDomain)) throw new Error('This verified email domain is not allowed for the customer entity.');
      const session = await new SignJWT({ email: payload.email, emailVerified: true, name: payload.name ?? payload.preferred_username ?? payload.email, issuer: connection.issuer, tenantId: authState.entityId, scopes: ['agreements:read', 'agreements:write', 'templates:write'] }).setProtectedHeader({ alg: 'HS256' }).setSubject(String(payload.sub)).setIssuedAt().setExpirationTime('8h').sign(secret);
      setCookie(context, 'bc_contracts_session', session, { httpOnly: true, sameSite: 'Lax', secure: config.WEB_URL.startsWith('https://'), path: '/', maxAge: 28_800 }); deleteCookie(context, 'bc_contracts_auth_state'); const returnUrl = new URL(String(authState.returnTo ?? '/'), config.WEB_URL); return context.redirect(returnUrl.origin === new URL(config.WEB_URL).origin ? returnUrl.toString() : config.WEB_URL);
    } catch (error) { return context.text(`Authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 401); }
  });

  app.get('/auth/participant-callback', async (context) => {
    const code = context.req.query('code'); const returnedState = context.req.query('state'); const stateCookie = getCookie(context, 'bc_contracts_participant_auth_state');
    if (!code || !returnedState || !stateCookie) return context.text('Invalid participant authentication response.', 400);
    try {
      const { payload: authState } = await jwtVerify(stateCookie, secret, { algorithms: ['HS256'] });
      if (authState.state !== returnedState || typeof authState.entityId !== 'string' || typeof authState.integrationSessionId !== 'string' || typeof authState.tokenHash !== 'string') throw new Error('State does not match');
      const handoff = await repository.getIntegrationSessionByTokenHash(authState.tokenHash);
      if (!handoff || handoff.id !== authState.integrationSessionId || handoff.tenantId !== authState.entityId || handoff.status !== 'authenticating' || new Date(handoff.expiresAt).getTime() <= Date.now()) throw new Error('The signing handoff has expired');
      const connection = await participantMetadata(repository, handoff.tenantId);
      const response = await fetch(connection.metadata.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: participantCallbackUri(), client_id: connection.clientId, client_secret: connection.clientSecret, code_verifier: String(authState.verifier) }) });
      if (!response.ok) throw new Error(`Token endpoint returned ${response.status}`);
      const tokens = await response.json() as { id_token?: string }; if (!tokens.id_token) throw new Error('Token endpoint did not return an ID token');
      const jwks = createRemoteJWKSet(new URL(connection.metadata.jwks_uri)); const { payload } = await jwtVerify(tokens.id_token, jwks, { issuer: connection.issuer, audience: connection.clientId });
      if (payload.nonce !== authState.nonce) throw new Error('Nonce does not match');
      if (typeof payload.sub !== 'string' || payload.sub !== handoff.externalSubject) throw new Error('The authenticated account does not match the signing subject');
      if (typeof payload.email !== 'string' || payload.email_verified !== true) throw new Error('A verified email address is required');
      let principal = await repository.findExternalPrincipal(handoff.tenantId, connection.issuer, payload.sub);
      if (!principal) {
        const resolvedPerson = await repository.findPersonByEmail(handoff.tenantId, payload.email) ?? await repository.createPerson(handoff.tenantId, payload.email, String(payload.name ?? payload.preferred_username ?? payload.email));
        const authenticationTime = typeof payload.auth_time === 'number' ? new Date(payload.auth_time * 1000).toISOString() : null;
        principal = ExternalPrincipalSchema.parse({ id: `principal_${randomBytes(18).toString('base64url')}`, tenantId: handoff.tenantId, identityProviderId: connection.identityProviderId, issuer: connection.issuer, subject: payload.sub, personId: resolvedPerson.id, email: payload.email.toLowerCase(), displayName: String(payload.name ?? payload.preferred_username ?? payload.email), verificationMethod: 'federated_oidc', verifiedAt: new Date().toISOString(), authenticationTime });
        await repository.createExternalPrincipal(principal);
        principal = await repository.findExternalPrincipal(handoff.tenantId, connection.issuer, payload.sub) ?? principal;
      }
      const agreement = await repository.getAgreement(handoff.tenantId, handoff.agreementId); if (!agreement) throw new Error('Agreement not found');
      const participant = agreement.participants.find((item) => item.id === handoff.participantId); if (!participant) throw new Error('Participant not found');
      participant.personId = principal.personId; participant.externalPrincipalId = principal.id; participant.email = principal.email;
      if (agreement.integrationContext) { agreement.integrationContext.personId = principal.personId; agreement.integrationContext.externalPrincipalId = principal.id; }
      agreement.updatedAt = new Date().toISOString(); await repository.saveAgreement(agreement);
      handoff.personId = principal.personId; handoff.externalPrincipalId = principal.id; handoff.status = 'accepted'; handoff.acceptedAt = new Date().toISOString(); await repository.saveIntegrationSession(handoff);
      await setExternalSession(context, { invitationId: handoff.id, agreementId: handoff.agreementId, participantId: handoff.participantId, tenantId: handoff.tenantId, authenticationMethod: 'federated_oidc', externalPrincipalId: principal.id, authenticationIssuer: principal.issuer, authenticationSubject: principal.subject, ...(principal.authenticationTime ? { authenticationTime: principal.authenticationTime } : {}) });
      deleteCookie(context, 'bc_contracts_participant_auth_state', { path: '/auth' });
      return context.redirect(`${config.WEB_URL}/invite`);
    } catch (error) { return context.text(`Participant authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 401); }
  });

  app.post('/auth/logout', (context) => {
    deleteCookie(context, 'bc_contracts_session', { path: '/' });
    return context.json({ ok: true });
  });

  app.get('/auth/me', authMiddleware(), (context) => context.json(currentUser(context)));
}
