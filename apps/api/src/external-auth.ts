import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { getCookie, setCookie } from 'hono/cookie';
import type { Context, MiddlewareHandler } from 'hono';
import { config } from './config.js';

export interface ExternalSession {
  invitationId: string;
  agreementId: string;
  participantId: string;
  tenantId: string;
}

declare module 'hono' {
  interface ContextVariableMap {
    externalSession: ExternalSession;
  }
}

const secret = new TextEncoder().encode(config.SESSION_SECRET);

export function createInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function setExternalSession(context: Context, session: ExternalSession): Promise<void> {
  const token = await new SignJWT({ ...session, kind: 'external-participant' })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(session.participantId).setIssuedAt().setExpirationTime('7d').sign(secret);
  setCookie(context, 'bc_external_session', token, {
    httpOnly: true, sameSite: 'Lax', secure: config.WEB_URL.startsWith('https://'), path: '/public', maxAge: 604_800,
  });
}

export function externalSessionMiddleware(): MiddlewareHandler {
  return async (context, next) => {
    const token = getCookie(context, 'bc_external_session');
    if (!token) return context.json({ error: 'unauthorized', message: 'Open a valid invitation to continue.' }, 401);
    try {
      const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
      if (payload.kind !== 'external-participant') throw new Error('Wrong session type');
      context.set('externalSession', {
        invitationId: String(payload.invitationId), agreementId: String(payload.agreementId),
        participantId: String(payload.participantId), tenantId: String(payload.tenantId),
      });
      return next();
    } catch {
      return context.json({ error: 'unauthorized', message: 'The invitation session has expired.' }, 401);
    }
  };
}

export function currentExternalSession(context: Context): ExternalSession {
  return context.get('externalSession');
}
