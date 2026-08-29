import { z } from 'zod';

export const AgreementStatusSchema = z.enum([
  'draft',
  'in_review',
  'ready_for_signature',
  'out_for_signature',
  'partially_signed',
  'executed',
  'declined',
  'voided',
  'expired',
]);
export type AgreementStatus = z.infer<typeof AgreementStatusSchema>;

export const SuggestionStatusSchema = z.enum(['open', 'accepted', 'rejected', 'countered']);
export const ParticipantRoleSchema = z.enum(['owner', 'reviewer', 'signatory']);
export const ParticipantStatusSchema = z.enum(['not_invited', 'invited', 'reviewed', 'signed', 'declined']);
export const PartyRoleSchema = z.enum(['sender', 'counterparty']);
export const PartyStatusSchema = z.enum(['invited', 'onboarding', 'reviewing', 'ready', 'signing', 'executed']);
export const SigningCapacitySchema = z.enum(['authorized_representative', 'director', 'officer', 'personally', 'other']);
export const ParticipantPermissionSchema = z.enum(['read', 'comment', 'suggest', 'sign', 'nominate_signatory']);
export const EntityVerificationStatusSchema = z.enum(['unconfirmed', 'confirmed', 'change_pending']);
export const ReviewAssigneeSchema = z.enum(['sender', 'counterparty']);
export const MentionSchema = z.object({ participantId: z.string().min(1), displayName: z.string().min(1).max(160) });
export type Mention = z.infer<typeof MentionSchema>;
export const SignatureInputSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('typed'), typedName: z.string().min(2).max(160), imageDataUrl: z.null().default(null) }),
  z.object({ method: z.literal('drawn'), typedName: z.string().min(2).max(160), imageDataUrl: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/).max(300_000) }),
]);
export type SignatureInput = z.infer<typeof SignatureInputSchema>;
export const SignatureRecordSchema = z.object({
  method: z.enum(['typed', 'drawn']), typedName: z.string().min(2).max(160), imageDataUrl: z.string().nullable(),
  signedContentSha256: z.string().length(64), signedAt: z.string().datetime(),
});
export type SignatureRecord = z.infer<typeof SignatureRecordSchema>;
export const InvalidatedSignatureSchema = z.object({
  participantId: z.string().min(1), participantName: z.string().min(1).max(160), signature: SignatureRecordSchema,
  invalidatedAt: z.string().datetime(), invalidatedByParticipantId: z.string().min(1), reason: z.literal('review_reopened'),
});
export type InvalidatedSignature = z.infer<typeof InvalidatedSignatureSchema>;

export const ThreadMessageSchema = z.object({
  id: z.string().min(1), authorId: z.string().min(1), authorName: z.string().min(1).max(160),
  body: z.string().min(1).max(4000), createdAt: z.string().datetime(),
  mentions: z.array(MentionSchema).default([]),
});
export type ThreadMessage = z.infer<typeof ThreadMessageSchema>;

export const LegalEntitySchema = z.object({
  id: z.string().min(1),
  externalId: z.string().max(255).nullable(),
  legalName: z.string().min(1).max(240).nullable(),
  businessAddress: z.string().min(1).max(500).nullable().default(null),
  registrationNumber: z.string().max(100).nullable(),
  jurisdiction: z.string().max(100).nullable(),
  verificationStatus: EntityVerificationStatusSchema.default('unconfirmed'),
  proposedDetails: z.object({
    legalName: z.string().min(1).max(240),
    businessAddress: z.string().min(1).max(500).nullable().default(null),
    registrationNumber: z.string().max(100).nullable(),
    jurisdiction: z.string().max(100).nullable(),
  }).nullable().default(null),
});
export type LegalEntity = z.infer<typeof LegalEntitySchema>;

