import assert from 'node:assert/strict';

const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const oidcUrl = process.env.OIDC_URL ?? 'http://localhost:8080/realms/bytecrunch';
const mailpitUrl = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const marker = Date.now().toString(36);
const recipientEmail = `alice-${marker}@example.test`;

async function json(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(data)}`);
  return data;
}

const tokenResponse = await json(await fetch(`${oidcUrl}/protocol/openid-connect/token`, {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'bytecrunch-contracts', client_secret: 'local-development-secret' }),
}));
const adminHeaders = { authorization: `Bearer ${tokenResponse.access_token}`, 'content-type': 'application/json' };

const agreement = await json(await fetch(`${apiUrl}/v1/agreements`, {
  method: 'POST', headers: adminHeaders,
  body: JSON.stringify({
    title: `External onboarding test ${marker}`, templateKey: 'mutual-nda', participants: [], metadata: { testRun: marker },
    parties: [{ role: 'counterparty', minimumSignatures: 1, entity: { legalName: 'Acme Test ApS', registrationNumber: `TEST-${marker}`, jurisdiction: 'DK' }, participants: [{ email: recipientEmail, name: 'Alice Example', role: 'signatory', required: true }, { email: `reviewer-${marker}@example.test`, role: 'reviewer', required: false }] }],
  }),
}));
const participant = agreement.participants[0];
assert(participant);
assert(participant.personId?.startsWith('person_'));
assert.equal(participant.externalSubjectId, null);
assert.equal(agreement.participants.length, 3);

const invitation = await json(await fetch(`${apiUrl}/v1/agreements/${agreement.id}/participants/${participant.id}/invite`, { method: 'POST', headers: adminHeaders }));
const invitationToken = new URL(invitation.invitationUrl).searchParams.get('token');
assert(invitationToken);

const mail = await json(await fetch(`${mailpitUrl}/api/v1/messages`));
assert(JSON.stringify(mail).includes(recipientEmail), 'Mailpit did not receive the invitation');

const exchangeResponse = await fetch(`${apiUrl}/public/invitations/exchange`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: invitationToken }),
});
await json(exchangeResponse);
const cookie = exchangeResponse.headers.get('set-cookie')?.split(';')[0];
assert(cookie);
const externalHeaders = { cookie, 'content-type': 'application/json' };

await json(await fetch(`${apiUrl}/public/session/onboarding`, {
  method: 'POST', headers: externalHeaders,
  body: JSON.stringify({ name: 'Alice Example', title: 'Director', capacity: 'director', authorityConfirmed: true, entity: { legalName: 'Acme Test ApS', registrationNumber: `TEST-${marker}`, jurisdiction: 'DK' } }),
}));
const reviewed = await json(await fetch(`${apiUrl}/public/session/suggestions`, {
  method: 'POST', headers: externalHeaders,
  body: JSON.stringify({ originalText: 'two years', replacementText: 'eighteen months', comment: 'External test redline' }),
}));
const suggestion = reviewed.agreement.suggestions.at(-1);
assert(suggestion);
const notificationsBeforeReturn = await json(await fetch(`${apiUrl}/v1/notifications`, { headers: adminHeaders }));
assert.equal(notificationsBeforeReturn.filter((item) => item.agreementId === agreement.id).length, 0, 'Draft review work must not notify the recipient');
await json(await fetch(`${apiUrl}/public/session/suggestions/${suggestion.id}`, { method: 'PATCH', headers: externalHeaders, body: JSON.stringify({ replacementText: 'one year', comment: 'Reconsidered during private review' }) }));
await json(await fetch(`${apiUrl}/public/session/return-review`, { method: 'POST', headers: externalHeaders, body: JSON.stringify({ message: 'Review complete' }) }));
const notifications = await json(await fetch(`${apiUrl}/v1/notifications`, { headers: adminHeaders }));
assert(notifications.some((item) => item.type === 'review.returned'));
let notificationEmailDelivered = false;
for (let attempt = 0; attempt < 30; attempt++) {
  const messages = await json(await fetch(`${mailpitUrl}/api/v1/messages`));
  if (JSON.stringify(messages).includes('Review returned:')) { notificationEmailDelivered = true; break; }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
assert(notificationEmailDelivered, 'Mailpit did not receive a queued workflow notification');
await json(await fetch(`${apiUrl}/v1/agreements/${agreement.id}/suggestions/${suggestion.id}/resolve`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ resolution: 'accepted' }) }));
await json(await fetch(`${apiUrl}/v1/agreements/${agreement.id}/send-for-signature`, { method: 'POST', headers: adminHeaders }));
const counterpartySigned = await json(await fetch(`${apiUrl}/public/session/sign`, { method: 'POST', headers: externalHeaders, body: JSON.stringify({ intentConfirmed: true, signature: { method: 'typed', typedName: 'Alice Example', imageDataUrl: null } }) }));
assert.equal(counterpartySigned.agreement.status, 'partially_signed');
assert.equal(counterpartySigned.participant.signature.signedContentSha256, counterpartySigned.agreement.contentSha256);
const executed = await json(await fetch(`${apiUrl}/v1/agreements/${agreement.id}/sign`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ participantId: agreement.createdByParticipantId, intentConfirmed: true, signature: { method: 'typed', typedName: 'Local Admin', imageDataUrl: null } }) }));
assert.equal(executed.status, 'executed');
assert(executed.participants.find((item) => item.id === agreement.createdByParticipantId).signature);
const integrationKey = `customer-portal-${marker}`;
await json(await fetch(`${apiUrl}/v1/integrations`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ key: integrationKey, name: 'Customer portal local E2E', mappingStrategy: 'host_asserted', allowedRedirectUris: ['http://localhost:3000/workflows'], allowedOrigins: ['http://localhost:3000'] }) }));
const integrationSession = await json(await fetch(`${apiUrl}/v1/integration-sessions`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ integrationKey, subject: `portal-user-${marker}`, email: `visitor-${marker}@example.test`, displayName: 'Portal User', templateKey: 'mutual-nda', returnUrl: 'http://localhost:3000/workflows', metadata: { workflow: `supplier-${marker}` } }) }));
const integrationToken = new URL(integrationSession.handoffUrl).searchParams.get('integrationToken');
assert(integrationToken);
const integrationExchange = await fetch(`${apiUrl}/public/integration-sessions/exchange`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: integrationToken }) });
await json(integrationExchange);
const integrationCookie = integrationExchange.headers.get('set-cookie')?.split(';')[0];
assert(integrationCookie);
const integrationExternalHeaders = { cookie: integrationCookie, 'content-type': 'application/json' };
await json(await fetch(`${apiUrl}/public/session/onboarding`, { method: 'POST', headers: integrationExternalHeaders, body: JSON.stringify({ name: 'Portal User', title: 'Director', capacity: 'director', authorityConfirmed: true, entity: { legalName: 'Visitor Test ApS', jurisdiction: 'DK' } }) }));
await json(await fetch(`${apiUrl}/v1/agreements/${integrationSession.agreementId}/send-for-signature`, { method: 'POST', headers: adminHeaders }));
await json(await fetch(`${apiUrl}/public/session/sign`, { method: 'POST', headers: integrationExternalHeaders, body: JSON.stringify({ intentConfirmed: true, signature: { method: 'typed', typedName: 'Portal User', imageDataUrl: null } }) }));
const conditionEvaluation = await json(await fetch(`${apiUrl}/v1/conditions/evaluate`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ integrationKey, subject: `portal-user-${marker}`, operator: 'all', conditions: [{ kind: 'subject_signed', templateKey: 'mutual-nda', minimumVersion: 1 }, { kind: 'agreement_executed', templateKey: 'mutual-nda', minimumVersion: 1 }] }) }));
assert.equal(conditionEvaluation.met, true);

console.log(JSON.stringify({ ok: true, agreementId: agreement.id, integrationAgreementId: integrationSession.agreementId, recipientEmail, participants: agreement.participants.length, notifications: notifications.length, revision: executed.revision, status: executed.status, conditionsMet: conditionEvaluation.met, mailpitDelivered: true, notificationEmailDelivered }, null, 2));
