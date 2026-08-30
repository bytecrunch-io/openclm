import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Agreement, Participant } from '@bytecrunch/contracts-domain';
import { config } from './config.js';

const PAGE = { width: 595.28, height: 841.89, left: 58, right: 58, top: 68, bottom: 58 };
const COLORS = { ink: rgb(0.075, 0.082, 0.098), muted: rgb(0.38, 0.42, 0.48), accent: rgb(0.99, 0.34, 0.13), line: rgb(0.84, 0.86, 0.89) };

type Fonts = { regular: PDFFont; bold: PDFFont; signature: PDFFont };
type Cursor = { page: PDFPage; y: number; pageNumber: number };

function cleanContent(content: string): string {
  return content.replace(/\n*\{\{signature_blocks\}\}\s*/g, '\n').trim();
}

function wordsThatFit(text: string, font: PDFFont, size: number, width: number): string[] {
  const output: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph) { output.push(''); continue; }
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      try {
        if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue; }
      } catch {
        throw new Error(`The PDF renderer cannot encode part of the document near “${word.slice(0, 40)}”. Use a supported Unicode font adapter before signing.`);
      }
      if (line) output.push(line);
      line = word;
    }
    output.push(line);
  }
  return output;
}

function decorate(page: PDFPage, fonts: Fonts, pageNumber: number, agreement: Agreement): void {
  page.drawText('BYTECRUNCH / CONTRACTS', { x: PAGE.left, y: PAGE.height - 35, size: 8, font: fonts.bold, color: COLORS.accent });
  page.drawText(`Agreement ${agreement.id} · revision ${agreement.revision}`, { x: PAGE.left, y: 28, size: 7, font: fonts.regular, color: COLORS.muted });
  page.drawText(String(pageNumber), { x: PAGE.width - PAGE.right - 8, y: 28, size: 7, font: fonts.regular, color: COLORS.muted });
}

function newPage(document: PDFDocument, fonts: Fonts, pageNumber: number, agreement: Agreement): Cursor {
  const page = document.addPage([PAGE.width, PAGE.height]);
  decorate(page, fonts, pageNumber, agreement);
  return { page, y: PAGE.height - PAGE.top, pageNumber };
}

function ensureSpace(document: PDFDocument, fonts: Fonts, cursor: Cursor, agreement: Agreement, space: number): Cursor {
  return cursor.y - space >= PAGE.bottom ? cursor : newPage(document, fonts, cursor.pageNumber + 1, agreement);
}

function drawWrapped(document: PDFDocument, fonts: Fonts, cursor: Cursor, agreement: Agreement, text: string, options: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; leading?: number; gap?: number } = {}): Cursor {
  const size = options.size ?? 10.5; const font = options.bold ? fonts.bold : fonts.regular; const leading = options.leading ?? size * 1.48;
  for (const line of wordsThatFit(text, font, size, PAGE.width - PAGE.left - PAGE.right)) {
    cursor = ensureSpace(document, fonts, cursor, agreement, leading);
    if (line) cursor.page.drawText(line, { x: PAGE.left, y: cursor.y, size, font, color: options.color ?? COLORS.ink });
    cursor.y -= leading;
  }
  cursor.y -= options.gap ?? 2;
  return cursor;
}

function participantParty(agreement: Agreement, participant: Participant): string {
  return agreement.parties.find((party) => party.id === participant.partyId)?.entity.legalName ?? 'Individual signatory';
}

