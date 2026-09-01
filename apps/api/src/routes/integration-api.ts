import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import {
  CreateIntegrationSessionSchema,
  EvaluateConditionsSchema,
  ExternalPrincipalSchema,
  IntegrationSessionSchema,
  type Agreement,
  type AgreementStatus,
} from '@bytecrunch/contracts-domain';
import { config } from '../config.js';
import { createInvitationToken } from '../external-auth.js';
import { integrationAuthMiddleware, integrationClient } from '../integration-oauth.js';
import { participantOidcConnection } from '../integration-plugins.js';
import type { Repository } from '../repository.js';

type ConditionResult = {
  kind: 'subject_signed' | 'agreement_executed'; templateKey: string; minimumVersion: number; met: boolean;
  status?: AgreementStatus; agreementId?: string; templateVersion?: number; signedAt?: string | null; executedAt?: string | null;
};

type Services = {
  now: () => string;
  transition: (agreement: Agreement, status: AgreementStatus) => void;
  conditionByPerson: (agreements: Agreement[], personId: string, condition: { kind: 'subject_signed' | 'agreement_executed'; templateKey: string; minimumVersion: number }) => ConditionResult;
};

async function identityContext(repository: Repository, integration: ReturnType<typeof integrationClient>['integration']) {
  if (integration.mappingStrategy === 'account_linking') throw new Error('Explicit account linking is reserved for identity migration workflows and cannot start a normal signing session.');
  if (integration.mappingStrategy === 'shared_oidc') {
    if (integration.identityProviderKey !== 'participant-oidc') throw new Error('This integration has no participant identity provider.');
    const connection = await participantOidcConnection(repository, integration.tenantId);
    if (!connection) throw new Error('Participant OIDC is not enabled for this entity.');
    return { issuer: connection.issuerUrl.replace(/\/$/, ''), identityProviderId: connection.installationId, federated: true };
  }
  return { issuer: `urn:bytecrunch:integration:${integration.id}`, identityProviderId: integration.id, federated: false };
}
export function registerIntegrationApiRoutes(app: Hono, repository: Repository, services: Services): void {
  app.post('/integration/v1/signing-sessions', integrationAuthMiddleware(repository, 'signing_sessions:write'), async (context) => {
    const input = CreateIntegrationSessionSchema.parse(await context.req.json());
    const { integration } = integrationClient(context);
    if (input.integrationKey !== integration.key) return context.json({ error: 'integration_mismatch', message: 'The request integration key does not match the access token.' }, 403);
    if (!integration.allowedRedirectUris.includes(input.returnUrl)) return context.json({ error: 'redirect_not_allowed', message: 'returnUrl is not allow-listed for this integration.' }, 400);
    const identity = await identityContext(repository, integration);
    let principal = await repository.findExternalPrincipal(integration.tenantId, identity.issuer, input.subject);
    if (principal && principal.email.toLowerCase() !== input.email.toLowerCase()) return context.json({ error: 'subject_conflict', message: 'This subject is already associated with a different participant email.' }, 409);
    const person = principal
      ? (await repository.findPersonByEmail(integration.tenantId, principal.email)) ?? await repository.createPerson(integration.tenantId, principal.email, principal.displayName)
      : (await repository.findPersonByEmail(integration.tenantId, input.email)) ?? await repository.createPerson(integration.tenantId, input.email, input.displayName ?? input.email.split('@')[0]!);
    if (!identity.federated && !principal) {
      principal = ExternalPrincipalSchema.parse({ id: `principal_${randomUUID()}`, tenantId: integration.tenantId, identityProviderId: identity.identityProviderId, issuer: identity.issuer, subject: input.subject, personId: person.id, email: input.email.toLowerCase(), displayName: input.displayName ?? person.displayName, verificationMethod: 'host_asserted', verifiedAt: services.now(), authenticationTime: null });
      await repository.createExternalPrincipal(principal);
    }
    const agreement = await repository.createAgreement(integration.tenantId, {
      title: input.title ?? `${input.templateKey} agreement`, templateKey: input.templateKey, participants: [],
      parties: [{ role: 'counterparty', entity: {}, minimumSignatures: 1, participants: [{ email: input.email, name: input.displayName, role: 'signatory', required: true }] }], metadata: input.metadata,
    });
    const participant = agreement.participants[0]!; participant.personId = person.id; participant.externalPrincipalId = principal?.id ?? null;
    agreement.integrationContext = { integrationId: integration.id, integrationKey: integration.key, identityIssuer: identity.issuer, externalSubject: input.subject, externalPrincipalId: principal?.id ?? null, personId: person.id, returnUrl: input.returnUrl };
    services.transition(agreement, 'in_review'); await repository.saveAgreement(agreement);
    const { token, tokenHash } = createInvitationToken();
    const handoff = IntegrationSessionSchema.parse({ id: `isess_${randomUUID()}`, tenantId: integration.tenantId, integrationId: integration.id, personId: person.id, externalSubject: input.subject, identityIssuer: identity.issuer, externalPrincipalId: principal?.id ?? null, agreementId: agreement.id, participantId: participant.id, tokenHash, status: 'pending', returnUrl: input.returnUrl, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), createdAt: services.now(), acceptedAt: null });
    await repository.createIntegrationSession(handoff);
    return context.json({ agreementId: agreement.id, expiresAt: handoff.expiresAt, handoffUrl: `${config.WEB_URL}/invite?integrationToken=${encodeURIComponent(token)}` }, 201);
  });

  app.post('/integration/v1/conditions/evaluate', integrationAuthMiddleware(repository, 'conditions:read'), async (context) => {
    const input = EvaluateConditionsSchema.parse(await context.req.json()); const { integration } = integrationClient(context);
    if (input.integrationKey !== integration.key) return context.json({ error: 'integration_mismatch', message: 'The request integration key does not match the access token.' }, 403);
    const identity = await identityContext(repository, integration);
    const principal = await repository.findExternalPrincipal(integration.tenantId, identity.issuer, input.subject);
    const agreements = principal ? await repository.listAgreements(integration.tenantId) : [];
    const conditions = input.conditions.map((condition) => principal ? services.conditionByPerson(agreements, principal.personId, condition) : { ...condition, met: false });
    return context.json({ decisionId: `decision_${randomUUID()}`, integrationKey: integration.key, issuer: identity.issuer, subject: input.subject, operator: input.operator, met: input.operator === 'all' ? conditions.every((item) => item.met) : conditions.some((item) => item.met), evaluatedAt: services.now(), conditions }, 200, { 'cache-control': 'no-store' });
  });
}
