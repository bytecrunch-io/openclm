import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  AgreementSchema,
  InvitationSchema,
  PersonSchema,
  IntegrationSchema,
  IdentityLinkSchema,
  IntegrationSessionSchema,
  NotificationSchema,
  NotificationOutboxSchema,
  TemplateSchema,
  type Agreement,
  type CreateAgreement,
  type CreateTemplate,
  type Template,
  type Invitation,
  type Person,
  type Integration,
  type IdentityLink,
  type IntegrationSession,
  type Notification,
  type NotificationOutbox,
} from '@bytecrunch/contracts-domain';

export interface WebhookEndpoint {
  id: string;
  tenantId: string;
  url: string;
  events: string[];
  createdAt: string;
}

export interface Repository {
  readonly kind: 'memory' | 'postgres';
  init(): Promise<void>;
  listTemplates(tenantId: string): Promise<Template[]>;
  createTemplate(tenantId: string, input: CreateTemplate): Promise<Template>;
  listAgreements(tenantId: string): Promise<Agreement[]>;
  getAgreement(tenantId: string, id: string): Promise<Agreement | undefined>;
  createAgreement(tenantId: string, input: CreateAgreement): Promise<Agreement>;
  saveAgreement(agreement: Agreement): Promise<void>;
  listWebhooks(tenantId: string): Promise<WebhookEndpoint[]>;
  createWebhook(tenantId: string, url: string, events: string[]): Promise<WebhookEndpoint>;
  createInvitation(invitation: Invitation): Promise<void>;
  getInvitationByTokenHash(tokenHash: string): Promise<Invitation | undefined>;
  getInvitation(id: string): Promise<Invitation | undefined>;
  saveInvitation(invitation: Invitation): Promise<void>;
  listInvitations(tenantId: string, agreementId: string): Promise<Invitation[]>;
  findPersonByEmail(tenantId: string, email: string): Promise<Person | undefined>;
  createPerson(tenantId: string, email: string, displayName: string): Promise<Person>;
  listIntegrations(tenantId: string): Promise<Integration[]>;
  createIntegration(tenantId: string, input: Omit<Integration, 'id' | 'tenantId' | 'createdAt'>): Promise<Integration>;
  findIntegration(tenantId: string, key: string): Promise<Integration | undefined>;
  findIdentityLink(tenantId: string, integrationId: string, externalSubject: string): Promise<IdentityLink | undefined>;
  createIdentityLink(link: IdentityLink): Promise<void>;
  createIntegrationSession(session: IntegrationSession): Promise<void>;
  getIntegrationSessionByTokenHash(tokenHash: string): Promise<IntegrationSession | undefined>;
  saveIntegrationSession(session: IntegrationSession): Promise<void>;
  listNotifications(tenantId: string, recipientPersonId: string): Promise<Notification[]>;
  saveNotification(notification: Notification): Promise<void>;
  createNotification(notification: Notification, outbox: NotificationOutbox): Promise<void>;
  listPendingOutbox(limit: number): Promise<NotificationOutbox[]>;
  saveOutbox(item: NotificationOutbox): Promise<void>;
}

function now(): string { return new Date().toISOString(); }
export function hashContent(content: string): string { return createHash('sha256').update(content).digest('hex'); }

export class MemoryRepository implements Repository {
  readonly kind: 'memory' | 'postgres' = 'memory';
  protected templates: Template[] = [];
  protected agreements: Agreement[] = [];
  protected webhooks: WebhookEndpoint[] = [];
  protected invitations: Invitation[] = [];
  protected people: Person[] = [];
  protected integrations: Integration[] = [];
  protected identityLinks: IdentityLink[] = [];
  protected integrationSessions: IntegrationSession[] = [];
  protected notifications: Notification[] = [];
  protected notificationOutbox: NotificationOutbox[] = [];

  async init(): Promise<void> {
    if (this.templates.length === 0) {
      await this.createTemplate('bytecrunch', {
        key: 'mutual-nda', name: 'Mutual NDA', description: 'A concise mutual confidentiality agreement.',
        content: `MUTUAL NON-DISCLOSURE AGREEMENT\n\nThis agreement is made between {{sender.legal_name}} and {{counterparty.legal_name}}.\n\n1. Confidential information\nEach party may disclose confidential information solely for evaluating a potential business relationship.\n\n2. Protection\nEach receiving party will protect confidential information using reasonable care and will not disclose it except to authorised representatives.\n\n3. Exclusions\nThese obligations do not apply to information already public, independently developed, or lawfully received from another source.\n\n4. Term\nThese obligations continue for two years from the effective date.\n\nIN WITNESS WHEREOF, the parties agree to the terms above through their authorized signatories.\n\n{{signature_blocks}}`,
      });
    }
  }

