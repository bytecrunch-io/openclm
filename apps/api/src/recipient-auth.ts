import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context, MiddlewareHandler } from "hono";
import { config } from "./config.js";

export interface RecipientSession {
  accountId: string;
  email: string;
  authenticationMethod: "invitation" | "email_code" | "passkey";
}

declare module "hono" {
  interface ContextVariableMap {
    recipientSession: RecipientSession;
  }
}

const secret = new TextEncoder().encode(config.SESSION_SECRET);

export function createRecipientLoginCode(challengeId: string): {
  code: string;
  codeHash: string;
} {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  return { code, codeHash: hashRecipientLoginCode(challengeId, code) };
}

export function hashRecipientLoginCode(
  challengeId: string,
  code: string,
): string {
  return createHmac("sha256", config.SESSION_SECRET)
    .update(`${challengeId}:${code}`)
    .digest("hex");
}

export function verifyRecipientLoginCode(
  challengeId: string,
  code: string,
  expectedHash: string,
): boolean {
  const actual = Buffer.from(hashRecipientLoginCode(challengeId, code), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function setRecipientSession(
  context: Context,
  session: RecipientSession,
): Promise<void> {
  const token = await new SignJWT({ ...session, kind: "recipient-account" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.accountId)
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(secret);
  setCookie(context, "bc_recipient_session", token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: config.WEB_URL.startsWith("https://"),
    path: "/public/recipient",
    maxAge: 28_800,
  });
}

export function clearRecipientSession(context: Context): void {
  deleteCookie(context, "bc_recipient_session", { path: "/public/recipient" });
}

export function recipientSessionMiddleware(): MiddlewareHandler {
  return async (context, next) => {
    const token = getCookie(context, "bc_recipient_session");
    if (!token)
      return context.json(
        { error: "unauthorized", message: "Sign in to view your agreements." },
        401,
      );
    try {
      const { payload } = await jwtVerify(token, secret, {
        algorithms: ["HS256"],
      });
      if (
        payload.kind !== "recipient-account" ||
        typeof payload.email !== "string"
      )
        throw new Error("Wrong session type");
      context.set("recipientSession", {
        accountId: String(payload.sub),
        email: payload.email,
        authenticationMethod:
          payload.authenticationMethod === "passkey"
            ? "passkey"
            : payload.authenticationMethod === "invitation"
              ? "invitation"
              : "email_code",
      });
      return next();
    } catch {
      clearRecipientSession(context);
      return context.json(
        {
          error: "unauthorized",
          message: "Your recipient session has expired.",
        },
        401,
      );
    }
  };
}

export function currentRecipientSession(context: Context): RecipientSession {
  return context.get("recipientSession");
}
