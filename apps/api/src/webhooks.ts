import { createHmac, randomUUID } from 'node:crypto';
import type { Agreement } from '@bytecrunch/contracts-domain';
import { config } from './config.js';
import type { Repository } from './repository.js';

export async function emitAgreementEvent(repository: Repository, type: string, agreement: Agreement): Promise<void> {
  const endpoints = await repository.listWebhooks(agreement.tenantId);
  const event = JSON.stringify({
    id: `evt_${randomUUID()}`,
    type,
    createdAt: new Date().toISOString(),
    tenantId: agreement.tenantId,
    data: {
      agreementId: agreement.id,
      externalId: agreement.externalId,
      templateKey: agreement.templateKey,
      templateVersion: agreement.templateVersion,
      status: agreement.status,
      contentSha256: agreement.contentSha256,
      executedAt: agreement.executedAt,
      personIds: agreement.participants.map((participant) => participant.personId).filter(Boolean),
      externalSubjectIds: agreement.participants.map((participant) => participant.externalSubjectId).filter(Boolean),
      integration: agreement.integrationContext,
      metadata: agreement.metadata,
    },
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', config.WEBHOOK_SIGNING_SECRET).update(`${timestamp}.${event}`).digest('hex');

  await Promise.allSettled(endpoints.filter((endpoint) => endpoint.events.includes(type)).map((endpoint) => fetch(endpoint.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'Bytecrunch-Contracts-Webhook/0.1',
      'x-bytecrunch-event': type,
      'x-bytecrunch-timestamp': timestamp,
      'x-bytecrunch-signature': `v1=${signature}`,
    },
    body: event,
    signal: AbortSignal.timeout(10_000),
  })));
}