// A customer entity is both the tenant/security boundary and the legal person
// whose templates and agreements are being managed. ByteCrunch operates the
// platform; it is not a parent workspace for customer entities.
export const EntityRoleSchema = z.enum(['administrator', 'template_manager', 'contract_manager', 'signatory', 'viewer']);
export type EntityRole = z.infer<typeof EntityRoleSchema>;
export const EntityPermissionSchema = z.enum([
  'entity.manage', 'members.manage', 'templates.read', 'templates.write',
  'agreements.read', 'agreements.write', 'agreements.sign',
]);
export type EntityPermission = z.infer<typeof EntityPermissionSchema>;
export const CustomerEntitySchema = z.object({
  id: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  legalName: z.string().min(1).max(240),
  businessAddress: z.string().max(500).nullable().default(null),
  registrationNumber: z.string().max(100).nullable().default(null),
  jurisdiction: z.string().max(100).nullable().default(null),
  createdAt: z.string().datetime(),
});
export type CustomerEntity = z.infer<typeof CustomerEntitySchema>;
export const CreateCustomerEntitySchema = CustomerEntitySchema.pick({
  slug: true, legalName: true, businessAddress: true, registrationNumber: true, jurisdiction: true,
}).partial({ businessAddress: true, registrationNumber: true, jurisdiction: true });

export const AccountSchema = z.object({
  id: z.string().min(1), email: z.string().email(), displayName: z.string().min(1).max(160), createdAt: z.string().datetime(),
});
export type Account = z.infer<typeof AccountSchema>;
export const AuthIdentitySchema = z.object({
  id: z.string().min(1), accountId: z.string().min(1), provider: z.enum(['dev', 'oidc', 'email']),
  issuer: z.string().min(1), subject: z.string().min(1), emailVerified: z.boolean(), createdAt: z.string().datetime(),
});
export type AuthIdentity = z.infer<typeof AuthIdentitySchema>;
export const EntityMembershipSchema = z.object({
  id: z.string().min(1), accountId: z.string().min(1), entityId: z.string().min(1),
  roles: z.array(EntityRoleSchema).min(1), permissions: z.array(EntityPermissionSchema),
  status: z.enum(['invited', 'active', 'suspended']), createdAt: z.string().datetime(),
});
export type EntityMembership = z.infer<typeof EntityMembershipSchema>;
export const EntityMembershipViewSchema = EntityMembershipSchema.extend({ entity: CustomerEntitySchema });
export type EntityMembershipView = z.infer<typeof EntityMembershipViewSchema>;
export const EntityMemberViewSchema = z.object({ membership: EntityMembershipSchema, account: AccountSchema });
export type EntityMemberView = z.infer<typeof EntityMemberViewSchema>;
export const InviteEntityMemberSchema = z.object({ email: z.string().email(), roles: z.array(EntityRoleSchema).min(1) });
export const UpdateEntityMemberSchema = z.object({ roles: z.array(EntityRoleSchema).min(1) });
export const EntityMemberInvitationSchema = z.object({
  id: z.string().min(1), entityId: z.string().min(1), email: z.string().email(), roles: z.array(EntityRoleSchema).min(1),
  tokenHash: z.string().length(64), status: z.enum(['pending', 'accepted', 'revoked', 'expired']),
  invitedByAccountId: z.string().min(1), acceptedByAccountId: z.string().min(1).nullable(),
  expiresAt: z.string().datetime(), createdAt: z.string().datetime(), acceptedAt: z.string().datetime().nullable(),
});
export type EntityMemberInvitation = z.infer<typeof EntityMemberInvitationSchema>;

export const AgreementAccessSchema = z.object({
  id: z.string().min(1), tenantId: z.string().min(1), agreementId: z.string().min(1),
  participantId: z.string().min(1), accountId: z.string().min(1), status: z.enum(['active', 'revoked']),
  grantedAt: z.string().datetime(), lastAccessedAt: z.string().datetime().nullable().default(null),
});
export type AgreementAccess = z.infer<typeof AgreementAccessSchema>;
export const AccessChallengeSchema = z.object({
  id: z.string().min(1), accountId: z.string().min(1), agreementAccessId: z.string().min(1),
  tokenHash: z.string().length(64), status: z.enum(['pending', 'accepted', 'expired']),
  expiresAt: z.string().datetime(), createdAt: z.string().datetime(), acceptedAt: z.string().datetime().nullable(),
});
export type AccessChallenge = z.infer<typeof AccessChallengeSchema>;
export const RecipientLoginChallengeSchema = z.object({
  id: z.string().min(1), accountId: z.string().min(1).nullable(), email: z.string().email(), codeHash: z.string().length(64),
  status: z.enum(['pending', 'accepted', 'expired', 'locked']), attempts: z.number().int().nonnegative().max(5),
  expiresAt: z.string().datetime(), createdAt: z.string().datetime(), acceptedAt: z.string().datetime().nullable(),
});
export type RecipientLoginChallenge = z.infer<typeof RecipientLoginChallengeSchema>;
export const RecipientInboxItemSchema = z.object({
  accessId: z.string().min(1), tenantId: z.string().min(1), entityName: z.string().min(1), agreementId: z.string().min(1),
  title: z.string().min(1), agreementStatus: AgreementStatusSchema, participantId: z.string().min(1), participantName: z.string().min(1),
  participantRole: ParticipantRoleSchema, participantStatus: ParticipantStatusSchema, action: z.enum(['review', 'sign', 'waiting', 'complete']),
  updatedAt: z.string().datetime(),
});
export type RecipientInboxItem = z.infer<typeof RecipientInboxItemSchema>;

