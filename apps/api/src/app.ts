import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { ZodError } from 'zod';
import {
  AgreementSchema,
  AddThreadMessageSchema,
  CreateDocumentCommentSchema,
  CreateAgreementSchema,
  CreateSuggestionSchema,
  CreateTemplateSchema,
  CreateWebhookSchema,
  CreateIntegrationSchema,
  CreateIntegrationSessionSchema,
  IdentityLinkSchema,
  IntegrationSessionSchema,
  EvaluateAgreementStatusSchema,
  ExternalSignAgreementSchema,
  InvitationSchema,
  NominateSignatorySchema,
  OnboardParticipantSchema,
  ResolveSuggestionSchema,
  ReopenReviewSchema,
  UpdateDocumentCommentSchema,
  UpdateSuggestionSchema,
  UpdateReviewDraftSchema,
  SignAgreementSchema,
  SendReviewSchema,
  assertReadyForSignature,
  canTransition,
  isExecutionComplete,
  isPartySignatureComplete,
  type Agreement,
  type AgreementStatus,
  type Suggestion,
} from '@bytecrunch/contracts-domain';
import { authMiddleware, currentUser, registerAuthRoutes } from './auth.js';
import { config } from './config.js';
import { sendInvitationEmail } from './email.js';
import { createInvitationToken, currentExternalSession, externalSessionMiddleware, hashInvitationToken, setExternalSession } from './external-auth.js';
import { hashContent, type Repository } from './repository.js';
import { emitAgreementEvent } from './webhooks.js';
import { notifyParticipants } from './notifications.js';

function isoNow(): string { return new Date().toISOString(); }

function transition(agreement: Agreement, status: AgreementStatus): void {
  if (!canTransition(agreement.status, status)) {
    throw new Error(`Agreement cannot transition from '${agreement.status}' to '${status}'.`);
  }
  agreement.status = status;
  agreement.updatedAt = isoNow();
}

function assignReview(agreement: Agreement, assignedTo: 'sender' | 'counterparty', sentBy: string, message = ''): void {
  if (agreement.status === 'draft') transition(agreement, 'in_review');
  if (agreement.status !== 'in_review') throw new Error('This agreement is not in review.');
  const current = agreement.reviewHistory.at(-1); if (current && !current.returnedAt) current.returnedAt = isoNow();
  agreement.reviewRound += 1; agreement.reviewAssignedTo = assignedTo;
  agreement.reviewHistory.push({ round: agreement.reviewRound, assignedTo, sentBy, message, sentAt: isoNow(), returnedAt: null }); agreement.updatedAt = isoNow();
}

function rangesOverlap(first: { start: number; end: number }, second: { start: number; end: number }): boolean {
  if (first.start === first.end) return first.start >= second.start && first.start <= second.end;
  if (second.start === second.end) return second.start >= first.start && second.start <= first.end;
  return first.start < second.end && first.end > second.start;
}

function restoreCounteredParents(agreement: Agreement, suggestion: Suggestion): void {
  for (const parentId of suggestion.inResponseToSuggestionIds) {
    const parent = agreement.suggestions.find((candidate) => candidate.id === parentId);
    if (parent?.status === 'countered' && parent.counteredBySuggestionId === suggestion.id) { parent.status = 'open'; parent.resolvedAt = null; parent.counteredBySuggestionId = null; }
  }
}

type TrackedChange = { originalText: string; replacementText: string; anchor: { start: number; end: number } };
function projectedIncomingReview(agreement: Agreement) {
  const candidates = agreement.suggestions.filter((item) => item.status === 'open' && item.reviewRound < agreement.reviewRound && item.anchor?.revision === agreement.revision).sort((a, b) => a.anchor!.start - b.anchor!.start);
  const ranges: Array<{ suggestion: Suggestion; start: number; end: number }> = []; let cursor = 0; let content = '';
  for (const suggestion of candidates) {
    const anchor = suggestion.anchor!;
    if (anchor.start < cursor || agreement.content.slice(anchor.start, anchor.end) !== suggestion.originalText) continue;
    content += agreement.content.slice(cursor, anchor.start); const start = content.length; content += suggestion.replacementText;
    ranges.push({ suggestion, start, end: content.length }); cursor = anchor.end;
  }
  return { content: content + agreement.content.slice(cursor), ranges };
}
function mapPositionThroughChanges(position: number, changes: TrackedChange[], endAffinity: boolean): number {
  let delta = 0;
  for (const change of changes) {
    if (change.anchor.end <= position) { delta += change.replacementText.length - change.originalText.length; continue; }
    if (change.anchor.start >= position) break;
    return change.anchor.start + delta + (endAffinity ? change.replacementText.length : 0);
  }
  return position + delta;
}
function projectionPositionToCanonical(position: number, ranges: Array<{ suggestion: Suggestion; start: number; end: number }>, endAffinity: boolean): number {
  let delta = 0;
  for (const range of ranges) {
    const anchor = range.suggestion.anchor!;
    if (position < range.start) break;
    if (position >= range.end) { delta += (range.end - range.start) - (anchor.end - anchor.start); continue; }
    return endAffinity ? anchor.end : anchor.start;
  }
  return position - delta;
}

function anchoredSuggestion(agreement: Agreement, input: { originalText: string; replacementText: string; comment: string; anchor?: { start: number; end: number } | undefined }, authorSubjectId: string, ignoredOpenSuggestionIds = new Set<string>()): Suggestion {
  const start = input.anchor?.start ?? agreement.content.indexOf(input.originalText); const end = input.anchor?.end ?? start + input.originalText.length;
  if (start < 0 || end < start || agreement.content.slice(start, end) !== input.originalText) throw new Error('The selected text no longer matches this revision. Select it again.');
  if (agreement.suggestions.some((item) => item.status === 'open' && !ignoredOpenSuggestionIds.has(item.id) && item.anchor?.revision === agreement.revision && rangesOverlap({ start, end }, item.anchor))) throw new Error('This selection overlaps another open redline. Resolve it first.');
  return { id: `sug_${randomUUID()}`, agreementId: agreement.id, authorSubjectId, originalText: input.originalText, replacementText: input.replacementText, comment: input.comment, anchor: { start, end, revision: agreement.revision, prefix: agreement.content.slice(Math.max(0, start - 40), start), suffix: agreement.content.slice(end, end + 40) }, messages: [], mentions: [], reviewRound: agreement.reviewRound, inResponseToSuggestionIds: [], counteredBySuggestionId: null, status: 'open' as const, createdAt: isoNow(), resolvedAt: null };
}

function replaceTurnDraft(agreement: Agreement, content: string, authorId: string, side: 'sender' | 'counterparty'): void {
  assertActiveReviewSide(agreement, side);
  const previous = agreement.suggestions.filter((item) => item.status === 'open' && item.reviewRound === agreement.reviewRound && item.authorSubjectId === authorId && item.anchor?.revision === agreement.revision);
  for (const item of previous) restoreCounteredParents(agreement, item);
  agreement.suggestions = agreement.suggestions.filter((item) => !previous.includes(item));
  const projection = projectedIncomingReview(agreement);
  if (content === projection.content) { agreement.updatedAt = isoNow(); return; }
  const changes = trackedChanges(projection.content, content); const used = new Set<string>();
  const retainIdentity = (suggestion: Suggestion, preferred?: Suggestion) => {
    const nearest = previous.filter((item) => !used.has(item.id)).map((item) => ({ item, distance: Math.max(0, suggestion.anchor!.start - item.anchor!.end, item.anchor!.start - suggestion.anchor!.end) })).sort((a, b) => a.distance - b.distance)[0];
    const match = preferred ?? (nearest && nearest.distance <= 24 ? nearest.item : undefined);
    if (match) { used.add(match.id); suggestion.id = match.id; suggestion.messages = match.messages; suggestion.mentions = match.mentions; suggestion.createdAt = match.createdAt; }
  };
  for (const range of projection.ranges) {
    const touching = changes.filter((change) => rangesOverlap(change.anchor, range)); if (touching.length === 0) continue;
    const start = mapPositionThroughChanges(range.start, changes, false); const end = mapPositionThroughChanges(range.end, changes, true); const replacementText = content.slice(start, end);
    if (replacementText === range.suggestion.replacementText || replacementText === range.suggestion.originalText) continue;
    const parent = range.suggestion; const suggestion = anchoredSuggestion(agreement, { originalText: parent.originalText, replacementText, comment: '', anchor: { start: parent.anchor!.start, end: parent.anchor!.end } }, authorId, new Set([parent.id]));
    const priorCounter = previous.find((item) => item.inResponseToSuggestionIds.includes(parent.id)); retainIdentity(suggestion, priorCounter); suggestion.inResponseToSuggestionIds = [parent.id];
    parent.status = 'countered'; parent.resolvedAt = isoNow(); parent.counteredBySuggestionId = suggestion.id; agreement.suggestions.push(suggestion);
  }
  for (const change of changes) {
    if (projection.ranges.some((range) => rangesOverlap(change.anchor, range))) continue;
    const start = projectionPositionToCanonical(change.anchor.start, projection.ranges, false); const end = projectionPositionToCanonical(change.anchor.end, projection.ranges, true);
    const canonicalChange = { originalText: agreement.content.slice(start, end), replacementText: change.replacementText, anchor: { start, end } };
    const suggestion = anchoredSuggestion(agreement, { ...canonicalChange, comment: '' }, authorId); retainIdentity(suggestion); agreement.suggestions.push(suggestion);
  }
  agreement.updatedAt = isoNow();
}

