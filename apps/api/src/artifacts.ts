import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  AgreementArtifactSchema,
  type Agreement,
  type AgreementArtifact,
} from "@bytecrunch/contracts-domain";
import type { Repository } from "./repository.js";
import { artifactStorage } from "./artifact-storage.js";
import { config } from "./config.js";
import { renderAgreementPdf, renderCompletionCertificatePdf } from './pdf.js';
import { pdfSha256, sealPdf, validateSealedPdf } from './pdf-seal.js';

const now = () => new Date().toISOString();
const safeName = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100) || "agreement";

async function storeArtifact(
  repository: Repository,
  agreement: Agreement,
  kind: AgreementArtifact["kind"],
  fileName: string,
  mediaType: string,
  bytes: Uint8Array,
): Promise<AgreementArtifact> {
  const artifactSha256 = createHash('sha256').update(bytes).digest('hex');
  const key = `${agreement.tenantId}/${agreement.id}/${kind}/${artifactSha256}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
  const stored = await artifactStorage().put(key, bytes, artifactSha256);
  const artifact = AgreementArtifactSchema.parse({
    id: `artifact_${randomUUID()}`,
    tenantId: agreement.tenantId,
    agreementId: agreement.id,
    kind,
    revision: agreement.revision,
    contentSha256: agreement.contentSha256,
    artifactSha256,
    mediaType,
    fileName,
    storageDriver: artifactStorage().driver,
    ...stored,
    retentionUntil: new Date(Date.now() + config.ARTIFACT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    legalHold: false,
    createdAt: now(),
  });
  await repository.createAgreementArtifact(artifact);
  return artifact;
}

async function storeJsonArtifact(repository: Repository, agreement: Agreement, kind: AgreementArtifact['kind'], fileName: string, body: unknown) {
  return storeArtifact(repository, agreement, kind, fileName, 'application/json', new TextEncoder().encode(`${JSON.stringify(body, null, 2)}\n`));
}

export async function ensureSigningSnapshot(
  repository: Repository,
  agreement: Agreement,
): Promise<AgreementArtifact> {
  const artifacts = await repository.listAgreementArtifacts(agreement.tenantId, agreement.id);
  const existing = artifacts.find(
    (item) =>
      item.kind === "signing_snapshot" &&
      item.revision === agreement.revision &&
      item.contentSha256 === agreement.contentSha256,
  );
  const snapshot = existing ?? await storeJsonArtifact(
    repository,
    agreement,
    "signing_snapshot",
    `${safeName(agreement.title)}-r${agreement.revision}-signing-snapshot.json`,
    {
      schemaVersion: 1,
      agreement: {
        id: agreement.id,
        title: agreement.title,
        templateKey: agreement.templateKey,
        templateVersion: agreement.templateVersion,
        revision: agreement.revision,
        content: agreement.content,
        contentSha256: agreement.contentSha256,
      },
      parties: agreement.parties,
      signatories: agreement.participants
        .filter((item) => item.role === "signatory")
        .map((item) => ({
          id: item.id,
          personId: item.personId,
          partyId: item.partyId,
          name: item.name,
          email: item.email,
          title: item.title,
          capacity: item.capacity,
          required: item.required,
        })),
      frozenAt: now(),
    },
  );
  let signingPdf = artifacts.find((item) => item.kind === 'signing_pdf' && item.revision === agreement.revision && item.contentSha256 === agreement.contentSha256);
  if (!signingPdf) signingPdf = await storeArtifact(repository, agreement, 'signing_pdf', `${safeName(agreement.title)}-r${agreement.revision}-signing.pdf`, 'application/pdf', await renderAgreementPdf(agreement));
  const envelopeMatches = agreement.signingEnvelope?.status === 'active' && agreement.signingEnvelope.revision === agreement.revision && agreement.signingEnvelope.contentSha256 === agreement.contentSha256 && agreement.signingEnvelope.signingArtifactSha256 === signingPdf.artifactSha256;
  if (!envelopeMatches) {
    agreement.signingEnvelope = { id: `envelope_${randomUUID()}`, revision: agreement.revision, contentSha256: agreement.contentSha256, signingArtifactId: signingPdf.id, signingArtifactSha256: signingPdf.artifactSha256, status: 'active', frozenAt: signingPdf.createdAt, invalidatedAt: null };
    await repository.saveAgreement(agreement);
  }
  return snapshot;
}

export async function ensureCompletionManifest(
  repository: Repository,
  agreement: Agreement,
): Promise<AgreementArtifact> {
  if (agreement.status !== "executed")
    throw new Error(
      "A completion manifest can only be created for an executed agreement.",
    );
  const artifacts = await repository.listAgreementArtifacts(agreement.tenantId, agreement.id);
  const existing = artifacts.find(
    (item) =>
      item.kind === "completion_manifest" &&
      item.revision === agreement.revision &&
      item.contentSha256 === agreement.contentSha256,
  );
  if (existing) return existing;
  if (!agreement.signingEnvelope || !['active', 'executed'].includes(agreement.signingEnvelope.status)) throw new Error('The executed agreement has no valid frozen signing envelope.');
  const sealedAt = agreement.executedAt ?? now();
  let executedPdf = artifacts.find((item) => item.kind === 'executed_pdf' && item.revision === agreement.revision && item.contentSha256 === agreement.contentSha256);
  let sealed: Awaited<ReturnType<typeof sealPdf>> | null = null;
  if (!executedPdf) { sealed = await sealPdf(await renderAgreementPdf(agreement, true), sealedAt); executedPdf = await storeArtifact(repository, agreement, 'executed_pdf', `${safeName(agreement.title)}-executed.pdf`, 'application/pdf', sealed.bytes); }
  const executedBytes = await readArtifactContent(executedPdf); const executedSha256 = pdfSha256(executedBytes); const validation = await validateSealedPdf(executedBytes);
  let validationReport = artifacts.find((item) => item.kind === 'validation_report' && item.revision === agreement.revision && item.contentSha256 === agreement.contentSha256);
  validationReport ??= await storeJsonArtifact(repository, agreement, 'validation_report', `${safeName(agreement.title)}-validation.json`, { ...validation, artifactId: executedPdf.id, artifactSha256: executedPdf.artifactSha256, validatedAt: now() });
  const sealProfile = sealed?.profile ?? validation.profile; const sealProvider = sealed?.provider ?? (config.PDF_SEAL_MODE === 'p12' ? 'deployment_p12' : 'development_ephemeral');
  let completionCertificate = artifacts.find((item) => item.kind === 'completion_certificate' && item.revision === agreement.revision && item.contentSha256 === agreement.contentSha256);
  completionCertificate ??= await storeArtifact(repository, agreement, 'completion_certificate', `${safeName(agreement.title)}-completion-certificate.pdf`, 'application/pdf', await renderCompletionCertificatePdf(agreement, executedSha256, `${sealProfile} · ${sealProvider}`));
  agreement.signingEnvelope.status = 'executed'; agreement.verificationCode ??= randomBytes(24).toString('base64url'); await repository.saveAgreement(agreement);
  const evidence = await repository.listSignatureEvidence(agreement.tenantId, agreement.id);
  return storeJsonArtifact(
    repository,
    agreement,
    "completion_manifest",
    `${safeName(agreement.title)}-completion-manifest.json`,
    {
      schemaVersion: 3,
      agreement: {
        id: agreement.id,
        title: agreement.title,
        templateKey: agreement.templateKey,
        templateVersion: agreement.templateVersion,
        revision: agreement.revision,
        contentSha256: agreement.contentSha256,
        executedAt: agreement.executedAt,
      },
      signatures: agreement.participants
        .filter((item) => item.signature)
        .map((item) => ({
          participantId: item.id,
          personId: item.personId,
          partyId: item.partyId,
          name: item.name,
          email: item.email,
          title: item.title,
          capacity: item.capacity,
          signature: item.signature,
        })),
      invalidatedSignatures: agreement.invalidatedSignatures,
      signatureEvidence: evidence,
      signingEnvelope: agreement.signingEnvelope,
      artifacts: { executedPdf: { id: executedPdf.id, sha256: executedPdf.artifactSha256 }, completionCertificate: { id: completionCertificate.id, sha256: completionCertificate.artifactSha256 }, validationReport: { id: validationReport.id, sha256: validationReport.artifactSha256 } },
      seal: { profile: sealProfile, provider: sealProvider, sealedAt, validation },
      verificationCode: agreement.verificationCode,
      completedAt: now(),
    },
  );
}

export function publicArtifact(
  artifact: AgreementArtifact,
): Omit<AgreementArtifact, "contentBase64" | "storageKey" | "storageDriver"> {
  const { contentBase64: _, storageKey: __, storageDriver: ___, ...metadata } = artifact;
  return metadata;
}

export async function readArtifactContent(artifact: AgreementArtifact): Promise<Uint8Array> {
  return artifactStorage().get({ storageKey: artifact.storageKey, contentBase64: artifact.contentBase64, expectedSha256: artifact.artifactSha256 });
}