  async listTemplates(tenantId: string): Promise<Template[]> {
    return this.templates.filter((template) => template.id.startsWith(`${tenantId}:`)).map((template) => structuredClone(template));
  }

  async createTemplate(tenantId: string, input: CreateTemplate): Promise<Template> {
    const version = Math.max(0, ...this.templates.filter((item) => item.id.startsWith(`${tenantId}:`) && item.key === input.key).map((item) => item.version)) + 1;
    const template = TemplateSchema.parse({ ...input, description: input.description ?? '', id: `${tenantId}:${randomUUID()}`, version, createdAt: now() });
    this.templates.push(template);
    return structuredClone(template);
  }

  async listAgreements(tenantId: string): Promise<Agreement[]> {
    return this.agreements.filter((agreement) => agreement.tenantId === tenantId).map((agreement) => structuredClone(agreement));
  }

  async getAgreement(tenantId: string, id: string): Promise<Agreement | undefined> {
    const agreement = this.agreements.find((item) => item.tenantId === tenantId && item.id === id);
    return agreement ? structuredClone(agreement) : undefined;
  }

  async createAgreement(tenantId: string, input: CreateAgreement): Promise<Agreement> {
    const templates = await this.listTemplates(tenantId);
    const template = templates.filter((item) => item.key === input.templateKey).sort((a, b) => b.version - a.version)[0];
    if (!template) throw new Error(`Template '${input.templateKey}' was not found.`);
    const timestamp = now();
    const parties = input.parties.map((party) => ({
      id: `party_${randomUUID()}`,
      role: party.role,
      status: 'invited' as const,
      minimumSignatures: party.minimumSignatures,
      entity: {
        id: `entity_${randomUUID()}`,
        externalId: party.entity.externalId ?? null,
        legalName: party.entity.legalName ?? null,
        businessAddress: party.entity.businessAddress ?? null,
        registrationNumber: party.entity.registrationNumber ?? null,
        jurisdiction: party.entity.jurisdiction ?? null,
        verificationStatus: 'unconfirmed' as const,
        proposedDetails: null,
      },
      sourceParticipants: party.participants,
    }));
    const allParticipants = [
      ...input.participants.map((participant) => ({ participant, partyId: null })),
      ...parties.flatMap((party) => party.sourceParticipants.map((participant) => ({ participant, partyId: party.id }))),
    ];
    const agreement = AgreementSchema.parse({
      id: `agr_${randomUUID()}`, tenantId, externalId: input.externalId ?? null, title: input.title,
      templateKey: template.key, templateVersion: template.version, status: 'draft', revision: 1,
      content: template.content, contentSha256: hashContent(template.content), metadata: input.metadata,
      participants: await Promise.all(allParticipants.map(async ({ participant, partyId }) => {
        const person = await this.findPersonByEmail(tenantId, participant.email) ?? await this.createPerson(tenantId, participant.email, participant.name ?? participant.email.split('@')[0]!);
        return {
        ...participant, name: participant.name ?? person.displayName, personId: person.id, externalSubjectId: participant.externalSubjectId ?? null, partyId, id: `part_${randomUUID()}`, status: 'not_invited', signedAt: null,
        title: participant.title ?? null,
        permissions: participant.permissions ?? permissionsForRole(participant.role),
      }; })),
      parties: parties.map(({ sourceParticipants: _, ...party }) => party),
      suggestions: [], createdAt: timestamp, updatedAt: timestamp, executedAt: null,
    });
    this.agreements.push(agreement);
    return structuredClone(agreement);
  }

  async saveAgreement(agreement: Agreement): Promise<void> {
    AgreementSchema.parse(agreement);
    const index = this.agreements.findIndex((item) => item.id === agreement.id && item.tenantId === agreement.tenantId);
    if (index < 0) throw new Error('Agreement was not found.');
    this.agreements[index] = structuredClone(agreement);
  }

