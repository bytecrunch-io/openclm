import { describe, expect, it } from "vitest";
import { parseConfig } from "./config.js";

const productionEnvironment = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://contracts:secret@db.example/contracts",
  AUTH_MODE: "oidc",
  WEB_URL: "https://contracts.example.com",
  OIDC_ISSUER_URL: "https://identity.example.com/realms/contracts",
  OIDC_CLIENT_ID: "contracts",
  OIDC_CLIENT_SECRET: "deployed-client-secret",
  OIDC_REDIRECT_URI: "https://api.contracts.example.com/auth/callback",
  SESSION_SECRET: "unique-session-secret-1234567890abcdef",
  WEBHOOK_SIGNING_SECRET: "unique-webhook-secret-1234567890abcdef",
  SMTP_HOST: "smtp.example.com",
  SIGNING_MODE: "disabled",
  ARTIFACT_STORAGE_DRIVER: "filesystem",
  ARTIFACT_STORAGE_PATH: "/var/lib/bytecrunch/artifacts",
  RATE_LIMIT_SECRET: "unique-rate-limit-secret-1234567890abcdef",
} satisfies NodeJS.ProcessEnv;

describe("production configuration", () => {
  it("accepts a persistent, OIDC-backed deployment with development signing disabled", () => {
    expect(parseConfig(productionEnvironment)).toMatchObject({
      NODE_ENV: "production",
      AUTH_MODE: "oidc",
      SIGNING_MODE: "disabled",
    });
  });

  it("rejects the development signature witness in production", () => {
    expect(() =>
      parseConfig({ ...productionEnvironment, SIGNING_MODE: "development" }),
    ).toThrow(/development signature witness/i);
  });

  it("rejects production without persistent storage", () => {
    const { DATABASE_URL: _, ...environment } = productionEnvironment;
    expect(() => parseConfig(environment)).toThrow(/PostgreSQL storage/i);
  });

  it("rejects production artifacts stored inline in the database", () => {
    expect(() => parseConfig({ ...productionEnvironment, ARTIFACT_STORAGE_DRIVER: "database" })).toThrow(/outside the application database/i);
  });
});
