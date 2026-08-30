import { createHash, randomUUID } from "node:crypto";
import {
  AgreementArtifactSchema,
  type Agreement,
  type AgreementArtifact,
} from "@bytecrunch/contracts-domain";
import type { Repository } from "./repository.js";
import { artifactStorage } from "./artifact-storage.js";

const now = () => new Date().toISOString();
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const safeName = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100) || "agreement";

async function storeJsonArtifact(
  repository: Repository,
  agreement: Agreement,
  kind: AgreementArtifact["kind"],
  fileName: string,
  body: unknown,
): Promise<AgreementArtifact> {
  const content = `${JSON.stringify(body, null, 2)}\n`;
  const artifactSha256 = sha256(content);
  const key = `${agreement.tenantId}/${agreement.id}/${kind}/${artifactSha256}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
  const stored = await artifactStorage().put(key, new TextEncoder().encode(content), artifactSha256);
  const artifact = AgreementArtifactSchema.parse({
    id: `artifact_${randomUUID()}`,
    tenantId: agreement.tenantId,
    agreementId: agreement.id,
    kind,
    revision: agreement.revision,
    contentSha256: agreement.contentSha256,
    artifactSha256,
    mediaType: "application/json",
    fileName,
    storageDriver: artifactStorage().driver,
    ...stored,
    retentionUntil: null,
    legalHold: false,
    createdAt: now(),
  });
  await repository.createAgreementArtifact(artifact);
  return artifact;
}

export async function ensureSigningSnapshot(
  repository: Repository,
  agreement: Agreement,
): Promise<AgreementArtifact> {
  const existing = (
    await repository.listAgreementArtifacts(agreement.tenantId, agreement.id)
  ).find(
    (item) =>
      item.kind === "signing_snapshot" &&
      item.revision === agreement.revision &&
      item.contentSha256 === agreement.contentSha256,
  );
  if (existing) return existing;
  return storeJsonArtifact(
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
}

export async function ensureCompletionManifest(
  repository: Repository,
  agreement: Agreement,
): Promise<AgreementArtifact> {
  if (agreement.status !== "executed")
    throw new Error(
      "A completion manifest can only be created for an executed agreement.",
    );
  const existing = (
    await repository.listAgreementArtifacts(agreement.tenantId, agreement.id)
  ).find(
    (item) =>
      item.kind === "completion_manifest" &&
      item.revision === agreement.revision &&
      item.contentSha256 === agreement.contentSha256,
  );
  if (existing) return existing;
  return storeJsonArtifact(
    repository,
    agreement,
    "completion_manifest",
    `${safeName(agreement.title)}-completion-manifest.json`,
    {
      schemaVersion: 1,
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
      completedAt: now(),
    },
  );
}

export function publicArtifact(
  artifact: AgreementArtifact,
): Omit<AgreementArtifact, "contentBase64" | "storageKey"> {
  const { contentBase64: _, storageKey: __, ...metadata } = artifact;
  return metadata;
}

export async function readArtifactContent(artifact: AgreementArtifact): Promise<Uint8Array> {
  return artifactStorage().get({ storageKey: artifact.storageKey, contentBase64: artifact.contentBase64, expectedSha256: artifact.artifactSha256 });
}