  async listWebhooks(tenantId: string): Promise<WebhookEndpoint[]> {
    return this.webhooks.filter((item) => item.tenantId === tenantId).map((item) => structuredClone(item));
  }

  async createWebhook(tenantId: string, url: string, events: string[]): Promise<WebhookEndpoint> {
    const endpoint = { id: `wh_${randomUUID()}`, tenantId, url, events, createdAt: now() };
    this.webhooks.push(endpoint);
    return structuredClone(endpoint);
  }

  async createInvitation(invitation: Invitation): Promise<void> { this.invitations.push(InvitationSchema.parse(invitation)); }
  async getInvitationByTokenHash(tokenHash: string): Promise<Invitation | undefined> { const value = this.invitations.find((item) => item.tokenHash === tokenHash); return value ? structuredClone(value) : undefined; }
  async getInvitation(id: string): Promise<Invitation | undefined> { const value = this.invitations.find((item) => item.id === id); return value ? structuredClone(value) : undefined; }
  async saveInvitation(invitation: Invitation): Promise<void> { const index = this.invitations.findIndex((item) => item.id === invitation.id); if (index < 0) throw new Error('Invitation not found.'); this.invitations[index] = InvitationSchema.parse(invitation); }
  async listInvitations(tenantId: string, agreementId: string): Promise<Invitation[]> { return this.invitations.filter((item) => item.tenantId === tenantId && item.agreementId === agreementId).map((item) => structuredClone(item)); }
  async findPersonByEmail(tenantId: string, email: string) { const value = this.people.find((item) => item.tenantId === tenantId && item.email.toLowerCase() === email.toLowerCase()); return value ? structuredClone(value) : undefined; }
  async createPerson(tenantId: string, email: string, displayName: string) { const value = PersonSchema.parse({ id: `person_${randomUUID()}`, tenantId, email: email.toLowerCase(), displayName, createdAt: now() }); this.people.push(value); return structuredClone(value); }
  async listIntegrations(tenantId: string) { return this.integrations.filter((item) => item.tenantId === tenantId).map((item) => structuredClone(item)); }
  async createIntegration(tenantId: string, input: Omit<Integration, 'id' | 'tenantId' | 'createdAt'>) { const value = IntegrationSchema.parse({ ...input, id: `int_${randomUUID()}`, tenantId, createdAt: now() }); this.integrations.push(value); return structuredClone(value); }
  async findIntegration(tenantId: string, key: string) { const value = this.integrations.find((item) => item.tenantId === tenantId && item.key === key); return value ? structuredClone(value) : undefined; }
  async findIdentityLink(tenantId: string, integrationId: string, externalSubject: string) { const value = this.identityLinks.find((item) => item.tenantId === tenantId && item.integrationId === integrationId && item.externalSubject === externalSubject); return value ? structuredClone(value) : undefined; }
  async createIdentityLink(link: IdentityLink) { this.identityLinks.push(IdentityLinkSchema.parse(link)); }
  async createIntegrationSession(session: IntegrationSession) { this.integrationSessions.push(IntegrationSessionSchema.parse(session)); }
  async getIntegrationSessionByTokenHash(tokenHash: string) { const value = this.integrationSessions.find((item) => item.tokenHash === tokenHash); return value ? structuredClone(value) : undefined; }
  async saveIntegrationSession(session: IntegrationSession) { const index = this.integrationSessions.findIndex((item) => item.id === session.id); if (index < 0) throw new Error('Integration session not found.'); this.integrationSessions[index] = IntegrationSessionSchema.parse(session); }
  async listNotifications(tenantId: string, recipientPersonId: string) { return this.notifications.filter((item) => item.tenantId === tenantId && item.recipientPersonId === recipientPersonId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((item) => structuredClone(item)); }
  async saveNotification(notification: Notification) { const index = this.notifications.findIndex((item) => item.id === notification.id); if (index < 0) throw new Error('Notification not found.'); this.notifications[index] = NotificationSchema.parse(notification); }
  async createNotification(notification: Notification, outbox: NotificationOutbox) { this.notifications.push(NotificationSchema.parse(notification)); this.notificationOutbox.push(NotificationOutboxSchema.parse(outbox)); }
  async listPendingOutbox(limit: number) { return this.notificationOutbox.filter((item) => ['pending', 'failed'].includes(item.status) && item.nextAttemptAt <= now()).slice(0, limit).map((item) => structuredClone(item)); }
  async saveOutbox(item: NotificationOutbox) { const index = this.notificationOutbox.findIndex((value) => value.id === item.id); if (index < 0) throw new Error('Outbox item not found.'); this.notificationOutbox[index] = NotificationOutboxSchema.parse(item); }
}

export class PostgresRepository extends MemoryRepository {
  readonly kind = 'postgres' as const;
  private readonly pool: Pool;

