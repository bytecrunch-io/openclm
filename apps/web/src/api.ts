import { z } from "zod";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import {
  AgreementSchema,
  AgreementPartySchema,
  CreateAgreementSchema,
  CreateSuggestionSchema,
  TemplateSchema,
  ParticipantSchema,
  NotificationSchema,
  CustomerEntitySchema,
  EntityMembershipViewSchema,
  EntityMembershipSchema,
  EntityMemberInvitationSchema,
  AccountSchema,
  EntityRoleSchema,
  RecipientInboxItemSchema,
  RequiredEntityFieldSchema,
  type Agreement,
  type CreateAgreement,
  type CreateTemplate,
  type CreateSuggestion,
  type SignatureInput,
} from "@bytecrunch/contracts-domain";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  activeEntityId: z.string().nullable(),
  entities: z.array(EntityMembershipViewSchema),
  scopes: z.array(z.string()),
});
const ExternalViewSchema = z.object({
  agreement: AgreementSchema,
  participant: ParticipantSchema,
  party: AgreementPartySchema.nullable(),
  requiredEntityFields: z.array(RequiredEntityFieldSchema),
});
const EntityMemberListSchema = z.object({
  members: z.array(
    z.object({ membership: EntityMembershipSchema, account: AccountSchema }),
  ),
  invitations: z.array(EntityMemberInvitationSchema.omit({ tokenHash: true })),
});
const PasskeySchema = z.object({
  id: z.string(),
  accountId: z.string(),
  counter: z.number(),
  transports: z.array(z.string()),
  deviceType: z.enum(["singleDevice", "multiDevice"]),
  backedUp: z.boolean(),
  name: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
const PasskeyOptionsSchema = z.object({
  requestId: z.string(),
  options: z.record(z.string(), z.unknown()),
});
const InvitationResponseSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  agreementId: z.string(),
  participantId: z.string(),
  email: z.string().email(),
  status: z.enum(["pending", "accepted", "revoked", "expired"]),
  expiresAt: z.string(),
  createdAt: z.string(),
  acceptedAt: z.string().nullable(),
  invitationUrl: z.string().url().optional(),
});
const AgreementArtifactSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  agreementId: z.string(),
  kind: z.enum(["signing_snapshot", "signing_pdf", "executed_pdf", "completion_certificate", "completion_manifest", "validation_report"]),
  revision: z.number().int().positive(),
  contentSha256: z.string().length(64),
  artifactSha256: z.string().length(64),
  mediaType: z.string(),
  fileName: z.string(),
  createdAt: z.string(),
});
export type User = z.infer<typeof UserSchema>;
export type ExternalView = z.infer<typeof ExternalViewSchema>;
export type EntityMemberList = z.infer<typeof EntityMemberListSchema>;
export type EntityRole = z.infer<typeof EntityRoleSchema>;
export type RecipientInboxItem = z.infer<typeof RecipientInboxItemSchema>;
export type Passkey = z.infer<typeof PasskeySchema>;
export type AgreementArtifact = z.infer<typeof AgreementArtifactSchema>;
const PublicVerificationSchema = z.object({
  schemaVersion: z.number(), status: z.literal('executed'), title: z.string(), agreementId: z.string(), revision: z.number(), executedAt: z.string(), contentSha256: z.string(),
  parties: z.array(z.object({ role: z.enum(['sender', 'counterparty']), legalName: z.string().nullable() })),
  signers: z.array(z.object({ name: z.string(), partyRole: z.enum(['sender', 'counterparty']).nullable(), signedAt: z.string() })),
  executedPdf: z.object({ sha256: z.string(), downloadUrl: z.string() }).nullable(),
  validation: z.object({ documentIntegrityValid: z.boolean(), cmsSignatureValid: z.boolean(), byteRangeValid: z.boolean(), certificateTrust: z.string(), profile: z.string(), limitations: z.array(z.string()) }).passthrough().nullable(),
});
export type PublicVerification = z.infer<typeof PublicVerificationSchema>;

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const activeEntityId = localStorage.getItem("bc-contracts-active-entity");
  const response = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      "content-type": "application/json",
      ...(activeEntityId ? { "x-bytecrunch-entity-id": activeEntityId } : {}),
      ...init?.headers,
    },
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ message: z.string() }).safeParse(data);
    throw new Error(
      error.success
        ? error.data.message
        : `Request failed with ${response.status}`,
    );
  }
  return schema.parse(data);
}

