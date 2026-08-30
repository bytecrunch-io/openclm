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
  AccountSchema,
  AuthIdentitySchema,
  CustomerEntitySchema,
  EntityMembershipSchema,
  AgreementAccessSchema,
  AccessChallengeSchema,
  EntityMemberInvitationSchema,
  RecipientLoginChallengeSchema,
  PasskeyCredentialSchema,
  PasskeyChallengeSchema,
  WebhookDeliverySchema,
  AgreementAuditEventSchema,
  AgreementArtifactSchema,
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
  type Account,
  type AuthIdentity,
  type CustomerEntity,
  type EntityMembership,
  type AgreementAccess,
  type AccessChallenge,
  type EntityMemberInvitation,
  type RecipientLoginChallenge,
  type PasskeyCredential,
  type PasskeyChallenge,
  type WebhookDelivery,
  type AgreementAuditEvent,
  type AgreementArtifact,
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
  createWebhookDeliveries(deliveries: WebhookDelivery[]): Promise<void>;
  listWebhookDeliveries(tenantId: string, limit: number): Promise<WebhookDelivery[]>;
  getWebhookDelivery(tenantId: string, id: string): Promise<WebhookDelivery | undefined>;
  listPendingWebhookDeliveries(limit: number): Promise<WebhookDelivery[]>;
  saveWebhookDelivery(delivery: WebhookDelivery): Promise<void>;
  appendAgreementAuditEvent(event: AgreementAuditEvent): Promise<void>;
  listAgreementAuditEvents(tenantId: string, agreementId: string): Promise<AgreementAuditEvent[]>;
  createAgreementArtifact(artifact: AgreementArtifact): Promise<void>;
  listAgreementArtifacts(tenantId: string, agreementId: string): Promise<AgreementArtifact[]>;
  getAgreementArtifact(tenantId: string, agreementId: string, artifactId: string): Promise<AgreementArtifact | undefined>;
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
  findOrCreateAccountByIdentity(provider: 'dev' | 'oidc', issuer: string, subject: string, email: string, displayName: string): Promise<Account>;
  findOrCreateAccountByEmail(email: string, displayName: string): Promise<Account>;
  findAccountByEmail(email: string): Promise<Account | undefined>;
  getAccount(id: string): Promise<Account | undefined>;
  getCustomerEntity(id: string): Promise<CustomerEntity | undefined>;
  createCustomerEntity(input: Omit<CustomerEntity, 'id' | 'createdAt'> & { id?: string }): Promise<CustomerEntity>;
  listEntityMemberships(accountId: string): Promise<EntityMembership[]>;
  grantEntityMembership(accountId: string, entityId: string, roles: EntityMembership['roles'], permissions: EntityMembership['permissions']): Promise<EntityMembership>;
  createAgreementAccess(access: AgreementAccess): Promise<void>;
  getAgreementAccess(id: string): Promise<AgreementAccess | undefined>;
  findAgreementAccess(accountId: string, agreementId: string, participantId: string): Promise<AgreementAccess | undefined>;
  saveAgreementAccess(access: AgreementAccess): Promise<void>;
  listAgreementAccesses(accountId: string): Promise<AgreementAccess[]>;
  createAccessChallenge(challenge: AccessChallenge): Promise<void>;
  getAccessChallengeByTokenHash(tokenHash: string): Promise<AccessChallenge | undefined>;
  saveAccessChallenge(challenge: AccessChallenge): Promise<void>;
  listEntityMembers(entityId: string): Promise<EntityMembership[]>;
  getEntityMembership(id: string): Promise<EntityMembership | undefined>;
  saveEntityMembership(membership: EntityMembership): Promise<void>;
  createEntityMemberInvitation(invitation: EntityMemberInvitation): Promise<void>;
  getEntityMemberInvitationByTokenHash(tokenHash: string): Promise<EntityMemberInvitation | undefined>;
  listEntityMemberInvitations(entityId: string): Promise<EntityMemberInvitation[]>;
  saveEntityMemberInvitation(invitation: EntityMemberInvitation): Promise<void>;
  createRecipientLoginChallenge(challenge: RecipientLoginChallenge): Promise<void>;
  getRecipientLoginChallenge(id: string): Promise<RecipientLoginChallenge | undefined>;
  listRecipientLoginChallenges(email: string): Promise<RecipientLoginChallenge[]>;
  saveRecipientLoginChallenge(challenge: RecipientLoginChallenge): Promise<void>;
  listPasskeyCredentials(accountId: string): Promise<PasskeyCredential[]>;
  getPasskeyCredential(id: string): Promise<PasskeyCredential | undefined>;
  savePasskeyCredential(credential: PasskeyCredential): Promise<void>;
  deletePasskeyCredential(id: string, accountId: string): Promise<void>;
  createPasskeyChallenge(challenge: PasskeyChallenge): Promise<void>;
  getPasskeyChallenge(id: string): Promise<PasskeyChallenge | undefined>;
  savePasskeyChallenge(challenge: PasskeyChallenge): Promise<void>;
}