  constructor(connectionString: string) {
    super();
    this.pool = new Pool({ connectionString });
  }

  override async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS templates (
        id text PRIMARY KEY, tenant_id text NOT NULL, template_key text NOT NULL,
        version integer NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, template_key, version)
      );
      CREATE TABLE IF NOT EXISTS agreements (
        id text PRIMARY KEY, tenant_id text NOT NULL, payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS agreements_tenant_idx ON agreements (tenant_id);
      CREATE TABLE IF NOT EXISTS webhook_endpoints (
        id text PRIMARY KEY, tenant_id text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS invitations (
        id text PRIMARY KEY, tenant_id text NOT NULL, agreement_id text NOT NULL,
        token_hash text UNIQUE NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS invitations_agreement_idx ON invitations (tenant_id, agreement_id);
      CREATE TABLE IF NOT EXISTS people (id text PRIMARY KEY, tenant_id text NOT NULL, email text NOT NULL, payload jsonb NOT NULL, UNIQUE (tenant_id, email));
      CREATE TABLE IF NOT EXISTS integrations (id text PRIMARY KEY, tenant_id text NOT NULL, integration_key text NOT NULL, payload jsonb NOT NULL, UNIQUE (tenant_id, integration_key));
      CREATE TABLE IF NOT EXISTS identity_links (id text PRIMARY KEY, tenant_id text NOT NULL, integration_id text NOT NULL, external_subject text NOT NULL, payload jsonb NOT NULL, UNIQUE (tenant_id, integration_id, external_subject));
      CREATE TABLE IF NOT EXISTS integration_sessions (id text PRIMARY KEY, tenant_id text NOT NULL, token_hash text UNIQUE NOT NULL, payload jsonb NOT NULL);
      CREATE TABLE IF NOT EXISTS notifications (id text PRIMARY KEY, tenant_id text NOT NULL, recipient_person_id text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
      CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON notifications (tenant_id, recipient_person_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS notification_outbox (id text PRIMARY KEY, notification_id text NOT NULL, status text NOT NULL, next_attempt_at timestamptz NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
      CREATE INDEX IF NOT EXISTS notification_outbox_pending_idx ON notification_outbox (status, next_attempt_at);
    `);
    await this.pool.query(`
      UPDATE agreements AS agreement
      SET payload = jsonb_set(agreement.payload, '{participants}', (
        SELECT jsonb_agg(CASE
          WHEN participant->>'status' = 'invited' AND NOT EXISTS (
            SELECT 1 FROM invitations AS invitation
            WHERE invitation.agreement_id = agreement.id
              AND invitation.payload->>'participantId' = participant->>'id'
          ) THEN jsonb_set(participant, '{status}', '"not_invited"'::jsonb)
          ELSE participant END)
        FROM jsonb_array_elements(agreement.payload->'participants') AS participant
      ))
      WHERE EXISTS (
        SELECT 1 FROM jsonb_array_elements(agreement.payload->'participants') AS participant
        WHERE participant->>'status' = 'invited' AND NOT EXISTS (
          SELECT 1 FROM invitations AS invitation
          WHERE invitation.agreement_id = agreement.id
            AND invitation.payload->>'participantId' = participant->>'id'
        )
      )
    `);
    const result = await this.pool.query('SELECT count(*)::int AS count FROM templates WHERE tenant_id = $1', ['bytecrunch']);
    const latestNda = (await this.listTemplates('bytecrunch')).filter((item) => item.key === 'mutual-nda').sort((a, b) => b.version - a.version)[0];
    if (result.rows[0]?.count === 0 || !latestNda?.content.includes('{{sender.legal_name}}') || !latestNda.content.includes('{{signature_blocks}}')) {
      await this.createTemplate('bytecrunch', {
        key: 'mutual-nda', name: 'Mutual NDA', description: 'A concise mutual confidentiality agreement.',
        content: 'MUTUAL NON-DISCLOSURE AGREEMENT\n\nThis agreement is made between {{sender.legal_name}} and {{counterparty.legal_name}}.\n\n1. Confidential information\nEach party may disclose confidential information solely for evaluating a potential business relationship.\n\n2. Protection\nEach receiving party will protect confidential information using reasonable care.\n\n3. Term\nThese obligations continue for two years from the effective date.\n\nIN WITNESS WHEREOF, the parties agree to the terms above through their authorized signatories.\n\n{{signature_blocks}}',
      });
    }
  }

  override async listTemplates(tenantId: string): Promise<Template[]> {
    const result = await this.pool.query('SELECT payload FROM templates WHERE tenant_id = $1 ORDER BY created_at DESC', [tenantId]);
    return result.rows.map((row) => TemplateSchema.parse(row.payload));
  }

  override async createTemplate(tenantId: string, input: CreateTemplate): Promise<Template> {
    const result = await this.pool.query('SELECT coalesce(max(version), 0)::int + 1 AS version FROM templates WHERE tenant_id = $1 AND template_key = $2', [tenantId, input.key]);
    const template = TemplateSchema.parse({ ...input, description: input.description ?? '', id: `${tenantId}:${randomUUID()}`, version: result.rows[0].version, createdAt: now() });
    await this.pool.query('INSERT INTO templates (id, tenant_id, template_key, version, payload) VALUES ($1, $2, $3, $4, $5)', [template.id, tenantId, template.key, template.version, JSON.stringify(template)]);
    return template;
  }

  override async listAgreements(tenantId: string): Promise<Agreement[]> {
    const result = await this.pool.query('SELECT payload FROM agreements WHERE tenant_id = $1 ORDER BY updated_at DESC', [tenantId]);
    return result.rows.map((row) => AgreementSchema.parse(row.payload));
  }

  override async getAgreement(tenantId: string, id: string): Promise<Agreement | undefined> {
    const result = await this.pool.query('SELECT payload FROM agreements WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return result.rows[0] ? AgreementSchema.parse(result.rows[0].payload) : undefined;
  }

  override async createAgreement(tenantId: string, input: CreateAgreement): Promise<Agreement> {
    const templates = await this.listTemplates(tenantId);
    const template = templates.filter((item) => item.key === input.templateKey).sort((a, b) => b.version - a.version)[0];
    if (!template) throw new Error(`Template '${input.templateKey}' was not found.`);
    const timestamp = now();
    const parties = input.parties.map((party) => ({
      id: `party_${randomUUID()}`, role: party.role, status: 'invited' as const, minimumSignatures: party.minimumSignatures,
      entity: { id: `entity_${randomUUID()}`, externalId: party.entity.externalId ?? null, legalName: party.entity.legalName ?? null, businessAddress: party.entity.businessAddress ?? null, registrationNumber: party.entity.registrationNumber ?? null, jurisdiction: party.entity.jurisdiction ?? null, verificationStatus: 'unconfirmed' as const, proposedDetails: null },
      sourceParticipants: party.participants,
    }));
    const allParticipants = [...input.participants.map((participant) => ({ participant, partyId: null })), ...parties.flatMap((party) => party.sourceParticipants.map((participant) => ({ participant, partyId: party.id })))];
    const agreement = AgreementSchema.parse({
      id: `agr_${randomUUID()}`, tenantId, externalId: input.externalId ?? null, title: input.title,
      templateKey: template.key, templateVersion: template.version, status: 'draft', revision: 1,
      content: template.content, contentSha256: hashContent(template.content), metadata: input.metadata,
      participants: await Promise.all(allParticipants.map(async ({ participant, partyId }) => { const person = await this.findPersonByEmail(tenantId, participant.email) ?? await this.createPerson(tenantId, participant.email, participant.name ?? participant.email.split('@')[0]!); return { ...participant, name: participant.name ?? person.displayName, personId: person.id, externalSubjectId: participant.externalSubjectId ?? null, partyId, id: `part_${randomUUID()}`, status: 'not_invited', signedAt: null, title: participant.title ?? null, permissions: participant.permissions ?? permissionsForRole(participant.role) }; })),
      parties: parties.map(({ sourceParticipants: _, ...party }) => party), suggestions: [], createdAt: timestamp, updatedAt: timestamp, executedAt: null,
    });
    await this.pool.query('INSERT INTO agreements (id, tenant_id, payload) VALUES ($1, $2, $3)', [agreement.id, tenantId, JSON.stringify(agreement)]);
    return agreement;
  }

  override async saveAgreement(agreement: Agreement): Promise<void> {
    AgreementSchema.parse(agreement);
    await this.pool.query('UPDATE agreements SET payload = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3', [JSON.stringify(agreement), agreement.id, agreement.tenantId]);
  }

  override async listWebhooks(tenantId: string): Promise<WebhookEndpoint[]> {
    const result = await this.pool.query('SELECT payload FROM webhook_endpoints WHERE tenant_id = $1 ORDER BY created_at DESC', [tenantId]);
    return result.rows.map((row) => row.payload as WebhookEndpoint);
  }

  override async createWebhook(tenantId: string, url: string, events: string[]): Promise<WebhookEndpoint> {
    const endpoint = { id: `wh_${randomUUID()}`, tenantId, url, events, createdAt: now() };
    await this.pool.query('INSERT INTO webhook_endpoints (id, tenant_id, payload) VALUES ($1, $2, $3)', [endpoint.id, tenantId, JSON.stringify(endpoint)]);
    return endpoint;
  }

  override async createInvitation(invitation: Invitation): Promise<void> {
    InvitationSchema.parse(invitation);
    await this.pool.query('INSERT INTO invitations (id, tenant_id, agreement_id, token_hash, payload) VALUES ($1, $2, $3, $4, $5)', [invitation.id, invitation.tenantId, invitation.agreementId, invitation.tokenHash, JSON.stringify(invitation)]);
  }
  override async getInvitationByTokenHash(tokenHash: string): Promise<Invitation | undefined> { const result = await this.pool.query('SELECT payload FROM invitations WHERE token_hash = $1', [tokenHash]); return result.rows[0] ? InvitationSchema.parse(result.rows[0].payload) : undefined; }
  override async getInvitation(id: string): Promise<Invitation | undefined> { const result = await this.pool.query('SELECT payload FROM invitations WHERE id = $1', [id]); return result.rows[0] ? InvitationSchema.parse(result.rows[0].payload) : undefined; }
  override async saveInvitation(invitation: Invitation): Promise<void> { InvitationSchema.parse(invitation); await this.pool.query('UPDATE invitations SET payload = $1 WHERE id = $2', [JSON.stringify(invitation), invitation.id]); }
  override async listInvitations(tenantId: string, agreementId: string): Promise<Invitation[]> { const result = await this.pool.query('SELECT payload FROM invitations WHERE tenant_id = $1 AND agreement_id = $2 ORDER BY created_at DESC', [tenantId, agreementId]); return result.rows.map((row) => InvitationSchema.parse(row.payload)); }
  override async findPersonByEmail(tenantId: string, email: string) { const result = await this.pool.query('SELECT payload FROM people WHERE tenant_id = $1 AND email = $2', [tenantId, email.toLowerCase()]); return result.rows[0] ? PersonSchema.parse(result.rows[0].payload) : undefined; }
  override async createPerson(tenantId: string, email: string, displayName: string) { const person = PersonSchema.parse({ id: `person_${randomUUID()}`, tenantId, email: email.toLowerCase(), displayName, createdAt: now() }); await this.pool.query('INSERT INTO people (id, tenant_id, email, payload) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id,email) DO NOTHING', [person.id, tenantId, person.email, JSON.stringify(person)]); return await this.findPersonByEmail(tenantId, email) ?? person; }
  override async listIntegrations(tenantId: string) { const result = await this.pool.query('SELECT payload FROM integrations WHERE tenant_id = $1', [tenantId]); return result.rows.map((row) => IntegrationSchema.parse(row.payload)); }
  override async createIntegration(tenantId: string, input: Omit<Integration, 'id' | 'tenantId' | 'createdAt'>) { const integration = IntegrationSchema.parse({ ...input, id: `int_${randomUUID()}`, tenantId, createdAt: now() }); await this.pool.query('INSERT INTO integrations (id,tenant_id,integration_key,payload) VALUES ($1,$2,$3,$4)', [integration.id, tenantId, integration.key, JSON.stringify(integration)]); return integration; }
  override async findIntegration(tenantId: string, key: string) { const result = await this.pool.query('SELECT payload FROM integrations WHERE tenant_id=$1 AND integration_key=$2', [tenantId,key]); return result.rows[0] ? IntegrationSchema.parse(result.rows[0].payload) : undefined; }
  override async findIdentityLink(tenantId: string, integrationId: string, externalSubject: string) { const result = await this.pool.query('SELECT payload FROM identity_links WHERE tenant_id=$1 AND integration_id=$2 AND external_subject=$3', [tenantId,integrationId,externalSubject]); return result.rows[0] ? IdentityLinkSchema.parse(result.rows[0].payload) : undefined; }
  override async createIdentityLink(link: IdentityLink) { IdentityLinkSchema.parse(link); await this.pool.query('INSERT INTO identity_links (id,tenant_id,integration_id,external_subject,payload) VALUES ($1,$2,$3,$4,$5)', [link.id,link.tenantId,link.integrationId,link.externalSubject,JSON.stringify(link)]); }
  override async createIntegrationSession(session: IntegrationSession) { IntegrationSessionSchema.parse(session); await this.pool.query('INSERT INTO integration_sessions (id,tenant_id,token_hash,payload) VALUES ($1,$2,$3,$4)', [session.id,session.tenantId,session.tokenHash,JSON.stringify(session)]); }
  override async getIntegrationSessionByTokenHash(tokenHash: string) { const result = await this.pool.query('SELECT payload FROM integration_sessions WHERE token_hash=$1',[tokenHash]); return result.rows[0] ? IntegrationSessionSchema.parse(result.rows[0].payload) : undefined; }
  override async saveIntegrationSession(session: IntegrationSession) { IntegrationSessionSchema.parse(session); await this.pool.query('UPDATE integration_sessions SET payload=$1 WHERE id=$2',[JSON.stringify(session),session.id]); }
  override async listNotifications(tenantId: string, recipientPersonId: string) { const result = await this.pool.query('SELECT payload FROM notifications WHERE tenant_id=$1 AND recipient_person_id=$2 ORDER BY created_at DESC LIMIT 100',[tenantId,recipientPersonId]); return result.rows.map((row) => NotificationSchema.parse(row.payload)); }
  override async saveNotification(notification: Notification) { NotificationSchema.parse(notification); await this.pool.query('UPDATE notifications SET payload=$1 WHERE id=$2',[JSON.stringify(notification),notification.id]); }
  override async createNotification(notification: Notification, outbox: NotificationOutbox) { NotificationSchema.parse(notification); NotificationOutboxSchema.parse(outbox); const client = await this.pool.connect(); try { await client.query('BEGIN'); await client.query('INSERT INTO notifications (id,tenant_id,recipient_person_id,payload) VALUES ($1,$2,$3,$4)',[notification.id,notification.tenantId,notification.recipientPersonId,JSON.stringify(notification)]); await client.query('INSERT INTO notification_outbox (id,notification_id,status,next_attempt_at,payload) VALUES ($1,$2,$3,$4,$5)',[outbox.id,outbox.notificationId,outbox.status,outbox.nextAttemptAt,JSON.stringify(outbox)]); await client.query('COMMIT'); } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); } }
  override async listPendingOutbox(limit: number) { const result = await this.pool.query("SELECT payload FROM notification_outbox WHERE status IN ('pending','failed') AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT $1",[limit]); return result.rows.map((row) => NotificationOutboxSchema.parse(row.payload)); }
  override async saveOutbox(item: NotificationOutbox) { NotificationOutboxSchema.parse(item); await this.pool.query('UPDATE notification_outbox SET payload=$1,status=$2,next_attempt_at=$3 WHERE id=$4',[JSON.stringify(item),item.status,item.nextAttemptAt,item.id]); }
}

function permissionsForRole(role: 'owner' | 'reviewer' | 'signatory') {
  if (role === 'signatory') return ['read', 'comment', 'suggest', 'sign', 'nominate_signatory'] as const;
  if (role === 'reviewer') return ['read', 'comment', 'suggest', 'nominate_signatory'] as const;
  return ['read', 'comment', 'suggest'] as const;
}
