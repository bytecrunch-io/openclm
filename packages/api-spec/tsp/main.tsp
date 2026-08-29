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
model SignatureRecord { method: "typed" | "drawn"; typedName: string; imageDataUrl: string | null; signedContentSha256: string; signedAt: utcDateTime; }
model InvalidatedSignature { participantId: string; participantName: string; signature: SignatureRecord; invalidatedAt: utcDateTime; invalidatedByParticipantId: string; reason: "review_reopened"; }

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
  participantId?: string;
  externalSubjectId?: string;
  intentConfirmed: true;
  signature?: SignatureInput;
}

model AgreementRequirement {
  templateKey: string;
  minimumVersion?: int32;
}

model EvaluateAgreementStatus {
  externalSubjectId: string;
  requirements: AgreementRequirement[];
  operator?: RequirementOperator;
}

model RequirementResult {
  templateKey: string;
  minimumVersion: int32;
  satisfied: boolean;
  status?: AgreementStatus;
  agreementId?: string;
  templateVersion?: int32;
  executedAt?: utcDateTime | null;
}

model EvaluationResult {
  externalSubjectId: string;
  satisfied: boolean;
  operator: RequirementOperator;
  requirements: RequirementResult[];
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
  invitationUrl?: url;
}

model ExchangeInvitation { token: string; }
model ExchangeResult { accepted: true; }
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
model ExternalView {
  agreement: Agreement;
  participant: Participant;
  party: AgreementParty | null;
}

@route("/health")
interface HealthOperations {
  @get get(): HealthResponse;
}

@route("/v1/templates")
@useAuth(ContractsOAuth2)
interface TemplateOperations {
  @get list(): Template[];
  @post create(@body body: CreateTemplate): Template | ErrorResponse;
}

@route("/v1/agreements")
@useAuth(ContractsOAuth2)
interface AgreementOperations {
  @get list(): Agreement[];
  @post create(@body body: CreateAgreement): Agreement | ErrorResponse;

  @get @route("/{agreementId}")
  get(@path agreementId: string): Agreement | ErrorResponse;

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

@route("/v1/integration-status")
@useAuth(ContractsOAuth2)
interface IntegrationStatusOperations {
  @get get(@query integrationKey: string, @query subject: string, @query templateKey: string, @query minimumVersion?: int32): RequirementResult;
}

@route("/v1/notifications")
@useAuth(ContractsOAuth2)
interface NotificationOperations {
  @get list(): Notification[];
  @post @route("/{notificationId}/read") read(@path notificationId: string): Notification | ErrorResponse;
  @post @route("/read-all") readAll(): { updated: int32; };
}

@route("/v1/agreement-status")
@useAuth(ContractsOAuth2)
interface StatusOperations {
  @get get(
    @query externalSubjectId: string,
    @query templateKey: string,
    @query minimumVersion?: int32,
  ): RequirementResult;

  @post @route("/evaluate")
  evaluate(@body body: EvaluateAgreementStatus): EvaluationResult | ErrorResponse;
}

@route("/v1/webhooks")
@useAuth(ContractsOAuth2)
interface WebhookOperations {
  @get list(): WebhookEndpoint[];
  @post create(@body body: CreateWebhook): WebhookEndpoint | ErrorResponse;
}

@route("/public")
interface ExternalParticipantOperations {
  @post @route("/invitations/exchange")
  exchange(@body body: ExchangeInvitation): ExchangeResult | ErrorResponse;

  @post @route("/integration-sessions/exchange")
  exchangeIntegration(@body body: ExchangeInvitation): ExchangeIntegrationResult | ErrorResponse;

  @get @route("/session")
  session(): ExternalView | ErrorResponse;

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
