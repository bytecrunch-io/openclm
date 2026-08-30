import { createHash, createHmac, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  AgreementAuditEventSchema,
  SignatureEvidenceSchema,
  WebhookDeliverySchema,
  type Agreement,
} from "@bytecrunch/contracts-domain";
import { config } from "./config.js";
import type { Repository } from "./repository.js";

const now = () => new Date().toISOString();

function evidenceId(providerSignatureId: string | null, participantId: string, signedAt: string, contentSha256: string, event: 'active' | 'invalidated'): string {
  return `sigev_${createHash('sha256').update(`${providerSignatureId ?? 'unattributed'}:${participantId}:${signedAt}:${contentSha256}:${event}`).digest('hex')}`;
}

function signatureEvidence(agreement: Agreement) {
  const records = agreement.participants.flatMap((participant) => participant.signature ? [SignatureEvidenceSchema.parse({
    id: evidenceId(participant.signature.providerSignatureId, participant.id, participant.signature.signedAt, participant.signature.signedContentSha256, 'active'),
    tenantId: agreement.tenantId, agreementId: agreement.id, participantId: participant.id, personId: participant.personId,
    partyId: participant.partyId, revision: agreement.revision, contentSha256: participant.signature.signedContentSha256,
    status: 'active', signature: participant.signature, supersedesEvidenceId: null, invalidatedAt: null, invalidatedByParticipantId: null,
    invalidationReason: null, createdAt: participant.signature.signedAt,
  })] : []);
  for (const invalidated of agreement.invalidatedSignatures) {
    const participant = agreement.participants.find((item) => item.id === invalidated.participantId);
    records.push(SignatureEvidenceSchema.parse({
      id: evidenceId(invalidated.signature.providerSignatureId, invalidated.participantId, invalidated.signature.signedAt, invalidated.signature.signedContentSha256, 'invalidated'),
      tenantId: agreement.tenantId, agreementId: agreement.id, participantId: invalidated.participantId,
      personId: participant?.personId ?? null, partyId: participant?.partyId ?? null, revision: agreement.revision,
      contentSha256: invalidated.signature.signedContentSha256, status: 'invalidated', signature: invalidated.signature,
      supersedesEvidenceId: evidenceId(invalidated.signature.providerSignatureId, invalidated.participantId, invalidated.signature.signedAt, invalidated.signature.signedContentSha256, 'active'),
      invalidatedAt: invalidated.invalidatedAt, invalidatedByParticipantId: invalidated.invalidatedByParticipantId,
      invalidationReason: invalidated.reason, createdAt: invalidated.signature.signedAt,
    }));
  }
  return records;
}

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [first, second] = address.split(".").map(Number);
    return (
      first === 10 ||
      first === 127 ||
      first === 0 ||
      (first === 169 && second === 254) ||
      (first === 172 && second! >= 16 && second! <= 31) ||
      (first === 192 && second === 168)
    );
  }
  const normalized = address.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

export async function assertWebhookUrlAllowed(value: string): Promise<void> {
  if (config.NODE_ENV !== "production") return;
  const url = new URL(value);
  if (url.protocol !== "https:")
    throw new Error("Production webhook endpoints must use HTTPS.");
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  )
    throw new Error("Webhook endpoints cannot target local or internal hosts.");
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (
    addresses.length === 0 ||
    addresses.some((item) => isPrivateAddress(item.address))
  )
    throw new Error(
      "Webhook endpoints must resolve only to public network addresses.",
    );
}