export const AgreementPartySchema = z.object({
  id: z.string().min(1),
  role: PartyRoleSchema,
  entity: LegalEntitySchema,
  status: PartyStatusSchema,
  minimumSignatures: z.number().int().nonnegative(),
});
export type AgreementParty = z.infer<typeof AgreementPartySchema>;

export const TemplateSchema = z.object({
  id: z.string().min(1),
  key: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1).max(160),
  version: z.number().int().positive(),
  description: z.string().max(500).default(''),
  content: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type Template = z.infer<typeof TemplateSchema>;

export const ParticipantSchema = z.object({
  id: z.string().min(1),
  personId: z.string().min(1).nullable().default(null),
  externalSubjectId: z.string().min(1).max(255).nullable().default(null),
  email: z.string().email(),
  name: z.string().min(1).max(160),
  role: ParticipantRoleSchema,
  required: z.boolean(),
  status: ParticipantStatusSchema,
  signedAt: z.string().datetime().nullable(),
  signature: SignatureRecordSchema.nullable().default(null),
  partyId: z.string().nullable().default(null),
  title: z.string().max(160).nullable().default(null),
  capacity: SigningCapacitySchema.nullable().default(null),
  authorityConfirmed: z.boolean().default(false),
  onboardingCompletedAt: z.string().datetime().nullable().default(null),
  permissions: z.array(ParticipantPermissionSchema).default(['read']),
});
export type Participant = z.infer<typeof ParticipantSchema>;

export const PersonSchema = z.object({
  id: z.string().min(1), tenantId: z.string().min(1), email: z.string().email(),
  displayName: z.string().min(1).max(160), createdAt: z.string().datetime(),
});
export type Person = z.infer<typeof PersonSchema>;

export const IntegrationSchema = z.object({
  id: z.string().min(1), tenantId: z.string().min(1), key: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1).max(160), mappingStrategy: z.enum(['host_asserted', 'shared_oidc', 'account_linking']),
  allowedRedirectUris: z.array(z.string().url()), allowedOrigins: z.array(z.string().url()).default([]), createdAt: z.string().datetime(),
});
export type Integration = z.infer<typeof IntegrationSchema>;
export const CreateIntegrationSchema = IntegrationSchema.pick({ name: true, key: true, mappingStrategy: true, allowedRedirectUris: true, allowedOrigins: true });

export const IdentityLinkSchema = z.object({
  id: z.string().min(1), tenantId: z.string().min(1), integrationId: z.string().min(1), externalSubject: z.string().min(1).max(255),
  personId: z.string().min(1), email: z.string().email(), linkingMethod: z.enum(['host_asserted', 'shared_oidc', 'account_linking']), verifiedAt: z.string().datetime(),
});
export type IdentityLink = z.infer<typeof IdentityLinkSchema>;

export const IntegrationSessionSchema = z.object({
  id: z.string().min(1), tenantId: z.string().min(1), integrationId: z.string().min(1), personId: z.string().min(1),
  externalSubject: z.string().min(1).max(255), agreementId: z.string().min(1), participantId: z.string().min(1), tokenHash: z.string().length(64),
  status: z.enum(['pending', 'accepted', 'expired']), returnUrl: z.string().url(), expiresAt: z.string().datetime(), createdAt: z.string().datetime(), acceptedAt: z.string().datetime().nullable(),
});
export type IntegrationSession = z.infer<typeof IntegrationSessionSchema>;

export const CreateIntegrationSessionSchema = z.object({
  integrationKey: z.string().min(1), subject: z.string().min(1).max(255), email: z.string().email(), displayName: z.string().min(1).max(160).optional(),
  templateKey: z.string().min(1), title: z.string().min(1).max(200).optional(), returnUrl: z.string().url(), metadata: z.record(z.string(), z.string()).default({}),
});

