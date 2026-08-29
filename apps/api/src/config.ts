import { z } from 'zod';

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  WEB_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().optional(),
  AUTH_MODE: z.enum(['dev', 'oidc']).default('dev'),
  DEV_USER_ID: z.string().default('local-admin'),
  DEV_USER_EMAIL: z.string().email().default('admin@bytecrunch.local'),
  DEV_USER_NAME: z.string().default('Local Admin'),
  TENANT_LEGAL_NAME: z.string().min(1).default('ByteCrunch ApS'),
  TENANT_BUSINESS_ADDRESS: z.string().max(500).default(''),
  OIDC_ISSUER_URL: z.string().url().default('http://localhost:8080/realms/bytecrunch'),
  OIDC_INTERNAL_ISSUER_URL: z.string().url().optional(),
  OIDC_CLIENT_ID: z.string().default('bytecrunch-contracts'),
  OIDC_CLIENT_SECRET: z.string().default('local-development-secret'),
  OIDC_REDIRECT_URI: z.string().url().default('http://localhost:3001/auth/callback'),
  SESSION_SECRET: z.string().min(32).default('local-only-session-secret-change-me'),
  WEBHOOK_SIGNING_SECRET: z.string().min(8).default('local-webhook-secret'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_FROM: z.string().default('Bytecrunch Contracts <contracts@bytecrunch.local>'),
});

export const config = ConfigSchema.parse(process.env);