async function download(path: string): Promise<void> {
  const activeEntityId = localStorage.getItem("bc-contracts-active-entity");
  const response = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: activeEntityId ? { "x-bytecrunch-entity-id": activeEntityId } : {},
  });
  if (!response.ok) {
    const error = z
      .object({ message: z.string() })
      .safeParse(await response.json().catch(() => undefined));
    throw new Error(
      error.success
        ? error.data.message
        : `Download failed with ${response.status}`,
    );
  }
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition");
  const fileName =
    disposition?.match(/filename="([^"]+)"/)?.[1] ?? "agreement-artifact";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const api = {
  loginUrl: `${API_URL}/auth/login`,
  loginUrlFor: (returnTo: string) =>
    `${API_URL}/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
  verifyAgreement: (code: string) => request(`/public/verify/${encodeURIComponent(code)}`, PublicVerificationSchema),
  downloadVerifiedAgreement: (code: string) => download(`/public/verify/${encodeURIComponent(code)}/document`),
  me: () => request("/v1/me", UserSchema),
  myWork: () => request("/v1/my-work", z.array(RecipientInboxItemSchema)),
  selectEntity: (entityId: string) => {
    localStorage.setItem("bc-contracts-active-entity", entityId);
  },
  createEntity: (input: {
    slug: string;
    legalName: string;
    businessAddress?: string;
    registrationNumber?: string;
    jurisdiction?: string;
  }) =>
    request("/v1/entities", CustomerEntitySchema, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  entityMembers: () => request("/v1/entity-members", EntityMemberListSchema),
  inviteEntityMember: (input: { email: string; roles: EntityRole[] }) =>
    request(
      "/v1/entity-members/invitations",
      EntityMemberInvitationSchema.omit({ tokenHash: true }).extend({
        invitationUrl: z.string().url().optional(),
      }),
      { method: "POST", body: JSON.stringify(input) },
    ),
  updateEntityMember: (membershipId: string, roles: EntityRole[]) =>
    request(`/v1/entity-members/${membershipId}`, EntityMembershipSchema, {
      method: "PATCH",
      body: JSON.stringify({ roles }),
    }),
  suspendEntityMember: (membershipId: string) =>
    request(`/v1/entity-members/${membershipId}`, EntityMembershipSchema, {
      method: "DELETE",
    }),
  previewEntityMemberInvitation: (token: string) =>
    request(
      `/public/entity-member-invitations/preview?token=${encodeURIComponent(token)}`,
      z.object({
        entityName: z.string(),
        emailHint: z.string(),
        roles: z.array(EntityRoleSchema),
        expiresAt: z.string(),
      }),
    ),
  acceptEntityMemberInvitation: (token: string) =>
    request(
      "/v1/entity-member-invitations/accept",
      z.object({
        membership: EntityMembershipSchema,
        entity: CustomerEntitySchema,
      }),
      { method: "POST", body: JSON.stringify({ token }) },
    ),
  requestRecipientCode: (email: string) =>
    request(
      "/public/recipient-auth/request",
      z.object({
        accepted: z.literal(true),
        requestId: z.string(),
        expiresAt: z.string(),
        developmentCode: z.string().optional(),
      }),
      { method: "POST", body: JSON.stringify({ email }) },
    ),
  verifyRecipientCode: (requestId: string, code: string) =>
    request(
      "/public/recipient-auth/verify",
      z.object({ accepted: z.literal(true), account: AccountSchema }),
      { method: "POST", body: JSON.stringify({ requestId, code }) },
    ),
  recipientPasskeyOptions: () =>
    request("/public/recipient-auth/passkey/options", PasskeyOptionsSchema, {
      method: "POST",
    }),
  verifyRecipientPasskey: (
    requestId: string,
    response: AuthenticationResponseJSON,
  ) =>
    request(
      "/public/recipient-auth/passkey/verify",
      z.object({ accepted: z.literal(true), account: AccountSchema }),
      { method: "POST", body: JSON.stringify({ requestId, response }) },
    ),
  recipientInbox: () =>
    request("/public/recipient/inbox", z.array(RecipientInboxItemSchema)),
  recipientPasskeys: () =>
    request("/public/recipient/passkeys", z.array(PasskeySchema)),
  recipientPasskeyRegistrationOptions: () =>
    request(
      "/public/recipient/passkeys/registration/options",
      PasskeyOptionsSchema,
      { method: "POST" },
    ),
  verifyRecipientPasskeyRegistration: (
    requestId: string,
    response: RegistrationResponseJSON,
  ) =>
    request("/public/recipient/passkeys/registration/verify", PasskeySchema, {
      method: "POST",
      body: JSON.stringify({ requestId, response }),
    }),
  deleteRecipientPasskey: (credentialId: string) =>
    request(
      `/public/recipient/passkeys/${encodeURIComponent(credentialId)}`,
      z.object({ ok: z.literal(true) }),
      { method: "DELETE" },
    ),
  openRecipientAgreement: (accessId: string) =>
    request("/public/recipient/open", z.object({ opened: z.literal(true) }), {
      method: "POST",
      body: JSON.stringify({ accessId }),
    }),
  logoutRecipient: () =>
    request("/public/recipient/logout", z.object({ ok: z.literal(true) }), {
      method: "POST",
    }),
  templates: () => request("/v1/templates", z.array(TemplateSchema)),
  createTemplate: (input: CreateTemplate) =>
    request("/v1/templates", TemplateSchema, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  agreements: () => request("/v1/agreements", z.array(AgreementSchema)),
  agreement: (id: string) => request(`/v1/agreements/${id}`, AgreementSchema),
  agreementArtifacts: (id: string) =>
    request(`/v1/agreements/${id}/artifacts`, z.array(AgreementArtifactSchema)),
  downloadAgreementArtifact: (agreementId: string, artifactId: string) =>
    download(`/v1/agreements/${agreementId}/artifacts/${artifactId}/content`),
  downloadSigningPdf: async (agreementId: string) => {
    const artifacts = await request(`/v1/agreements/${agreementId}/artifacts`, z.array(AgreementArtifactSchema)); const artifact = artifacts.find((item) => item.kind === 'signing_pdf');
    if (!artifact) throw new Error('The frozen signing PDF is unavailable.'); return download(`/v1/agreements/${agreementId}/artifacts/${artifact.id}/content`);
  },
  createAgreement: (input: CreateAgreement) =>
    request("/v1/agreements", AgreementSchema, {
      method: "POST",
      body: JSON.stringify(CreateAgreementSchema.parse(input)),
    }),
  startReview: (id: string) =>
    request(`/v1/agreements/${id}/review`, AgreementSchema, { method: "POST" }),
  sendReview: (id: string, message = "") =>
    request(`/v1/agreements/${id}/send-review`, AgreementSchema, {
      method: "POST",
      body: JSON.stringify({ message }),
    }),
  saveReviewDraft: (id: string, content: string) =>
    request(`/v1/agreements/${id}/review-draft`, AgreementSchema, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),
  addSuggestion: (id: string, input: CreateSuggestion) =>
    request(`/v1/agreements/${id}/suggestions`, AgreementSchema, {
      method: "POST",
      body: JSON.stringify(CreateSuggestionSchema.parse(input)),
    }),
  updateSuggestion: (
    agreementId: string,
    suggestionId: string,
    input: { replacementText: string; comment: string },
  ) =>
    request(
      `/v1/agreements/${agreementId}/suggestions/${suggestionId}`,
      AgreementSchema,
      { method: "PATCH", body: JSON.stringify(input) },
    ),
  removeSuggestion: (agreementId: string, suggestionId: string) =>
    request(
      `/v1/agreements/${agreementId}/suggestions/${suggestionId}`,
      AgreementSchema,
      { method: "DELETE" },
    ),
  resolveSuggestion: (
    agreementId: string,
    suggestionId: string,
    resolution: "accepted" | "rejected",
  ) =>
    request(
      `/v1/agreements/${agreementId}/suggestions/${suggestionId}/resolve`,
      AgreementSchema,
      { method: "POST", body: JSON.stringify({ resolution }) },
    ),
  replySuggestion: (agreementId: string, suggestionId: string, body: string) =>
    request(
      `/v1/agreements/${agreementId}/suggestions/${suggestionId}/messages`,
      AgreementSchema,
      { method: "POST", body: JSON.stringify({ body }) },
    ),
  addDocumentComment: (agreementId: string, body: string) =>
    request(`/v1/agreements/${agreementId}/comments`, AgreementSchema, {
      method: "POST",
      body: JSON.stringify({ body }),
    }),
  updateDocumentComment: (
    agreementId: string,
    commentId: string,
    body: string,
  ) =>
    request(
      `/v1/agreements/${agreementId}/comments/${commentId}`,
      AgreementSchema,
      { method: "PATCH", body: JSON.stringify({ body }) },
    ),
  removeDocumentComment: (agreementId: string, commentId: string) =>
    request(
      `/v1/agreements/${agreementId}/comments/${commentId}`,
      AgreementSchema,
      { method: "DELETE" },
    ),
  resolveDocumentComment: (agreementId: string, commentId: string) =>
    request(
      `/v1/agreements/${agreementId}/comments/${commentId}/resolve`,
      AgreementSchema,
      { method: "POST" },
    ),
  sendForSignature: (id: string) =>
    request(`/v1/agreements/${id}/send-for-signature`, AgreementSchema, {
      method: "POST",
    }),
  prepareForSignature: (id: string) =>
    request(`/v1/agreements/${id}/prepare-for-signature`, AgreementSchema, {
      method: "POST",
    }),
  acceptEntity: (agreementId: string, partyId: string) =>
    request(
      `/v1/agreements/${agreementId}/parties/${partyId}/accept-entity`,
      AgreementSchema,
      { method: "POST" },
    ),
  sign: (
    agreementId: string,
    participantId: string,
    signature: SignatureInput,
  ) =>
    request(`/v1/agreements/${agreementId}/sign`, AgreementSchema, {
      method: "POST",
      body: JSON.stringify({ participantId, intentConfirmed: true, signature }),
    }),
  invite: (agreementId: string, participantId: string) =>
    request(
      `/v1/agreements/${agreementId}/participants/${participantId}/invite`,
      InvitationResponseSchema,
      { method: "POST" },
    ),
  exchangeInvitation: (token: string) =>
    request(
      "/public/invitations/exchange",
      z.union([
        z.object({ accepted: z.literal(true) }),
        z.object({
          accepted: z.literal(false),
          verificationRequired: z.literal(true),
          message: z.string(),
        }),
      ]),
      { method: "POST", body: JSON.stringify({ token }) },
    ),
  exchangeAccess: (token: string) =>
    request(
      "/public/access/exchange",
      z.object({ accepted: z.literal(true) }),
      { method: "POST", body: JSON.stringify({ token }) },
    ),
  exchangeIntegrationSession: (token: string) =>
    request(
      "/public/integration-sessions/exchange",
      z.object({ accepted: z.literal(true), returnUrl: z.string().url() }),
      { method: "POST", body: JSON.stringify({ token }) },
    ),
  externalSession: () => request("/public/session", ExternalViewSchema),
  externalArtifacts: () =>
    request("/public/session/artifacts", z.array(AgreementArtifactSchema)),
  downloadExternalArtifact: (artifactId: string) =>
    download(`/public/session/artifacts/${artifactId}/content`),
  onboardExternal: (input: {
    name: string;
    title: string;
    capacity: string;
    authorityConfirmed: boolean;
    entity: {
      legalName: string;
      businessAddress?: string;
      registrationNumber?: string;
      jurisdiction?: string;
    };
  }) =>
    request("/public/session/onboarding", ExternalViewSchema, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  externalSuggest: (input: {
    originalText: string;
    replacementText: string;
    comment: string;
    anchor?: { start: number; end: number };
  }) =>
    request("/public/session/suggestions", ExternalViewSchema, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  externalSaveReviewDraft: (content: string) =>
    request("/public/session/review-draft", ExternalViewSchema, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),
  externalUpdateSuggestion: (
    suggestionId: string,
    input: { replacementText: string; comment: string },
  ) =>
    request(`/public/session/suggestions/${suggestionId}`, ExternalViewSchema, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  externalRemoveSuggestion: (suggestionId: string) =>
    request(`/public/session/suggestions/${suggestionId}`, ExternalViewSchema, {
      method: "DELETE",
    }),
  externalResolveSuggestion: (
    suggestionId: string,
    resolution: "accepted" | "rejected",
  ) =>
    request(
      `/public/session/suggestions/${suggestionId}/resolve`,
      ExternalViewSchema,
      { method: "POST", body: JSON.stringify({ resolution }) },
    ),
  externalReplySuggestion: (suggestionId: string, body: string) =>
    request(
      `/public/session/suggestions/${suggestionId}/messages`,
      ExternalViewSchema,
      { method: "POST", body: JSON.stringify({ body }) },
    ),
  externalDocumentComment: (body: string) =>
    request("/public/session/comments", ExternalViewSchema, {
      method: "POST",
      body: JSON.stringify({ body }),
    }),
  externalUpdateDocumentComment: (commentId: string, body: string) =>
    request(`/public/session/comments/${commentId}`, ExternalViewSchema, {
      method: "PATCH",
      body: JSON.stringify({ body }),
    }),
  externalRemoveDocumentComment: (commentId: string) =>
    request(`/public/session/comments/${commentId}`, ExternalViewSchema, {
      method: "DELETE",
    }),
  returnReview: (message = "") =>
    request("/public/session/return-review", ExternalViewSchema, {
      method: "POST",
      body: JSON.stringify({ message }),
    }),
  approveExternalForSignature: () =>
    request("/public/session/approve-for-signature", ExternalViewSchema, {
      method: "POST",
    }),
  reopenExternalReview: () =>
    request("/public/session/reopen-review", ExternalViewSchema, {
      method: "POST",
      body: JSON.stringify({
        invalidateSignatures: true,
        confirmation: "VOID_SIGNATURES_AND_REOPEN",
      }),
    }),
  externalSign: (signature: SignatureInput) =>
    request("/public/session/sign", ExternalViewSchema, {
      method: "POST",
      body: JSON.stringify({ intentConfirmed: true, signature }),
    }),
  downloadExternalSigningPdf: async () => {
    const artifacts = await request('/public/session/artifacts', z.array(AgreementArtifactSchema)); const artifact = artifacts.find((item) => item.kind === 'signing_pdf');
    if (!artifact) throw new Error('The frozen signing PDF is unavailable.'); return download(`/public/session/artifacts/${artifact.id}/content`);
  },
  nominateSignatory: (input: { name: string; email: string; title?: string }) =>
    request(
      "/public/session/nominate",
      ExternalViewSchema.extend({
        nominatedInvitation: InvitationResponseSchema,
      }).or(ExternalViewSchema),
      { method: "POST", body: JSON.stringify(input) },
    ),
  notifications: () =>
    request("/v1/notifications", z.array(NotificationSchema)),
  readNotification: (id: string) =>
    request(`/v1/notifications/${id}/read`, NotificationSchema, {
      method: "POST",
    }),
  readAllNotifications: () =>
    request("/v1/notifications/read-all", z.object({ updated: z.number() }), {
      method: "POST",
    }),
};

export function statusLabel(status: Agreement["status"]): string {
  return status.replaceAll("_", " ");
}
