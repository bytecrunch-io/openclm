import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createApp } from './app.js';
import { MemoryRepository } from './repository.js';
import { hashInvitationToken } from './external-auth.js';
import { deliverWebhookOutbox } from './webhooks.js';
import { config } from './config.js';
import { validateSealedPdf } from './pdf-seal.js';
import type { AgreementArtifact } from '@bytecrunch/contracts-domain';

async function testApp() {
  const repository = new MemoryRepository();
  await repository.init();
  return createApp(repository);
}

class FailingLifecycleRepository extends MemoryRepository {
  failLifecycleCommits = false;

  override async commitAgreementEvent(...args: Parameters<MemoryRepository['commitAgreementEvent']>): Promise<void> {
    if (this.failLifecycleCommits) throw new Error('Simulated lifecycle commit failure.');
    await super.commitAgreementEvent(...args);
  }
}

class UnavailableRepository extends MemoryRepository {
  override async healthCheck(): Promise<boolean> { return false; }
}

describe('contracts API vertical slice', () => {
  it('requires a counterparty address during onboarding when the template uses it', async () => {
    const repository = new MemoryRepository(); await repository.init();
    await repository.createTemplate('bytecrunch', { key: 'address-required', name: 'Address-required NDA', description: '', content: 'This agreement is between {{sender.legal_name}} and {{counterparty.legal_name}}, with offices at {{counterparty.business_address}}.\n\n{{signature_blocks}}' });
    const app = createApp(repository);
    const createdResponse = await app.request('/v1/agreements', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      title: 'Address-required NDA', templateKey: 'address-required', participants: [], metadata: {},
      parties: [{ role: 'counterparty', entity: {}, minimumSignatures: 1, participants: [{ email: 'address@example.com', role: 'signatory', required: true }] }],
    }) });
    const created = await createdResponse.json() as { id: string; participants: Array<{ id: string }> };
    const invitationResponse = await app.request(`/v1/agreements/${created.id}/participants/${created.participants[0]!.id}/invite`, { method: 'POST' });
    const invitation = await invitationResponse.json() as { invitationUrl: string };
    const token = new URL(invitation.invitationUrl).searchParams.get('token')!;
    const exchange = await app.request('/public/invitations/exchange', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
    const headers = { 'content-type': 'application/json', cookie: exchange.headers.get('set-cookie')!.split(';')[0]! };
    const details = { name: 'Address Tester', title: 'Director', capacity: 'director', authorityConfirmed: true, entity: { legalName: 'Address Ltd' } };

    const missing = await app.request('/public/session/onboarding', { method: 'POST', headers, body: JSON.stringify(details) });
    expect(missing.status).toBe(409);
    expect(await missing.json()).toMatchObject({ message: expect.stringMatching(/business address is required/i) });

    const completed = await app.request('/public/session/onboarding', { method: 'POST', headers, body: JSON.stringify({ ...details, entity: { ...details.entity, businessAddress: '42 Required Street, Copenhagen' } }) });
    expect(completed.status).toBe(200);
    expect(await completed.json()).toMatchObject({ agreement: { content: expect.stringContaining('42 Required Street, Copenhagen') }, requiredEntityFields: ['businessAddress'] });
  });

  it('returns one canonical artifact across concurrent idempotent finalization writes', async () => {
    const repository = new MemoryRepository(); const createdAt = new Date().toISOString();
    const base = { tenantId: 'bytecrunch', agreementId: 'agr_artifact_race', kind: 'executed_pdf' as const, revision: 1, contentSha256: 'a'.repeat(64), artifactSha256: 'b'.repeat(64), mediaType: 'application/pdf', fileName: 'executed.pdf', storageDriver: 'database' as const, storageKey: null, contentBase64: 'eA==', retentionUntil: null, legalHold: false, createdAt };
    const [first, second] = await Promise.all([repository.createAgreementArtifact({ ...base, id: 'artifact_first' } satisfies AgreementArtifact), repository.createAgreementArtifact({ ...base, id: 'artifact_second' } satisfies AgreementArtifact)]);
    expect(first.id).toBe(second.id); expect(await repository.listAgreementArtifacts('bytecrunch', 'agr_artifact_race')).toHaveLength(1);
  });

  it('protects and exposes Prometheus metrics', async () => {
    const app = await testApp(); expect((await app.request('/metrics')).status).toBe(401);
    const response = await app.request('/metrics', { headers: { authorization: `Bearer ${config.METRICS_TOKEN}` } });
    expect(response.status).toBe(200); const metrics = await response.text(); expect(metrics).toContain('bytecrunch_http_requests_total'); expect(metrics).toContain('bytecrunch_delivery_queue_items');
  });

  it('claims deliveries once and lets entity administrators inspect and replay email dead letters', async () => {
    const repository = new MemoryRepository(); await repository.init(); const app = createApp(repository); const createdAt = new Date().toISOString();
    await repository.createNotification(
      { id: 'note_delivery_test', tenantId: 'bytecrunch', recipientPersonId: 'person_delivery_test', recipientEmail: 'recipient@example.com', type: 'review.assigned', title: 'Review ready', body: 'Please review.', agreementId: 'agr_delivery_test', threadId: null, actorName: 'Admin', readAt: null, createdAt },
      { id: 'out_delivery_test', notificationId: 'note_delivery_test', recipientEmail: 'recipient@example.com', subject: 'Review ready', body: 'Please review.', actionUrl: 'http://localhost:3000/invite', status: 'pending', attempts: 0, nextAttemptAt: createdAt, lastError: null, createdAt, deliveredAt: null },
    );
    const firstClaim = await repository.claimPendingOutbox(1); const secondClaim = await repository.claimPendingOutbox(1);
    expect(firstClaim).toMatchObject([{ id: 'out_delivery_test', status: 'sending', attempts: 1 }]); expect(secondClaim).toEqual([]);
    firstClaim[0]!.status = 'dead_letter'; firstClaim[0]!.lastError = 'SMTP rejected the message'; await repository.saveOutbox(firstClaim[0]!);
    const listed = await app.request('/v1/notification-deliveries'); expect(await listed.json()).toMatchObject([{ id: 'out_delivery_test', status: 'dead_letter' }]);
    const replayed = await app.request('/v1/notification-deliveries/out_delivery_test/replay', { method: 'POST' }); expect(await replayed.json()).toMatchObject({ status: 'pending', lastError: null });
  });

  it('enforces a shared rate-limit counter', async () => {
    const repository = new MemoryRepository(); await repository.init();
    expect(await repository.consumeRateLimit('test-client', 2, 60)).toMatchObject({ allowed: true, remaining: 1 });
    expect(await repository.consumeRateLimit('test-client', 2, 60)).toMatchObject({ allowed: true, remaining: 0 });
    expect(await repository.consumeRateLimit('test-client', 2, 60)).toMatchObject({ allowed: false, remaining: 0 });
  });

  it('reports failed storage connectivity through readiness', async () => {
    const repository = new UnavailableRepository(); await repository.init(); const response = await createApp(repository).request('/health/ready');
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ status: 'not_ready', checks: { storageReachable: false, safeSigningConfiguration: true } });
  });

  it('rejects state-changing browser requests from an untrusted origin', async () => {
    const app = await testApp();
    const response = await app.request('/v1/agreements', { method: 'POST', headers: { origin: 'https://attacker.example', 'content-type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ error: 'forbidden_origin' });
  });

  it('does not persist a lifecycle transition when its event transaction fails', async () => {
    const repository = new FailingLifecycleRepository(); await repository.init(); const app = createApp(repository);
    const createdResponse = await app.request('/v1/agreements', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Atomic NDA', templateKey: 'mutual-nda', participants: [], metadata: {}, parties: [{ role: 'counterparty', entity: {}, minimumSignatures: 1, participants: [{ email: 'atomic@example.com', role: 'signatory', required: true }] }] }) });
    const created = await createdResponse.json() as { id: string };
    repository.failLifecycleCommits = true;
    const response = await app.request(`/v1/agreements/${created.id}/review`, { method: 'POST' });
    expect(response.status).toBe(409);
    expect(await repository.getAgreement('bytecrunch', created.id)).toMatchObject({ status: 'draft', reviewAssignedTo: null });
    expect(await repository.listAgreementAuditEvents('bytecrunch', created.id)).toHaveLength(1);
  });

  it('creates internal people for multiple participants without external IDs', async () => {
    const app = await testApp();
    const response = await app.request('/v1/agreements', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      title: 'Multi-party review', templateKey: 'mutual-nda', participants: [], metadata: {}, parties: [{ role: 'counterparty', entity: {}, minimumSignatures: 1, participants: [
        { email: 'reviewer@example.com', role: 'reviewer', required: false },
        { email: 'signer@example.com', name: 'Signer', role: 'signatory', required: true },
      ] }],
    }) });
    expect(response.status).toBe(201);
    const agreement = await response.json() as { participants: Array<{ personId: string; externalSubjectId: null; name: string }>; parties: Array<{ role: string; entity: { legalName: string | null } }> };
    expect(agreement.participants).toHaveLength(3);
    expect(agreement.participants.filter((participant) => participant.personId.startsWith('person_'))).toHaveLength(2);
    expect(agreement.participants.some((participant) => participant.personId.startsWith('acct_'))).toBe(true);
    expect(agreement.participants.every((participant) => participant.externalSubjectId === null)).toBe(true);
    expect(agreement.participants[0]!.name).toBe('reviewer');
    expect(agreement.parties.find((party) => party.role === 'sender')?.entity.legalName).toBe('ByteCrunch ApS');
    expect(agreement.parties.find((party) => party.role === 'counterparty')?.entity.legalName).toBeNull();
  });

  it('switches between customer entities without making ByteCrunch a parent workspace', async () => {
    const app = await testApp();
    const createdEntity = await app.request('/v1/entities', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: 'second-customer', legalName: 'Second Customer ApS', businessAddress: 'Second Street 2' }) });
    expect(createdEntity.status).toBe(201); const entity = await createdEntity.json() as { id: string };
    const me = await app.request('/v1/me', { headers: { 'x-bytecrunch-entity-id': entity.id } });
    expect(await me.json()).toMatchObject({ activeEntityId: entity.id, entities: expect.arrayContaining([expect.objectContaining({ entity: expect.objectContaining({ legalName: 'Second Customer ApS' }) })]) });
    const agreementResponse = await app.request('/v1/agreements', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bytecrunch-entity-id': entity.id }, body: JSON.stringify({ title: 'Entity-scoped NDA', templateKey: 'mutual-nda', participants: [], metadata: {}, parties: [{ role: 'counterparty', minimumSignatures: 1, entity: {}, participants: [{ email: 'counterparty@example.com', role: 'signatory', required: true }] }] }) });
    expect(agreementResponse.status).toBe(201); expect(await agreementResponse.json()).toMatchObject({ tenantId: entity.id, parties: expect.arrayContaining([expect.objectContaining({ role: 'sender', entity: expect.objectContaining({ id: entity.id, legalName: 'Second Customer ApS' }) })]) });
    const originalEntityAgreements = await app.request('/v1/agreements', { headers: { 'x-bytecrunch-entity-id': 'bytecrunch' } }); expect(await originalEntityAgreements.json()).toHaveLength(0);
    expect((await app.request('/v1/agreements', { headers: { 'x-bytecrunch-entity-id': 'not-a-membership' } })).status).toBe(403);
  });

  it('stores entity branding at the tenant boundary and enforces entity-manage permission', async () => {
    const repository = new MemoryRepository(); await repository.init(); const app = createApp(repository);
    const branding = { displayName: 'FiftySixty', primaryColor: '#112233', secondaryColor: '#aabbcc', logoDataUrl: null, markDataUrl: 'data:image/png;base64,iVBORw0KGgo=' };
    const updated = await app.request('/v1/entity/branding', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(branding) });
    expect(updated.status).toBe(200); expect(await updated.json()).toMatchObject({ id: 'bytecrunch', branding });
    const me = await (await app.request('/v1/me')).json() as { id: string };
    const restricted = await repository.createCustomerEntity({ slug: 'brand-viewer', legalName: 'Brand Viewer', businessAddress: null, registrationNumber: null, jurisdiction: null });
    await repository.grantEntityMembership(me.id, restricted.id, ['viewer'], ['templates.read', 'agreements.read']);
    const denied = await app.request('/v1/entity/branding', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-bytecrunch-entity-id': restricted.id }, body: JSON.stringify(branding) });
    expect(denied.status).toBe(403);
  });

  it('installs entity plugins without exposing credentials and starts entity-specific SSO', async () => {
    const repository = new MemoryRepository(); await repository.init(); const app = createApp(repository);
    const catalog = await app.request('/v1/plugin-catalog'); expect(await catalog.json()).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'google-drive' }), expect.objectContaining({ key: 'enterprise-oidc' })]));
    const secret = 'client-secret-that-must-never-be-returned';
    const configured = await app.request('/v1/plugin-installations/enterprise-oidc', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, configuration: { issuerUrl: 'https://identity.example.com/pool', authorizationEndpoint: 'https://auth.example.com/oauth2/authorize', tokenEndpoint: 'https://auth.example.com/oauth2/token', jwksUri: 'https://identity.example.com/pool/jwks.json', clientId: 'contracts-client', clientSecret: secret, emailDomains: ['example.com'] } }) });
    expect(configured.status).toBe(200); const publicBody = await configured.json() as Record<string, unknown>; expect(publicBody).toMatchObject({ pluginKey: 'enterprise-oidc', status: 'enabled', configuredSecretFields: ['clientSecret'] }); expect(JSON.stringify(publicBody)).not.toContain(secret); expect(publicBody).not.toHaveProperty('secretCiphertext');
    const stored = await repository.findPluginInstallation('bytecrunch', 'enterprise-oidc'); expect(stored?.secretCiphertext).toBeTruthy(); expect(stored?.secretCiphertext).not.toContain(secret);
    const response = new Response(JSON.stringify({ authorization_endpoint: 'https://discovered.example/authorize', token_endpoint: 'https://discovered.example/token', jwks_uri: 'https://discovered.example/jwks' }), { status: 200, headers: { 'content-type': 'application/json' } });
    vi.stubGlobal('fetch', vi.fn(async () => response.clone()));
    try { const login = await app.request('/auth/sso/bytecrunch'); expect(login.status).toBe(302); const location = new URL(login.headers.get('location')!); expect(location.origin + location.pathname).toBe('https://auth.example.com/oauth2/authorize'); expect(location.searchParams.get('client_id')).toBe('contracts-client'); expect(location.searchParams.get('redirect_uri')).toBe('http://localhost:3001/auth/entity-callback'); }
    finally { vi.unstubAllGlobals(); }
    const removed = await app.request('/v1/plugin-installations/enterprise-oidc', { method: 'DELETE' }); expect(removed.status).toBe(200); expect(await repository.findPluginInstallation('bytecrunch', 'enterprise-oidc')).toBeUndefined();
  });

  it('versions templates inside the selected customer entity only', async () => {
    const repository = new MemoryRepository(); await repository.init(); const app = createApp(repository); const me = await (await app.request('/v1/me')).json() as { id: string };
    const createdEntity = await app.request('/v1/entities', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: 'template-customer', legalName: 'Template Customer ApS' }) }); const entity = await createdEntity.json() as { id: string }; const headers = { 'content-type': 'application/json', 'x-bytecrunch-entity-id': entity.id };
    const first = await app.request('/v1/templates', { method: 'POST', headers, body: JSON.stringify({ key: 'services-agreement', name: 'Services Agreement', description: 'Standard services terms', content: 'SERVICES V1\n\n{{sender.legal_name}} and {{counterparty.legal_name}}\n\n{{signature_blocks}}' }) }); expect(first.status).toBe(201); expect(await first.json()).toMatchObject({ key: 'services-agreement', version: 1 });
    const second = await app.request('/v1/templates', { method: 'POST', headers, body: JSON.stringify({ key: 'services-agreement', name: 'Services Agreement', description: 'Updated services terms', content: 'SERVICES V2\n\n{{sender.legal_name}} and {{counterparty.legal_name}}\n\n{{signature_blocks}}' }) }); expect(second.status).toBe(201); expect(await second.json()).toMatchObject({ key: 'services-agreement', version: 2 });
    const entityTemplates = await (await app.request('/v1/templates', { headers })).json() as Array<{ key: string; version: number }>; expect(entityTemplates.filter((item) => item.key === 'services-agreement').map((item) => item.version).sort()).toEqual([1, 2]); const platformTemplates = await (await app.request('/v1/templates', { headers: { 'x-bytecrunch-entity-id': 'bytecrunch' } })).json() as Array<{ key: string }>; expect(platformTemplates.some((item) => item.key === 'services-agreement')).toBe(false);
    const agreement = await app.request('/v1/agreements', { method: 'POST', headers, body: JSON.stringify({ title: 'Latest services agreement', templateKey: 'services-agreement', participants: [], metadata: {}, parties: [{ role: 'counterparty', entity: {}, minimumSignatures: 1, participants: [{ email: 'services@example.com', role: 'signatory', required: true }] }] }) }); expect(await agreement.json()).toMatchObject({ tenantId: entity.id, templateKey: 'services-agreement', templateVersion: 2, content: expect.stringContaining('SERVICES V2') });
    const restricted = await repository.createCustomerEntity({ slug: 'template-viewer', legalName: 'Template Viewer ApS', businessAddress: null, registrationNumber: null, jurisdiction: 'DK' }); await repository.grantEntityMembership(me.id, restricted.id, ['viewer'], ['templates.read', 'agreements.read']); const denied = await app.request('/v1/templates', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bytecrunch-entity-id': restricted.id }, body: JSON.stringify({ key: 'forbidden', name: 'Forbidden', content: 'No write access' }) }); expect(denied.status).toBe(403);
  });

  it('binds an accepted invite to durable account access and permits a fresh return challenge', async () => {
    const repository = new MemoryRepository(); await repository.init(); const app = createApp(repository);
    const createdResponse = await app.request('/v1/agreements', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Returnable NDA', templateKey: 'mutual-nda', participants: [], metadata: {}, parties: [{ role: 'counterparty', minimumSignatures: 1, entity: {}, participants: [{ email: 'return@example.com', name: 'Return Recipient', role: 'signatory', required: true }] }] }) });
    const created = await createdResponse.json() as { id: string; createdByParticipantId: string; participants: Array<{ id: string }> }; const participant = created.participants.find((item) => item.id !== created.createdByParticipantId)!;
    const invitationResponse = await app.request(`/v1/agreements/${created.id}/participants/${participant.id}/invite`, { method: 'POST' }); const invitationBody = await invitationResponse.json() as { invitationUrl: string }; const inviteToken = new URL(invitationBody.invitationUrl).searchParams.get('token')!;
    expect((await app.request('/public/invitations/exchange', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: inviteToken }) })).status).toBe(200);
    const accepted = await repository.getInvitationByTokenHash(hashInvitationToken(inviteToken)); expect(accepted?.acceptedByAccountId).toMatch(/^acct_/);
    const access = await repository.findAgreementAccess(accepted!.acceptedByAccountId!, created.id, participant.id); expect(access).toMatchObject({ status: 'active' });
    const repeated = await app.request('/public/invitations/exchange', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: inviteToken }) }); expect(repeated.status).toBe(202); expect(await repeated.json()).toMatchObject({ accepted: false, verificationRequired: true });
    const returnToken = 'fresh-return-token-with-enough-entropy'; await repository.createAccessChallenge({ id: 'challenge_test', accountId: access!.accountId, agreementAccessId: access!.id, tokenHash: hashInvitationToken(returnToken), status: 'pending', expiresAt: new Date(Date.now() + 60_000).toISOString(), createdAt: new Date().toISOString(), acceptedAt: null });
    const returned = await app.request('/public/access/exchange', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: returnToken }) }); expect(returned.status).toBe(200); const cookie = returned.headers.get('set-cookie')!.split(';')[0]!;
    expect((await app.request('/public/session', { headers: { cookie } })).status).toBe(200);
    expect((await app.request('/public/access/exchange', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: returnToken }) })).status).toBe(410);
  });

  it('uses a non-enumerating email code to open a cross-entity recipient inbox', async () => {
    const repository = new MemoryRepository(); await repository.init(); const app = createApp(repository);
    const created = await (await app.request('/v1/agreements', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Inbox NDA', templateKey: 'mutual-nda', participants: [], metadata: {}, parties: [{ role: 'counterparty', entity: {}, minimumSignatures: 1, participants: [{ email: 'inbox@example.com', name: 'Inbox Recipient', role: 'signatory', required: true }] }] }) })).json() as { id: string; createdByParticipantId: string; participants: Array<{ id: string }> };
    const participant = created.participants.find((item) => item.id !== created.createdByParticipantId)!; const invited = await (await app.request(`/v1/agreements/${created.id}/participants/${participant.id}/invite`, { method: 'POST' })).json() as { invitationUrl: string }; const inviteToken = new URL(invited.invitationUrl).searchParams.get('token')!;
    await app.request('/public/invitations/exchange', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: inviteToken }) });
    const requested = await app.request('/public/recipient-auth/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'inbox@example.com' }) }); expect(requested.status).toBe(202); const challenge = await requested.json() as { requestId: string; developmentCode: string };
    expect((await app.request('/public/recipient-auth/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: challenge.requestId, code: '999999' }) })).status).toBe(401);
    const verified = await app.request('/public/recipient-auth/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: challenge.requestId, code: challenge.developmentCode }) }); expect(verified.status).toBe(200); const recipientCookie = verified.headers.get('set-cookie')!.split(';')[0]!;
    const account = (await verified.json()) as { account: { id: string } }; const registrationOptions = await app.request('/public/recipient/passkeys/registration/options', { method: 'POST', headers: { cookie: recipientCookie } }); expect(registrationOptions.status).toBe(200); expect(await registrationOptions.json()).toMatchObject({ requestId: expect.any(String), options: { rp: { id: 'localhost' }, authenticatorSelection: { residentKey: 'required', userVerification: 'required' } } });
    const authenticationOptions = await app.request('/public/recipient-auth/passkey/options', { method: 'POST' }); expect(authenticationOptions.status).toBe(200); expect(await authenticationOptions.json()).toMatchObject({ requestId: expect.any(String), options: { rpId: 'localhost', userVerification: 'required' } });
    await repository.savePasskeyCredential({ id: 'test-passkey-id', accountId: account.account.id, publicKey: 'AQID', counter: 0, transports: ['internal'], deviceType: 'multiDevice', backedUp: true, name: 'Test passkey', createdAt: new Date().toISOString(), lastUsedAt: null }); const passkeys = await app.request('/public/recipient/passkeys', { headers: { cookie: recipientCookie } }); const listedPasskeys = await passkeys.json() as Array<Record<string, unknown>>; expect(listedPasskeys).toEqual([expect.objectContaining({ id: 'test-passkey-id', name: 'Test passkey' })]); expect(listedPasskeys[0]).not.toHaveProperty('publicKey');
    expect((await app.request('/public/recipient/passkeys/test-passkey-id', { method: 'DELETE', headers: { cookie: recipientCookie } })).status).toBe(200); expect(await (await app.request('/public/recipient/passkeys', { headers: { cookie: recipientCookie } })).json()).toEqual([]);
    const inbox = await app.request('/public/recipient/inbox', { headers: { cookie: recipientCookie } }); expect(await inbox.json()).toEqual([expect.objectContaining({ title: 'Inbox NDA', entityName: 'ByteCrunch ApS', participantName: 'Inbox Recipient' })]);
    const listed = await app.request('/public/recipient/inbox', { headers: { cookie: recipientCookie } }); const accessId = ((await listed.json()) as Array<{ accessId: string }>)[0]!.accessId;
    const opened = await app.request('/public/recipient/open', { method: 'POST', headers: { 'content-type': 'application/json', cookie: recipientCookie }, body: JSON.stringify({ accessId }) }); expect(opened.status).toBe(200); const externalCookie = opened.headers.get('set-cookie')!.split(';')[0]!; expect((await app.request('/public/session', { headers: { cookie: externalCookie } })).status).toBe(200);
    const unknown = await app.request('/public/recipient-auth/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'unknown@example.com' }) }); expect(unknown.status).toBe(202); expect(await unknown.json()).toMatchObject({ accepted: true, requestId: expect.any(String), expiresAt: expect.any(String) });
    const staffWork = await app.request('/v1/my-work'); expect(await staffWork.json()).toEqual(expect.arrayContaining([expect.objectContaining({ agreementId: created.id, participantName: 'Local Admin' })]));
  });

  it('administers entity members without allowing the last administrator to be removed', async () => {
    const repository = new MemoryRepository(); await repository.init(); const app = createApp(repository);
    const meResponse = await app.request('/v1/me'); const me = await meResponse.json() as { id: string };
    const colleague = await repository.findOrCreateAccountByEmail('colleague@example.com', 'Colleague'); const colleagueMembership = await repository.grantEntityMembership(colleague.id, 'bytecrunch', ['viewer'], ['templates.read', 'agreements.read']);
    const listed = await app.request('/v1/entity-members'); expect(await listed.json()).toMatchObject({ members: expect.arrayContaining([expect.objectContaining({ account: expect.objectContaining({ email: 'colleague@example.com' }), membership: expect.objectContaining({ roles: ['viewer'] }) })]) });
    const updated = await app.request(`/v1/entity-members/${colleagueMembership.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ roles: ['contract_manager', 'signatory'] }) }); expect(await updated.json()).toMatchObject({ roles: ['contract_manager', 'signatory'], permissions: expect.arrayContaining(['agreements.write', 'agreements.sign']) });
    const admin = (await repository.listEntityMembers('bytecrunch')).find((item) => item.accountId === me.id)!; const removeLastAdmin = await app.request(`/v1/entity-members/${admin.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ roles: ['viewer'] }) }); expect(removeLastAdmin.status).toBe(409);
    const invited = await app.request('/v1/entity-members/invitations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'new.member@example.com', roles: ['template_manager'] }) }); expect(invited.status).toBe(201); expect(await invited.json()).toMatchObject({ email: 'new.member@example.com', roles: ['template_manager'], status: 'pending', invitationUrl: expect.any(String) });
    const suspended = await app.request(`/v1/entity-members/${colleagueMembership.id}`, { method: 'DELETE' }); expect(await suspended.json()).toMatchObject({ status: 'suspended' });
    const restrictedEntity = await repository.createCustomerEntity({ slug: 'restricted-customer', legalName: 'Restricted Customer ApS', businessAddress: null, registrationNumber: null, jurisdiction: 'DK' });
    await repository.grantEntityMembership(me.id, restrictedEntity.id, ['viewer'], ['templates.read', 'agreements.read']);
    expect((await app.request('/v1/entity-members', { headers: { 'x-bytecrunch-entity-id': restrictedEntity.id } })).status).toBe(403);
  });

  it('previews and accepts a customer-entity invitation with the verified signed-in email', async () => {
    const repository = new MemoryRepository(); await repository.init(); const app = createApp(repository); const me = await (await app.request('/v1/me')).json() as { id: string; email: string };
    const entity = await repository.createCustomerEntity({ slug: 'invited-entity', legalName: 'Invited Entity ApS', businessAddress: null, registrationNumber: null, jurisdiction: 'DK' }); const token = 'entity-membership-invitation-token';
    await repository.createEntityMemberInvitation({ id: 'member_inv_test', entityId: entity.id, email: me.email, roles: ['contract_manager'], tokenHash: hashInvitationToken(token), status: 'pending', invitedByAccountId: 'inviter_account', acceptedByAccountId: null, expiresAt: new Date(Date.now() + 60_000).toISOString(), createdAt: new Date().toISOString(), acceptedAt: null });
    const preview = await app.request(`/public/entity-member-invitations/preview?token=${token}`); expect(await preview.json()).toMatchObject({ entityName: 'Invited Entity ApS', emailHint: expect.stringContaining('@bytecrunch.local'), roles: ['contract_manager'] });
    const accepted = await app.request('/v1/entity-member-invitations/accept', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) }); expect(accepted.status).toBe(200); expect(await accepted.json()).toMatchObject({ membership: { accountId: me.id, entityId: entity.id, roles: ['contract_manager'], status: 'active' } });
    const selected = await app.request('/v1/me', { headers: { 'x-bytecrunch-entity-id': entity.id } }); expect(await selected.json()).toMatchObject({ activeEntityId: entity.id });
    expect((await app.request('/v1/entity-member-invitations/accept', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) })).status).toBe(410);
  });

  it('evaluates generic conditions through an integration-scoped identity link', async () => {
    const app = await testApp();
    const integration = await app.request('/v1/integrations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'customer-portal', name: 'Customer portal', mappingStrategy: 'host_asserted', allowedRedirectUris: ['https://portal.example/workflows'], allowedOrigins: [] }) });
    expect(integration.status).toBe(201);
    const sessionResponse = await app.request('/v1/integration-sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ integrationKey: 'customer-portal', subject: 'portal-user-42', email: 'visitor@example.com', displayName: 'Visitor', templateKey: 'mutual-nda', returnUrl: 'https://portal.example/workflows', metadata: { workflow: 'supplier-onboarding' } }) });
    expect(sessionResponse.status).toBe(201);
    const handoff = await sessionResponse.json() as { agreementId: string; handoffUrl: string };
    const token = new URL(handoff.handoffUrl).searchParams.get('integrationToken')!;
    const exchange = await app.request('/public/integration-sessions/exchange', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
    expect(exchange.status).toBe(200); const cookie = exchange.headers.get('set-cookie')!.split(';')[0]!;
    const externalHeaders = { 'content-type': 'application/json', cookie };
    await app.request('/public/session/onboarding', { method: 'POST', headers: externalHeaders, body: JSON.stringify({ name: 'Visitor Person', title: 'Director', capacity: 'director', authorityConfirmed: true, entity: { legalName: 'Visitor ApS', jurisdiction: 'DK' } }) });
    expect((await app.request(`/v1/agreements/${handoff.agreementId}/send-for-signature`, { method: 'POST' })).status).toBe(200);
    const signed = await app.request('/public/session/sign', { method: 'POST', headers: externalHeaders, body: JSON.stringify({ intentConfirmed: true }) });
    const completed = await signed.json() as { agreement: { status: string; verificationCode: string }; participant: unknown };
    expect(completed).toMatchObject({ agreement: { status: 'executed' }, participant: { signature: { provider: 'development_witness', providerSignatureId: expect.stringMatching(/^devsig_/), authenticationMethod: 'integration_handoff', consentVersion: '2026-08-30' } } });
    const artifacts = await (await app.request(`/v1/agreements/${handoff.agreementId}/artifacts`)).json() as Array<{ id: string; kind: string; artifactSha256: string }>; expect(artifacts.map((item) => item.kind)).toEqual(['signing_snapshot', 'signing_pdf', 'executed_pdf', 'validation_report', 'completion_certificate', 'completion_manifest']); const manifest = artifacts.find((item) => item.kind === 'completion_manifest')!;
    const executedPdf = artifacts.find((item) => item.kind === 'executed_pdf')!; const pdfResponse = await app.request(`/v1/agreements/${handoff.agreementId}/artifacts/${executedPdf.id}/content`); const pdfBytes = new Uint8Array(await pdfResponse.arrayBuffer()); expect(new TextDecoder().decode(pdfBytes.slice(0, 4))).toBe('%PDF'); expect(pdfResponse.headers.get('x-content-sha256')).toBe(createHash('sha256').update(pdfBytes).digest('hex')); expect(await validateSealedPdf(pdfBytes)).toMatchObject({ byteRangeValid: true, cmsSignatureValid: true, documentIntegrityValid: true, profile: 'PAdES-B-B', certificateTrust: 'not_evaluated' });
    const tamperedPdf = pdfBytes.slice(); tamperedPdf[100] = tamperedPdf[100]! ^ 1; expect(await validateSealedPdf(tamperedPdf)).toMatchObject({ cmsSignatureValid: false, documentIntegrityValid: false });
    const downloaded = await app.request(`/v1/agreements/${handoff.agreementId}/artifacts/${manifest.id}/content`); const manifestContent = await downloaded.text(); expect(downloaded.headers.get('content-disposition')).toContain('completion-manifest.json'); expect(downloaded.headers.get('x-content-sha256')).toBe(createHash('sha256').update(manifestContent).digest('hex')); expect(JSON.parse(manifestContent)).toMatchObject({ schemaVersion: 3, signatures: [expect.objectContaining({ signature: expect.objectContaining({ authenticationMethod: 'integration_handoff', signedArtifactSha256: expect.stringMatching(/^[a-f0-9]{64}$/), signingEnvelopeId: expect.stringMatching(/^envelope_/) }) })], signatureEvidence: [expect.objectContaining({ status: 'active', signature: expect.objectContaining({ authenticationMethod: 'integration_handoff' }) })], seal: { profile: 'PAdES-B-B', validation: { documentIntegrityValid: true } } });
    const verification = await app.request(`/public/verify/${completed.agreement.verificationCode}`); expect(await verification.json()).toMatchObject({ status: 'executed', agreementId: handoff.agreementId, executedPdf: { sha256: executedPdf.artifactSha256 }, validation: { documentIntegrityValid: true } });
    expect(await (await app.request('/public/session/artifacts', { headers: { cookie } })).json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: manifest.id, kind: 'completion_manifest' })])); expect((await app.request(`/public/session/artifacts/${manifest.id}/content`, { headers: { cookie } })).status).toBe(200);
    const evaluation = await app.request('/v1/conditions/evaluate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ integrationKey: 'customer-portal', subject: 'portal-user-42', operator: 'all', conditions: [{ kind: 'subject_signed', templateKey: 'mutual-nda', minimumVersion: 1 }, { kind: 'agreement_executed', templateKey: 'mutual-nda', minimumVersion: 1 }] }) });
    expect(await evaluation.json()).toMatchObject({ integrationKey: 'customer-portal', subject: 'portal-user-42', met: true, operator: 'all', conditions: [{ kind: 'subject_signed', met: true }, { kind: 'agreement_executed', met: true }] });
    const unknown = await app.request('/v1/conditions/evaluate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ integrationKey: 'customer-portal', subject: 'unknown-subject', conditions: [{ kind: 'agreement_executed', templateKey: 'mutual-nda' }] }) }); expect(await unknown.json()).toMatchObject({ met: false, conditions: [{ met: false }] });
    expect((await app.request('/v1/integration-status?integrationKey=customer-portal&subject=portal-user-42&templateKey=mutual-nda')).status).toBe(404);
  });

  it('persists webhook deliveries and allows a failed delivery to be replayed', async () => {
    const repository = new MemoryRepository(); await repository.init(); const app = createApp(repository);
    expect((await app.request('/v1/webhooks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://events.example/contracts', events: ['agreement.created'] }) })).status).toBe(201);
    expect((await app.request('/v1/agreements', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Auditable NDA', templateKey: 'mutual-nda', participants: [], metadata: {}, parties: [{ role: 'counterparty', entity: {}, minimumSignatures: 1, participants: [{ email: 'audit@example.com', role: 'signatory', required: true }] }] }) })).status).toBe(201);
    const deliveries = await repository.listWebhookDeliveries('bytecrunch', 10); expect(deliveries).toHaveLength(1); expect(deliveries[0]).toMatchObject({ eventType: 'agreement.created', status: 'pending', attempts: 0 });
    const eventPayload = JSON.parse(deliveries[0]!.payload) as { data: { agreementId: string } }; const audit = await repository.listAgreementAuditEvents('bytecrunch', eventPayload.data.agreementId); expect(audit).toEqual([expect.objectContaining({ type: 'agreement.created', revision: 1, eventSha256: expect.stringMatching(/^[a-f0-9]{64}$/) })]);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 })); expect(await deliverWebhookOutbox(repository)).toBe(1); expect(fetchMock).toHaveBeenCalledWith('https://events.example/contracts', expect.objectContaining({ redirect: 'error', headers: expect.objectContaining({ 'x-bytecrunch-delivery': deliveries[0]!.id, 'x-bytecrunch-signature': expect.stringMatching(/^v1=[a-f0-9]{64}$/) }) })); fetchMock.mockRestore();
    const delivered = (await repository.listWebhookDeliveries('bytecrunch', 10))[0]!; expect(delivered).toMatchObject({ status: 'delivered', attempts: 1, responseStatus: 204 });
    delivered.status = 'failed'; delivered.lastError = 'Test failure'; await repository.saveWebhookDelivery(delivered);
    const replayed = await app.request(`/v1/webhook-deliveries/${deliveries[0]!.id}/replay`, { method: 'POST' }); expect(replayed.status).toBe(200); expect(await replayed.json()).toMatchObject({ status: 'pending', lastError: null });
  });

  it('requires the staff signer participant ID instead of an external subject ID', async () => {
    const repository = new MemoryRepository(); await repository.init(); const app = createApp(repository);
    const createResponse = await app.request('/v1/agreements', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Example NDA', templateKey: 'mutual-nda', participants: [], metadata: {},
        parties: [{ role: 'counterparty', entity: {}, minimumSignatures: 1, participants: [{ email: 'signer@example.com', name: 'Signer', role: 'signatory', required: true }] }],
      }),
    });
    expect(createResponse.status).toBe(201);
    const agreement = await createResponse.json() as { id: string; createdByParticipantId: string };

    const signingAgreement = (await repository.getAgreement('bytecrunch', agreement.id))!; signingAgreement.status = 'out_for_signature'; await repository.saveAgreement(signingAgreement);
    const legacySubject = await app.request(`/v1/agreements/${agreement.id}/sign`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ externalSubjectId: 'user_123', intentConfirmed: true }),
    });
    expect(legacySubject.status).toBe(400);
    const signed = await app.request(`/v1/agreements/${agreement.id}/sign`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ participantId: agreement.createdByParticipantId, intentConfirmed: true }) });
    expect(await signed.json()).toMatchObject({ status: 'partially_signed' });
  });

  it('refuses to sign a participant record linked to another account', async () => {
    const repository = new MemoryRepository(); await repository.init(); const app = createApp(repository);
    const created = await (await app.request('/v1/agreements', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Account-bound NDA', templateKey: 'mutual-nda', participants: [], metadata: {}, parties: [{ role: 'counterparty', entity: {}, minimumSignatures: 1, participants: [{ email: 'bound@example.com', role: 'signatory', required: true }] }] }) })).json() as { id: string; createdByParticipantId: string };
    const stored = (await repository.getAgreement('bytecrunch', created.id))!; stored.status = 'out_for_signature'; stored.participants.find((item) => item.id === created.createdByParticipantId)!.personId = 'acct_another_user'; await repository.saveAgreement(stored);
    const response = await app.request(`/v1/agreements/${created.id}/sign`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ participantId: created.createdByParticipantId, intentConfirmed: true }) });
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ message: expect.stringContaining('linked to your account') });
    expect(await repository.getAgreement('bytecrunch', created.id)).toMatchObject({ status: 'out_for_signature' });
  });

  it('accepts an attributed redline into a new revision', async () => {
    const app = await testApp();
    const created = await app.request('/v1/agreements', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Negotiated NDA', templateKey: 'mutual-nda',
        participants: [{ externalSubjectId: 'reviewer_123', email: 'reviewer@example.com', name: 'Reviewer', role: 'signatory', required: true }],
        metadata: {},
      }),
    });
    const agreement = await created.json() as { id: string; content: string };
    await app.request(`/v1/agreements/${agreement.id}/review`, { method: 'POST' });
    const suggested = await app.request(`/v1/agreements/${agreement.id}/suggestions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        authorSubjectId: 'reviewer_123', originalText: 'two years', replacementText: 'one year', comment: 'Shorter survival period.',
      }),
    });
    const withSuggestion = await suggested.json() as { suggestions: Array<{ id: string }>; revision: number };
    const resolved = await app.request(`/v1/agreements/${agreement.id}/suggestions/${withSuggestion.suggestions[0]!.id}/resolve`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resolution: 'accepted' }),
    });
    expect(await resolved.json()).toMatchObject({ revision: 2, content: expect.stringContaining('one year') });
  });

  it('onboards an invited entity signatory and completes the external flow', async () => {
    const app = await testApp();
    const createdResponse = await app.request('/v1/agreements', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Acme mutual NDA', templateKey: 'mutual-nda', participants: [], metadata: { resourceId: 'room_42' },
        parties: [{
          role: 'counterparty', minimumSignatures: 1,
          entity: { legalName: 'Acme Ltd', registrationNumber: 'ACME-42', jurisdiction: 'DK' },
          participants: [{ externalSubjectId: 'person_alice', email: 'alice@acme.test', name: 'Alice', role: 'signatory', required: true }],
        }],
      }),
    });
    const created = await createdResponse.json() as { id: string; participants: Array<{ id: string }>; parties: Array<{ id: string; role: string }> };
    const firstInvitationResponse = await app.request(`/v1/agreements/${created.id}/participants/${created.participants[0]!.id}/invite`, { method: 'POST' });
    expect(firstInvitationResponse.status).toBe(201);
    const firstInvitation = await firstInvitationResponse.json() as { invitationUrl: string };
    const firstToken = new URL(firstInvitation.invitationUrl).searchParams.get('token')!;
    const invitationResponse = await app.request(`/v1/agreements/${created.id}/participants/${created.participants[0]!.id}/invite`, { method: 'POST' });
    const invitation = await invitationResponse.json() as { invitationUrl: string };
    const token = new URL(invitation.invitationUrl).searchParams.get('token')!;
    expect((await app.request('/public/invitations/exchange', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: firstToken }) })).status).toBe(410);

    const exchange = await app.request('/public/invitations/exchange', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }),
    });
    expect(exchange.status).toBe(200);
    const cookie = exchange.headers.get('set-cookie')!.split(';')[0]!;
    const externalHeaders = { 'content-type': 'application/json', cookie };

    const onboarding = await app.request('/public/session/onboarding', {
      method: 'POST', headers: externalHeaders,
      body: JSON.stringify({ name: 'Alice Andersson', title: 'Director', capacity: 'director', authorityConfirmed: true, entity: { legalName: 'Acme Ltd', businessAddress: '42 Market Street, Copenhagen', registrationNumber: 'ACME-42', jurisdiction: 'DK' } }),
    });
    const onboarded = await onboarding.json() as { agreement: { content: string }; participant: { title: string; authorityConfirmed: boolean }; party: { entity: { legalName: string; businessAddress: string | null; verificationStatus: string; proposedDetails: { businessAddress: string | null } | null } } };
    expect(onboarded).toMatchObject({ participant: { title: 'Director', authorityConfirmed: true }, party: { entity: { legalName: 'Acme Ltd', businessAddress: null, verificationStatus: 'change_pending', proposedDetails: { businessAddress: '42 Market Street, Copenhagen' } } } });
    const counterparty = created.parties.find((party) => party.role === 'counterparty')!;
    const acceptedEntity = await app.request(`/v1/agreements/${created.id}/parties/${counterparty.id}/accept-entity`, { method: 'POST' });
    expect(await acceptedEntity.json()).toMatchObject({ parties: expect.arrayContaining([expect.objectContaining({ id: counterparty.id, entity: expect.objectContaining({ businessAddress: '42 Market Street, Copenhagen', verificationStatus: 'confirmed', proposedDetails: null }) })]) });
    const directDraft = await app.request('/public/session/review-draft', { method: 'PUT', headers: externalHeaders, body: JSON.stringify({ content: onboarded.agreement.content.replace('two years', 'one year') }) });
    const firstDirectDraft = await directDraft.json() as { agreement: { suggestions: Array<{ id: string; originalText: string; replacementText: string; status: string }> } };
    expect(firstDirectDraft).toMatchObject({ agreement: { suggestions: [expect.objectContaining({ originalText: 'two years', replacementText: 'one year', status: 'open' })] } });
    const refinedDraft = await app.request('/public/session/review-draft', { method: 'PUT', headers: externalHeaders, body: JSON.stringify({ content: onboarded.agreement.content.replace('two years', 'eighteen months') }) });
    const refinedView = await refinedDraft.json() as { agreement: { suggestions: Array<{ id: string; originalText: string; replacementText: string }> } };
    expect(refinedView.agreement.suggestions).toEqual([expect.objectContaining({ id: firstDirectDraft.agreement.suggestions[0]!.id, originalText: 'two years', replacementText: 'eighteen months' })]);
    const clearedDraft = await app.request('/public/session/review-draft', { method: 'PUT', headers: externalHeaders, body: JSON.stringify({ content: onboarded.agreement.content }) });
    expect(await clearedDraft.json()).toMatchObject({ agreement: { suggestions: [] } });
    const multiEditDraft = await app.request('/public/session/review-draft', { method: 'PUT', headers: externalHeaders, body: JSON.stringify({ content: onboarded.agreement.content.replace('reasonable care', 'strict care').replace('two years', 'one year') }) });
    expect((await multiEditDraft.json() as { agreement: { suggestions: unknown[] } }).agreement.suggestions).toHaveLength(2);
    await app.request('/public/session/review-draft', { method: 'PUT', headers: externalHeaders, body: JSON.stringify({ content: onboarded.agreement.content }) });

    const suggested = await app.request('/public/session/suggestions', {
      method: 'POST', headers: externalHeaders,
      body: JSON.stringify({ originalText: 'two years', replacementText: 'eighteen months', comment: 'Align with our policy.' }),
    });
    const externalView = await suggested.json() as { agreement: { suggestions: Array<{ id: string; anchor: { start: number; end: number }; reviewRound: number }> } };
    expect(externalView.agreement.suggestions[0]!.anchor).toMatchObject({ start: expect.any(Number), end: expect.any(Number) });
    const edited = await app.request(`/public/session/suggestions/${externalView.agreement.suggestions[0]!.id}`, { method: 'PATCH', headers: externalHeaders, body: JSON.stringify({ replacementText: 'one year', comment: 'Updated after further review.' }) });
    expect(await edited.json()).toMatchObject({ agreement: { suggestions: [{ replacementText: 'one year', comment: 'Updated after further review.' }] } });
    const disposable = await app.request('/public/session/suggestions', { method: 'POST', headers: externalHeaders, body: JSON.stringify({ originalText: 'reasonable care', replacementText: 'commercially reasonable care', comment: 'Temporary thought.' }) });
    const disposableView = await disposable.json() as { agreement: { suggestions: Array<{ id: string }> } }; const disposableId = disposableView.agreement.suggestions.at(-1)!.id;
    expect((await app.request(`/public/session/suggestions/${disposableId}`, { method: 'DELETE', headers: externalHeaders })).status).toBe(200);
    const quietNotifications = await app.request('/v1/notifications'); expect(await quietNotifications.json()).toEqual([]);
    const replied = await app.request(`/public/session/suggestions/${externalView.agreement.suggestions[0]!.id}/messages`, { method: 'POST', headers: externalHeaders, body: JSON.stringify({ body: 'This aligns the survival period with our policy.' }) });
    expect(await replied.json()).toMatchObject({ agreement: { suggestions: [{ messages: [{ authorName: 'Alice Andersson' }] }] } });
    const commented = await app.request('/public/session/comments', { method: 'POST', headers: externalHeaders, body: JSON.stringify({ body: 'Please confirm the notice address separately.' }) });
    const withComment = await commented.json() as { agreement: { documentComments: Array<{ id: string }> } };
    await app.request('/public/session/return-review', { method: 'POST', headers: externalHeaders, body: JSON.stringify({ message: 'Redlines ready for review.' }) });
    expect((await app.request(`/public/session/suggestions/${externalView.agreement.suggestions[0]!.id}`, { method: 'PATCH', headers: externalHeaders, body: JSON.stringify({ replacementText: 'six months', comment: '' }) })).status).toBe(409);
    const notificationsResponse = await app.request('/v1/notifications'); const notifications = await notificationsResponse.json() as Array<{ id: string; type: string; readAt: string | null }>;
    expect(notifications.map((item) => item.type)).toEqual(['review.returned']);
    const readResponse = await app.request(`/v1/notifications/${notifications[0]!.id}/read`, { method: 'POST' }); expect(await readResponse.json()).toMatchObject({ readAt: expect.any(String) });
    await app.request(`/v1/agreements/${created.id}/suggestions/${externalView.agreement.suggestions[0]!.id}/resolve`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resolution: 'accepted' }),
    });
    await app.request(`/v1/agreements/${created.id}/comments/${withComment.agreement.documentComments[0]!.id}/resolve`, { method: 'POST' });
    await app.request(`/v1/agreements/${created.id}/send-for-signature`, { method: 'POST' });

    const signed = await app.request('/public/session/sign', {
      method: 'POST', headers: externalHeaders, body: JSON.stringify({ intentConfirmed: true, signature: { method: 'typed', typedName: 'Alice Andersson', imageDataUrl: null } }),
    });
    expect(await signed.json()).toMatchObject({ agreement: { status: 'partially_signed' }, participant: { status: 'signed', signature: { method: 'typed', typedName: 'Alice Andersson', signedContentSha256: expect.any(String) } } });
    const countersignNotifications = await app.request('/v1/notifications'); expect(await countersignNotifications.json()).toEqual(expect.arrayContaining([expect.objectContaining({ title: 'Your signature is required: Acme mutual NDA' })]));
    const beforeOwnerSignature = await app.request(`/v1/agreements/${created.id}`); const ownerAgreement = await beforeOwnerSignature.json() as { createdByParticipantId: string };
    const ownerSigned = await app.request(`/v1/agreements/${created.id}/sign`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ participantId: ownerAgreement.createdByParticipantId, intentConfirmed: true, signature: { method: 'typed', typedName: 'Local Admin', imageDataUrl: null } }) });
    expect(await ownerSigned.json()).toMatchObject({ status: 'executed', participants: expect.arrayContaining([expect.objectContaining({ id: ownerAgreement.createdByParticipantId, signature: expect.objectContaining({ method: 'typed', signedContentSha256: expect.any(String) }) })]) });

  });

  it('turns an inline edit of an incoming redline into a counterproposal that the other party must decide', async () => {
    const app = await testApp();
    const createdResponse = await app.request('/v1/agreements', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Counterproposal NDA', templateKey: 'mutual-nda', participants: [], metadata: {}, parties: [{ role: 'counterparty', minimumSignatures: 1, entity: { legalName: 'Counter Co' }, participants: [{ email: 'counter@example.com', name: 'Counter Reviewer', role: 'signatory', required: true }] }] }) });
    const created = await createdResponse.json() as { id: string; createdByParticipantId: string; content: string; participants: Array<{ id: string }> };
    const external = created.participants.find((item) => item.id !== created.createdByParticipantId)!;
    const invitationResponse = await app.request(`/v1/agreements/${created.id}/participants/${external.id}/invite`, { method: 'POST' });
    const invitation = await invitationResponse.json() as { invitationUrl: string }; const token = new URL(invitation.invitationUrl).searchParams.get('token')!;
    const exchange = await app.request('/public/invitations/exchange', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
    const cookie = exchange.headers.get('set-cookie')!.split(';')[0]!; const externalHeaders = { 'content-type': 'application/json', cookie };
    const onboarding = await app.request('/public/session/onboarding', { method: 'POST', headers: externalHeaders, body: JSON.stringify({ name: 'Counter Reviewer', title: 'Director', capacity: 'director', authorityConfirmed: true, entity: { legalName: 'Counter Co' } }) });
    const onboarded = await onboarding.json() as { agreement: { content: string } };

    const partyBDraft = await app.request('/public/session/review-draft', { method: 'PUT', headers: externalHeaders, body: JSON.stringify({ content: onboarded.agreement.content.replace('two years', 'one year') }) });
    const partyBView = await partyBDraft.json() as { agreement: { suggestions: Array<{ id: string }> } }; const partyBRedlineId = partyBView.agreement.suggestions[0]!.id;
    const privatePartyBView = await app.request(`/v1/agreements/${created.id}`);
    expect(await privatePartyBView.json()).toMatchObject({ suggestions: [] });
    expect((await app.request('/public/session/return-review', { method: 'POST', headers: externalHeaders, body: JSON.stringify({ message: 'Please shorten the term.' }) })).status).toBe(200);

    const prematureHandback = await app.request(`/v1/agreements/${created.id}/send-review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: '' }) });
    expect(prematureHandback.status).toBe(409); expect(await prematureHandback.json()).toMatchObject({ message: expect.stringContaining('Accept, keep original, or counter') });

    const projectedReturnedDraft = await app.request(`/v1/agreements/${created.id}/review-draft`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: created.content.replace('two years', 'one year') }) });
    expect(await projectedReturnedDraft.json()).toMatchObject({ suggestions: [expect.objectContaining({ id: partyBRedlineId, status: 'open', replacementText: 'one year' })] });

    const counterDraft = await app.request(`/v1/agreements/${created.id}/review-draft`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: created.content.replace('two years', 'eighteen months') }) });
    expect(counterDraft.status).toBe(200); const countered = await counterDraft.json() as { suggestions: Array<{ id: string; status: string; replacementText: string; inResponseToSuggestionIds: string[]; counteredBySuggestionId: string | null }> };
    const partyBRedline = countered.suggestions.find((item) => item.id === partyBRedlineId)!; let partyACounter = countered.suggestions.find((item) => item.inResponseToSuggestionIds.includes(partyBRedlineId))!;
    expect(partyBRedline).toMatchObject({ status: 'countered', counteredBySuggestionId: partyACounter.id });
    expect(partyACounter).toMatchObject({ status: 'open', replacementText: 'eighteen months', inResponseToSuggestionIds: [partyBRedlineId] });
    const partyACommentResponse = await app.request(`/v1/agreements/${created.id}/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: 'Internal note before sending.' }) });
    const partyAComment = (await partyACommentResponse.json() as { documentComments: Array<{ id: string }> }).documentComments[0]!;
    const privatePartyAView = await app.request('/public/session', { headers: externalHeaders });
    expect(await privatePartyAView.json()).toMatchObject({ agreement: { suggestions: [expect.objectContaining({ id: partyBRedlineId, status: 'open', replacementText: 'one year', counteredBySuggestionId: null })], documentComments: [] } });
    const removedCounter = await app.request(`/v1/agreements/${created.id}/suggestions/${partyACounter.id}`, { method: 'DELETE' });
    expect(await removedCounter.json()).toMatchObject({ suggestions: expect.arrayContaining([expect.objectContaining({ id: partyBRedlineId, status: 'open', counteredBySuggestionId: null })]) });
    const recreatedCounter = await app.request(`/v1/agreements/${created.id}/review-draft`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: created.content.replace('two years', 'eighteen months') }) });
    const recreated = await recreatedCounter.json() as { suggestions: Array<{ id: string; status: string; replacementText: string; inResponseToSuggestionIds: string[]; counteredBySuggestionId: string | null }> }; partyACounter = recreated.suggestions.find((item) => item.inResponseToSuggestionIds.includes(partyBRedlineId))!;
    expect((await app.request(`/v1/agreements/${created.id}/send-review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'We can agree to eighteen months.' }) })).status).toBe(200);
    const submittedPartyAView = await app.request('/public/session', { headers: externalHeaders });
    expect(await submittedPartyAView.json()).toMatchObject({ agreement: { suggestions: expect.arrayContaining([expect.objectContaining({ id: partyACounter.id, status: 'open', replacementText: 'eighteen months' })]), documentComments: [expect.objectContaining({ id: partyAComment.id, body: 'Internal note before sending.' })] } });

    const unresolvedReturn = await app.request('/public/session/return-review', { method: 'POST', headers: externalHeaders, body: JSON.stringify({ message: '' }) });
    expect(unresolvedReturn.status).toBe(409);
    const acceptedCounter = await app.request(`/public/session/suggestions/${partyACounter.id}/resolve`, { method: 'POST', headers: externalHeaders, body: JSON.stringify({ resolution: 'accepted' }) });
    expect(acceptedCounter.status).toBe(200); expect(await acceptedCounter.json()).toMatchObject({ agreement: { revision: 2, content: expect.stringContaining('eighteen months'), suggestions: expect.arrayContaining([expect.objectContaining({ id: partyACounter.id, status: 'accepted' })]) } });
    expect((await app.request('/public/session/return-review', { method: 'POST', headers: externalHeaders, body: JSON.stringify({ message: 'Accepted.' }) })).status).toBe(200);
  });

  it('allows the sender to sign before the counterparty', async () => {
    const repository = new MemoryRepository(); await repository.init(); const app = createApp(repository);
    const createdResponse = await app.request('/v1/agreements', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Unordered signatures', templateKey: 'mutual-nda', participants: [], metadata: {}, parties: [{ role: 'counterparty', minimumSignatures: 1, entity: { legalName: 'Other Co' }, participants: [{ email: 'other@example.com', name: 'Other Signer', role: 'signatory', required: true }] }] }) });
    const created = await createdResponse.json() as { id: string; createdByParticipantId: string; participants: Array<{ id: string }>; content: string };
    expect(created.content).toContain('ByteCrunch ApS and Other Co');
    const counterpartyId = created.participants.find((item) => item.id !== created.createdByParticipantId)!.id;
    const invitationResponse = await app.request(`/v1/agreements/${created.id}/participants/${counterpartyId}/invite`, { method: 'POST' }); const invitation = await invitationResponse.json() as { invitationUrl: string }; const token = new URL(invitation.invitationUrl).searchParams.get('token')!;
    const exchange = await app.request('/public/invitations/exchange', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) }); const cookie = exchange.headers.get('set-cookie')!.split(';')[0]!;
    await app.request('/public/session/onboarding', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'Other Signer', title: 'Director', capacity: 'director', authorityConfirmed: true, entity: { legalName: 'Other Co' } }) });
    await app.request('/public/session/return-review', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ message: 'No changes requested.' }) });
    const prepared = await app.request(`/v1/agreements/${created.id}/prepare-for-signature`, { method: 'POST' });
    expect(await prepared.json()).toMatchObject({ status: 'out_for_signature', signatureNotificationsSentAt: null });
    const ownerSignRequest = () => app.request(`/v1/agreements/${created.id}/sign`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ participantId: created.createdByParticipantId, intentConfirmed: true }) });
    const concurrentOwnerResults = await Promise.all([ownerSignRequest(), ownerSignRequest()]); expect(concurrentOwnerResults.map((item) => item.status).sort()).toEqual([200, 409]);
    const ownerSigned = concurrentOwnerResults.find((item) => item.status === 200)!; expect(await ownerSigned.json()).toMatchObject({ status: 'partially_signed', signatureNotificationsSentAt: expect.any(String) });
    expect(await repository.listSignatureEvidence('bytecrunch', created.id)).toMatchObject([{ participantId: created.createdByParticipantId, status: 'active', signature: { provider: 'development_witness' } }]);
    const completed = await app.request('/public/session/sign', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ intentConfirmed: true }) });
    expect(await completed.json()).toMatchObject({ agreement: { status: 'executed' } });
    expect(await repository.listSignatureEvidence('bytecrunch', created.id)).toHaveLength(2);
  });

  it('voids existing signatures before an external party reopens negotiation', async () => {
    const repository = new MemoryRepository(); await repository.init(); const app = createApp(repository);
    const createdResponse = await app.request('/v1/agreements', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Reopen signed revision', templateKey: 'mutual-nda', participants: [], metadata: {}, parties: [{ role: 'counterparty', minimumSignatures: 1, entity: { legalName: 'Reopen Co' }, participants: [{ email: 'reopen@example.com', name: 'Review Again', role: 'signatory', required: true }] }] }) });
    const created = await createdResponse.json() as { id: string; createdByParticipantId: string; content: string; participants: Array<{ id: string }> }; const external = created.participants.find((item) => item.id !== created.createdByParticipantId)!;
    const invitationResponse = await app.request(`/v1/agreements/${created.id}/participants/${external.id}/invite`, { method: 'POST' }); const invitation = await invitationResponse.json() as { invitationUrl: string }; const token = new URL(invitation.invitationUrl).searchParams.get('token')!;
    const exchange = await app.request('/public/invitations/exchange', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) }); const cookie = exchange.headers.get('set-cookie')!.split(';')[0]!; const headers = { 'content-type': 'application/json', cookie };
    await app.request('/public/session/onboarding', { method: 'POST', headers, body: JSON.stringify({ name: 'Review Again', title: 'Director', capacity: 'director', authorityConfirmed: true, entity: { legalName: 'Reopen Co' } }) });
    await app.request('/public/session/return-review', { method: 'POST', headers, body: JSON.stringify({ message: 'Initially approved.' }) });
    await app.request(`/v1/agreements/${created.id}/prepare-for-signature`, { method: 'POST' });
    await app.request(`/v1/agreements/${created.id}/sign`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ participantId: created.createdByParticipantId, intentConfirmed: true, signature: { method: 'typed', typedName: 'Local Admin', imageDataUrl: null } }) });
    const reopenedResponse = await app.request('/public/session/reopen-review', { method: 'POST', headers, body: JSON.stringify({ invalidateSignatures: true, confirmation: 'VOID_SIGNATURES_AND_REOPEN' }) });
    expect(reopenedResponse.status).toBe(200); const reopened = await reopenedResponse.json() as { agreement: { content: string; status: string; reviewAssignedTo: string; participants: Array<{ id: string; signature: unknown; signedAt: unknown }>; invalidatedSignatures: Array<{ participantId: string; reason: string }> } };
    expect(reopened.agreement).toMatchObject({ status: 'in_review', reviewAssignedTo: 'counterparty', invalidatedSignatures: [expect.objectContaining({ participantId: created.createdByParticipantId, reason: 'review_reopened' })] });
    expect(reopened.agreement.participants.find((item) => item.id === created.createdByParticipantId)).toMatchObject({ signature: null, signedAt: null });
    expect(await repository.listSignatureEvidence('bytecrunch', created.id)).toEqual(expect.arrayContaining([expect.objectContaining({ participantId: created.createdByParticipantId, status: 'active' }), expect.objectContaining({ participantId: created.createdByParticipantId, status: 'invalidated', invalidationReason: 'review_reopened', supersedesEvidenceId: expect.any(String) })]));
    const draft = await app.request('/public/session/review-draft', { method: 'PUT', headers, body: JSON.stringify({ content: reopened.agreement.content.replace('two years', 'three years') }) });
    expect(await draft.json()).toMatchObject({ agreement: { suggestions: [expect.objectContaining({ originalText: 'two', replacementText: 'three' })] } });
  });

  it('lets an unchanged external reviewer approve and sign without returning a review', async () => {
    const app = await testApp();
    const createdResponse = await app.request('/v1/agreements', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Approve without changes', templateKey: 'mutual-nda', participants: [], metadata: {}, parties: [{ role: 'counterparty', minimumSignatures: 1, entity: {}, participants: [{ email: 'clean@example.com', name: 'Clean Reviewer', role: 'signatory', required: true }] }] }) });
    const created = await createdResponse.json() as { id: string; createdByParticipantId: string; content: string; participants: Array<{ id: string }> }; expect(created.content).toContain('{{counterparty.legal_name}}'); expect(created.content).not.toContain('Counterparty legal name pending'); const external = created.participants.find((item) => item.id !== created.createdByParticipantId)!;
    const invitationResponse = await app.request(`/v1/agreements/${created.id}/participants/${external.id}/invite`, { method: 'POST' }); const invitation = await invitationResponse.json() as { invitationUrl: string }; const token = new URL(invitation.invitationUrl).searchParams.get('token')!;
    const exchange = await app.request('/public/invitations/exchange', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) }); const cookie = exchange.headers.get('set-cookie')!.split(';')[0]!; const headers = { 'content-type': 'application/json', cookie };
    await app.request('/public/session/onboarding', { method: 'POST', headers, body: JSON.stringify({ name: 'Clean Reviewer', title: 'Director', capacity: 'director', authorityConfirmed: true, entity: { legalName: 'Clean Co' } }) });
    const approved = await app.request('/public/session/approve-for-signature', { method: 'POST', headers }); expect(await approved.json()).toMatchObject({ agreement: { status: 'out_for_signature', signatureNotificationsSentAt: null } });
    const signed = await app.request('/public/session/sign', { method: 'POST', headers, body: JSON.stringify({ intentConfirmed: true }) }); expect(await signed.json()).toMatchObject({ agreement: { status: 'partially_signed', signatureNotificationsSentAt: expect.any(String) }, participant: { status: 'signed' } });
    const reopenAfterSigning = await app.request('/public/session/reopen-review', { method: 'POST', headers, body: JSON.stringify({ invalidateSignatures: true, confirmation: 'VOID_SIGNATURES_AND_REOPEN' }) }); expect(reopenAfterSigning.status).toBe(409); expect(await reopenAfterSigning.json()).toMatchObject({ message: expect.stringContaining('signature are complete') });
  });
});