export const SuggestionSchema = z.object({
  id: z.string().min(1),
  agreementId: z.string().min(1),
  authorSubjectId: z.string().min(1),
  originalText: z.string(),
  replacementText: z.string(),
  comment: z.string().max(2000).default(''),
  anchor: z.object({
    start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), revision: z.number().int().positive(),
    prefix: z.string().max(80), suffix: z.string().max(80),
  }).nullable().default(null),
  messages: z.array(ThreadMessageSchema).default([]),
  mentions: z.array(MentionSchema).default([]),
  reviewRound: z.number().int().nonnegative().default(0),
  inResponseToSuggestionIds: z.array(z.string().min(1)).default([]),
  counteredBySuggestionId: z.string().min(1).nullable().default(null),
  status: SuggestionStatusSchema,
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
});
export type Suggestion = z.infer<typeof SuggestionSchema>;

export const DocumentCommentSchema = z.object({
  id: z.string().min(1), authorId: z.string().min(1), authorName: z.string().min(1).max(160),
  body: z.string().min(1).max(4000), status: z.enum(['open', 'resolved']), messages: z.array(ThreadMessageSchema).default([]),
  createdAt: z.string().datetime(), resolvedAt: z.string().datetime().nullable(),
  mentions: z.array(MentionSchema).default([]),
  reviewRound: z.number().int().nonnegative().default(0),
});
export type DocumentComment = z.infer<typeof DocumentCommentSchema>;

export const ReviewTurnSchema = z.object({
  round: z.number().int().positive(), assignedTo: ReviewAssigneeSchema, sentBy: z.string().min(1),
  message: z.string().max(2000).default(''), sentAt: z.string().datetime(), returnedAt: z.string().datetime().nullable(),
});

export const AgreementSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  externalId: z.string().max(255).nullable(),
  title: z.string().min(1).max(200),
  templateKey: z.string().min(1),
  templateVersion: z.number().int().positive(),
  status: AgreementStatusSchema,
  revision: z.number().int().positive(),
  content: z.string().min(1),
  contentSha256: z.string().length(64),
  participants: z.array(ParticipantSchema),
  parties: z.array(AgreementPartySchema).default([]),
  suggestions: z.array(SuggestionSchema),
  documentComments: z.array(DocumentCommentSchema).default([]),
  reviewRound: z.number().int().nonnegative().default(0),
  reviewAssignedTo: ReviewAssigneeSchema.nullable().default(null),
  reviewHistory: z.array(ReviewTurnSchema).default([]),
  createdByParticipantId: z.string().nullable().default(null),
  integrationContext: z.object({
    integrationId: z.string(), integrationKey: z.string(), externalSubject: z.string(), personId: z.string(), returnUrl: z.string().url(),
  }).nullable().default(null),
  metadata: z.record(z.string(), z.string()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  executedAt: z.string().datetime().nullable(),
  signatureNotificationsSentAt: z.string().datetime().nullable().default(null),
  invalidatedSignatures: z.array(InvalidatedSignatureSchema).default([]),
});
export type Agreement = z.infer<typeof AgreementSchema>;

export const CreateTemplateSchema = TemplateSchema.pick({
  key: true,
  name: true,
  description: true,
  content: true,
});
export type CreateTemplate = z.infer<typeof CreateTemplateSchema>;

export const CreateParticipantSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(160).optional(),
  role: ParticipantRoleSchema,
  required: z.boolean(),
  externalSubjectId: z.string().min(1).max(255).optional(),
  title: z.string().max(160).optional(),
  permissions: z.array(ParticipantPermissionSchema).optional(),
});

export const CreateLegalEntitySchema = z.object({
  externalId: z.string().max(255).optional(),
  legalName: z.string().min(1).max(240).optional(),
  businessAddress: z.string().min(1).max(500).optional(),
  registrationNumber: z.string().max(100).optional(),
  jurisdiction: z.string().max(100).optional(),
});

