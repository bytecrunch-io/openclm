import "@typespec/http";
import "@typespec/openapi3";

using TypeSpec.Http;

@service(#{ title: "Bytecrunch Contracts API" })
@server("http://localhost:3001", "Local development")
namespace Bytecrunch.Contracts;

model ContractsOAuth2 is OAuth2Auth<[
  {
    type: OAuth2FlowType.clientCredentials;
    tokenUrl: "http://localhost:8080/realms/bytecrunch/protocol/openid-connect/token";
    scopes: [
      "agreements:read",
      "agreements:write",
      "templates:read",
      "templates:write",
      "webhooks:manage",
    ];
  }
]>;

enum AgreementStatus {
  draft,
  in_review,
  ready_for_signature,
  out_for_signature,
  partially_signed,
  executed,
  declined,
  voided,
  expired,
}

enum ParticipantRole { owner, reviewer, signatory }
enum ParticipantStatus { not_invited, invited, reviewed, signed, declined }
enum SuggestionStatus { open, accepted, rejected, countered }
enum RequirementOperator { all, any }
enum PartyRole { sender, counterparty }
enum PartyStatus { invited, onboarding, reviewing, ready, signing, executed }
enum SigningCapacity { authorized_representative, director, officer, personally, other }
enum ParticipantPermission { read, comment, suggest, sign, nominate_signatory }
enum EntityVerificationStatus { unconfirmed, confirmed, change_pending }
enum ReviewAssignee { sender, counterparty }

model ErrorResponse {
  error: string;
  message: string;
  issues?: string[];
}

model HealthResponse {
  status: "ok";
  version: string;
  storage: "memory" | "postgres";
}

model ReadinessResponse {
  status: "ready" | "not_ready";
  checks: {
    persistentStorage: boolean;
    storageReachable: boolean;
    artifactStorage: boolean;
    externalArtifactStorage: boolean;
    oidc: boolean;
    safeSigningConfiguration: boolean;
  };
}

model Template {
  id: string;
  key: string;
  name: string;
  version: int32;
  description: string;
  content: string;
  createdAt: utcDateTime;
}

model CreateTemplate {
  key: string;
  name: string;
  description?: string;
  content: string;
}

model Participant {
  id: string;
  personId: string | null;
  externalSubjectId: string | null;
  email: string;
  name: string;
  role: ParticipantRole;
  required: boolean;
  status: ParticipantStatus;
  signedAt: utcDateTime | null;
  signature: SignatureRecord | null;
  partyId: string | null;
  title: string | null;
  capacity: SigningCapacity | null;
  authorityConfirmed: boolean;
  onboardingCompletedAt: utcDateTime | null;
  permissions: ParticipantPermission[];
}

union SignatureInput {
  typed: { method: "typed"; typedName: string; imageDataUrl: null; },
  drawn: { method: "drawn"; typedName: string; imageDataUrl: string; },
}
model SignatureRecord {
  method: "typed" | "drawn";
  typedName: string;
  imageDataUrl: string | null;
  signedContentSha256: string;
  signedArtifactSha256: string | null;
  signingEnvelopeId: string | null;
  signedAt: utcDateTime;
  provider: "development_witness" | "platform_electronic_signature" | "external_provider";
  providerSignatureId: string | null;
  authenticationMethod: "development" | "oidc" | "invitation" | "email_code" | "passkey" | "integration_handoff";
  consentText: string;
  consentVersion: string;
}
model InvalidatedSignature { participantId: string; participantName: string; signature: SignatureRecord; invalidatedAt: utcDateTime; invalidatedByParticipantId: string; reason: "review_reopened"; }
model SigningEnvelope { id: string; revision: int32; contentSha256: string; signingArtifactId: string; signingArtifactSha256: string; status: "active" | "invalidated" | "executed"; frozenAt: utcDateTime; invalidatedAt: utcDateTime | null; }

model CreateParticipant {
  email: string;
  name?: string;
  role: ParticipantRole;
  required: boolean;
  title?: string;
  permissions?: ParticipantPermission[];
}

model LegalEntity {
  id: string;
  externalId: string | null;
  legalName: string | null;
  businessAddress: string | null;
  registrationNumber: string | null;
  jurisdiction: string | null;
  verificationStatus: EntityVerificationStatus;
  proposedDetails: EntityDetails | null;
}

model EntityDetails { legalName: string; businessAddress: string | null; registrationNumber: string | null; jurisdiction: string | null; }

model AgreementParty {
  id: string;
  role: PartyRole;
  entity: LegalEntity;
  status: PartyStatus;
  minimumSignatures: int32;
}

model CreateLegalEntity {
  externalId?: string;
  legalName?: string;
  businessAddress?: string;
  registrationNumber?: string;
  jurisdiction?: string;
}

model CreateAgreementParty {
  role: PartyRole;
  entity: CreateLegalEntity;
  minimumSignatures?: int32;
  participants: CreateParticipant[];
}

model Suggestion {
  id: string;
  agreementId: string;
  authorSubjectId: string;
  originalText: string;
  replacementText: string;
  comment: string;
  anchor: RedlineAnchor | null;
  messages: ThreadMessage[];
  mentions: Mention[];
  reviewRound: int32;
  inResponseToSuggestionIds: string[];
  counteredBySuggestionId: string | null;
  status: SuggestionStatus;
  createdAt: utcDateTime;
  resolvedAt: utcDateTime | null;
}
model RedlineAnchor { start: int32; end: int32; revision: int32; prefix: string; suffix: string; }
model ThreadMessage { id: string; authorId: string; authorName: string; body: string; mentions: Mention[]; createdAt: utcDateTime; }
model Mention { participantId: string; displayName: string; }
model DocumentComment { id: string; authorId: string; authorName: string; body: string; status: "open" | "resolved"; messages: ThreadMessage[]; mentions: Mention[]; reviewRound: int32; createdAt: utcDateTime; resolvedAt: utcDateTime | null; }
model ReviewTurn { round: int32; assignedTo: ReviewAssignee; sentBy: string; message: string; sentAt: utcDateTime; returnedAt: utcDateTime | null; }

model Agreement {
  id: string;
  tenantId: string;
  externalId: string | null;
  title: string;
  templateKey: string;
  templateVersion: int32;
  status: AgreementStatus;
  revision: int32;
  content: string;
  contentSha256: string;
  participants: Participant[];
  parties: AgreementParty[];
  suggestions: Suggestion[];
  documentComments: DocumentComment[];
  reviewRound: int32;
  reviewAssignedTo: ReviewAssignee | null;
  reviewHistory: ReviewTurn[];
  createdByParticipantId: string | null;
  integrationContext: IntegrationContext | null;
  metadata: Record<string>;
  createdAt: utcDateTime;
  updatedAt: utcDateTime;
  executedAt: utcDateTime | null;
  signatureNotificationsSentAt: utcDateTime | null;
  invalidatedSignatures: InvalidatedSignature[];
  signingEnvelope: SigningEnvelope | null;
  verificationCode: string | null;
}

model CreateAgreement {
  title: string;
  templateKey: string;
  externalId?: string;
  participants?: CreateParticipant[];
  parties?: CreateAgreementParty[];
  metadata?: Record<string>;
}

model CreateSuggestion {
  authorSubjectId: string;
  originalText: string;
  replacementText: string;
  comment?: string;
  anchor?: { start: int32; end: int32; };
}
model ExternalSuggestion {
  originalText: string;
  replacementText: string;
  comment?: string;
  anchor?: { start: int32; end: int32; };
}
model ThreadMessageInput { body: string; }
model UpdateSuggestion { replacementText: string; comment?: string; }
model UpdateDocumentComment { body: string; }
model SendReview { message?: string; }
model UpdateReviewDraft { content: string; }
model ReopenReview { invalidateSignatures: true; confirmation: "VOID_SIGNATURES_AND_REOPEN"; }

model ResolveSuggestion {
  resolution: "accepted" | "rejected";
}

model SignAgreement {
  participantId: string;
  intentConfirmed: true;
  signature?: SignatureInput;
}

enum AgreementConditionKind {
  subjectSigned: "subject_signed",
  agreementExecuted: "agreement_executed",
}

model AgreementCondition {
  kind: AgreementConditionKind;
  templateKey: string;
  minimumVersion?: int32;
}

model EvaluateConditions {
  integrationKey: string;
  subject: string;
  conditions: AgreementCondition[];
  operator?: RequirementOperator;
}

model ConditionResult {
  kind: AgreementConditionKind;
  templateKey: string;
  minimumVersion: int32;
  met: boolean;
  status?: AgreementStatus;
  agreementId?: string;
  templateVersion?: int32;
  signedAt?: utcDateTime | null;
  executedAt?: utcDateTime | null;
}

model ConditionEvaluation {
  integrationKey: string;
  subject: string;
  met: boolean;
  operator: RequirementOperator;
  evaluatedAt: utcDateTime;
  conditions: ConditionResult[];
}

model CreateWebhook {
  url: url;
  events: string[];
}

model WebhookEndpoint {
  id: string;
  url: url;
  events: string[];
  createdAt: utcDateTime;
}

model WebhookDelivery {
  id: string;
  tenantId: string;
  endpointId: string;
  eventId: string;
  eventType: string;
  url: url;
  payload: string;
  status: "pending" | "sending" | "delivered" | "failed" | "dead_letter";
  attempts: int32;
  nextAttemptAt: utcDateTime;
  responseStatus: int32 | null;
  lastError: string | null;
  createdAt: utcDateTime;
  deliveredAt: utcDateTime | null;
}

model AgreementAuditEvent {
  id: string;
  tenantId: string;
  agreementId: string;
  type: string;
  revision: int32;
  status: AgreementStatus;
  contentSha256: string;
  eventSha256: string;
  createdAt: utcDateTime;
}

model AgreementArtifact {
  id: string;
  tenantId: string;
  agreementId: string;
  kind: "signing_snapshot" | "signing_pdf" | "executed_pdf" | "completion_certificate" | "completion_manifest" | "validation_report";
  revision: int32;
  contentSha256: string;
  artifactSha256: string;
  mediaType: string;
  fileName: string;
  retentionUntil: utcDateTime | null;
  legalHold: boolean;
  createdAt: utcDateTime;
}

model ArtifactContentResponse {
  @header("content-type") contentType: string;
  @header("content-disposition") contentDisposition: string;
  @header("x-content-sha256") contentSha256: string;
  @body body: bytes;
}
model PublicVerification {
  schemaVersion: int32; status: "executed"; title: string; agreementId: string; revision: int32; executedAt: utcDateTime;
  contentSha256: string; parties: { role: PartyRole; legalName: string | null; }[];
  signers: { name: string; partyRole: PartyRole | null; signedAt: utcDateTime; }[];
  executedPdf: { sha256: string; downloadUrl: string; } | null;
  validation: Record<unknown> | null;
}

model Invitation {
  id: string;
  tenantId: string;
  agreementId: string;
  participantId: string;
  email: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: utcDateTime;
  createdAt: utcDateTime;
  acceptedAt: utcDateTime | null;
  acceptedByAccountId: string | null;
  recoverySentAt: utcDateTime | null;
  invitationUrl?: url;
}

model ExchangeInvitation { token: string; }
model ExchangeResult { accepted: true; }
model RecoveryRequired { accepted: false; verificationRequired: true; message: string; }
enum EntityRole { administrator, template_manager, contract_manager, signatory, viewer }
enum EntityPermission { entity_manage: "entity.manage", members_manage: "members.manage", templates_read: "templates.read", templates_write: "templates.write", agreements_read: "agreements.read", agreements_write: "agreements.write", agreements_sign: "agreements.sign" }
model EntityBranding { displayName: string | null; primaryColor: string; secondaryColor: string; logoDataUrl: string | null; markDataUrl: string | null; }
model CustomerEntity { id: string; slug: string; legalName: string; businessAddress: string | null; registrationNumber: string | null; jurisdiction: string | null; branding: EntityBranding; createdAt: utcDateTime; }
model CreateCustomerEntity { slug: string; legalName: string; businessAddress?: string; registrationNumber?: string; jurisdiction?: string; }
enum PluginKey { google_drive: "google-drive", enterprise_oidc: "enterprise-oidc" }
model PluginField { key: string; label: string; kind: "text" | "url" | "email" | "password" | "textarea" | "string_list"; required: boolean; secret: boolean; help: string; }
model PluginManifest { key: PluginKey; name: string; description: string; capability: "executed_agreement_export" | "identity_provider"; fields: PluginField[]; }
model PluginInstallation { id: string; entityId: string; pluginKey: PluginKey; status: "configured" | "enabled" | "disabled" | "error"; configuration: Record<unknown>; configuredSecretFields: string[]; lastCheckedAt: utcDateTime | null; lastError: string | null; createdAt: utcDateTime; updatedAt: utcDateTime; }
model ConfigurePluginInstallation { configuration: Record<unknown>; enabled?: boolean; }
model EntityMembershipRecord { id: string; accountId: string; entityId: string; roles: EntityRole[]; permissions: EntityPermission[]; status: "invited" | "active" | "suspended"; createdAt: utcDateTime; }
model EntityMembership is EntityMembershipRecord { entity: CustomerEntity; }
model CurrentAccount { id: string; email: string; name: string; activeEntityId: string | null; entities: EntityMembership[]; scopes: string[]; }
model EntityContext { @header("x-bytecrunch-entity-id") entityId?: string; }
model AccountSummary { id: string; email: string; displayName: string; createdAt: utcDateTime; }
model EntityMember { membership: EntityMembershipRecord; account: AccountSummary; }
model EntityMemberInvitation { id: string; entityId: string; email: string; roles: EntityRole[]; status: "pending" | "accepted" | "revoked" | "expired"; invitedByAccountId: string; acceptedByAccountId: string | null; expiresAt: utcDateTime; createdAt: utcDateTime; acceptedAt: utcDateTime | null; invitationUrl?: url; }
model EntityMemberList { members: EntityMember[]; invitations: EntityMemberInvitation[]; }
model InviteEntityMember { email: string; roles: EntityRole[]; }
model UpdateEntityMember { roles: EntityRole[]; }
model EntityMemberInvitationPreview { entityName: string; emailHint: string; roles: EntityRole[]; expiresAt: utcDateTime; }
model RecipientInboxItem { accessId: string; tenantId: string; entityName: string; agreementId: string; title: string; agreementStatus: AgreementStatus; participantId: string; participantName: string; participantRole: ParticipantRole; participantStatus: ParticipantStatus; action: "review" | "sign" | "waiting" | "complete"; updatedAt: utcDateTime; }
model RequestRecipientCode { email: string; }
model RecipientCodeRequested { accepted: true; requestId: string; expiresAt: utcDateTime; developmentCode?: string; }
model VerifyRecipientCode { requestId: string; code: string; }
model RecipientAuthenticated { accepted: true; account: AccountSummary; }
model OpenRecipientAgreement { accessId: string; }
model PasskeyOptions { requestId: string; options: Record<unknown>; }
model VerifyPasskey { requestId: string; response: Record<unknown>; }
model PasskeyCredential { id: string; accountId: string; counter: int32; transports: string[]; deviceType: "singleDevice" | "multiDevice"; backedUp: boolean; name: string; createdAt: utcDateTime; lastUsedAt: utcDateTime | null; }
model OnboardParticipant {
  name: string;
  title: string;
  capacity: SigningCapacity;
  authorityConfirmed: boolean;
  entity: {
    legalName: string;
    businessAddress?: string;
    registrationNumber?: string;
    jurisdiction?: string;
  };
}
model NominateSignatory {
  name: string;
  email: string;
  title?: string;
}

model IntegrationContext { integrationId: string; integrationKey: string; externalSubject: string; personId: string; returnUrl: url; }
model Integration {
  id: string; tenantId: string; key: string; name: string;
  mappingStrategy: "host_asserted" | "shared_oidc" | "account_linking";
  allowedRedirectUris: url[]; allowedOrigins: url[]; createdAt: utcDateTime;
}
model CreateIntegration {
  key: string; name: string; mappingStrategy: "host_asserted" | "shared_oidc" | "account_linking";
  allowedRedirectUris: url[]; allowedOrigins?: url[];
}
model CreateIntegrationSession {
  integrationKey: string; subject: string; email: string; displayName?: string; templateKey: string;
  title?: string; returnUrl: url; metadata?: Record<string>;
}
model IntegrationSessionResult { agreementId: string; expiresAt: utcDateTime; handoffUrl: url; }
model ExchangeIntegrationResult { accepted: true; returnUrl: url; }
model Notification { id: string; tenantId: string; recipientPersonId: string; recipientEmail: string; type: string; title: string; body: string; agreementId: string; threadId: string | null; actorName: string; readAt: utcDateTime | null; createdAt: utcDateTime; }
model NotificationDelivery {
  id: string; notificationId: string; recipientEmail: string; subject: string; body: string; actionUrl: url;
  status: "pending" | "sending" | "delivered" | "failed" | "dead_letter"; attempts: int32;
  nextAttemptAt: utcDateTime; lastError: string | null; createdAt: utcDateTime; deliveredAt: utcDateTime | null;
}
model ExternalView {
  agreement: Agreement;
  participant: Participant;
  party: AgreementParty | null;
  requiredEntityFields: "businessAddress"[];
  branding: EntityBranding | null;
}

@route("/health")
interface HealthOperations {
  @get get(): HealthResponse;
  @get @route("/ready") ready(): ReadinessResponse;
}

@route("/v1/me")
@useAuth(ContractsOAuth2)
interface AccountOperations { @get get(@header("x-bytecrunch-entity-id") entityId?: string): CurrentAccount | ErrorResponse; }

@route("/v1/my-work")
@useAuth(ContractsOAuth2)
interface PersonalWorkOperations { @get list(): RecipientInboxItem[] | ErrorResponse; }

@route("/v1/entities")
@useAuth(ContractsOAuth2)
interface EntityOperations { @post create(@body body: CreateCustomerEntity): CustomerEntity | ErrorResponse; }

@route("/v1/entity/branding")
@useAuth(ContractsOAuth2)
interface EntityBrandingOperations { @put update(...EntityContext, @body body: EntityBranding): CustomerEntity | ErrorResponse; }

@route("/v1/plugin-catalog")
@useAuth(ContractsOAuth2)
interface PluginCatalogOperations { @get list(...EntityContext): PluginManifest[] | ErrorResponse; }

@route("/v1/plugin-installations")
@useAuth(ContractsOAuth2)
interface PluginInstallationOperations {
  @get list(...EntityContext): PluginInstallation[] | ErrorResponse;
  @put @route("/{pluginKey}") configure(...EntityContext, @path pluginKey: PluginKey, @body body: ConfigurePluginInstallation): PluginInstallation | ErrorResponse;
  @post @route("/{pluginKey}/test") test(...EntityContext, @path pluginKey: PluginKey): PluginInstallation | ErrorResponse;
  @delete @route("/{pluginKey}") remove(...EntityContext, @path pluginKey: PluginKey): { removed: true; operationId: string; } | ErrorResponse;
}

@route("/v1/entity-members")
@useAuth(ContractsOAuth2)
interface EntityMemberOperations {
  @get list(...EntityContext): EntityMemberList | ErrorResponse;
  @post @route("/invitations") invite(...EntityContext, @body body: InviteEntityMember): EntityMemberInvitation | ErrorResponse;
  @patch @route("/{membershipId}") update(...EntityContext, @path membershipId: string, @body body: UpdateEntityMember): EntityMembershipRecord | ErrorResponse;
  @delete @route("/{membershipId}") suspend(...EntityContext, @path membershipId: string): EntityMembershipRecord | ErrorResponse;
}

@route("/v1/entity-member-invitations")
@useAuth(ContractsOAuth2)
interface EntityMemberInvitationOperations { @post @route("/accept") accept(@body body: ExchangeInvitation): { membership: EntityMembershipRecord; entity: CustomerEntity; } | ErrorResponse; }

@route("/v1/templates")
@useAuth(ContractsOAuth2)
interface TemplateOperations {
  @get list(...EntityContext): Template[];
  @post create(...EntityContext, @body body: CreateTemplate): Template | ErrorResponse;
}

@route("/v1/agreements")
@useAuth(ContractsOAuth2)
interface AgreementOperations {
  @get list(...EntityContext): Agreement[];
  @post create(...EntityContext, @body body: CreateAgreement): Agreement | ErrorResponse;

  @get @route("/{agreementId}")
  get(...EntityContext, @path agreementId: string): Agreement | ErrorResponse;

  @get @route("/{agreementId}/audit-events")
  auditEvents(...EntityContext, @path agreementId: string): AgreementAuditEvent[] | ErrorResponse;

  @get @route("/{agreementId}/artifacts")
  artifacts(...EntityContext, @path agreementId: string): AgreementArtifact[] | ErrorResponse;

  @get @route("/{agreementId}/artifacts/{artifactId}/content")
  artifactContent(...EntityContext, @path agreementId: string, @path artifactId: string): ArtifactContentResponse | ErrorResponse;

  @post @route("/{agreementId}/finalize")
  finalize(...EntityContext, @path agreementId: string): Agreement | ErrorResponse;

  @post @route("/{agreementId}/review")
  startReview(@path agreementId: string): Agreement | ErrorResponse;

  @post @route("/{agreementId}/send-review")
  sendReview(@path agreementId: string, @body body: SendReview): Agreement | ErrorResponse;

  @post @route("/{agreementId}/suggestions")
  suggest(@path agreementId: string, @body body: CreateSuggestion): Agreement | ErrorResponse;

  @put @route("/{agreementId}/review-draft")
  saveReviewDraft(@path agreementId: string, @body body: UpdateReviewDraft): Agreement | ErrorResponse;

  @patch @route("/{agreementId}/suggestions/{suggestionId}")
  updateSuggestion(@path agreementId: string, @path suggestionId: string, @body body: UpdateSuggestion): Agreement | ErrorResponse;

  @delete @route("/{agreementId}/suggestions/{suggestionId}")
  removeSuggestion(@path agreementId: string, @path suggestionId: string): Agreement | ErrorResponse;

  @post @route("/{agreementId}/suggestions/{suggestionId}/resolve")
  resolveSuggestion(
    @path agreementId: string,
    @path suggestionId: string,
    @body body: ResolveSuggestion,
  ): Agreement | ErrorResponse;

  @post @route("/{agreementId}/suggestions/{suggestionId}/messages")
  replySuggestion(@path agreementId: string, @path suggestionId: string, @body body: ThreadMessageInput): Agreement | ErrorResponse;

  @post @route("/{agreementId}/comments")
  comment(@path agreementId: string, @body body: ThreadMessageInput): Agreement | ErrorResponse;

  @patch @route("/{agreementId}/comments/{commentId}")
  updateComment(@path agreementId: string, @path commentId: string, @body body: UpdateDocumentComment): Agreement | ErrorResponse;

  @delete @route("/{agreementId}/comments/{commentId}")
  removeComment(@path agreementId: string, @path commentId: string): Agreement | ErrorResponse;

  @post @route("/{agreementId}/comments/{commentId}/resolve")
  resolveComment(@path agreementId: string, @path commentId: string): Agreement | ErrorResponse;

  @post @route("/{agreementId}/send-for-signature")
  sendForSignature(@path agreementId: string): Agreement | ErrorResponse;

  @post @route("/{agreementId}/prepare-for-signature")
  prepareForSignature(@path agreementId: string): Agreement | ErrorResponse;

  @post @route("/{agreementId}/sign")
  sign(@path agreementId: string, @body body: SignAgreement): Agreement | ErrorResponse;

  @get @route("/{agreementId}/invitations")
  listInvitations(@path agreementId: string): Invitation[];

  @post @route("/{agreementId}/participants/{participantId}/invite")
  invite(@path agreementId: string, @path participantId: string): Invitation | ErrorResponse;

  @post @route("/{agreementId}/parties/{partyId}/accept-entity")
  acceptEntity(@path agreementId: string, @path partyId: string): Agreement | ErrorResponse;
}

@route("/v1/integrations")
@useAuth(ContractsOAuth2)
interface IntegrationOperations {
  @get list(): Integration[];
  @post create(@body body: CreateIntegration): Integration | ErrorResponse;
}

@route("/v1/integration-sessions")
@useAuth(ContractsOAuth2)
interface IntegrationSessionOperations { @post create(@body body: CreateIntegrationSession): IntegrationSessionResult | ErrorResponse; }

@route("/v1/conditions")
@useAuth(ContractsOAuth2)
interface ConditionOperations {
  @post @route("/evaluate")
  evaluate(@body body: EvaluateConditions): ConditionEvaluation | ErrorResponse;
}

@route("/v1/notifications")
@useAuth(ContractsOAuth2)
interface NotificationOperations {
  @get list(): Notification[];
  @post @route("/{notificationId}/read") read(@path notificationId: string): Notification | ErrorResponse;
  @post @route("/read-all") readAll(): { updated: int32; };
}

@route("/v1/notification-deliveries")
@useAuth(ContractsOAuth2)
interface NotificationDeliveryOperations {
  @get list(@query limit?: int32): NotificationDelivery[];
  @post @route("/{deliveryId}/replay") replay(@path deliveryId: string): NotificationDelivery | ErrorResponse;
}

@route("/v1/webhooks")
@useAuth(ContractsOAuth2)
interface WebhookOperations {
  @get list(): WebhookEndpoint[];
  @post create(@body body: CreateWebhook): WebhookEndpoint | ErrorResponse;
}

@route("/v1/webhook-deliveries")
@useAuth(ContractsOAuth2)
interface WebhookDeliveryOperations {
  @get list(@query limit?: int32): WebhookDelivery[];
  @post @route("/{deliveryId}/replay") replay(@path deliveryId: string): WebhookDelivery | ErrorResponse;
}

@route("/public")
interface ExternalParticipantOperations {
  @get @route("/verify/{code}")
  verify(@path code: string): PublicVerification | ErrorResponse;

  @get @route("/verify/{code}/document")
  verifiedDocument(@path code: string): ArtifactContentResponse | ErrorResponse;
  @post @route("/recipient-auth/request")
  requestRecipientCode(@body body: RequestRecipientCode): RecipientCodeRequested | ErrorResponse;

  @post @route("/recipient-auth/verify")
  verifyRecipientCode(@body body: VerifyRecipientCode): RecipientAuthenticated | ErrorResponse;

  @post @route("/recipient-auth/passkey/options")
  recipientPasskeyOptions(): PasskeyOptions | ErrorResponse;

  @post @route("/recipient-auth/passkey/verify")
  verifyRecipientPasskey(@body body: VerifyPasskey): RecipientAuthenticated | ErrorResponse;

  @get @route("/recipient/inbox")
  recipientInbox(): RecipientInboxItem[] | ErrorResponse;

  @get @route("/recipient/passkeys")
  listRecipientPasskeys(): PasskeyCredential[] | ErrorResponse;

  @post @route("/recipient/passkeys/registration/options")
  recipientPasskeyRegistrationOptions(): PasskeyOptions | ErrorResponse;

  @post @route("/recipient/passkeys/registration/verify")
  verifyRecipientPasskeyRegistration(@body body: VerifyPasskey): PasskeyCredential | ErrorResponse;

  @delete @route("/recipient/passkeys/{credentialId}")
  deleteRecipientPasskey(@path credentialId: string): { ok: true; } | ErrorResponse;

  @post @route("/recipient/open")
  openRecipientAgreement(@body body: OpenRecipientAgreement): { opened: true; } | ErrorResponse;

  @post @route("/recipient/logout")
  logoutRecipient(): { ok: true; } | ErrorResponse;

  @get @route("/entity-member-invitations/preview")
  previewEntityMemberInvitation(@query token: string): EntityMemberInvitationPreview | ErrorResponse;

  @post @route("/invitations/exchange")
  exchange(@body body: ExchangeInvitation): ExchangeResult | RecoveryRequired | ErrorResponse;

  @post @route("/access/exchange")
  exchangeAccess(@body body: ExchangeInvitation): ExchangeResult | ErrorResponse;

  @post @route("/integration-sessions/exchange")
  exchangeIntegration(@body body: ExchangeInvitation): ExchangeIntegrationResult | ErrorResponse;

  @get @route("/session")
  session(): ExternalView | ErrorResponse;

  @get @route("/session/artifacts")
  sessionArtifacts(): AgreementArtifact[] | ErrorResponse;

  @get @route("/session/artifacts/{artifactId}/content")
  sessionArtifactContent(@path artifactId: string): ArtifactContentResponse | ErrorResponse;

  @post @route("/session/finalize")
  finalizeSession(): ExternalView | ErrorResponse;

  @post @route("/session/onboarding")
  onboard(@body body: OnboardParticipant): ExternalView | ErrorResponse;

  @post @route("/session/suggestions")
  suggest(@body body: ExternalSuggestion): ExternalView | ErrorResponse;

  @put @route("/session/review-draft")
  saveReviewDraft(@body body: UpdateReviewDraft): ExternalView | ErrorResponse;

  @patch @route("/session/suggestions/{suggestionId}")
  updateSuggestion(@path suggestionId: string, @body body: UpdateSuggestion): ExternalView | ErrorResponse;

  @delete @route("/session/suggestions/{suggestionId}")
  removeSuggestion(@path suggestionId: string): ExternalView | ErrorResponse;

  @post @route("/session/suggestions/{suggestionId}/messages")
  replySuggestion(@path suggestionId: string, @body body: ThreadMessageInput): ExternalView | ErrorResponse;

  @post @route("/session/suggestions/{suggestionId}/resolve")
  resolveSuggestion(@path suggestionId: string, @body body: ResolveSuggestion): ExternalView | ErrorResponse;

  @post @route("/session/comments")
  comment(@body body: ThreadMessageInput): ExternalView | ErrorResponse;

  @patch @route("/session/comments/{commentId}")
  updateComment(@path commentId: string, @body body: UpdateDocumentComment): ExternalView | ErrorResponse;

  @delete @route("/session/comments/{commentId}")
  removeComment(@path commentId: string): ExternalView | ErrorResponse;

  @post @route("/session/return-review")
  returnReview(@body body: SendReview): ExternalView | ErrorResponse;

  @post @route("/session/approve-for-signature")
  approveForSignature(): ExternalView | ErrorResponse;

  @post @route("/session/reopen-review")
  reopenReview(@body body: ReopenReview): ExternalView | ErrorResponse;

  @post @route("/session/sign")
  sign(@body body: { intentConfirmed: true; signature?: SignatureInput; }): ExternalView | ErrorResponse;

  @post @route("/session/nominate")
  nominate(@body body: NominateSignatory): ExternalView | ErrorResponse;
}