function now(): string { return new Date().toISOString(); }
export function hashContent(content: string): string { return createHash('sha256').update(content).digest('hex'); }

export class MemoryRepository implements Repository {
  readonly kind: 'memory' | 'postgres' = 'memory';
  protected templates: Template[] = [];
  protected agreements: Agreement[] = [];
  protected webhooks: WebhookEndpoint[] = [];
  protected webhookDeliveries: WebhookDelivery[] = [];
  protected agreementAuditEvents: AgreementAuditEvent[] = [];
  protected agreementArtifacts: AgreementArtifact[] = [];
  protected invitations: Invitation[] = [];
  protected people: Person[] = [];
  protected integrations: Integration[] = [];
  protected identityLinks: IdentityLink[] = [];
  protected integrationSessions: IntegrationSession[] = [];
  protected notifications: Notification[] = [];
  protected notificationOutbox: NotificationOutbox[] = [];
  protected accounts: Account[] = [];
  protected authIdentities: AuthIdentity[] = [];
  protected customerEntities: CustomerEntity[] = [];
  protected entityMemberships: EntityMembership[] = [];
  protected agreementAccess: AgreementAccess[] = [];
  protected accessChallenges: AccessChallenge[] = [];
  protected entityMemberInvitations: EntityMemberInvitation[] = [];
  protected recipientLoginChallenges: RecipientLoginChallenge[] = [];
  protected passkeyCredentials: PasskeyCredential[] = [];
  protected passkeyChallenges: PasskeyChallenge[] = [];

  async init(): Promise<void> {
    if (!this.customerEntities.some((entity) => entity.id === 'bytecrunch')) {
      await this.createCustomerEntity({ id: 'bytecrunch', slug: 'bytecrunch', legalName: 'ByteCrunch ApS', businessAddress: null, registrationNumber: null, jurisdiction: 'DK' });
    }
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

  async createWebhookDeliveries(deliveries: WebhookDelivery[]): Promise<void> {
    this.webhookDeliveries.push(...deliveries.map((item) => WebhookDeliverySchema.parse(item)));
  }

  async listWebhookDeliveries(tenantId: string, limit: number): Promise<WebhookDelivery[]> {
    return this.webhookDeliveries.filter((item) => item.tenantId === tenantId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map((item) => structuredClone(item));
  }

  async getWebhookDelivery(tenantId: string, id: string): Promise<WebhookDelivery | undefined> {
    const value = this.webhookDeliveries.find((item) => item.tenantId === tenantId && item.id === id);
    return value ? structuredClone(value) : undefined;
  }

  async listPendingWebhookDeliveries(limit: number): Promise<WebhookDelivery[]> {
    return this.webhookDeliveries.filter((item) => ['pending', 'failed', 'sending'].includes(item.status) && item.nextAttemptAt <= now()).sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt)).slice(0, limit).map((item) => structuredClone(item));
  }

  async saveWebhookDelivery(delivery: WebhookDelivery): Promise<void> {
    const index = this.webhookDeliveries.findIndex((item) => item.id === delivery.id);
    if (index < 0) throw new Error('Webhook delivery not found.');
    this.webhookDeliveries[index] = WebhookDeliverySchema.parse(delivery);
  }

  async appendAgreementAuditEvent(event: AgreementAuditEvent): Promise<void> {
    if (this.agreementAuditEvents.some((item) => item.id === event.id)) return;
    this.agreementAuditEvents.push(AgreementAuditEventSchema.parse(event));
  }