async function drawSignatureBlock(document: PDFDocument, fonts: Fonts, cursor: Cursor, agreement: Agreement, participant: Participant): Promise<Cursor> {
  cursor = ensureSpace(document, fonts, cursor, agreement, 128);
  const x = PAGE.left; const width = PAGE.width - PAGE.left - PAGE.right; const top = cursor.y;
  cursor.page.drawRectangle({ x, y: top - 112, width, height: 112, borderColor: COLORS.line, borderWidth: 0.8 });
  cursor.page.drawText(participantParty(agreement, participant), { x: x + 14, y: top - 20, size: 9, font: fonts.bold, color: COLORS.ink });
  if (participant.signature?.method === 'drawn' && participant.signature.imageDataUrl) {
    try {
      const png = await document.embedPng(Buffer.from(participant.signature.imageDataUrl.split(',')[1]!, 'base64'));
      const dimensions = png.scaleToFit(155, 42);
      cursor.page.drawImage(png, { x: x + 14, y: top - 70, width: dimensions.width, height: dimensions.height });
    } catch { cursor.page.drawText(participant.signature.typedName, { x: x + 14, y: top - 58, size: 18, font: fonts.signature, color: COLORS.ink }); }
  } else if (participant.signature) {
    cursor.page.drawText(participant.signature.typedName, { x: x + 14, y: top - 58, size: 18, font: fonts.signature, color: COLORS.ink });
  } else {
    cursor.page.drawLine({ start: { x: x + 14, y: top - 72 }, end: { x: x + 190, y: top - 72 }, thickness: 0.7, color: COLORS.muted });
  }
  const status = participant.signature ? `Signed ${new Date(participant.signature.signedAt).toISOString()}` : 'Signature pending';
  cursor.page.drawText(`${participant.name}${participant.title ? ` · ${participant.title}` : ''}`, { x: x + 215, y: top - 48, size: 9, font: fonts.bold, color: COLORS.ink });
  cursor.page.drawText(status, { x: x + 215, y: top - 64, size: 8, font: fonts.regular, color: COLORS.muted });
  cursor.page.drawText(participant.capacity?.replaceAll('_', ' ') ?? 'capacity to be confirmed', { x: x + 215, y: top - 80, size: 8, font: fonts.regular, color: COLORS.muted });
  cursor.page.drawText('SIGNATURE', { x: x + 14, y: top - 99, size: 6.5, font: fonts.bold, color: COLORS.muted });
  cursor.y = top - 126;
  return cursor;
}

function deterministicMetadata(document: PDFDocument, agreement: Agreement, executed: boolean): void {
  const timestamp = new Date(executed ? agreement.executedAt ?? agreement.updatedAt : agreement.updatedAt);
  document.setTitle(agreement.title); document.setAuthor('ByteCrunch Contracts'); document.setCreator('ByteCrunch Contracts'); document.setProducer('ByteCrunch Contracts');
  document.setCreationDate(new Date(agreement.createdAt)); document.setModificationDate(timestamp);
  document.setSubject(`Agreement ${agreement.id}, revision ${agreement.revision}`);
}

