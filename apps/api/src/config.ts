import { z } from "zod";

try {
  process.loadEnvFile();
} catch (error) {
  if (
    !(error instanceof Error) ||
    !("code" in error) ||
    error.code !== "ENOENT"
  )
    throw error;
}

const ConfigSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().positive().default(3001),
    WEB_URL: z.string().url().default("http://localhost:3000"),
    DATABASE_URL: z.string().optional(),
    AUTH_MODE: z.enum(["dev", "oidc"]).default("dev"),
    DEV_USER_ID: z.string().default("local-admin"),
    DEV_USER_EMAIL: z.string().email().default("admin@bytecrunch.local"),
    DEV_USER_NAME: z.string().default("Local Admin"),
    TENANT_LEGAL_NAME: z.string().min(1).default("ByteCrunch ApS"),
    TENANT_BUSINESS_ADDRESS: z.string().max(500).default(""),
    OIDC_ISSUER_URL: z
      .string()
      .url()
      .default("http://localhost:8080/realms/bytecrunch"),
    OIDC_INTERNAL_ISSUER_URL: z.string().url().optional(),
    OIDC_CLIENT_ID: z.string().default("bytecrunch-contracts"),
    OIDC_CLIENT_SECRET: z.string().default("local-development-secret"),
    OIDC_REDIRECT_URI: z
      .string()
      .url()
      .default("http://localhost:3001/auth/callback"),
    SESSION_SECRET: z
      .string()
      .min(32)
      .default("local-only-session-secret-change-me"),
    WEBHOOK_SIGNING_SECRET: z.string().min(8).default("local-webhook-secret"),
    SIGNING_MODE: z.enum(["development", "disabled"]).default("development"),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    SMTP_FROM: z
      .string()
      .default("Bytecrunch Contracts <contracts@bytecrunch.local>"),
    WEBAUTHN_RP_ID: z.string().min(1).optional(),
    WEBAUTHN_ORIGIN: z.string().url().optional(),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV !== "production") return;
    const require = (condition: boolean, path: string, message: string) => {
      if (!condition)
        context.addIssue({ code: "custom", path: [path], message });
    };
    require(Boolean(
      value.DATABASE_URL,
    ), "DATABASE_URL", "Persistent PostgreSQL storage is required in production.");
    require(value.AUTH_MODE ===
      "oidc", "AUTH_MODE", "OIDC authentication is required in production.");
    require(value.WEB_URL.startsWith(
      "https://",
    ), "WEB_URL", "HTTPS is required in production.");
    require(value.OIDC_ISSUER_URL.startsWith(
      "https://",
    ), "OIDC_ISSUER_URL", "The public OIDC issuer must use HTTPS in production.");
    require(value.OIDC_REDIRECT_URI.startsWith(
      "https://",
    ), "OIDC_REDIRECT_URI", "The OIDC redirect URI must use HTTPS in production.");
    require(Boolean(
      value.SMTP_HOST,
    ), "SMTP_HOST", "An SMTP transport is required in production.");
    require(value.SESSION_SECRET.length >= 32 &&
      !value.SESSION_SECRET.includes("local-") &&
      !value.SESSION_SECRET.includes(
        "change-",
      ), "SESSION_SECRET", "Use a unique production session secret of at least 32 characters.");
    require(value.WEBHOOK_SIGNING_SECRET.length >= 32 &&
      !value.WEBHOOK_SIGNING_SECRET.includes(
        "local-",
      ), "WEBHOOK_SIGNING_SECRET", "Use a unique webhook signing secret of at least 32 characters.");
    require(value.OIDC_CLIENT_SECRET !==
      "local-development-secret", "OIDC_CLIENT_SECRET", "Use the deployed OIDC client secret.");
    require(value.SIGNING_MODE !==
      "development", "SIGNING_MODE", "The development signature witness cannot run in production. Set signing to disabled until a certified provider is configured.");
  });

export function parseConfig(environment: NodeJS.ProcessEnv) {
  return ConfigSchema.parse(environment);
}

export const config = parseConfig(process.env);