  async listAgreementAuditEvents(tenantId: string, agreementId: string): Promise<AgreementAuditEvent[]> {
    return this.agreementAuditEvents.filter((item) => item.tenantId === tenantId && item.agreementId === agreementId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((item) => structuredClone(item));
  }

  async createAgreementArtifact(artifact: AgreementArtifact): Promise<void> {
    if (this.agreementArtifacts.some((item) => item.id === artifact.id)) return;
    this.agreementArtifacts.push(AgreementArtifactSchema.parse(artifact));
  }

  async listAgreementArtifacts(tenantId: string, agreementId: string): Promise<AgreementArtifact[]> {
    return this.agreementArtifacts.filter((item) => item.tenantId === tenantId && item.agreementId === agreementId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((item) => structuredClone(item));
  }

  async getAgreementArtifact(tenantId: string, agreementId: string, artifactId: string): Promise<AgreementArtifact | undefined> {
    const value = this.agreementArtifacts.find((item) => item.tenantId === tenantId && item.agreementId === agreementId && item.id === artifactId);
    return value ? structuredClone(value) : undefined;
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
  async findOrCreateAccountByIdentity(provider: 'dev' | 'oidc', issuer: string, subject: string, email: string, displayName: string) {
    const identity = this.authIdentities.find((item) => item.provider === provider && item.issuer === issuer && item.subject === subject);
    if (identity) return structuredClone(this.accounts.find((item) => item.id === identity.accountId)!);
    const account = await this.findOrCreateAccountByEmail(email, displayName);
    this.authIdentities.push(AuthIdentitySchema.parse({ id: `auth_${randomUUID()}`, accountId: account.id, provider, issuer, subject, emailVerified: true, createdAt: now() }));
    return account;
  }
  async findOrCreateAccountByEmail(email: string, displayName: string) {
    const normalized = email.toLowerCase(); const existing = this.accounts.find((item) => item.email === normalized);
    if (existing) return structuredClone(existing);
    const account = AccountSchema.parse({ id: `acct_${randomUUID()}`, email: normalized, displayName, createdAt: now() }); this.accounts.push(account); return structuredClone(account);
  }
  async findAccountByEmail(email: string) { const value = this.accounts.find((item) => item.email === email.toLowerCase()); return value ? structuredClone(value) : undefined; }
  async getAccount(id: string) { const value = this.accounts.find((item) => item.id === id); return value ? structuredClone(value) : undefined; }
  async getCustomerEntity(id: string) { const value = this.customerEntities.find((item) => item.id === id); return value ? structuredClone(value) : undefined; }
  async createCustomerEntity(input: Omit<CustomerEntity, 'id' | 'createdAt'> & { id?: string }) {
    if (this.customerEntities.some((item) => item.slug === input.slug)) throw new Error('An entity with this slug already exists.');
    const value = CustomerEntitySchema.parse({ ...input, id: input.id ?? `org_${randomUUID()}`, createdAt: now() }); this.customerEntities.push(value); return structuredClone(value);
  }
  async listEntityMemberships(accountId: string) { return this.entityMemberships.filter((item) => item.accountId === accountId).map((item) => structuredClone(item)); }
  async grantEntityMembership(accountId: string, entityId: string, roles: EntityMembership['roles'], permissions: EntityMembership['permissions']) {
    const existing = this.entityMemberships.find((item) => item.accountId === accountId && item.entityId === entityId);
    if (existing) return structuredClone(existing);
    const value = EntityMembershipSchema.parse({ id: `membership_${randomUUID()}`, accountId, entityId, roles, permissions, status: 'active', createdAt: now() }); this.entityMemberships.push(value); return structuredClone(value);
  }
  async createAgreementAccess(access: AgreementAccess) { if (!this.agreementAccess.some((item) => item.accountId === access.accountId && item.agreementId === access.agreementId && item.participantId === access.participantId)) this.agreementAccess.push(AgreementAccessSchema.parse(access)); }
  async getAgreementAccess(id: string) { const value = this.agreementAccess.find((item) => item.id === id); return value ? structuredClone(value) : undefined; }
  async findAgreementAccess(accountId: string, agreementId: string, participantId: string) { const value = this.agreementAccess.find((item) => item.accountId === accountId && item.agreementId === agreementId && item.participantId === participantId); return value ? structuredClone(value) : undefined; }
  async saveAgreementAccess(access: AgreementAccess) { const index = this.agreementAccess.findIndex((item) => item.id === access.id); if (index < 0) throw new Error('Agreement access not found.'); this.agreementAccess[index] = AgreementAccessSchema.parse(access); }
  async listAgreementAccesses(accountId: string) { return this.agreementAccess.filter((item) => item.accountId === accountId && item.status === 'active').map((item) => structuredClone(item)); }
  async createAccessChallenge(challenge: AccessChallenge) { this.accessChallenges.push(AccessChallengeSchema.parse(challenge)); }
  async getAccessChallengeByTokenHash(tokenHash: string) { const value = this.accessChallenges.find((item) => item.tokenHash === tokenHash); return value ? structuredClone(value) : undefined; }
  async saveAccessChallenge(challenge: AccessChallenge) { const index = this.accessChallenges.findIndex((item) => item.id === challenge.id); if (index < 0) throw new Error('Access challenge not found.'); this.accessChallenges[index] = AccessChallengeSchema.parse(challenge); }
  async listEntityMembers(entityId: string) { return this.entityMemberships.filter((item) => item.entityId === entityId).map((item) => structuredClone(item)); }
  async getEntityMembership(id: string) { const value = this.entityMemberships.find((item) => item.id === id); return value ? structuredClone(value) : undefined; }
  async saveEntityMembership(membership: EntityMembership) { const index = this.entityMemberships.findIndex((item) => item.id === membership.id); if (index < 0) throw new Error('Entity membership not found.'); this.entityMemberships[index] = EntityMembershipSchema.parse(membership); }
  async createEntityMemberInvitation(invitation: EntityMemberInvitation) { this.entityMemberInvitations.push(EntityMemberInvitationSchema.parse(invitation)); }
  async getEntityMemberInvitationByTokenHash(tokenHash: string) { const value = this.entityMemberInvitations.find((item) => item.tokenHash === tokenHash); return value ? structuredClone(value) : undefined; }
  async listEntityMemberInvitations(entityId: string) { return this.entityMemberInvitations.filter((item) => item.entityId === entityId).map((item) => structuredClone(item)); }
  async saveEntityMemberInvitation(invitation: EntityMemberInvitation) { const index = this.entityMemberInvitations.findIndex((item) => item.id === invitation.id); if (index < 0) throw new Error('Entity member invitation not found.'); this.entityMemberInvitations[index] = EntityMemberInvitationSchema.parse(invitation); }
  async createRecipientLoginChallenge(challenge: RecipientLoginChallenge) { this.recipientLoginChallenges.push(RecipientLoginChallengeSchema.parse(challenge)); }
  async getRecipientLoginChallenge(id: string) { const value = this.recipientLoginChallenges.find((item) => item.id === id); return value ? structuredClone(value) : undefined; }
  async listRecipientLoginChallenges(email: string) { return this.recipientLoginChallenges.filter((item) => item.email === email.toLowerCase()).map((item) => structuredClone(item)); }
  async saveRecipientLoginChallenge(challenge: RecipientLoginChallenge) { const index = this.recipientLoginChallenges.findIndex((item) => item.id === challenge.id); if (index < 0) throw new Error('Recipient login challenge not found.'); this.recipientLoginChallenges[index] = RecipientLoginChallengeSchema.parse(challenge); }
  async listPasskeyCredentials(accountId: string) { return this.passkeyCredentials.filter((item) => item.accountId === accountId).map((item) => structuredClone(item)); }
  async getPasskeyCredential(id: string) { const value = this.passkeyCredentials.find((item) => item.id === id); return value ? structuredClone(value) : undefined; }
  async savePasskeyCredential(credential: PasskeyCredential) { const value = PasskeyCredentialSchema.parse(credential); const index = this.passkeyCredentials.findIndex((item) => item.id === value.id); if (index < 0) this.passkeyCredentials.push(value); else this.passkeyCredentials[index] = value; }
  async deletePasskeyCredential(id: string, accountId: string) { this.passkeyCredentials = this.passkeyCredentials.filter((item) => item.id !== id || item.accountId !== accountId); }
  async createPasskeyChallenge(challenge: PasskeyChallenge) { this.passkeyChallenges.push(PasskeyChallengeSchema.parse(challenge)); }
  async getPasskeyChallenge(id: string) { const value = this.passkeyChallenges.find((item) => item.id === id); return value ? structuredClone(value) : undefined; }
  async savePasskeyChallenge(challenge: PasskeyChallenge) { const index = this.passkeyChallenges.findIndex((item) => item.id === challenge.id); if (index < 0) throw new Error('Passkey challenge not found.'); this.passkeyChallenges[index] = PasskeyChallengeSchema.parse(challenge); }
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
      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id text PRIMARY KEY, tenant_id text NOT NULL, endpoint_id text NOT NULL, event_id text NOT NULL,
        status text NOT NULL, next_attempt_at timestamptz NOT NULL, payload jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (endpoint_id, event_id)
      );
      CREATE INDEX IF NOT EXISTS webhook_deliveries_pending_idx ON webhook_deliveries (status, next_attempt_at);
      CREATE INDEX IF NOT EXISTS webhook_deliveries_tenant_idx ON webhook_deliveries (tenant_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS agreement_audit_events (
        id text PRIMARY KEY, tenant_id text NOT NULL, agreement_id text NOT NULL, event_type text NOT NULL,
        payload jsonb NOT NULL, created_at timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS agreement_audit_events_agreement_idx ON agreement_audit_events (tenant_id, agreement_id, created_at);
      CREATE TABLE IF NOT EXISTS agreement_artifacts (
        id text PRIMARY KEY, tenant_id text NOT NULL, agreement_id text NOT NULL, artifact_kind text NOT NULL,
        revision integer NOT NULL, content_sha256 text NOT NULL, artifact_sha256 text NOT NULL,
        payload jsonb NOT NULL, created_at timestamptz NOT NULL,
        UNIQUE (agreement_id, artifact_kind, revision, content_sha256)
      );
      CREATE INDEX IF NOT EXISTS agreement_artifacts_agreement_idx ON agreement_artifacts (tenant_id, agreement_id, created_at);
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
      CREATE TABLE IF NOT EXISTS accounts (id text PRIMARY KEY, email text UNIQUE NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS auth_identities (id text PRIMARY KEY, provider text NOT NULL, issuer text NOT NULL, subject text NOT NULL, account_id text NOT NULL, payload jsonb NOT NULL, UNIQUE (provider, issuer, subject));
      CREATE TABLE IF NOT EXISTS customer_entities (id text PRIMARY KEY, slug text UNIQUE NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS entity_memberships (id text PRIMARY KEY, account_id text NOT NULL, entity_id text NOT NULL, payload jsonb NOT NULL, UNIQUE (account_id, entity_id));
      CREATE INDEX IF NOT EXISTS entity_memberships_account_idx ON entity_memberships (account_id);
      CREATE TABLE IF NOT EXISTS agreement_access (id text PRIMARY KEY, account_id text NOT NULL, agreement_id text NOT NULL, participant_id text NOT NULL, payload jsonb NOT NULL, UNIQUE (account_id, agreement_id, participant_id));
      CREATE TABLE IF NOT EXISTS access_challenges (id text PRIMARY KEY, token_hash text UNIQUE NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS entity_member_invitations (id text PRIMARY KEY, entity_id text NOT NULL, email text NOT NULL, token_hash text UNIQUE NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
      CREATE INDEX IF NOT EXISTS entity_member_invitations_entity_idx ON entity_member_invitations (entity_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS recipient_login_challenges (id text PRIMARY KEY, email text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
      CREATE INDEX IF NOT EXISTS recipient_login_challenges_email_idx ON recipient_login_challenges (email, created_at DESC);
      CREATE TABLE IF NOT EXISTS passkey_credentials (id text PRIMARY KEY, account_id text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
      CREATE INDEX IF NOT EXISTS passkey_credentials_account_idx ON passkey_credentials (account_id);
      CREATE TABLE IF NOT EXISTS passkey_challenges (id text PRIMARY KEY, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
    `);
    const platformEntity = CustomerEntitySchema.parse({ id: 'bytecrunch', slug: 'bytecrunch', legalName: 'ByteCrunch ApS', businessAddress: null, registrationNumber: null, jurisdiction: 'DK', createdAt: now() });
    await this.pool.query('INSERT INTO customer_entities (id,slug,payload) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING', [platformEntity.id, platformEntity.slug, JSON.stringify(platformEntity)]);
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

  override async createWebhookDeliveries(deliveries: WebhookDelivery[]): Promise<void> {
    if (deliveries.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const delivery of deliveries) {
        WebhookDeliverySchema.parse(delivery);
        await client.query('INSERT INTO webhook_deliveries (id,tenant_id,endpoint_id,event_id,status,next_attempt_at,payload) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (endpoint_id,event_id) DO NOTHING', [delivery.id, delivery.tenantId, delivery.endpointId, delivery.eventId, delivery.status, delivery.nextAttemptAt, JSON.stringify(delivery)]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  override async listWebhookDeliveries(tenantId: string, limit: number): Promise<WebhookDelivery[]> {
    const result = await this.pool.query('SELECT payload FROM webhook_deliveries WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2', [tenantId, limit]);
    return result.rows.map((row) => WebhookDeliverySchema.parse(row.payload));
  }

  override async getWebhookDelivery(tenantId: string, id: string): Promise<WebhookDelivery | undefined> {
    const result = await this.pool.query('SELECT payload FROM webhook_deliveries WHERE tenant_id=$1 AND id=$2', [tenantId, id]);
    return result.rows[0] ? WebhookDeliverySchema.parse(result.rows[0].payload) : undefined;
  }

  override async listPendingWebhookDeliveries(limit: number): Promise<WebhookDelivery[]> {
    const result = await this.pool.query("SELECT payload FROM webhook_deliveries WHERE status IN ('pending','failed','sending') AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT $1", [limit]);
    return result.rows.map((row) => WebhookDeliverySchema.parse(row.payload));
  }

  override async saveWebhookDelivery(delivery: WebhookDelivery): Promise<void> {
    WebhookDeliverySchema.parse(delivery);
    await this.pool.query('UPDATE webhook_deliveries SET payload=$1,status=$2,next_attempt_at=$3 WHERE id=$4 AND tenant_id=$5', [JSON.stringify(delivery), delivery.status, delivery.nextAttemptAt, delivery.id, delivery.tenantId]);
  }

  override async appendAgreementAuditEvent(event: AgreementAuditEvent): Promise<void> {
    AgreementAuditEventSchema.parse(event);
    await this.pool.query('INSERT INTO agreement_audit_events (id,tenant_id,agreement_id,event_type,payload,created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING', [event.id, event.tenantId, event.agreementId, event.type, JSON.stringify(event), event.createdAt]);
  }

  override async listAgreementAuditEvents(tenantId: string, agreementId: string): Promise<AgreementAuditEvent[]> {
    const result = await this.pool.query('SELECT payload FROM agreement_audit_events WHERE tenant_id=$1 AND agreement_id=$2 ORDER BY created_at', [tenantId, agreementId]);
    return result.rows.map((row) => AgreementAuditEventSchema.parse(row.payload));
  }

  override async createAgreementArtifact(artifact: AgreementArtifact): Promise<void> {
    AgreementArtifactSchema.parse(artifact);
    await this.pool.query('INSERT INTO agreement_artifacts (id,tenant_id,agreement_id,artifact_kind,revision,content_sha256,artifact_sha256,payload,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (agreement_id,artifact_kind,revision,content_sha256) DO NOTHING', [artifact.id, artifact.tenantId, artifact.agreementId, artifact.kind, artifact.revision, artifact.contentSha256, artifact.artifactSha256, JSON.stringify(artifact), artifact.createdAt]);
  }

  override async listAgreementArtifacts(tenantId: string, agreementId: string): Promise<AgreementArtifact[]> {
    const result = await this.pool.query('SELECT payload FROM agreement_artifacts WHERE tenant_id=$1 AND agreement_id=$2 ORDER BY created_at', [tenantId, agreementId]);
    return result.rows.map((row) => AgreementArtifactSchema.parse(row.payload));
  }

  override async getAgreementArtifact(tenantId: string, agreementId: string, artifactId: string): Promise<AgreementArtifact | undefined> {
    const result = await this.pool.query('SELECT payload FROM agreement_artifacts WHERE tenant_id=$1 AND agreement_id=$2 AND id=$3', [tenantId, agreementId, artifactId]);
    return result.rows[0] ? AgreementArtifactSchema.parse(result.rows[0].payload) : undefined;
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
  override async findOrCreateAccountByIdentity(provider: 'dev' | 'oidc', issuer: string, subject: string, email: string, displayName: string) {
    const found = await this.pool.query('SELECT account.payload FROM auth_identities identity JOIN accounts account ON account.id=identity.account_id WHERE identity.provider=$1 AND identity.issuer=$2 AND identity.subject=$3', [provider, issuer, subject]);
    if (found.rows[0]) return AccountSchema.parse(found.rows[0].payload);
    const account = await this.findOrCreateAccountByEmail(email, displayName);
    const identity = AuthIdentitySchema.parse({ id: `auth_${randomUUID()}`, accountId: account.id, provider, issuer, subject, emailVerified: true, createdAt: now() });
    await this.pool.query('INSERT INTO auth_identities (id,provider,issuer,subject,account_id,payload) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (provider,issuer,subject) DO NOTHING', [identity.id, provider, issuer, subject, account.id, JSON.stringify(identity)]);
    const resolved = await this.pool.query('SELECT account.payload FROM auth_identities identity JOIN accounts account ON account.id=identity.account_id WHERE identity.provider=$1 AND identity.issuer=$2 AND identity.subject=$3', [provider, issuer, subject]);
    return AccountSchema.parse(resolved.rows[0]?.payload ?? account);
  }
  override async findOrCreateAccountByEmail(email: string, displayName: string) {
    const normalized = email.toLowerCase(); const found = await this.pool.query('SELECT payload FROM accounts WHERE email=$1', [normalized]);
    if (found.rows[0]) return AccountSchema.parse(found.rows[0].payload);
    const account = AccountSchema.parse({ id: `acct_${randomUUID()}`, email: normalized, displayName, createdAt: now() });
    await this.pool.query('INSERT INTO accounts (id,email,payload) VALUES ($1,$2,$3) ON CONFLICT (email) DO NOTHING', [account.id, account.email, JSON.stringify(account)]);
    const resolved = await this.pool.query('SELECT payload FROM accounts WHERE email=$1', [normalized]); return AccountSchema.parse(resolved.rows[0]?.payload ?? account);
  }
  override async findAccountByEmail(email: string) { const result = await this.pool.query('SELECT payload FROM accounts WHERE email=$1', [email.toLowerCase()]); return result.rows[0] ? AccountSchema.parse(result.rows[0].payload) : undefined; }
  override async getAccount(id: string) { const result = await this.pool.query('SELECT payload FROM accounts WHERE id=$1', [id]); return result.rows[0] ? AccountSchema.parse(result.rows[0].payload) : undefined; }
  override async getCustomerEntity(id: string) { const result = await this.pool.query('SELECT payload FROM customer_entities WHERE id=$1', [id]); return result.rows[0] ? CustomerEntitySchema.parse(result.rows[0].payload) : undefined; }
  override async createCustomerEntity(input: Omit<CustomerEntity, 'id' | 'createdAt'> & { id?: string }) { const entity = CustomerEntitySchema.parse({ ...input, id: input.id ?? `org_${randomUUID()}`, createdAt: now() }); await this.pool.query('INSERT INTO customer_entities (id,slug,payload) VALUES ($1,$2,$3)', [entity.id, entity.slug, JSON.stringify(entity)]); return entity; }
  override async listEntityMemberships(accountId: string) { const result = await this.pool.query('SELECT payload FROM entity_memberships WHERE account_id=$1', [accountId]); return result.rows.map((row) => EntityMembershipSchema.parse(row.payload)); }
  override async grantEntityMembership(accountId: string, entityId: string, roles: EntityMembership['roles'], permissions: EntityMembership['permissions']) {
    const found = await this.pool.query('SELECT payload FROM entity_memberships WHERE account_id=$1 AND entity_id=$2', [accountId, entityId]); if (found.rows[0]) return EntityMembershipSchema.parse(found.rows[0].payload);
    const membership = EntityMembershipSchema.parse({ id: `membership_${randomUUID()}`, accountId, entityId, roles, permissions, status: 'active', createdAt: now() }); await this.pool.query('INSERT INTO entity_memberships (id,account_id,entity_id,payload) VALUES ($1,$2,$3,$4) ON CONFLICT (account_id,entity_id) DO NOTHING', [membership.id, accountId, entityId, JSON.stringify(membership)]); return membership;
  }
  override async createAgreementAccess(access: AgreementAccess) { AgreementAccessSchema.parse(access); await this.pool.query('INSERT INTO agreement_access (id,account_id,agreement_id,participant_id,payload) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (account_id,agreement_id,participant_id) DO NOTHING', [access.id, access.accountId, access.agreementId, access.participantId, JSON.stringify(access)]); }
  override async getAgreementAccess(id: string) { const result = await this.pool.query('SELECT payload FROM agreement_access WHERE id=$1', [id]); return result.rows[0] ? AgreementAccessSchema.parse(result.rows[0].payload) : undefined; }
  override async findAgreementAccess(accountId: string, agreementId: string, participantId: string) { const result = await this.pool.query('SELECT payload FROM agreement_access WHERE account_id=$1 AND agreement_id=$2 AND participant_id=$3', [accountId, agreementId, participantId]); return result.rows[0] ? AgreementAccessSchema.parse(result.rows[0].payload) : undefined; }
  override async saveAgreementAccess(access: AgreementAccess) { AgreementAccessSchema.parse(access); await this.pool.query('UPDATE agreement_access SET payload=$1 WHERE id=$2', [JSON.stringify(access), access.id]); }
  override async listAgreementAccesses(accountId: string) { const result = await this.pool.query('SELECT payload FROM agreement_access WHERE account_id=$1', [accountId]); return result.rows.map((row) => AgreementAccessSchema.parse(row.payload)).filter((item) => item.status === 'active'); }
  override async createAccessChallenge(challenge: AccessChallenge) { AccessChallengeSchema.parse(challenge); await this.pool.query('INSERT INTO access_challenges (id,token_hash,payload) VALUES ($1,$2,$3)', [challenge.id, challenge.tokenHash, JSON.stringify(challenge)]); }
  override async getAccessChallengeByTokenHash(tokenHash: string) { const result = await this.pool.query('SELECT payload FROM access_challenges WHERE token_hash=$1', [tokenHash]); return result.rows[0] ? AccessChallengeSchema.parse(result.rows[0].payload) : undefined; }
  override async saveAccessChallenge(challenge: AccessChallenge) { AccessChallengeSchema.parse(challenge); await this.pool.query('UPDATE access_challenges SET payload=$1 WHERE id=$2', [JSON.stringify(challenge), challenge.id]); }
  override async listEntityMembers(entityId: string) { const result = await this.pool.query('SELECT payload FROM entity_memberships WHERE entity_id=$1', [entityId]); return result.rows.map((row) => EntityMembershipSchema.parse(row.payload)); }
  override async getEntityMembership(id: string) { const result = await this.pool.query('SELECT payload FROM entity_memberships WHERE id=$1', [id]); return result.rows[0] ? EntityMembershipSchema.parse(result.rows[0].payload) : undefined; }
  override async saveEntityMembership(membership: EntityMembership) { EntityMembershipSchema.parse(membership); await this.pool.query('UPDATE entity_memberships SET payload=$1 WHERE id=$2', [JSON.stringify(membership), membership.id]); }
  override async createEntityMemberInvitation(invitation: EntityMemberInvitation) { EntityMemberInvitationSchema.parse(invitation); await this.pool.query('INSERT INTO entity_member_invitations (id,entity_id,email,token_hash,payload) VALUES ($1,$2,$3,$4,$5)', [invitation.id, invitation.entityId, invitation.email, invitation.tokenHash, JSON.stringify(invitation)]); }
  override async getEntityMemberInvitationByTokenHash(tokenHash: string) { const result = await this.pool.query('SELECT payload FROM entity_member_invitations WHERE token_hash=$1', [tokenHash]); return result.rows[0] ? EntityMemberInvitationSchema.parse(result.rows[0].payload) : undefined; }
  override async listEntityMemberInvitations(entityId: string) { const result = await this.pool.query('SELECT payload FROM entity_member_invitations WHERE entity_id=$1 ORDER BY created_at DESC', [entityId]); return result.rows.map((row) => EntityMemberInvitationSchema.parse(row.payload)); }
  override async saveEntityMemberInvitation(invitation: EntityMemberInvitation) { EntityMemberInvitationSchema.parse(invitation); await this.pool.query('UPDATE entity_member_invitations SET payload=$1 WHERE id=$2', [JSON.stringify(invitation), invitation.id]); }
  override async createRecipientLoginChallenge(challenge: RecipientLoginChallenge) { RecipientLoginChallengeSchema.parse(challenge); await this.pool.query('INSERT INTO recipient_login_challenges (id,email,payload) VALUES ($1,$2,$3)', [challenge.id, challenge.email, JSON.stringify(challenge)]); }
  override async getRecipientLoginChallenge(id: string) { const result = await this.pool.query('SELECT payload FROM recipient_login_challenges WHERE id=$1', [id]); return result.rows[0] ? RecipientLoginChallengeSchema.parse(result.rows[0].payload) : undefined; }
  override async listRecipientLoginChallenges(email: string) { const result = await this.pool.query('SELECT payload FROM recipient_login_challenges WHERE email=$1 ORDER BY created_at DESC', [email.toLowerCase()]); return result.rows.map((row) => RecipientLoginChallengeSchema.parse(row.payload)); }
  override async saveRecipientLoginChallenge(challenge: RecipientLoginChallenge) { RecipientLoginChallengeSchema.parse(challenge); await this.pool.query('UPDATE recipient_login_challenges SET payload=$1 WHERE id=$2', [JSON.stringify(challenge), challenge.id]); }
  override async listPasskeyCredentials(accountId: string) { const result = await this.pool.query('SELECT payload FROM passkey_credentials WHERE account_id=$1', [accountId]); return result.rows.map((row) => PasskeyCredentialSchema.parse(row.payload)); }
  override async getPasskeyCredential(id: string) { const result = await this.pool.query('SELECT payload FROM passkey_credentials WHERE id=$1', [id]); return result.rows[0] ? PasskeyCredentialSchema.parse(result.rows[0].payload) : undefined; }
  override async savePasskeyCredential(credential: PasskeyCredential) { PasskeyCredentialSchema.parse(credential); await this.pool.query('INSERT INTO passkey_credentials (id,account_id,payload) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET payload=EXCLUDED.payload', [credential.id, credential.accountId, JSON.stringify(credential)]); }
  override async deletePasskeyCredential(id: string, accountId: string) { await this.pool.query('DELETE FROM passkey_credentials WHERE id=$1 AND account_id=$2', [id, accountId]); }
  override async createPasskeyChallenge(challenge: PasskeyChallenge) { PasskeyChallengeSchema.parse(challenge); await this.pool.query('INSERT INTO passkey_challenges (id,payload) VALUES ($1,$2)', [challenge.id, JSON.stringify(challenge)]); }
  override async getPasskeyChallenge(id: string) { const result = await this.pool.query('SELECT payload FROM passkey_challenges WHERE id=$1', [id]); return result.rows[0] ? PasskeyChallengeSchema.parse(result.rows[0].payload) : undefined; }
  override async savePasskeyChallenge(challenge: PasskeyChallenge) { PasskeyChallengeSchema.parse(challenge); await this.pool.query('UPDATE passkey_challenges SET payload=$1 WHERE id=$2', [JSON.stringify(challenge), challenge.id]); }
}

function permissionsForRole(role: 'owner' | 'reviewer' | 'signatory') {
  if (role === 'signatory') return ['read', 'comment', 'suggest', 'sign', 'nominate_signatory'] as const;
  if (role === 'reviewer') return ['read', 'comment', 'suggest', 'nominate_signatory'] as const;
  return ['read', 'comment', 'suggest'] as const;
}