function trackedChanges(before: string, after: string): TrackedChange[] {
  const beforeTokens = before.match(/\s+|[^\s]+/g) ?? []; const afterTokens = after.match(/\s+|[^\s]+/g) ?? [];
  if (beforeTokens.length * afterTokens.length > 2_000_000) return [singleTrackedChange(before, after)];
  const table = Array.from({ length: beforeTokens.length + 1 }, () => new Uint32Array(afterTokens.length + 1));
  for (let i = beforeTokens.length - 1; i >= 0; i--) for (let j = afterTokens.length - 1; j >= 0; j--) table[i]![j] = beforeTokens[i] === afterTokens[j] ? 1 + table[i + 1]![j + 1]! : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const changes: TrackedChange[] = []; let i = 0; let j = 0; let offset = 0; let active: (typeof changes)[number] | undefined;
  const flush = () => { if (active) { while (active.originalText && active.replacementText && /\s/.test(active.originalText.at(-1)!) && active.originalText.at(-1) === active.replacementText.at(-1)) { active.originalText = active.originalText.slice(0, -1); active.replacementText = active.replacementText.slice(0, -1); active.anchor.end--; } if (active.originalText || active.replacementText) changes.push(active); } active = undefined; };
  while (i < beforeTokens.length || j < afterTokens.length) {
    if (i < beforeTokens.length && j < afterTokens.length && beforeTokens[i] === afterTokens[j]) { const token = beforeTokens[i]!; if (active && /^\s+$/.test(token)) { active.originalText += token; active.replacementText += token; offset += token.length; active.anchor.end = offset; } else { flush(); offset += token.length; } i++; j++; }
    else if (j < afterTokens.length && (i === beforeTokens.length || table[i]![j + 1]! >= table[i + 1]![j]!)) { active ??= { originalText: '', replacementText: '', anchor: { start: offset, end: offset } }; active.replacementText += afterTokens[j]!; j++; }
    else { active ??= { originalText: '', replacementText: '', anchor: { start: offset, end: offset } }; active.originalText += beforeTokens[i]!; offset += beforeTokens[i]!.length; active.anchor.end = offset; i++; }
  }
  flush(); return clusterTrackedChanges(before, changes);
}

function clusterTrackedChanges(before: string, changes: Array<{ originalText: string; replacementText: string; anchor: { start: number; end: number } }>) {
  const clustered: typeof changes = [];
  for (const change of changes) {
    const previous = clustered.at(-1); const gap = previous ? before.slice(previous.anchor.end, change.anchor.start) : '';
    // Keep a continuing edit to the same phrase/sentence as one review decision. Paragraph boundaries remain separate.
    if (previous && gap.length <= 24 && !gap.includes('\n\n')) {
      previous.originalText += gap + change.originalText; previous.replacementText += gap + change.replacementText; previous.anchor.end = change.anchor.end;
    } else clustered.push(change);
  }
  return clustered;
}

function singleTrackedChange(before: string, after: string) {
  let start = 0; while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let oldEnd = before.length; let newEnd = after.length; while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
  return { originalText: before.slice(start, oldEnd), replacementText: after.slice(start, newEnd), anchor: { start, end: oldEnd } };
}

function creatorRecipients(agreement: Agreement) { return agreement.createdByParticipantId ? [agreement.createdByParticipantId] : []; }
function counterpartyRecipients(agreement: Agreement, signatoriesOnly = false) { const partyIds = new Set(agreement.parties.filter((party) => party.role === 'counterparty').map((party) => party.id)); return agreement.participants.filter((participant) => participant.partyId && partyIds.has(participant.partyId) && (!signatoriesOnly || participant.role === 'signatory')).map((participant) => participant.id); }
function unsignedSignatoryRecipients(agreement: Agreement, exceptParticipantId?: string) { return agreement.participants.filter((participant) => participant.role === 'signatory' && participant.required && participant.status !== 'signed' && participant.id !== exceptParticipantId).map((participant) => participant.id); }
function materializePartyVariables(agreement: Agreement): boolean {
  let changed = false;
  if (agreement.createdByParticipantId && !agreement.parties.some((party) => party.role === 'sender')) {
    const senderPartyId = `party_sender_${agreement.id}`;
    agreement.parties.unshift({ id: senderPartyId, role: 'sender', status: 'ready', minimumSignatures: 1, entity: { id: `entity_sender_${agreement.id}`, externalId: null, legalName: config.TENANT_LEGAL_NAME, businessAddress: config.TENANT_BUSINESS_ADDRESS || null, registrationNumber: null, jurisdiction: null, verificationStatus: 'confirmed', proposedDetails: null } });
    const creator = agreement.participants.find((item) => item.id === agreement.createdByParticipantId); if (creator && !creator.partyId) creator.partyId = senderPartyId; changed = true;
  }
  const sender = agreement.parties.find((party) => party.role === 'sender')?.entity.legalName ?? config.TENANT_LEGAL_NAME;
  const senderEntity = agreement.parties.find((party) => party.role === 'sender')?.entity; const counterpartyEntity = agreement.parties.find((party) => party.role === 'counterparty')?.entity; const counterparty = counterpartyEntity?.legalName;
  const next = agreement.content
    .replaceAll('{{party_one}}', sender).replaceAll('{{sender.legal_name}}', sender)
    .replaceAll('{{party_two}}', counterparty ?? '{{counterparty.legal_name}}')
    .replaceAll('Counterparty legal name pending', counterparty ?? '{{counterparty.legal_name}}');
  const withCounterparty = counterparty ? next.replaceAll('{{counterparty.legal_name}}', counterparty) : next;
  const withSenderAddress = senderEntity?.businessAddress ? withCounterparty.replaceAll('{{sender.business_address}}', senderEntity.businessAddress) : withCounterparty;
  const withAddresses = counterpartyEntity?.businessAddress && counterpartyEntity.verificationStatus === 'confirmed' ? withSenderAddress.replaceAll('{{counterparty.business_address}}', counterpartyEntity.businessAddress) : withSenderAddress;
  const withSignatures = agreement.templateKey === 'mutual-nda' && !['executed', 'declined', 'voided', 'expired'].includes(agreement.status) && !withAddresses.includes('{{signature_blocks}}') ? `${withAddresses.trimEnd()}\n\n{{signature_blocks}}` : withAddresses;
  if (withSignatures !== agreement.content) { agreement.content = withSignatures; agreement.contentSha256 = hashContent(withSignatures); agreement.updatedAt = isoNow(); changed = true; }
  return changed;
}
function assertActiveReviewSide(agreement: Agreement, side: 'sender' | 'counterparty') { if (agreement.status !== 'in_review' || agreement.reviewAssignedTo !== side) throw new Error('This review turn is no longer editable.'); }
function assertDraftOwner(agreement: Agreement, reviewRound: number, authorId: string, actorId: string, side: 'sender' | 'counterparty') { assertActiveReviewSide(agreement, side); if (reviewRound !== agreement.reviewRound || authorId !== actorId) throw new Error('Submitted review items are immutable. Only your changes from the active turn can be edited or removed.'); }
function assertIncomingSuggestionsResolved(agreement: Agreement): void {
  const unresolved = agreement.suggestions.filter((item) => item.status === 'open' && item.reviewRound < agreement.reviewRound).length;
  if (unresolved > 0) throw new Error(`Accept, keep original, or counter ${unresolved} incoming redline${unresolved === 1 ? '' : 's'} before sending your response.`);
}
function resolveSuggestionDecision(agreement: Agreement, suggestion: Suggestion, resolution: 'accepted' | 'rejected'): void {
  if (suggestion.status !== 'open') throw new Error('This suggestion has already been resolved.');
  if (agreement.createdByParticipantId && suggestion.reviewRound >= agreement.reviewRound) throw new Error('You cannot resolve your own redline from the active review turn.');
  if (resolution === 'accepted') {
    if (!agreement.content.includes(suggestion.originalText)) throw new Error('The original text changed before this suggestion was accepted.');
    const acceptedAnchor = suggestion.anchor; const delta = suggestion.replacementText.length - suggestion.originalText.length;
    agreement.content = acceptedAnchor && agreement.content.slice(acceptedAnchor.start, acceptedAnchor.end) === suggestion.originalText
      ? agreement.content.slice(0, acceptedAnchor.start) + suggestion.replacementText + agreement.content.slice(acceptedAnchor.end)
      : agreement.content.replace(suggestion.originalText, suggestion.replacementText);
    agreement.contentSha256 = hashContent(agreement.content); agreement.revision += 1;
    if (acceptedAnchor) agreement.suggestions.forEach((item) => { if (item.id !== suggestion.id && item.status === 'open' && item.anchor?.revision === acceptedAnchor.revision) { if (item.anchor.start >= acceptedAnchor.end) { item.anchor.start += delta; item.anchor.end += delta; } item.anchor.revision = agreement.revision; } });
  }
  suggestion.status = resolution; suggestion.resolvedAt = isoNow();
  agreement.updatedAt = isoNow();
}
function openSigningRevision(agreement: Agreement, completingReviewSide: 'sender' | 'counterparty' = 'sender'): void {
  assertReadyForSignature(agreement, completingReviewSide);
  if (agreement.status === 'draft' || agreement.status === 'in_review') transition(agreement, 'ready_for_signature');
  transition(agreement, 'out_for_signature'); agreement.parties.forEach((party) => { party.status = 'signing'; }); materializePartyVariables(agreement);
}

