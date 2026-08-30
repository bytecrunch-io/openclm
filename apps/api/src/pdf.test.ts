import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { AgreementSchema } from '@bytecrunch/contracts-domain';
import { renderAgreementPdf } from './pdf.js';

const timestamp = '2026-08-30T12:00:00.000Z';
function agreement() {
  const signature = { method: 'typed' as const, typedName: 'Chris Example', imageDataUrl: null, signedContentSha256: 'a'.repeat(64), signedArtifactSha256: 'b'.repeat(64), signingEnvelopeId: 'envelope_test', signedAt: timestamp, provider: 'platform_electronic_signature' as const, providerSignatureId: 'sig_test', authenticationMethod: 'oidc' as const, consentText: 'I intend to sign this agreement electronically and adopt this mark as my signature.', consentVersion: '2026-08-30' };
  return AgreementSchema.parse({
    id: 'agr_pdf_test', tenantId: 'entity_test', externalId: null, title: 'Mutual NDA', templateKey: 'mutual-nda', templateVersion: 2, status: 'executed', revision: 3,
    content: `MUTUAL NON-DISCLOSURE AGREEMENT\n\nThis agreement is made between Sender ApS and Counterparty A/S.\n\n${'Confidential information must be protected and used only for the agreed purpose. '.repeat(180)}\n\n{{signature_blocks}}`, contentSha256: 'a'.repeat(64),
    parties: [{ id: 'party_sender', role: 'sender', status: 'executed', minimumSignatures: 1, entity: { id: 'sender', externalId: null, legalName: 'Sender ApS', businessAddress: 'Copenhagen', registrationNumber: null, jurisdiction: 'DK', verificationStatus: 'confirmed', proposedDetails: null } }],
    participants: [{ id: 'participant_sender', personId: 'person_sender', externalSubjectId: null, email: 'signer@example.com', name: 'Chris Example', role: 'signatory', required: true, status: 'signed', signedAt: timestamp, signature, partyId: 'party_sender', title: 'Director', capacity: 'director', authorityConfirmed: true, onboardingCompletedAt: timestamp, permissions: ['read', 'sign'] }],
    suggestions: [], documentComments: [], reviewRound: 1, reviewAssignedTo: null, reviewHistory: [], createdByParticipantId: 'participant_sender', integrationContext: null, metadata: {}, createdAt: timestamp, updatedAt: timestamp, executedAt: timestamp, invalidatedSignatures: [], verificationCode: 'v'.repeat(32),
    signingEnvelope: { id: 'envelope_test', revision: 3, contentSha256: 'a'.repeat(64), signingArtifactId: 'artifact_signing', signingArtifactSha256: 'b'.repeat(64), status: 'executed', frozenAt: timestamp, invalidatedAt: null },
  });
}

describe('agreement PDF renderer', () => {
  it('renders the same frozen agreement deterministically with pagination and an embedded completion record', async () => {
    const first = await renderAgreementPdf(agreement(), true); const second = await renderAgreementPdf(agreement(), true);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
    expect(new TextDecoder().decode(first.slice(0, 4))).toBe('%PDF');
    expect((await PDFDocument.load(first)).getPageCount()).toBeGreaterThan(2);
  });

  it('fails explicitly instead of silently corrupting unsupported glyphs', async () => {
    const value = agreement(); value.content += '\n\nUnsupported CJK example: 契約';
    await expect(renderAgreementPdf(value)).rejects.toThrow(/cannot encode/i);
  });
});
