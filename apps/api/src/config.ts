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
      .enum(["development", "test", "staging", "production"])
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
    SIGNING_MODE: z.enum(["development", "platform", "disabled"]).default("development"),
    PDF_SEAL_MODE: z.enum(["development", "p12", "disabled"]).default("development"),
    PDF_SEAL_P12_PATH: z.string().min(1).optional(),
    PDF_SEAL_P12_PASSWORD: z.string().optional(),
    PDF_SEAL_NAME: z.string().min(1).default("ByteCrunch Contracts"),
    PDF_SEAL_LOCATION: z.string().default("Copenhagen, Denmark"),
    PDF_SEAL_CONTACT: z.string().default("contracts@bytecrunch.com"),
    ARTIFACT_STORAGE_DRIVER: z.enum(["database", "filesystem"]).default("database"),
    ARTIFACT_STORAGE_PATH: z.string().min(1).default("./var/artifacts"),
    ARTIFACT_RETENTION_DAYS: z.coerce.number().int().min(1).max(36500).default(2555),
    RATE_LIMIT_SECRET: z.string().min(32).default("local-rate-limit-secret-change-me"),
    TRUST_PROXY: z.enum(["true", "false"]).default("false"),
    METRICS_TOKEN: z.string().min(32).default("local-metrics-token-change-me-now"),
    DELIVERY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(10),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    SMTP_FROM: z
      .string()
      .default("Bytecrunch Contracts <contracts@bytecrunch.local>"),
    WEBAUTHN_RP_ID: z.string().min(1).optional(),
    WEBAUTHN_ORIGIN: z.string().url().optional(),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === "development" || value.NODE_ENV === "test") return;
    const require = (condition: boolean, path: string, message: string) => {
      if (!condition)
        context.addIssue({ code: "custom", path: [path], message });
    };
    require(Boolean(
      value.DATABASE_URL,
    ), "DATABASE_URL", "Persistent PostgreSQL storage is required in deployed environments.");
    require(value.AUTH_MODE ===
      "oidc", "AUTH_MODE", "OIDC authentication is required in deployed environments.");
    require(value.WEB_URL.startsWith(
      "https://"), "WEB_URL", "HTTPS is required in deployed environments.");
    require(value.OIDC_ISSUER_URL.startsWith(
      "https://"), "OIDC_ISSUER_URL", "The public OIDC issuer must use HTTPS in deployed environments.");
    require(value.OIDC_REDIRECT_URI.startsWith(
      "https://"), "OIDC_REDIRECT_URI", "The OIDC redirect URI must use HTTPS in deployed environments.");
    require(Boolean(
      value.SMTP_HOST), "SMTP_HOST", "An SMTP transport is required in deployed environments.");
    require(value.SESSION_SECRET.length >= 32 &&
      !value.SESSION_SECRET.includes("local-") &&
      !value.SESSION_SECRET.includes(
        "change-",
      ), "SESSION_SECRET", "Use a unique deployed session secret of at least 32 characters.");
    require(value.WEBHOOK_SIGNING_SECRET.length >= 32 &&
      !value.WEBHOOK_SIGNING_SECRET.includes(
        "local-",
      ), "WEBHOOK_SIGNING_SECRET", "Use a unique deployed webhook signing secret of at least 32 characters.");
    require(value.OIDC_CLIENT_SECRET !==
      "local-development-secret", "OIDC_CLIENT_SECRET", "Use the deployed OIDC client secret.");
    require(value.ARTIFACT_STORAGE_DRIVER !==
      "database", "ARTIFACT_STORAGE_DRIVER", "Deployed artifacts must use a storage adapter outside the application database.");
    require(!value.RATE_LIMIT_SECRET.includes(
      "local-") && !value.RATE_LIMIT_SECRET.includes("change-"), "RATE_LIMIT_SECRET", "Use a unique production rate-limit key secret.");
    require(!value.METRICS_TOKEN.includes(
      "local-") && !value.METRICS_TOKEN.includes("change-"), "METRICS_TOKEN", "Use a unique production metrics bearer token.");
    if (value.NODE_ENV === "production") {
      require(value.SIGNING_MODE !== "development", "SIGNING_MODE", "The development signature witness cannot run in production.");
      if (value.SIGNING_MODE === "platform") {
        require(value.PDF_SEAL_MODE === "p12", "PDF_SEAL_MODE", "Platform signing in production requires a deployment-managed PKCS#12 seal.");
        require(Boolean(value.PDF_SEAL_P12_PATH), "PDF_SEAL_P12_PATH", "Set the path to the deployment PKCS#12 seal.");
        require(Boolean(value.PDF_SEAL_P12_PASSWORD), "PDF_SEAL_P12_PASSWORD", "Set the PKCS#12 seal password.");
      }
      if (value.SIGNING_MODE !== 'disabled') require(value.PDF_SEAL_MODE !== "development", "PDF_SEAL_MODE", "The ephemeral development seal cannot run in production.");
    }
  });

export function parseConfig(environment: NodeJS.ProcessEnv) {
  return ConfigSchema.parse(environment);
}

export const config = parseConfig(process.env);