export function createApp(repository: Repository): Hono {
  const app = new Hono();
  app.use('*', logger());
  app.use('*', secureHeaders());
  app.use('*', cors({ origin: config.WEB_URL, credentials: true }));

  app.get('/health', (context) => context.json({ status: 'ok', version: '0.1.0', storage: repository.kind }));
  app.get('/openapi.yaml', async (context) => {
    try {
      const document = await readFile(new URL('../../../packages/api-spec/generated/openapi.yaml', import.meta.url), 'utf8');
      return context.text(document, 200, { 'content-type': 'application/yaml' });
    } catch {
      return context.json({ error: 'spec_not_generated', message: 'Run npm run api:generate first.' }, 404);
    }
  });
  registerAuthRoutes(app);
  app.use('/v1/*', authMiddleware());

  app.post('/public/invitations/exchange', async (context) => {
    const body = await context.req.json() as { token?: unknown };
    if (typeof body.token !== 'string' || body.token.length < 20) return context.json({ error: 'invalid_invitation', message: 'The invitation token is invalid.' }, 400);
    const invitation = await repository.getInvitationByTokenHash(hashInvitationToken(body.token));
    if (!invitation || invitation.status !== 'pending') return context.json({ error: 'invalid_invitation', message: 'This invitation is invalid or has already been used.' }, 410);
    if (new Date(invitation.expiresAt).getTime() <= Date.now()) {
      invitation.status = 'expired'; await repository.saveInvitation(invitation);
      return context.json({ error: 'invitation_expired', message: 'This invitation has expired. Ask the sender for a new one.' }, 410);
    }
    invitation.status = 'accepted'; invitation.acceptedAt = isoNow(); await repository.saveInvitation(invitation);
    await setExternalSession(context, { invitationId: invitation.id, agreementId: invitation.agreementId, participantId: invitation.participantId, tenantId: invitation.tenantId });
    return context.json({ accepted: true });
  });

  app.post('/public/integration-sessions/exchange', async (context) => {
    const body = await context.req.json() as { token?: unknown };
    if (typeof body.token !== 'string' || body.token.length < 20) return context.json({ error: 'invalid_session', message: 'The handoff token is invalid.' }, 400);
    const session = await repository.getIntegrationSessionByTokenHash(hashInvitationToken(body.token));
    if (!session || session.status !== 'pending') return context.json({ error: 'invalid_session', message: 'This handoff is invalid or has already been used.' }, 410);
    if (new Date(session.expiresAt).getTime() <= Date.now()) { session.status = 'expired'; await repository.saveIntegrationSession(session); return context.json({ error: 'session_expired', message: 'This handoff has expired.' }, 410); }
    session.status = 'accepted'; session.acceptedAt = isoNow(); await repository.saveIntegrationSession(session);
    await setExternalSession(context, { invitationId: session.id, agreementId: session.agreementId, participantId: session.participantId, tenantId: session.tenantId });
    return context.json({ accepted: true, returnUrl: session.returnUrl });
  });

  app.get('/public/session', externalSessionMiddleware(), async (context) => {
    const session = currentExternalSession(context);
    return context.json(await externalView(repository, session));
  });

  app.post('/public/session/onboarding', externalSessionMiddleware(), async (context) => {
    const input = OnboardParticipantSchema.parse(await context.req.json());
    const session = currentExternalSession(context);
    const agreement = await requiredAgreement(repository, session.tenantId, session.agreementId);
    const participant = agreement.participants.find((item) => item.id === session.participantId);
    if (!participant) throw new Error('Participant not found.');
    participant.name = input.name; participant.title = input.title; participant.capacity = input.capacity;
    participant.authorityConfirmed = input.authorityConfirmed; participant.onboardingCompletedAt = isoNow(); participant.status = 'reviewed';
    const party = agreement.parties.find((item) => item.id === participant.partyId);
    if (party) {
      const details = { legalName: input.entity.legalName, businessAddress: input.entity.businessAddress ?? null, registrationNumber: input.entity.registrationNumber ?? null, jurisdiction: input.entity.jurisdiction ?? null };
      const hadExpectedDetails = Boolean(party.entity.legalName);
      const changed = hadExpectedDetails && (party.entity.legalName !== details.legalName || party.entity.businessAddress !== details.businessAddress || party.entity.registrationNumber !== details.registrationNumber || party.entity.jurisdiction !== details.jurisdiction);
      if (changed) { party.entity.proposedDetails = details; party.entity.verificationStatus = 'change_pending'; }
      else { Object.assign(party.entity, details); party.entity.proposedDetails = null; party.entity.verificationStatus = 'confirmed'; }
      party.status = 'reviewing';
    }
    materializePartyVariables(agreement);
    agreement.updatedAt = isoNow(); await repository.saveAgreement(agreement);
    return context.json(await externalView(repository, session));
  });

  app.post('/public/session/suggestions', externalSessionMiddleware(), async (context) => {
    const session = currentExternalSession(context);
    const input = CreateSuggestionSchema.omit({ authorSubjectId: true }).parse(await context.req.json());
    const agreement = await requiredAgreement(repository, session.tenantId, session.agreementId);
    const participant = agreement.participants.find((item) => item.id === session.participantId);
    if (!participant?.permissions.includes('suggest')) throw new Error('You do not have permission to suggest changes.');
    if (agreement.status !== 'in_review' || (agreement.reviewAssignedTo !== null && agreement.reviewAssignedTo !== 'counterparty')) throw new Error('The agreement is not currently assigned to your party for review.');
    if (agreement.reviewAssignedTo === null) assignReview(agreement, 'counterparty', participant.name);
    const suggestion = anchoredSuggestion(agreement, input, participant.personId ?? participant.id); agreement.suggestions.push(suggestion);
    agreement.updatedAt = isoNow(); await repository.saveAgreement(agreement);
    return context.json(await externalView(repository, session));
  });

  app.put('/public/session/review-draft', externalSessionMiddleware(), async (context) => {
    const input = UpdateReviewDraftSchema.parse(await context.req.json()); const session = currentExternalSession(context); const agreement = await requiredAgreement(repository, session.tenantId, session.agreementId); const participant = agreement.participants.find((item) => item.id === session.participantId);
    if (!participant?.permissions.includes('suggest')) throw new Error('You do not have permission to edit this agreement.'); replaceTurnDraft(agreement, input.content, participant.personId ?? participant.id, 'counterparty'); await repository.saveAgreement(agreement); return context.json(await externalView(repository, session));
  });

  app.patch('/public/session/suggestions/:suggestionId', externalSessionMiddleware(), async (context) => {
    const input = UpdateSuggestionSchema.parse(await context.req.json()); const session = currentExternalSession(context); const agreement = await requiredAgreement(repository, session.tenantId, session.agreementId); const participant = agreement.participants.find((item) => item.id === session.participantId); const suggestion = agreement.suggestions.find((item) => item.id === context.req.param('suggestionId'));
    if (!participant || !suggestion || suggestion.status !== 'open') throw new Error('Editable redline not found.'); assertDraftOwner(agreement, suggestion.reviewRound, suggestion.authorSubjectId, participant.personId ?? participant.id, 'counterparty'); suggestion.replacementText = input.replacementText; suggestion.comment = input.comment; suggestion.mentions = []; agreement.updatedAt = isoNow(); await repository.saveAgreement(agreement); return context.json(await externalView(repository, session));
  });

  app.delete('/public/session/suggestions/:suggestionId', externalSessionMiddleware(), async (context) => {
    const session = currentExternalSession(context); const agreement = await requiredAgreement(repository, session.tenantId, session.agreementId); const participant = agreement.participants.find((item) => item.id === session.participantId); const index = agreement.suggestions.findIndex((item) => item.id === context.req.param('suggestionId')); const suggestion = agreement.suggestions[index];
    if (!participant || !suggestion || suggestion.status !== 'open') throw new Error('Removable redline not found.'); assertDraftOwner(agreement, suggestion.reviewRound, suggestion.authorSubjectId, participant.personId ?? participant.id, 'counterparty'); restoreCounteredParents(agreement, suggestion); agreement.suggestions.splice(index, 1); agreement.updatedAt = isoNow(); await repository.saveAgreement(agreement); return context.json(await externalView(repository, session));
  });

  app.post('/public/session/comments', externalSessionMiddleware(), async (context) => {
    const input = CreateDocumentCommentSchema.parse(await context.req.json()); const session = currentExternalSession(context);
    const agreement = await requiredAgreement(repository, session.tenantId, session.agreementId); const participant = agreement.participants.find((item) => item.id === session.participantId);
    if (!participant?.permissions.includes('comment') || (agreement.reviewAssignedTo !== null && agreement.reviewAssignedTo !== 'counterparty')) throw new Error('The agreement is not assigned to you for feedback.');
    if (agreement.reviewAssignedTo === null) assignReview(agreement, 'counterparty', participant.name);
    const comment = { id: `comment_${randomUUID()}`, authorId: participant.personId ?? participant.id, authorName: participant.name, body: input.body, status: 'open' as const, messages: [], mentions: [], reviewRound: agreement.reviewRound, createdAt: isoNow(), resolvedAt: null }; agreement.documentComments.push(comment);
    agreement.updatedAt = isoNow(); await repository.saveAgreement(agreement); return context.json(await externalView(repository, session));
  });

  app.patch('/public/session/comments/:commentId', externalSessionMiddleware(), async (context) => {
    const input = UpdateDocumentCommentSchema.parse(await context.req.json()); const session = currentExternalSession(context); const agreement = await requiredAgreement(repository, session.tenantId, session.agreementId); const participant = agreement.participants.find((item) => item.id === session.participantId); const comment = agreement.documentComments.find((item) => item.id === context.req.param('commentId'));
    if (!participant || !comment || comment.status !== 'open') throw new Error('Editable comment not found.'); assertDraftOwner(agreement, comment.reviewRound, comment.authorId, participant.personId ?? participant.id, 'counterparty'); comment.body = input.body; comment.mentions = []; agreement.updatedAt = isoNow(); await repository.saveAgreement(agreement); return context.json(await externalView(repository, session));
  });

  app.delete('/public/session/comments/:commentId', externalSessionMiddleware(), async (context) => {
    const session = currentExternalSession(context); const agreement = await requiredAgreement(repository, session.tenantId, session.agreementId); const participant = agreement.participants.find((item) => item.id === session.participantId); const index = agreement.documentComments.findIndex((item) => item.id === context.req.param('commentId')); const comment = agreement.documentComments[index];
    if (!participant || !comment || comment.status !== 'open') throw new Error('Removable comment not found.'); assertDraftOwner(agreement, comment.reviewRound, comment.authorId, participant.personId ?? participant.id, 'counterparty'); agreement.documentComments.splice(index, 1); agreement.updatedAt = isoNow(); await repository.saveAgreement(agreement); return context.json(await externalView(repository, session));
  });

  app.post('/public/session/suggestions/:suggestionId/messages', externalSessionMiddleware(), async (context) => {
    const input = AddThreadMessageSchema.parse(await context.req.json()); const session = currentExternalSession(context); const agreement = await requiredAgreement(repository, session.tenantId, session.agreementId); const participant = agreement.participants.find((item) => item.id === session.participantId); const suggestion = agreement.suggestions.find((item) => item.id === context.req.param('suggestionId'));
    if (!participant || !suggestion) throw new Error('Redline thread not found.'); assertActiveReviewSide(agreement, 'counterparty'); suggestion.messages.push({ id: `msg_${randomUUID()}`, authorId: participant.personId ?? participant.id, authorName: participant.name, body: input.body, mentions: [], createdAt: isoNow() }); agreement.updatedAt = isoNow(); await repository.saveAgreement(agreement); return context.json(await externalView(repository, session));
  });

  app.post('/public/session/suggestions/:suggestionId/resolve', externalSessionMiddleware(), async (context) => {
    const input = ResolveSuggestionSchema.parse(await context.req.json()); const session = currentExternalSession(context); const agreement = await requiredAgreement(repository, session.tenantId, session.agreementId);
    assertActiveReviewSide(agreement, 'counterparty'); const suggestion = agreement.suggestions.find((item) => item.id === context.req.param('suggestionId'));
    if (!suggestion) return context.json({ error: 'not_found', message: 'Suggestion not found.' }, 404);
    resolveSuggestionDecision(agreement, suggestion, input.resolution); await repository.saveAgreement(agreement); void emitAgreementEvent(repository, 'agreement.suggestion.resolved', agreement); return context.json(await externalView(repository, session));
  });

  app.post('/public/session/return-review', externalSessionMiddleware(), async (context) => {
    const input = SendReviewSchema.parse(await context.req.json()); const session = currentExternalSession(context); const agreement = await requiredAgreement(repository, session.tenantId, session.agreementId); const participant = agreement.participants.find((item) => item.id === session.participantId);
    if (!participant || agreement.reviewAssignedTo !== 'counterparty') throw new Error('This review is not assigned to you.'); assertIncomingSuggestionsResolved(agreement); const submittedRound = agreement.reviewRound; const redlineCount = agreement.suggestions.filter((item) => item.reviewRound === submittedRound).length; const commentCount = agreement.documentComments.filter((item) => item.reviewRound === submittedRound).length; assignReview(agreement, 'sender', participant.name, input.message); participant.status = 'reviewed'; await repository.saveAgreement(agreement); await notifyParticipants(repository, agreement, { type: 'review.returned', actorName: participant.name, actorParticipantId: participant.id, recipientParticipantIds: creatorRecipients(agreement), title: `Review returned: ${agreement.title}`, body: `${participant.name} returned their review with ${redlineCount} redline${redlineCount === 1 ? '' : 's'} and ${commentCount} general comment${commentCount === 1 ? '' : 's'}.${input.message ? ` ${input.message}` : ''}` }); return context.json(await externalView(repository, session));
  });

  app.post('/public/session/approve-for-signature', externalSessionMiddleware(), async (context) => {
    const session = currentExternalSession(context); const agreement = await requiredAgreement(repository, session.tenantId, session.agreementId); const participant = agreement.participants.find((item) => item.id === session.participantId);
    if (!participant || participant.role !== 'signatory' || !participant.permissions.includes('sign')) throw new Error('You are not a signatory on this agreement.');
    if (!participant.onboardingCompletedAt || !participant.authorityConfirmed) throw new Error('Complete onboarding and confirm your authority before signing.');
    if (agreement.reviewAssignedTo !== 'counterparty') throw new Error('This review is not assigned to you.');
    const actorId = participant.personId ?? participant.id; const hasDraftWork = agreement.suggestions.some((item) => item.status === 'open' && item.reviewRound === agreement.reviewRound && item.authorSubjectId === actorId) || agreement.documentComments.some((item) => item.status === 'open' && item.reviewRound === agreement.reviewRound && item.authorId === actorId);
    if (hasDraftWork) throw new Error('Send your changes for review before signing.');
    openSigningRevision(agreement, 'counterparty'); await repository.saveAgreement(agreement); return context.json(await externalView(repository, session));
  });

  app.post('/public/session/reopen-review', externalSessionMiddleware(), async (context) => {
    ReopenReviewSchema.parse(await context.req.json()); const session = currentExternalSession(context); const agreement = await requiredAgreement(repository, session.tenantId, session.agreementId); const participant = agreement.participants.find((item) => item.id === session.participantId);
    if (!participant?.permissions.includes('suggest')) throw new Error('You do not have permission to propose changes.');
    if (!['out_for_signature', 'partially_signed'].includes(agreement.status)) throw new Error('Only an agreement awaiting signatures can be reopened for review.');
    const invalidatedAt = isoNow(); const signed = agreement.participants.filter((item) => item.signature);
    for (const signer of signed) {
      agreement.invalidatedSignatures.push({ participantId: signer.id, participantName: signer.name, signature: signer.signature!, invalidatedAt, invalidatedByParticipantId: participant.id, reason: 'review_reopened' });
      signer.signature = null; signer.signedAt = null; signer.status = 'reviewed';
    }
    transition(agreement, 'in_review'); agreement.executedAt = null; agreement.signatureNotificationsSentAt = null; agreement.parties.forEach((party) => { party.status = party.role === 'counterparty' ? 'reviewing' : 'ready'; }); assignReview(agreement, 'counterparty', participant.name, 'Reopened signing revision to propose additional changes.');
    await repository.saveAgreement(agreement);
    await notifyParticipants(repository, agreement, { type: 'signature.invalidated', actorName: participant.name, actorParticipantId: participant.id, recipientParticipantIds: signed.map((item) => item.id).filter((id) => id !== participant.id), title: `Signature voided: ${agreement.title}`, body: `${participant.name} reopened the agreement for review. ${signed.length} signature${signed.length === 1 ? '' : 's'} were voided because the document may change.` });
    return context.json(await externalView(repository, session));
  });

  app.post('/public/session/sign', externalSessionMiddleware(), async (context) => {
    const session = currentExternalSession(context);
    const body = ExternalSignAgreementSchema.parse(await context.req.json());
    const agreement = await requiredAgreement(repository, session.tenantId, session.agreementId);
    const participant = agreement.participants.find((item) => item.id === session.participantId);
    if (!participant || participant.role !== 'signatory' || !participant.permissions.includes('sign')) throw new Error('You are not a signatory on this agreement.');
    if (!participant.onboardingCompletedAt || !participant.authorityConfirmed) throw new Error('Complete onboarding and confirm your authority before signing.');
    if (!['out_for_signature', 'partially_signed'].includes(agreement.status)) throw new Error('This agreement is not open for signature.');
    participant.status = 'signed'; participant.signedAt = isoNow(); participant.signature = { ...(body.signature ?? { method: 'typed' as const, typedName: participant.name, imageDataUrl: null }), signedContentSha256: agreement.contentSha256, signedAt: participant.signedAt }; agreement.updatedAt = isoNow();
    if (isExecutionComplete(agreement)) { transition(agreement, 'executed'); agreement.executedAt = isoNow(); agreement.parties.forEach((party) => { party.status = 'executed'; }); }
    else {
      if (participant.partyId && isPartySignatureComplete(agreement, participant.partyId)) agreement.parties.find((party) => party.id === participant.partyId)!.status = 'executed';
      if (agreement.status === 'out_for_signature') transition(agreement, 'partially_signed');
    }
    const releaseSignatureRequests = agreement.status !== 'executed' && !agreement.signatureNotificationsSentAt; if (releaseSignatureRequests) agreement.signatureNotificationsSentAt = isoNow(); await repository.saveAgreement(agreement);
    const ownerStillNeedsToSign = agreement.createdByParticipantId !== null && agreement.participants.find((item) => item.id === agreement.createdByParticipantId)?.status !== 'signed';
    await notifyParticipants(repository, agreement, { type: agreement.status === 'executed' ? 'agreement.executed' : releaseSignatureRequests ? 'signature.requested' : 'signature.completed', actorName: participant.name, actorParticipantId: participant.id, recipientParticipantIds: agreement.status === 'executed' ? agreement.participants.map((item) => item.id) : creatorRecipients(agreement), title: agreement.status === 'executed' ? `Agreement executed: ${agreement.title}` : ownerStillNeedsToSign ? `Your signature is required: ${agreement.title}` : `${participant.name} signed ${agreement.title}`, body: agreement.status === 'executed' ? 'Every required signature has been collected.' : ownerStillNeedsToSign ? `${participant.name} signed. You can add your signature at any time while the remaining signatures are collected.` : `${participant.name} signed. Other required signatures are still outstanding.` });
    void emitAgreementEvent(repository, agreement.status === 'executed' ? 'agreement.executed' : 'agreement.partially_signed', agreement);
    return context.json(await externalView(repository, session));
  });

  app.post('/public/session/nominate', externalSessionMiddleware(), async (context) => {
    const input = NominateSignatorySchema.parse(await context.req.json());
    const session = currentExternalSession(context);
    const agreement = await requiredAgreement(repository, session.tenantId, session.agreementId);
    const nominator = agreement.participants.find((item) => item.id === session.participantId);
    if (!nominator?.permissions.includes('nominate_signatory') || !nominator.partyId) throw new Error('You cannot nominate a signatory for this party.');
    const person = await repository.findPersonByEmail(session.tenantId, input.email) ?? await repository.createPerson(session.tenantId, input.email, input.name);
    const participant = {
      id: `part_${randomUUID()}`, partyId: nominator.partyId, personId: person.id, externalSubjectId: null,
      email: input.email, name: input.name, title: input.title ?? null, role: 'signatory' as const, required: true,
      status: 'not_invited' as const, signedAt: null, signature: null, capacity: null, authorityConfirmed: false, onboardingCompletedAt: null,
      permissions: ['read', 'comment', 'suggest', 'sign', 'nominate_signatory'] as Array<'read' | 'comment' | 'suggest' | 'sign' | 'nominate_signatory'>,
    };
    agreement.participants.push(participant); agreement.updatedAt = isoNow(); await repository.saveAgreement(agreement);
    const result = await createAndSendInvitation(repository, agreement, participant.id, nominator.name);
    return context.json({ ...await externalView(repository, session), nominatedInvitation: result }, 201);
  });

  app.get('/v1/templates', async (context) => context.json(await repository.listTemplates(currentUser(context).tenantId)));
  app.post('/v1/templates', async (context) => {
    const input = CreateTemplateSchema.parse(await context.req.json());
    return context.json(await repository.createTemplate(currentUser(context).tenantId, input), 201);
  });

  app.get('/v1/agreements', async (context) => { const agreements = await repository.listAgreements(currentUser(context).tenantId); await Promise.all(agreements.map(async (agreement) => { if (materializePartyVariables(agreement)) await repository.saveAgreement(agreement); })); return context.json(agreements); });
  app.post('/v1/agreements', async (context) => {
    const input = CreateAgreementSchema.parse(await context.req.json());
    const user = currentUser(context); const agreement = await repository.createAgreement(user.tenantId, input);
    if (agreement.parties.some((party) => party.role === 'counterparty')) {
      const person = await repository.findPersonByEmail(user.tenantId, user.email) ?? await repository.createPerson(user.tenantId, user.email, user.name);
      const senderParty = { id: `party_${randomUUID()}`, role: 'sender' as const, status: 'ready' as const, minimumSignatures: 1, entity: { id: `entity_${randomUUID()}`, externalId: null, legalName: config.TENANT_LEGAL_NAME, businessAddress: config.TENANT_BUSINESS_ADDRESS || null, registrationNumber: null, jurisdiction: null, verificationStatus: 'confirmed' as const, proposedDetails: null } };
      agreement.parties.unshift(senderParty);
      const creator = { id: `part_${randomUUID()}`, personId: person.id, externalSubjectId: null, email: user.email, name: user.name, role: 'signatory' as const, required: true, status: 'reviewed' as const, signedAt: null, signature: null, partyId: senderParty.id, title: null, capacity: 'authorized_representative' as const, authorityConfirmed: true, onboardingCompletedAt: isoNow(), permissions: ['read', 'comment', 'suggest', 'sign'] as Array<'read' | 'comment' | 'suggest' | 'sign'> };
      agreement.participants.push(creator); agreement.createdByParticipantId = creator.id; await repository.saveAgreement(agreement);
      materializePartyVariables(agreement); await repository.saveAgreement(agreement);
    }
    void emitAgreementEvent(repository, 'agreement.created', agreement);
    return context.json(agreement, 201);
  });

  app.get('/v1/agreements/:agreementId', async (context) => {
    const agreement = await repository.getAgreement(currentUser(context).tenantId, context.req.param('agreementId'));
    return agreement ? context.json(agreement) : context.json({ error: 'not_found', message: 'Agreement not found.' }, 404);
  });

  app.post('/v1/agreements/:agreementId/review', async (context) => {
    const agreement = await requiredAgreement(repository, currentUser(context).tenantId, context.req.param('agreementId'));
    assignReview(agreement, 'counterparty', currentUser(context).name);
    await repository.saveAgreement(agreement);
    void emitAgreementEvent(repository, 'agreement.sent_for_review', agreement);
    return context.json(agreement);
  });

  app.post('/v1/agreements/:agreementId/send-review', async (context) => {
    const input = SendReviewSchema.parse(await context.req.json()); const user = currentUser(context); const agreement = await requiredAgreement(repository, user.tenantId, context.req.param('agreementId'));
    assertActiveReviewSide(agreement, 'sender'); assertIncomingSuggestionsResolved(agreement);
    const redlineCount = agreement.suggestions.filter((item) => item.status === 'open').length; const commentCount = agreement.documentComments.filter((item) => item.status === 'open').length; assignReview(agreement, 'counterparty', user.name, input.message); await repository.saveAgreement(agreement); await notifyParticipants(repository, agreement, { type: 'review.assigned', actorName: user.name, actorParticipantId: agreement.createdByParticipantId ?? undefined, recipientParticipantIds: counterpartyRecipients(agreement), title: `Review ready: ${agreement.title}`, body: `${user.name} handed the agreement back for your next review. ${redlineCount} redline${redlineCount === 1 ? '' : 's'} and ${commentCount} general comment${commentCount === 1 ? '' : 's'} remain open.${input.message ? ` ${input.message}` : ''}` }); void emitAgreementEvent(repository, 'agreement.sent_for_review', agreement); return context.json(agreement);
  });

  app.get('/v1/agreements/:agreementId/invitations', async (context) => {
    const user = currentUser(context); await requiredAgreement(repository, user.tenantId, context.req.param('agreementId'));
    const invitations = await repository.listInvitations(user.tenantId, context.req.param('agreementId'));
    return context.json(invitations.map(publicInvitation));
  });

  app.post('/v1/agreements/:agreementId/participants/:participantId/invite', async (context) => {
    const user = currentUser(context);
    const agreement = await requiredAgreement(repository, user.tenantId, context.req.param('agreementId'));
    if (agreement.status === 'draft' || agreement.reviewAssignedTo === null) assignReview(agreement, 'counterparty', user.name);
    const result = await createAndSendInvitation(repository, agreement, context.req.param('participantId'), user.name);
    await repository.saveAgreement(agreement);
    void emitAgreementEvent(repository, 'agreement.sent_for_review', agreement);
    return context.json(result, 201);
  });

  app.post('/v1/agreements/:agreementId/suggestions', async (context) => {
    const input = CreateSuggestionSchema.parse(await context.req.json());
    const user = currentUser(context); const agreement = await requiredAgreement(repository, user.tenantId, context.req.param('agreementId'));
    if (agreement.status !== 'in_review' || (agreement.createdByParticipantId && agreement.reviewAssignedTo !== 'sender')) throw new Error('The agreement is not currently assigned to you for review.');
    const suggestion = anchoredSuggestion(agreement, input, user.id); agreement.suggestions.push(suggestion);
    agreement.updatedAt = isoNow();
    await repository.saveAgreement(agreement);
    return context.json(agreement, 201);
  });

  app.put('/v1/agreements/:agreementId/review-draft', async (context) => {
    const input = UpdateReviewDraftSchema.parse(await context.req.json()); const user = currentUser(context); const agreement = await requiredAgreement(repository, user.tenantId, context.req.param('agreementId'));
    replaceTurnDraft(agreement, input.content, user.id, 'sender'); await repository.saveAgreement(agreement); return context.json(agreement);
  });

  app.patch('/v1/agreements/:agreementId/suggestions/:suggestionId', async (context) => {
    const input = UpdateSuggestionSchema.parse(await context.req.json()); const user = currentUser(context); const agreement = await requiredAgreement(repository, user.tenantId, context.req.param('agreementId')); const suggestion = agreement.suggestions.find((item) => item.id === context.req.param('suggestionId'));
    if (!suggestion || suggestion.status !== 'open') throw new Error('Editable redline not found.'); assertDraftOwner(agreement, suggestion.reviewRound, suggestion.authorSubjectId, user.id, 'sender'); suggestion.replacementText = input.replacementText; suggestion.comment = input.comment; suggestion.mentions = []; agreement.updatedAt = isoNow(); await repository.saveAgreement(agreement); return context.json(agreement);
  });

  app.delete('/v1/agreements/:agreementId/suggestions/:suggestionId', async (context) => {
    const user = currentUser(context); const agreement = await requiredAgreement(repository, user.tenantId, context.req.param('agreementId')); const index = agreement.suggestions.findIndex((item) => item.id === context.req.param('suggestionId')); const suggestion = agreement.suggestions[index];
    if (!suggestion || suggestion.status !== 'open') throw new Error('Removable redline not found.'); assertDraftOwner(agreement, suggestion.reviewRound, suggestion.authorSubjectId, user.id, 'sender'); restoreCounteredParents(agreement, suggestion); agreement.suggestions.splice(index, 1); agreement.updatedAt = isoNow(); await repository.saveAgreement(agreement); return context.json(agreement);
  });

  app.post('/v1/agreements/:agreementId/comments', async (context) => {
    const input = CreateDocumentCommentSchema.parse(await context.req.json()); const user = currentUser(context); const agreement = await requiredAgreement(repository, user.tenantId, context.req.param('agreementId'));
    assertActiveReviewSide(agreement, 'sender'); const comment = { id: `comment_${randomUUID()}`, authorId: user.id, authorName: user.name, body: input.body, status: 'open' as const, messages: [], mentions: [], reviewRound: agreement.reviewRound, createdAt: isoNow(), resolvedAt: null }; agreement.documentComments.push(comment); agreement.updatedAt = isoNow(); await repository.saveAgreement(agreement); return context.json(agreement, 201);
  });

  app.patch('/v1/agreements/:agreementId/comments/:commentId', async (context) => {
    const input = UpdateDocumentCommentSchema.parse(await context.req.json()); const user = currentUser(context); const agreement = await requiredAgreement(repository, user.tenantId, context.req.param('agreementId')); const comment = agreement.documentComments.find((item) => item.id === context.req.param('commentId'));
    if (!comment || comment.status !== 'open') throw new Error('Editable comment not found.'); assertDraftOwner(agreement, comment.reviewRound, comment.authorId, user.id, 'sender'); comment.body = input.body; comment.mentions = []; agreement.updatedAt = isoNow(); await repository.saveAgreement(agreement); return context.json(agreement);
  });

  app.delete('/v1/agreements/:agreementId/comments/:commentId', async (context) => {
    const user = currentUser(context); const agreement = await requiredAgreement(repository, user.tenantId, context.req.param('agreementId')); const index = agreement.documentComments.findIndex((item) => item.id === context.req.param('commentId')); const comment = agreement.documentComments[index];
    if (!comment || comment.status !== 'open') throw new Error('Removable comment not found.'); assertDraftOwner(agreement, comment.reviewRound, comment.authorId, user.id, 'sender'); agreement.documentComments.splice(index, 1); agreement.updatedAt = isoNow(); await repository.saveAgreement(agreement); return context.json(agreement);
  });

  app.post('/v1/agreements/:agreementId/suggestions/:suggestionId/messages', async (context) => {
    const input = AddThreadMessageSchema.parse(await context.req.json()); const user = currentUser(context); const agreement = await requiredAgreement(repository, user.tenantId, context.req.param('agreementId')); const suggestion = agreement.suggestions.find((item) => item.id === context.req.param('suggestionId'));
    if (!suggestion) throw new Error('Redline thread not found.'); assertActiveReviewSide(agreement, 'sender'); suggestion.messages.push({ id: `msg_${randomUUID()}`, authorId: user.id, authorName: user.name, body: input.body, mentions: [], createdAt: isoNow() }); agreement.updatedAt = isoNow(); await repository.saveAgreement(agreement); return context.json(agreement);
  });

  app.post('/v1/agreements/:agreementId/suggestions/:suggestionId/resolve', async (context) => {
    const input = ResolveSuggestionSchema.parse(await context.req.json());
    const agreement = await requiredAgreement(repository, currentUser(context).tenantId, context.req.param('agreementId'));
    if (agreement.status !== 'in_review') throw new Error('Suggestions can only be resolved while an agreement is in review.');
    if (agreement.createdByParticipantId && agreement.reviewAssignedTo !== 'sender') throw new Error('Wait for the counterparty to return its review before resolving redlines.');
    const suggestion = agreement.suggestions.find((item) => item.id === context.req.param('suggestionId'));
    if (!suggestion) return context.json({ error: 'not_found', message: 'Suggestion not found.' }, 404);
    resolveSuggestionDecision(agreement, suggestion, input.resolution);
    await repository.saveAgreement(agreement);
    void emitAgreementEvent(repository, 'agreement.suggestion.resolved', agreement);
    return context.json(agreement);
  });

  app.post('/v1/agreements/:agreementId/comments/:commentId/resolve', async (context) => {
    const agreement = await requiredAgreement(repository, currentUser(context).tenantId, context.req.param('agreementId')); const comment = agreement.documentComments.find((item) => item.id === context.req.param('commentId'));
    if (!comment) throw new Error('Document comment not found.'); if (agreement.reviewAssignedTo !== 'sender') throw new Error('Wait for the review to return before resolving feedback.'); comment.status = 'resolved'; comment.resolvedAt = isoNow(); agreement.updatedAt = isoNow(); await repository.saveAgreement(agreement); return context.json(agreement);
  });

  app.post('/v1/agreements/:agreementId/send-for-signature', async (context) => {
    const agreement = await requiredAgreement(repository, currentUser(context).tenantId, context.req.param('agreementId'));
    if (['draft', 'in_review'].includes(agreement.status)) openSigningRevision(agreement);
    else if (!['out_for_signature', 'partially_signed'].includes(agreement.status)) throw new Error('This agreement cannot request signatures in its current state.');
    agreement.signatureNotificationsSentAt = isoNow();
    await repository.saveAgreement(agreement);
    await notifyParticipants(repository, agreement, { type: 'signature.requested', actorName: currentUser(context).name, actorParticipantId: agreement.createdByParticipantId ?? undefined, recipientParticipantIds: unsignedSignatoryRecipients(agreement, agreement.createdByParticipantId ?? undefined), title: `Signature requested: ${agreement.title}`, body: 'Review is complete. The final revision is ready for signature; required signatories may sign in any order.' });
    void emitAgreementEvent(repository, 'agreement.ready_for_signature', agreement);
    return context.json(agreement);
  });

  app.post('/v1/agreements/:agreementId/prepare-for-signature', async (context) => {
    const agreement = await requiredAgreement(repository, currentUser(context).tenantId, context.req.param('agreementId')); openSigningRevision(agreement); await repository.saveAgreement(agreement); return context.json(agreement);
  });

  app.post('/v1/agreements/:agreementId/parties/:partyId/accept-entity', async (context) => {
    const agreement = await requiredAgreement(repository, currentUser(context).tenantId, context.req.param('agreementId'));
    const party = agreement.parties.find((item) => item.id === context.req.param('partyId'));
    if (!party?.entity.proposedDetails) throw new Error('There are no proposed entity details to accept.');
    Object.assign(party.entity, party.entity.proposedDetails);
    party.entity.proposedDetails = null; party.entity.verificationStatus = 'confirmed'; agreement.updatedAt = isoNow(); materializePartyVariables(agreement);
    await repository.saveAgreement(agreement); return context.json(agreement);
  });

  app.post('/v1/agreements/:agreementId/sign', async (context) => {
    const input = SignAgreementSchema.parse(await context.req.json());
    const agreement = await requiredAgreement(repository, currentUser(context).tenantId, context.req.param('agreementId'));
    if (!['out_for_signature', 'partially_signed'].includes(agreement.status)) throw new Error('This agreement is not open for signature.');
    const participant = agreement.participants.find((item) => (input.participantId ? item.id === input.participantId : item.externalSubjectId === input.externalSubjectId) && item.role === 'signatory');
    if (!participant) throw new Error('The subject is not a signatory on this agreement.');
    if (agreement.createdByParticipantId && participant.id !== agreement.createdByParticipantId) throw new Error('Only the agreement creator may sign from the owner workspace.');
    if (participant.status === 'signed') throw new Error('This participant has already signed.');
    participant.status = 'signed';
    participant.signedAt = isoNow();
    participant.signature = { ...(input.signature ?? { method: 'typed' as const, typedName: participant.name, imageDataUrl: null }), signedContentSha256: agreement.contentSha256, signedAt: participant.signedAt };
    agreement.updatedAt = isoNow();
    if (isExecutionComplete(agreement)) {
      transition(agreement, 'executed');
      agreement.executedAt = isoNow();
      agreement.parties.forEach((party) => { party.status = 'executed'; });
    } else if (agreement.status === 'out_for_signature') {
      if (participant.partyId && isPartySignatureComplete(agreement, participant.partyId)) agreement.parties.find((party) => party.id === participant.partyId)!.status = 'executed';
      transition(agreement, 'partially_signed');
    }
    const releaseSignatureRequests = agreement.status !== 'executed' && !agreement.signatureNotificationsSentAt; if (releaseSignatureRequests) agreement.signatureNotificationsSentAt = isoNow();
    await repository.saveAgreement(agreement);
    await notifyParticipants(repository, agreement, { type: agreement.status === 'executed' ? 'agreement.executed' : releaseSignatureRequests ? 'signature.requested' : 'signature.completed', actorName: participant.name, actorParticipantId: participant.id, recipientParticipantIds: agreement.status === 'executed' ? agreement.participants.map((item) => item.id) : unsignedSignatoryRecipients(agreement, participant.id), title: agreement.status === 'executed' ? `Agreement executed: ${agreement.title}` : releaseSignatureRequests ? `Signature requested: ${agreement.title}` : `${participant.name} signed ${agreement.title}`, body: agreement.status === 'executed' ? 'Every required signature has been collected.' : releaseSignatureRequests ? `${participant.name} signed the final revision. Your signature is now requested.` : 'Their signature is complete. Other required signatories may sign now.' });
    void emitAgreementEvent(repository, agreement.status === 'executed' ? 'agreement.executed' : 'agreement.partially_signed', agreement);
    return context.json(agreement);
  });

  app.get('/v1/notifications', async (context) => {
    const user = currentUser(context); const person = await repository.findPersonByEmail(user.tenantId, user.email);
    return context.json(person ? await repository.listNotifications(user.tenantId, person.id) : []);
  });

  app.post('/v1/notifications/:notificationId/read', async (context) => {
    const user = currentUser(context); const person = await repository.findPersonByEmail(user.tenantId, user.email); if (!person) throw new Error('Person record not found.');
    const notification = (await repository.listNotifications(user.tenantId, person.id)).find((item) => item.id === context.req.param('notificationId')); if (!notification) throw new Error('Notification not found.'); notification.readAt = isoNow(); await repository.saveNotification(notification); return context.json(notification);
  });

  app.post('/v1/notifications/read-all', async (context) => {
    const user = currentUser(context); const person = await repository.findPersonByEmail(user.tenantId, user.email); if (!person) return context.json({ updated: 0 }); const notifications = await repository.listNotifications(user.tenantId, person.id); const unread = notifications.filter((item) => !item.readAt); await Promise.all(unread.map(async (item) => { item.readAt = isoNow(); await repository.saveNotification(item); })); return context.json({ updated: unread.length });
  });

  app.get('/v1/integrations', async (context) => context.json(await repository.listIntegrations(currentUser(context).tenantId)));
  app.post('/v1/integrations', async (context) => {
    const input = CreateIntegrationSchema.parse(await context.req.json());
    return context.json(await repository.createIntegration(currentUser(context).tenantId, input), 201);
  });

  app.post('/v1/integration-sessions', async (context) => {
    const input = CreateIntegrationSessionSchema.parse(await context.req.json()); const user = currentUser(context);
    const integration = await repository.findIntegration(user.tenantId, input.integrationKey);
    if (!integration) throw new Error('Integration not found.');
    if (!integration.allowedRedirectUris.includes(input.returnUrl)) throw new Error('returnUrl is not allow-listed for this integration.');
    let link = await repository.findIdentityLink(user.tenantId, integration.id, input.subject);
    if (link && link.email.toLowerCase() !== input.email.toLowerCase()) throw new Error('This subject is already linked to a different email address.');
    if (!link) {
      const person = await repository.findPersonByEmail(user.tenantId, input.email) ?? await repository.createPerson(user.tenantId, input.email, input.displayName ?? input.email.split('@')[0]!);
      link = IdentityLinkSchema.parse({ id: `link_${randomUUID()}`, tenantId: user.tenantId, integrationId: integration.id, externalSubject: input.subject, personId: person.id, email: input.email.toLowerCase(), linkingMethod: integration.mappingStrategy, verifiedAt: isoNow() });
      await repository.createIdentityLink(link);
    }
    const agreement = await repository.createAgreement(user.tenantId, { title: input.title ?? `${input.templateKey} agreement`, templateKey: input.templateKey, participants: [], parties: [{ role: 'counterparty', entity: {}, minimumSignatures: 1, participants: [{ email: input.email, name: input.displayName, role: 'signatory', required: true }] }], metadata: input.metadata });
    const participant = agreement.participants[0]!; participant.personId = link.personId;
    agreement.integrationContext = { integrationId: integration.id, integrationKey: integration.key, externalSubject: input.subject, personId: link.personId, returnUrl: input.returnUrl };
    transition(agreement, 'in_review'); await repository.saveAgreement(agreement);
    const { token, tokenHash } = createInvitationToken();
    const handoff = IntegrationSessionSchema.parse({ id: `isess_${randomUUID()}`, tenantId: user.tenantId, integrationId: integration.id, personId: link.personId, externalSubject: input.subject, agreementId: agreement.id, participantId: participant.id, tokenHash, status: 'pending', returnUrl: input.returnUrl, expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), createdAt: isoNow(), acceptedAt: null });
    await repository.createIntegrationSession(handoff);
    return context.json({ agreementId: agreement.id, expiresAt: handoff.expiresAt, handoffUrl: `${config.WEB_URL}/invite?integrationToken=${encodeURIComponent(token)}` }, 201);
  });

  app.get('/v1/integration-status', async (context) => {
    const user = currentUser(context); const integrationKey = context.req.query('integrationKey'); const subject = context.req.query('subject'); const templateKey = context.req.query('templateKey'); const minimumVersion = Number(context.req.query('minimumVersion') ?? '1');
    if (!integrationKey || !subject || !templateKey || !Number.isInteger(minimumVersion) || minimumVersion < 1) return context.json({ error: 'invalid_query', message: 'integrationKey, subject and templateKey are required.' }, 400);
    const integration = await repository.findIntegration(user.tenantId, integrationKey); if (!integration) return context.json({ satisfied: false, templateKey, minimumVersion });
    const link = await repository.findIdentityLink(user.tenantId, integration.id, subject); if (!link) return context.json({ satisfied: false, templateKey, minimumVersion });
    return context.json(requirementResultByPerson(await repository.listAgreements(user.tenantId), link.personId, templateKey, minimumVersion));
  });

  app.get('/v1/agreement-status', async (context) => {
    const externalSubjectId = context.req.query('externalSubjectId');
    const templateKey = context.req.query('templateKey');
    const minimumVersion = Number(context.req.query('minimumVersion') ?? '1');
    if (!externalSubjectId || !templateKey || !Number.isInteger(minimumVersion) || minimumVersion < 1) {
      return context.json({ error: 'invalid_query', message: 'externalSubjectId, templateKey and a valid minimumVersion are required.' }, 400);
    }
    const agreements = await repository.listAgreements(currentUser(context).tenantId);
    return context.json(requirementResult(agreements, externalSubjectId, templateKey, minimumVersion));
  });

  app.post('/v1/agreement-status/evaluate', async (context) => {
    const input = EvaluateAgreementStatusSchema.parse(await context.req.json());
    const agreements = await repository.listAgreements(currentUser(context).tenantId);
    const requirements = input.requirements.map((requirement) => requirementResult(
      agreements, input.externalSubjectId, requirement.templateKey, requirement.minimumVersion,
    ));
    return context.json({
      externalSubjectId: input.externalSubjectId,
      operator: input.operator,
      satisfied: input.operator === 'all' ? requirements.every((item) => item.satisfied) : requirements.some((item) => item.satisfied),
      requirements,
    });
  });

  app.get('/v1/webhooks', async (context) => context.json(await repository.listWebhooks(currentUser(context).tenantId)));
  app.post('/v1/webhooks', async (context) => {
    const input = CreateWebhookSchema.parse(await context.req.json());
    return context.json(await repository.createWebhook(currentUser(context).tenantId, input.url, input.events), 201);
  });

  app.onError((error, context) => {
    if (error instanceof ZodError) {
      return context.json({ error: 'validation_error', message: 'The request did not match the API contract.', issues: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) }, 400);
    }
    console.error(error);
    return context.json({ error: 'request_failed', message: error instanceof Error ? error.message : 'Unexpected error.' }, 409);
  });

  return app;
}

