import { randomUUID } from 'node:crypto';
import { NotificationOutboxSchema, NotificationSchema, type Agreement, type NotificationType } from '@bytecrunch/contracts-domain';
import { config } from './config.js';
import { sendNotificationEmail } from './email.js';
import type { Repository } from './repository.js';

const now = () => new Date().toISOString();

export async function notifyParticipants(repository: Repository, agreement: Agreement, input: { type: NotificationType; actorName: string; actorParticipantId?: string | undefined; recipientParticipantIds: string[]; title: string; body: string; threadId?: string | undefined }) {
  const unique = new Map(agreement.participants.filter((participant) => input.recipientParticipantIds.includes(participant.id) && participant.id !== input.actorParticipantId && participant.personId).map((participant) => [participant.personId!, participant]));
  await Promise.all([...unique.values()].map(async (participant) => {
    const notification = NotificationSchema.parse({ id: `note_${randomUUID()}`, tenantId: agreement.tenantId, recipientPersonId: participant.personId, recipientEmail: participant.email, type: input.type, title: input.title, body: input.body, agreementId: agreement.id, threadId: input.threadId ?? null, actorName: input.actorName, readAt: null, createdAt: now() });
    const external = participant.id !== agreement.createdByParticipantId; const actionUrl = external ? `${config.WEB_URL}/invite` : `${config.WEB_URL}/?agreement=${encodeURIComponent(agreement.id)}`;
    const outbox = NotificationOutboxSchema.parse({ id: `out_${randomUUID()}`, notificationId: notification.id, recipientEmail: participant.email, subject: input.title, body: input.body, actionUrl, status: 'pending', attempts: 0, nextAttemptAt: now(), lastError: null, createdAt: now(), deliveredAt: null });
    await repository.createNotification(notification, outbox);
  }));
}

export function participantsForMentions(agreement: Agreement, mentions: Array<{ participantId: string }>): string[] {
  const allowed = new Set(agreement.participants.map((participant) => participant.id)); return [...new Set(mentions.map((mention) => mention.participantId).filter((id) => allowed.has(id)))];
}

export async function deliverNotificationOutbox(repository: Repository): Promise<number> {
  const items = await repository.listPendingOutbox(25); let delivered = 0;
  for (const item of items) {
    item.status = 'sending'; item.attempts += 1; await repository.saveOutbox(item);
    try { await sendNotificationEmail({ email: item.recipientEmail, subject: item.subject, body: item.body, actionUrl: item.actionUrl }); item.status = 'delivered'; item.deliveredAt = now(); item.lastError = null; delivered += 1; }
    catch (error) { item.status = 'failed'; item.lastError = error instanceof Error ? error.message : 'Delivery failed'; item.nextAttemptAt = new Date(Date.now() + Math.min(60, 2 ** item.attempts) * 60_000).toISOString(); }
    await repository.saveOutbox(item);
  }
  return delivered;
}

export function startNotificationWorker(repository: Repository): () => void {
  const run = () => void deliverNotificationOutbox(repository).catch((error) => console.error('Notification outbox delivery failed', error)); run();
  const timer = setInterval(run, 5_000); timer.unref(); return () => clearInterval(timer);
}
