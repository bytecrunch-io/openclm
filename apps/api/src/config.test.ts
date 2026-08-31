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
  METRICS_TOKEN: "unique-metrics-token-1234567890abcdef",
} satisfies NodeJS.ProcessEnv;

describe("production configuration", () => {
  it("accepts a production-like staging deployment with the test signing witness", () => {
    expect(parseConfig({ ...productionEnvironment, NODE_ENV: "staging", SIGNING_MODE: "development" })).toMatchObject({
      NODE_ENV: "staging",
      AUTH_MODE: "oidc",
      SIGNING_MODE: "development",
    });
  });

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

  it('accepts production platform signing only with a deployment PKCS#12 seal', () => {
    expect(parseConfig({ ...productionEnvironment, SIGNING_MODE: 'platform', PDF_SEAL_MODE: 'p12', PDF_SEAL_P12_PATH: '/run/secrets/contracts-seal.p12', PDF_SEAL_P12_PASSWORD: 'secret-manager-value' })).toMatchObject({ SIGNING_MODE: 'platform', PDF_SEAL_MODE: 'p12' });
    expect(() => parseConfig({ ...productionEnvironment, SIGNING_MODE: 'platform', PDF_SEAL_MODE: 'p12' })).toThrow(/PKCS#12 seal/i);
  });

  it("rejects production without persistent storage", () => {
    const { DATABASE_URL: _, ...environment } = productionEnvironment;
    expect(() => parseConfig(environment)).toThrow(/PostgreSQL storage/i);
  });

  it("rejects production artifacts stored inline in the database", () => {
    expect(() => parseConfig({ ...productionEnvironment, ARTIFACT_STORAGE_DRIVER: "database" })).toThrow(/outside the application database/i);
  });

  it("requires explicitly scoped Google Drive export configuration", () => {
    expect(() => parseConfig({ ...productionEnvironment, EXECUTED_EXPORT_DRIVER: 'google_drive' })).toThrow(/Google service-account credential path/i);
    expect(parseConfig({
      ...productionEnvironment,
      EXECUTED_EXPORT_DRIVER: 'google_drive',
      EXECUTED_EXPORT_ENTITY_IDS: 'fiftysixty',
      GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH: '/run/secrets/google-service-account.json',
      GOOGLE_DRIVE_FOLDER_ID: 'drive-folder-id',
    })).toMatchObject({ EXECUTED_EXPORT_DRIVER: 'google_drive', EXECUTED_EXPORT_ENTITY_IDS: 'fiftysixty' });
  });

  it("requires complete verified-domain entity bootstrap configuration", () => {
    expect(() => parseConfig({ ...productionEnvironment, BOOTSTRAP_ENTITY_ID: 'fiftysixty' })).toThrow(/slug for the bootstrapped/i);
    expect(parseConfig({
      ...productionEnvironment,
      BOOTSTRAP_ENTITY_ID: 'fiftysixty',
      BOOTSTRAP_ENTITY_SLUG: 'fiftysixty',
      BOOTSTRAP_ENTITY_LEGAL_NAME: 'FiftySixty ApS',
      BOOTSTRAP_MEMBER_EMAIL_DOMAINS: 'fiftysixty.com,spot.dog',
    })).toMatchObject({ BOOTSTRAP_ENTITY_ID: 'fiftysixty' });
  });
});