export async function migrateTenantAgreements(repository: Repository, tenantId: string): Promise<number> {
  const agreements = await repository.listAgreements(tenantId); let updated = 0;
  for (const agreement of agreements) if (materializePartyVariables(agreement)) { await repository.saveAgreement(agreement); updated++; }
  return updated;
}

async function requiredAgreement(repository: Repository, tenantId: string, id: string): Promise<Agreement> {
  const agreement = await repository.getAgreement(tenantId, id);
  if (!agreement) throw new Error('Agreement not found.');
  const parsed = AgreementSchema.parse(agreement); materializePartyVariables(parsed); return parsed;
}

function requirementResult(agreements: Agreement[], externalSubjectId: string, templateKey: string, minimumVersion: number) {
  const candidates = agreements
    .filter((agreement) => agreement.templateKey === templateKey && agreement.templateVersion >= minimumVersion && agreement.participants.some((participant) => participant.externalSubjectId === externalSubjectId))
    .sort((a, b) => b.templateVersion - a.templateVersion || b.updatedAt.localeCompare(a.updatedAt));
  const executed = candidates.find((agreement) => agreement.status === 'executed');
  const agreement = executed ?? candidates[0];
  return {
    templateKey, minimumVersion, satisfied: Boolean(executed),
    ...(agreement ? { status: agreement.status, agreementId: agreement.id, templateVersion: agreement.templateVersion, executedAt: agreement.executedAt } : {}),
  };
}