export const CreateAgreementPartySchema = z.object({
  role: PartyRoleSchema,
  entity: CreateLegalEntitySchema,
  minimumSignatures: z.number().int().nonnegative().default(1),
  participants: z.array(CreateParticipantSchema).min(1),
}).superRefine((party, context) => {
  const signerCount = party.participants.filter((participant) => participant.role === 'signatory').length;
  if (party.minimumSignatures > signerCount) context.addIssue({ code: 'custom', path: ['minimumSignatures'], message: 'Cannot require more signatures than there are signatories.' });
  const emails = party.participants.map((participant) => participant.email.toLowerCase());
  if (new Set(emails).size !== emails.length) context.addIssue({ code: 'custom', path: ['participants'], message: 'Each participant email must be unique within a party.' });
});

export const CreateAgreementSchema = z.object({
  title: z.string().min(1).max(200),
  templateKey: z.string().min(1),
  externalId: z.string().max(255).optional(),
  participants: z.array(CreateParticipantSchema).default([]),
  parties: z.array(CreateAgreementPartySchema).default([]),
  metadata: z.record(z.string(), z.string()).default({}),
}).refine((value) => value.participants.length > 0 || value.parties.length > 0, {
  message: 'At least one participant or legal party is required.',
});
export type CreateAgreement = z.infer<typeof CreateAgreementSchema>;

export const CreateSuggestionSchema = z.object({
  authorSubjectId: z.string().min(1),
  originalText: z.string(),
  replacementText: z.string(),
  comment: z.string().max(2000).default(''),
  anchor: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).optional(),
});
export type CreateSuggestion = z.infer<typeof CreateSuggestionSchema>;

export const ResolveSuggestionSchema = z.object({
  resolution: z.enum(['accepted', 'rejected']),
});

export const UpdateSuggestionSchema = z.object({
  replacementText: z.string(),
  comment: z.string().max(2000).default(''),
});

export const UpdateDocumentCommentSchema = z.object({ body: z.string().min(1).max(4000) });

export const AddThreadMessageSchema = z.object({ body: z.string().min(1).max(4000) });
export const CreateDocumentCommentSchema = AddThreadMessageSchema;
export const SendReviewSchema = z.object({ message: z.string().max(2000).default('') });
export const UpdateReviewDraftSchema = z.object({ content: z.string().min(1).max(500_000) });
export const ReopenReviewSchema = z.object({ invalidateSignatures: z.literal(true), confirmation: z.literal('VOID_SIGNATURES_AND_REOPEN') });

export const NotificationTypeSchema = z.enum(['review.assigned', 'review.returned', 'redline.created', 'redline.replied', 'redline.resolved', 'comment.created', 'participant.mentioned', 'signature.requested', 'signature.completed', 'signature.invalidated', 'agreement.executed']);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;
export const NotificationSchema = z.object({
  id: z.string().min(1), tenantId: z.string().min(1), recipientPersonId: z.string().min(1), recipientEmail: z.string().email(),
  type: NotificationTypeSchema, title: z.string().min(1).max(240), body: z.string().max(2000), agreementId: z.string().min(1),
  threadId: z.string().nullable(), actorName: z.string().min(1).max(160), readAt: z.string().datetime().nullable(), createdAt: z.string().datetime(),
});
export type Notification = z.infer<typeof NotificationSchema>;
export const NotificationOutboxSchema = z.object({
  id: z.string().min(1), notificationId: z.string().min(1), recipientEmail: z.string().email(), subject: z.string().min(1), body: z.string().min(1),
  actionUrl: z.string().url(), status: z.enum(['pending', 'sending', 'delivered', 'failed']), attempts: z.number().int().nonnegative(),
  nextAttemptAt: z.string().datetime(), lastError: z.string().nullable(), createdAt: z.string().datetime(), deliveredAt: z.string().datetime().nullable(),
});
export type NotificationOutbox = z.infer<typeof NotificationOutboxSchema>;

export const SignAgreementSchema = z.object({
  participantId: z.string().min(1).optional(),
  externalSubjectId: z.string().min(1).optional(),
  intentConfirmed: z.literal(true),
  signature: SignatureInputSchema.optional(),
}).refine((value) => Boolean(value.participantId || value.externalSubjectId), { message: 'participantId is required.' });
export const ExternalSignAgreementSchema = z.object({ intentConfirmed: z.literal(true), signature: SignatureInputSchema.optional() });

export const OnboardParticipantSchema = z.object({
  name: z.string().min(1).max(160),
  title: z.string().min(1).max(160),
  capacity: SigningCapacitySchema,
  authorityConfirmed: z.boolean(),
  entity: z.object({
    legalName: z.string().min(1).max(240),
    businessAddress: z.string().min(1).max(500).optional(),
    registrationNumber: z.string().max(100).optional(),
    jurisdiction: z.string().max(100).optional(),
  }),
});

