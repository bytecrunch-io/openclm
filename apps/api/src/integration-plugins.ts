import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { importPKCS8, SignJWT } from 'jose';
import type { Agreement, AgreementArtifact } from '@bytecrunch/contracts-domain';
import { config } from './config.js';

export interface ExecutedAgreementExport {
  provider: string;
  externalId: string;
  webUrl: string | null;
}

export interface ExecutedAgreementExportPlugin {
  readonly key: string;
  enabledFor(entityId: string): boolean;
  exportExecutedAgreement(input: {
    agreement: Agreement;
    artifact: AgreementArtifact;
    bytes: Uint8Array;
  }): Promise<ExecutedAgreementExport>;
}

type GoogleServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

const csv = (value: string) => new Set(value.split(',').map((item) => item.trim()).filter(Boolean));
const driveEntityIds = csv(config.EXECUTED_EXPORT_ENTITY_IDS);
let credentialPromise: Promise<GoogleServiceAccount> | undefined;
let tokenCache: { value: string; expiresAt: number } | undefined;

async function googleCredential(): Promise<GoogleServiceAccount> {
  if (!config.GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH) throw new Error('Google Drive credentials are not configured.');
  credentialPromise ??= readFile(config.GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH, 'utf8').then((body) => {
    const value = JSON.parse(body) as Partial<GoogleServiceAccount>;
    if (!value.client_email || !value.private_key) throw new Error('The Google service-account credential is incomplete.');
    return value as GoogleServiceAccount;
  });
  return credentialPromise;
}

async function googleAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;
  const credential = await googleCredential();
  const tokenUri = credential.token_uri ?? 'https://oauth2.googleapis.com/token';
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({
    scope: 'https://www.googleapis.com/auth/drive',
    ...(config.GOOGLE_DRIVE_IMPERSONATE_EMAIL ? { sub: config.GOOGLE_DRIVE_IMPERSONATE_EMAIL } : {}),
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(credential.client_email)
    .setAudience(tokenUri)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(await importPKCS8(credential.private_key, 'RS256'));
  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!response.ok) throw new Error(`Google OAuth token exchange failed with ${response.status}.`);
  const result = await response.json() as { access_token?: string; expires_in?: number };
  if (!result.access_token) throw new Error('Google OAuth did not return an access token.');
  tokenCache = { value: result.access_token, expiresAt: Date.now() + (result.expires_in ?? 3600) * 1000 };
  return tokenCache.value;
}

const driveEscape = (value: string) => value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
const safeFileName = (value: string) => value.replace(/[^a-zA-Z0-9 ._()-]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 160) || 'Executed agreement';

const googleDrivePlugin: ExecutedAgreementExportPlugin = {
  key: 'google_drive',
  enabledFor: (entityId) => config.EXECUTED_EXPORT_DRIVER === 'google_drive' && driveEntityIds.has(entityId),
  async exportExecutedAgreement({ agreement, artifact, bytes }) {
    if (!config.GOOGLE_DRIVE_FOLDER_ID) throw new Error('A Google Drive destination folder is not configured.');
    const token = await googleAccessToken();
    const query = [
      `'${driveEscape(config.GOOGLE_DRIVE_FOLDER_ID)}' in parents`,
      'trashed = false',
      `appProperties has { key='bytecrunchAgreementId' and value='${driveEscape(agreement.id)}' }`,
      `appProperties has { key='bytecrunchArtifactSha256' and value='${artifact.artifactSha256}' }`,
    ].join(' and ');
    const lookup = new URL('https://www.googleapis.com/drive/v3/files');
    lookup.searchParams.set('q', query);
    lookup.searchParams.set('fields', 'files(id,webViewLink)');
    lookup.searchParams.set('spaces', 'drive');
    lookup.searchParams.set('supportsAllDrives', 'true');
    lookup.searchParams.set('includeItemsFromAllDrives', 'true');
    const existingResponse = await fetch(lookup, { headers: { authorization: `Bearer ${token}` } });
    if (!existingResponse.ok) throw new Error(`Google Drive lookup failed with ${existingResponse.status}.`);
    const existing = await existingResponse.json() as { files?: Array<{ id: string; webViewLink?: string }> };
    if (existing.files?.[0]) return { provider: 'google_drive', externalId: existing.files[0].id, webUrl: existing.files[0].webViewLink ?? null };

    const boundary = `bytecrunch_${randomUUID()}`;
    const metadata = {
      name: `${safeFileName(agreement.title)} - executed.pdf`,
      mimeType: 'application/pdf',
      parents: [config.GOOGLE_DRIVE_FOLDER_ID],
      appProperties: {
        bytecrunchAgreementId: agreement.id,
        bytecrunchEntityId: agreement.tenantId,
        bytecrunchRevision: String(agreement.revision),
        bytecrunchArtifactSha256: artifact.artifactSha256,
      },
    };
    const prefix = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`);
    const suffix = Buffer.from(`\r\n--${boundary}--`);
    const upload = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/related; boundary=${boundary}` },
      body: Buffer.concat([prefix, Buffer.from(bytes), suffix]),
    });
    if (!upload.ok) throw new Error(`Google Drive upload failed with ${upload.status}.`);
    const created = await upload.json() as { id?: string; webViewLink?: string };
    if (!created.id) throw new Error('Google Drive did not return a file ID.');
    return { provider: 'google_drive', externalId: created.id, webUrl: created.webViewLink ?? null };
  },
};

const executedAgreementExportPlugins: readonly ExecutedAgreementExportPlugin[] = [googleDrivePlugin];

export async function runExecutedAgreementExports(input: { agreement: Agreement; artifact: AgreementArtifact; bytes: Uint8Array }): Promise<ExecutedAgreementExport[]> {
  const enabled = executedAgreementExportPlugins.filter((plugin) => plugin.enabledFor(input.agreement.tenantId));
  return Promise.all(enabled.map((plugin) => plugin.exportExecutedAgreement(input)));
}

export function configuredIntegrationPlugins(): Array<{ key: string; capability: 'executed_agreement_export'; enabledEntityIds: string[] }> {
  return config.EXECUTED_EXPORT_DRIVER === 'none' ? [] : [{ key: config.EXECUTED_EXPORT_DRIVER, capability: 'executed_agreement_export', enabledEntityIds: [...driveEntityIds] }];
}