function requirementResultByPerson(agreements: Agreement[], personId: string, templateKey: string, minimumVersion: number) {
  const candidates = agreements.filter((agreement) => agreement.templateKey === templateKey && agreement.templateVersion >= minimumVersion && agreement.participants.some((participant) => participant.personId === personId)).sort((a, b) => b.templateVersion - a.templateVersion || b.updatedAt.localeCompare(a.updatedAt));
  const executed = candidates.find((agreement) => agreement.status === 'executed'); const agreement = executed ?? candidates[0];
  return { templateKey, minimumVersion, satisfied: Boolean(executed), ...(agreement ? { status: agreement.status, agreementId: agreement.id, templateVersion: agreement.templateVersion, executedAt: agreement.executedAt } : {}) };
}

async function createAndSendInvitation(repository: Repository, agreement: Agreement, participantId: string, inviterName: string) {
  const participant = agreement.participants.find((item) => item.id === participantId);
  if (!participant) throw new Error('Participant not found.');
  const previousInvitations = await repository.listInvitations(agreement.tenantId, agreement.id);
  await Promise.all(previousInvitations.filter((item) => item.participantId === participantId && item.status === 'pending').map(async (item) => {
    item.status = 'revoked'; await repository.saveInvitation(item);
  }));
  const { token, tokenHash } = createInvitationToken();
  const invitation = InvitationSchema.parse({
    id: `inv_${randomUUID()}`, tenantId: agreement.tenantId, agreementId: agreement.id, participantId,
    email: participant.email, tokenHash, status: 'pending', createdAt: isoNow(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), acceptedAt: null,
  });
  await repository.createInvitation(invitation);
  if (participant.status === 'not_invited' || participant.status === 'invited') participant.status = 'invited'; agreement.updatedAt = isoNow(); await repository.saveAgreement(agreement);
  const invitationUrl = `${config.WEB_URL}/invite?token=${encodeURIComponent(token)}`;
  await sendInvitationEmail({ email: participant.email, name: participant.name, agreementTitle: agreement.title, inviterName, invitationUrl });
  return { ...publicInvitation(invitation), invitationUrl };
}

function publicInvitation(invitation: import('@bytecrunch/contracts-domain').Invitation) {
  const { tokenHash: _, ...safe } = invitation;
  return safe;
}

async function externalView(repository: Repository, session: { tenantId: string; agreementId: string; participantId: string }) {
  const agreement = await requiredAgreement(repository, session.tenantId, session.agreementId);
  const participant = agreement.participants.find((item) => item.id === session.participantId);
  if (!participant) throw new Error('Participant not found.');
  const party = agreement.parties.find((item) => item.id === participant.partyId) ?? null;
  return { agreement, participant, party };
}