export const NominateSignatorySchema = z.object({
  name: z.string().min(1).max(160),
  email: z.string().email(),
  title: z.string().max(160).optional(),
});

export const InvitationStatusSchema = z.enum(['pending', 'accepted', 'revoked', 'expired']);
export const InvitationSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  agreementId: z.string().min(1),
  participantId: z.string().min(1),
  email: z.string().email(),
  tokenHash: z.string().length(64),
  status: InvitationStatusSchema,
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  acceptedAt: z.string().datetime().nullable(),
  acceptedByAccountId: z.string().min(1).nullable().default(null),
  recoverySentAt: z.string().datetime().nullable().default(null),
});
export type Invitation = z.infer<typeof InvitationSchema>;

export const AgreementRequirementSchema = z.object({
  templateKey: z.string().min(1),
  minimumVersion: z.number().int().positive().default(1),
});

export const EvaluateAgreementStatusSchema = z.object({
  externalSubjectId: z.string().min(1),
  requirements: z.array(AgreementRequirementSchema).min(1),
  operator: z.enum(['all', 'any']).default('all'),
});
export type EvaluateAgreementStatus = z.infer<typeof EvaluateAgreementStatusSchema>;

export const CreateWebhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.enum([
    'agreement.created',
    'agreement.sent_for_review',
    'agreement.suggestion.created',
    'agreement.suggestion.resolved',
    'agreement.ready_for_signature',
    'agreement.partially_signed',
    'agreement.executed',
    'agreement.declined',
    'agreement.voided',
  ])).min(1),
});

export function canTransition(from: AgreementStatus, to: AgreementStatus): boolean {
  const transitions: Record<AgreementStatus, AgreementStatus[]> = {
    draft: ['in_review', 'ready_for_signature', 'voided'],
    in_review: ['ready_for_signature', 'declined', 'voided'],
    ready_for_signature: ['out_for_signature', 'in_review', 'voided'],
    out_for_signature: ['partially_signed', 'executed', 'declined', 'voided', 'expired'],
    partially_signed: ['executed', 'in_review', 'declined', 'voided', 'expired'],
    executed: [],
    declined: [],
    voided: [],
    expired: [],
  };
  return transitions[from].includes(to);
}

export function assertReadyForSignature(agreement: Agreement, completingReviewSide: 'sender' | 'counterparty' = 'sender'): void {
  if (agreement.suggestions.some((suggestion) => suggestion.status === 'open')) {
    throw new Error('All suggestions must be resolved before signing can begin.');
  }
  if (agreement.documentComments.some((comment) => comment.status === 'open')) throw new Error('All document-level feedback must be resolved before signing can begin.');
  if (agreement.createdByParticipantId && agreement.status === 'in_review' && agreement.reviewAssignedTo !== completingReviewSide) throw new Error('The active reviewer must complete their review before signing can begin.');
  if (!agreement.participants.some((participant) => participant.role === 'signatory')) {
    throw new Error('At least one signatory is required.');
  }
  const unconfirmed = agreement.parties.find((party) => party.minimumSignatures > 0 && (!party.entity.legalName || party.entity.verificationStatus !== 'confirmed'));
  if (unconfirmed) throw new Error('Every signing entity must confirm its legal details before signing can begin.');
}

export function isExecutionComplete(agreement: Agreement): boolean {
  const partyRequirementsMet = agreement.parties.every((party) => {
    const signedForParty = agreement.participants.filter((participant) =>
      participant.partyId === party.id && participant.role === 'signatory' && participant.status === 'signed'
    ).length;
    return signedForParty >= party.minimumSignatures;
  });
  const unassignedRequirementsMet = agreement.participants
    .filter((participant) => participant.partyId === null && participant.role === 'signatory' && participant.required)
    .every((participant) => participant.status === 'signed');
  return partyRequirementsMet && unassignedRequirementsMet;
}

export function isPartySignatureComplete(agreement: Agreement, partyId: string): boolean {
  const party = agreement.parties.find((item) => item.id === partyId);
  if (!party) return false;
  return agreement.participants.filter((participant) => participant.partyId === partyId && participant.role === 'signatory' && participant.status === 'signed').length >= party.minimumSignatures;
}