export async function emitAgreementEvent(
  repository: Repository,
  type: string,
  agreement: Agreement,
): Promise<void> {
  const eventId = `evt_${randomUUID()}`;
  const createdAt = now();
  const event = {
    id: eventId,
    type,
    createdAt,
    tenantId: agreement.tenantId,
    data: {
      agreementId: agreement.id,
      externalId: agreement.externalId,
      templateKey: agreement.templateKey,
      templateVersion: agreement.templateVersion,
      status: agreement.status,
      contentSha256: agreement.contentSha256,
      executedAt: agreement.executedAt,
      personIds: agreement.participants
        .map((participant) => participant.personId)
        .filter(Boolean),
      integration: agreement.integrationContext,
      metadata: agreement.metadata,
    },
  };
  const payload = JSON.stringify(event);
  const auditEvent = AgreementAuditEventSchema.parse({
      id: eventId,
      tenantId: agreement.tenantId,
      agreementId: agreement.id,
      type,
      revision: agreement.revision,
      status: agreement.status,
      contentSha256: agreement.contentSha256,
      eventSha256: createHash("sha256").update(payload).digest("hex"),
      createdAt,
  });
  const endpoints = (await repository.listWebhooks(agreement.tenantId)).filter(
    (endpoint) => endpoint.events.includes(type),
  );
  const deliveries = endpoints.map((endpoint) =>
      WebhookDeliverySchema.parse({
        id: `whd_${randomUUID()}`,
        tenantId: agreement.tenantId,
        endpointId: endpoint.id,
        eventId,
        eventType: type,
        url: endpoint.url,
        payload,
        status: "pending",
        attempts: 0,
        nextAttemptAt: createdAt,
        responseStatus: null,
        lastError: null,
        createdAt,
        deliveredAt: null,
      }),
    );
  await repository.commitAgreementEvent(agreement, auditEvent, deliveries, signatureEvidence(agreement));
}

export async function deliverWebhookOutbox(
  repository: Repository,
): Promise<number> {
  const deliveries = await repository.claimPendingWebhookDeliveries(25);
  let delivered = 0;
  for (const item of deliveries) {
    try {
      await assertWebhookUrlAllowed(item.url);
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = createHmac("sha256", config.WEBHOOK_SIGNING_SECRET)
        .update(`${timestamp}.${item.payload}`)
        .digest("hex");
      const response = await fetch(item.url, {
        method: "POST",
        redirect: "error",
        headers: {
          "content-type": "application/json",
          "user-agent": "Bytecrunch-Contracts-Webhook/0.1",
          "x-bytecrunch-delivery": item.id,
          "x-bytecrunch-event": item.eventType,
          "x-bytecrunch-timestamp": timestamp,
          "x-bytecrunch-signature": `v1=${signature}`,
        },
        body: item.payload,
        signal: AbortSignal.timeout(10_000),
      });
      item.responseStatus = response.status;
      if (!response.ok)
        throw new Error(`Endpoint returned HTTP ${response.status}.`);
      item.status = "delivered";
      item.deliveredAt = now();
      item.lastError = null;
      delivered += 1;
    } catch (error) {
      item.status = item.attempts >= config.DELIVERY_MAX_ATTEMPTS ? "dead_letter" : "failed";
      item.lastError =
        error instanceof Error
          ? error.message.slice(0, 1000)
          : "Delivery failed.";
      item.nextAttemptAt = new Date(
        Date.now() + Math.min(60, 2 ** item.attempts) * 60_000,
      ).toISOString();
    }
    await repository.saveWebhookDelivery(item);
  }
  return delivered;
}

export async function replayWebhookDelivery(
  repository: Repository,
  tenantId: string,
  deliveryId: string,
) {
  const delivery = await repository.getWebhookDelivery(tenantId, deliveryId);
  if (!delivery) return undefined;
  delivery.status = "pending";
  delivery.nextAttemptAt = now();
  delivery.lastError = null;
  await repository.saveWebhookDelivery(delivery);
  return delivery;
}

export function startWebhookWorker(repository: Repository): () => void {
  const run = () =>
    void deliverWebhookOutbox(repository).catch((error) =>
      console.error("Webhook outbox delivery failed", error),
    );
  run();
  const timer = setInterval(run, 5_000);
  timer.unref();
  return () => clearInterval(timer);
}
