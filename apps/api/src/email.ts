import nodemailer from 'nodemailer';
import { config } from './config.js';

export async function sendInvitationEmail(input: { email: string; name: string; agreementTitle: string; inviterName: string; invitationUrl: string }): Promise<void> {
  if (!config.SMTP_HOST) {
    console.log(`Invitation for ${input.email}: ${input.invitationUrl}`);
    return;
  }
  const transport = nodemailer.createTransport({ host: config.SMTP_HOST, port: config.SMTP_PORT, secure: false });
  await transport.sendMail({
    from: config.SMTP_FROM,
    to: input.email,
    subject: `${input.inviterName} invited you to review ${input.agreementTitle}`,
    text: `${input.name},\n\n${input.inviterName} invited you to review and, if authorised, sign “${input.agreementTitle}”.\n\nOpen the secure invitation:\n${input.invitationUrl}\n\nThis link expires in 7 days.`,
    html: `<div style="background:#0a0a0a;color:#e3e3e3;font-family:Arial,sans-serif;padding:40px"><div style="border-top:3px solid #ed650f;padding-top:24px;max-width:600px"><p style="font-family:monospace;letter-spacing:.18em;color:#ed650f;font-size:11px">// BYTECRUNCH CONTRACTS</p><h1 style="font-weight:300;color:white">You’re invited to review an agreement.</h1><p>${escapeHtml(input.name)},</p><p>${escapeHtml(input.inviterName)} invited you to review and, if authorised, sign <strong>${escapeHtml(input.agreementTitle)}</strong>.</p><p style="margin:32px 0"><a href="${input.invitationUrl}" style="background:#ed650f;color:white;padding:14px 20px;text-decoration:none">Review agreement →</a></p><p style="color:#9ca3af;font-size:13px">This one-time link expires in 7 days.</p></div></div>`,
  });
}

export async function sendNotificationEmail(input: { email: string; subject: string; body: string; actionUrl: string }): Promise<void> {
  if (!config.SMTP_HOST) { console.log(`Notification for ${input.email}: ${input.subject} — ${input.actionUrl}`); return; }
  const transport = nodemailer.createTransport({ host: config.SMTP_HOST, port: config.SMTP_PORT, secure: false });
  await transport.sendMail({ from: config.SMTP_FROM, to: input.email, subject: input.subject,
    text: `${input.body}\n\nOpen agreement:\n${input.actionUrl}`,
    html: `<div style="background:#0a0a0a;color:#e3e3e3;font-family:Arial,sans-serif;padding:40px"><div style="border-top:3px solid #ed650f;padding-top:24px;max-width:600px"><p style="font-family:monospace;letter-spacing:.18em;color:#ed650f;font-size:11px">// BYTECRUNCH CONTRACTS</p><h1 style="font-weight:300;color:white">${escapeHtml(input.subject)}</h1><p>${escapeHtml(input.body)}</p><p style="margin:32px 0"><a href="${input.actionUrl}" style="background:#ed650f;color:white;padding:14px 20px;text-decoration:none">Open agreement →</a></p></div></div>`,
  });
}

export async function sendAccessEmail(input: { email: string; name: string; agreementTitle: string; accessUrl: string }): Promise<void> {
  if (!config.SMTP_HOST) { console.log(`Return access for ${input.email}: ${input.accessUrl}`); return; }
  const transport = nodemailer.createTransport({ host: config.SMTP_HOST, port: config.SMTP_PORT, secure: false });
  await transport.sendMail({
    from: config.SMTP_FROM, to: input.email, subject: `Return to ${input.agreementTitle}`,
    text: `${input.name},\n\nUse this fresh secure link to continue “${input.agreementTitle}”.\n\n${input.accessUrl}\n\nThis link expires in 15 minutes and can only be used once.`,
    html: `<div style="background:#0a0a0a;color:#e3e3e3;font-family:Arial,sans-serif;padding:40px"><div style="border-top:3px solid #ed650f;padding-top:24px;max-width:600px"><p style="font-family:monospace;letter-spacing:.18em;color:#ed650f;font-size:11px">// BYTECRUNCH CONTRACTS</p><h1 style="font-weight:300;color:white">Continue your agreement.</h1><p>${escapeHtml(input.name)}, use this fresh secure link to return to <strong>${escapeHtml(input.agreementTitle)}</strong>.</p><p style="margin:32px 0"><a href="${input.accessUrl}" style="background:#ed650f;color:white;padding:14px 20px;text-decoration:none">Continue agreement →</a></p><p style="color:#9ca3af;font-size:13px">This link expires in 15 minutes and can only be used once.</p></div></div>`,
  });
}

export async function sendMemberInvitationEmail(input: { email: string; inviterName: string; entityName: string; invitationUrl: string }): Promise<void> {
  if (!config.SMTP_HOST) { console.log(`Entity invitation for ${input.email}: ${input.invitationUrl}`); return; }
  const transport = nodemailer.createTransport({ host: config.SMTP_HOST, port: config.SMTP_PORT, secure: false });
  await transport.sendMail({
    from: config.SMTP_FROM, to: input.email, subject: `${input.inviterName} invited you to join ${input.entityName}`,
    text: `${input.inviterName} invited you to work on contracts for ${input.entityName}.\n\nReview and accept the invitation:\n${input.invitationUrl}\n\nSign in with the invited email address. This invitation expires in 7 days.`,
    html: `<div style="background:#0a0a0a;color:#e3e3e3;font-family:Arial,sans-serif;padding:40px"><div style="border-top:3px solid #ed650f;padding-top:24px;max-width:600px"><p style="font-family:monospace;letter-spacing:.18em;color:#ed650f;font-size:11px">// BYTECRUNCH CONTRACTS</p><h1 style="font-weight:300;color:white">Join ${escapeHtml(input.entityName)}.</h1><p>${escapeHtml(input.inviterName)} invited you to work on contracts for this customer entity.</p><p style="margin:32px 0"><a href="${input.invitationUrl}" style="background:#ed650f;color:white;padding:14px 20px;text-decoration:none">Review invitation →</a></p><p style="color:#9ca3af;font-size:13px">Sign in with ${escapeHtml(input.email)}. This invitation expires in 7 days.</p></div></div>`,
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!);
}