export async function renderAgreementPdf(agreement: Agreement, executed = false): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const fonts: Fonts = { regular: await document.embedFont(StandardFonts.Helvetica), bold: await document.embedFont(StandardFonts.HelveticaBold), signature: await document.embedFont(StandardFonts.TimesRomanItalic) };
  deterministicMetadata(document, agreement, executed);
  let cursor = newPage(document, fonts, 1, agreement);
  cursor = drawWrapped(document, fonts, cursor, agreement, agreement.title.toUpperCase(), { size: 17, bold: true, leading: 22, gap: 12 });
  for (const paragraph of cleanContent(agreement.content).split('\n')) {
    const trimmed = paragraph.trim();
    const heading = /^((\d+\.)|[A-Z][A-Z\s&/-]{5,})/.test(trimmed);
    cursor = drawWrapped(document, fonts, cursor, agreement, paragraph, { bold: heading, size: heading ? 11 : 10.5, gap: heading ? 5 : 2 });
  }
  cursor.y -= 12;
  cursor = drawWrapped(document, fonts, cursor, agreement, 'SIGNATURES', { size: 12, bold: true, gap: 8 });
  for (const participant of agreement.participants.filter((item) => item.role === 'signatory')) cursor = await drawSignatureBlock(document, fonts, cursor, agreement, participant);
  if (executed) {
    cursor = newPage(document, fonts, cursor.pageNumber + 1, agreement);
    cursor = drawWrapped(document, fonts, cursor, agreement, 'ELECTRONIC COMPLETION RECORD', { size: 16, bold: true, gap: 12 });
    cursor = drawWrapped(document, fonts, cursor, agreement, 'This page is part of the sealed PDF. It summarizes the electronic signing events; the platform’s detached cryptographic seal covers this page and every preceding page.', { color: COLORS.muted, gap: 12 });
    for (const [label, value] of [['Agreement ID', agreement.id], ['Revision', String(agreement.revision)], ['Executed at', agreement.executedAt ?? ''], ['Document content SHA-256', agreement.contentSha256]]) {
      cursor = drawWrapped(document, fonts, cursor, agreement, label!, { size: 7, bold: true, color: COLORS.muted, gap: 0 }); cursor = drawWrapped(document, fonts, cursor, agreement, value!, { size: 9, gap: 7 });
    }
    cursor = drawWrapped(document, fonts, cursor, agreement, 'SIGNING EVENTS', { size: 11, bold: true, gap: 6 });
    for (const participant of agreement.participants.filter((item) => item.signature)) cursor = drawWrapped(document, fonts, cursor, agreement, `${participant.name} · ${participantParty(agreement, participant)} · ${participant.signature!.signedAt} · authenticated by ${participant.signature!.authenticationMethod}`, { size: 8.5, gap: 5 });
    if (agreement.verificationCode) {
      const verificationUrl = new URL(`/verify/${agreement.verificationCode}`, config.WEB_URL).toString();
      cursor = drawWrapped(document, fonts, cursor, agreement, 'VERIFY THIS DOCUMENT', { size: 11, bold: true, gap: 4 }); cursor = drawWrapped(document, fonts, cursor, agreement, verificationUrl, { size: 8.5, color: COLORS.accent, gap: 8 });
    }
    drawWrapped(document, fonts, cursor, agreement, 'The platform seal is an organizational seal over the evidence package. It is not represented as the signer’s qualified electronic signature. Certificate-chain trust, revocation and long-term validation status are reported separately.', { size: 8, color: COLORS.muted });
  }
  return document.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
}

export async function renderCompletionCertificatePdf(agreement: Agreement, executedPdfSha256: string, sealSummary: string): Promise<Uint8Array> {
  const document = await PDFDocument.create(); const fonts: Fonts = { regular: await document.embedFont(StandardFonts.Helvetica), bold: await document.embedFont(StandardFonts.HelveticaBold), signature: await document.embedFont(StandardFonts.TimesRomanItalic) };
  deterministicMetadata(document, agreement, true); let cursor = newPage(document, fonts, 1, agreement);
  cursor = drawWrapped(document, fonts, cursor, agreement, 'COMPLETION CERTIFICATE', { size: 18, bold: true, gap: 14 });
  cursor = drawWrapped(document, fonts, cursor, agreement, 'This certificate is a human-readable summary of the electronic transaction evidence retained by ByteCrunch Contracts. It is not an X.509 certificate and does not by itself establish a qualified electronic signature.', { color: COLORS.muted, gap: 12 });
  const rows = [
    ['Agreement', agreement.title], ['Agreement ID', agreement.id], ['Revision', String(agreement.revision)], ['Executed at', agreement.executedAt ?? ''],
    ['Content SHA-256', agreement.contentSha256], ['Executed PDF SHA-256', executedPdfSha256], ['Platform seal', sealSummary],
  ];
  for (const [label, value] of rows) { cursor = drawWrapped(document, fonts, cursor, agreement, label!, { size: 7, bold: true, color: COLORS.muted, gap: 0 }); cursor = drawWrapped(document, fonts, cursor, agreement, value!, { size: 9, gap: 7 }); }
  cursor = drawWrapped(document, fonts, cursor, agreement, 'SIGNING EVENTS', { size: 12, bold: true, gap: 8 });
  for (const participant of agreement.participants.filter((item) => item.signature)) {
    const signature = participant.signature!;
    cursor = drawWrapped(document, fonts, cursor, agreement, `${participant.name} · ${participantParty(agreement, participant)} · ${signature.signedAt} · ${signature.authenticationMethod} · evidence ${signature.providerSignatureId ?? 'recorded'}`, { size: 8.5, gap: 5 });
  }
  return document.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
}
