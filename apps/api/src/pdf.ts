import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { DOCUMENT_PRESENTATION, formatDocumentDate, type Agreement, type Participant } from '@bytecrunch/contracts-domain';
import { config } from './config.js';

const CSS_TO_POINTS = 0.75;
const PAGE = {
  width: DOCUMENT_PRESENTATION.paperWidthPx * CSS_TO_POINTS,
  height: 841.89,
  left: DOCUMENT_PRESENTATION.paddingPx * CSS_TO_POINTS,
  right: DOCUMENT_PRESENTATION.paddingPx * CSS_TO_POINTS,
  top: DOCUMENT_PRESENTATION.paddingPx * CSS_TO_POINTS,
  bottom: DOCUMENT_PRESENTATION.paddingPx * CSS_TO_POINTS,
};
const hex = (value: string) => rgb(Number.parseInt(value.slice(1, 3), 16) / 255, Number.parseInt(value.slice(3, 5), 16) / 255, Number.parseInt(value.slice(5, 7), 16) / 255);
const COLORS = {
  paper: hex(DOCUMENT_PRESENTATION.paperBackground), ink: hex(DOCUMENT_PRESENTATION.text), muted: hex(DOCUMENT_PRESENTATION.muted),
  signature: hex(DOCUMENT_PRESENTATION.signatureInk), signed: hex(DOCUMENT_PRESENTATION.signedRule), accent: rgb(0.929, 0.396, 0.059),
  line: rgb(0.32, 0.32, 0.32), fieldLine: rgb(0.68, 0.67, 0.64),
};

type Fonts = { regular: PDFFont; semibold: PDFFont; italic: PDFFont; mono: PDFFont };
type Cursor = { page: PDFPage; y: number; pageNumber: number; kind: 'contract' | 'appendix' };

const require = createRequire(import.meta.url);
const fontFiles = Promise.all([
  readFile(require.resolve('@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff')),
  readFile(require.resolve('@fontsource/source-serif-4/files/source-serif-4-latin-600-normal.woff')),
  readFile(require.resolve('@fontsource/source-serif-4/files/source-serif-4-latin-400-italic.woff')),
]);

function cleanContent(content: string): string { return content.replace(/\n*\{\{signature_blocks\}\}\s*/g, '\n').trim(); }

function assertSupportedText(text: string): void {
  const unsupported = text.match(/[^\u0000-\u024f\u2000-\u206f\u20a0-\u20cf\u2120-\u214f]/u)?.[0];
  if (unsupported) throw new Error(`The PDF renderer cannot encode “${unsupported}”. Add the matching Source Serif 4 subset before signing this document.`);
}

function wrapLine(text: string, font: PDFFont, size: number, width: number): string[] {
  if (text.length === 0) return [''];
  const output: string[] = []; let line = '';
  for (const token of text.match(/\S+\s*/g) ?? []) {
    const candidate = line + token;
    if (font.widthOfTextAtSize(candidate.trimEnd(), size) <= width) { line = candidate; continue; }
    if (line) output.push(line.trimEnd());
    line = token.trimStart();
  }
  if (line || output.length === 0) output.push(line.trimEnd());
  return output;
}

function contractPage(document: PDFDocument, pageNumber: number): Cursor {
  const page = document.addPage([PAGE.width, PAGE.height]);
  page.drawRectangle({ x: 0, y: 0, width: PAGE.width, height: PAGE.height, color: COLORS.paper });
  return { page, y: PAGE.height - PAGE.top - DOCUMENT_PRESENTATION.bodyFontSizePx * CSS_TO_POINTS, pageNumber, kind: 'contract' };
}

function appendixPage(document: PDFDocument, fonts: Fonts, pageNumber: number, agreement: Agreement): Cursor {
  const page = document.addPage([PAGE.width, PAGE.height]);
  page.drawText('BYTECRUNCH / CONTRACTS', { x: PAGE.left, y: PAGE.height - 35, size: 8, font: fonts.semibold, color: COLORS.accent });
  page.drawText(`Agreement ${agreement.id} · revision ${agreement.revision}`, { x: PAGE.left, y: 28, size: 7, font: fonts.regular, color: COLORS.muted });
  page.drawText(String(pageNumber), { x: PAGE.width - PAGE.right - 8, y: 28, size: 7, font: fonts.regular, color: COLORS.muted });
  return { page, y: PAGE.height - PAGE.top, pageNumber, kind: 'appendix' };
}

function ensureSpace(document: PDFDocument, fonts: Fonts, cursor: Cursor, agreement: Agreement, space: number): Cursor {
  if (cursor.y - space >= PAGE.bottom) return cursor;
  return cursor.kind === 'contract' ? contractPage(document, cursor.pageNumber + 1) : appendixPage(document, fonts, cursor.pageNumber + 1, agreement);
}

function drawWrapped(document: PDFDocument, fonts: Fonts, cursor: Cursor, agreement: Agreement, text: string, options: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; leading?: number; gap?: number } = {}): Cursor {
  const size = options.size ?? 9; const font = options.font ?? fonts.regular; const leading = options.leading ?? size * 1.48;
  for (const sourceLine of text.split('\n')) {
    for (const line of wrapLine(sourceLine, font, size, PAGE.width - PAGE.left - PAGE.right)) {
      cursor = ensureSpace(document, fonts, cursor, agreement, leading);
      if (line) cursor.page.drawText(line, { x: PAGE.left, y: cursor.y, size, font, color: options.color ?? COLORS.ink });
      cursor.y -= leading;
    }
  }
  cursor.y -= options.gap ?? 0;
  return cursor;
}

function participantParty(agreement: Agreement, participant: Participant): string {
  return agreement.parties.find((party) => party.id === participant.partyId)?.entity.legalName ?? 'Legal entity pending';
}

function orderedSignatories(agreement: Agreement): Participant[] {
  const partyOrder = new Map(agreement.parties.map((party, index) => [party.id, index]));
  return agreement.participants.filter((participant) => participant.role === 'signatory').sort((a, b) => (partyOrder.get(a.partyId ?? '') ?? 999) - (partyOrder.get(b.partyId ?? '') ?? 999));
}

function field(page: PDFPage, fonts: Fonts, x: number, y: number, width: number, label: string, value: string): void {
  const labelWidth = 64.5;
  page.drawText(label.toUpperCase(), { x, y: y + 2.25, size: 6, font: fonts.mono, color: COLORS.muted });
  page.drawText(value, { x: x + labelWidth, y: y + 3.25, size: 8.25, font: fonts.regular, color: COLORS.ink, maxWidth: width - labelWidth });
  page.drawLine({ start: { x: x + labelWidth, y }, end: { x: x + width, y }, thickness: 0.6, color: COLORS.fieldLine });
}

async function drawSignatureBlock(document: PDFDocument, fonts: Fonts, page: PDFPage, agreement: Agreement, participant: Participant, x: number, top: number, width: number): Promise<void> {
  page.drawText('SIGNED FOR AND ON BEHALF OF', { x, y: top - 6.75, size: 6.75, font: fonts.mono, color: COLORS.muted });
  page.drawText(participantParty(agreement, participant), { x, y: top - 22.5, size: 10.5, font: fonts.semibold, color: COLORS.ink, maxWidth: width });
  const signatureLineY = top - 117;
  if (participant.signature?.method === 'drawn' && participant.signature.imageDataUrl) {
    try {
      const encoded = participant.signature.imageDataUrl.split(',')[1];
      if (!encoded) throw new Error('Missing drawn-signature payload.');
      const png = await document.embedPng(Buffer.from(encoded, 'base64')); const dimensions = png.scaleToFit(width, 54);
      page.drawImage(png, { x, y: signatureLineY + 2, width: dimensions.width, height: dimensions.height });
    } catch { page.drawText(participant.signature.typedName, { x, y: signatureLineY + 8, size: 24, font: fonts.italic, color: COLORS.signature, maxWidth: width }); }
  } else if (participant.signature) {
    page.drawText(participant.signature.typedName, { x, y: signatureLineY + 8, size: 24, font: fonts.italic, color: COLORS.signature, maxWidth: width });
  }
  page.drawLine({ start: { x, y: signatureLineY }, end: { x: x + width, y: signatureLineY }, thickness: 0.75, color: participant.signature ? COLORS.signed : COLORS.line });
  page.drawText('SIGNATURE', { x, y: signatureLineY - 9.75, size: 6, font: fonts.mono, color: COLORS.muted });
  field(page, fonts, x, top - 159, width, 'Name', participant.signature?.typedName ?? participant.name);
  field(page, fonts, x, top - 183.75, width, 'Title / capacity', participant.title ?? participant.capacity?.replaceAll('_', ' ') ?? 'Authorized signatory');
  field(page, fonts, x, top - 208.5, width, 'Date', participant.signature ? formatDocumentDate(participant.signature.signedAt) : '—');
  if (participant.signature) page.drawText(`Electronic signature record · ${participant.signature.signedContentSha256.slice(0, 12)}…`, { x, y: top - 225, size: 6, font: fonts.mono, color: COLORS.muted });
}

async function drawSignatureBlocks(document: PDFDocument, fonts: Fonts, cursor: Cursor, agreement: Agreement): Promise<Cursor> {
  const signatories = orderedSignatories(agreement); if (signatories.length === 0) return cursor;
  cursor.y -= 6;
  const gap = DOCUMENT_PRESENTATION.signatureGapPx * CSS_TO_POINTS; const width = (PAGE.width - PAGE.left - PAGE.right - gap) / 2;
  const rowHeight = DOCUMENT_PRESENTATION.signatureBlockHeightPx * CSS_TO_POINTS;
  for (let index = 0; index < signatories.length; index += 2) {
    cursor = ensureSpace(document, fonts, cursor, agreement, rowHeight);
    const pair = signatories.slice(index, index + 2);
    await Promise.all(pair.map((participant, column) => drawSignatureBlock(document, fonts, cursor.page, agreement, participant, PAGE.left + column * (width + gap), cursor.y, width)));
    cursor.y -= rowHeight;
  }
  return cursor;
}

function deterministicMetadata(document: PDFDocument, agreement: Agreement, executed: boolean): void {
  const timestamp = new Date(executed ? agreement.executedAt ?? agreement.updatedAt : agreement.updatedAt);
  document.setTitle(agreement.title); document.setAuthor('ByteCrunch Contracts'); document.setCreator('ByteCrunch Contracts'); document.setProducer('ByteCrunch Contracts');
  document.setCreationDate(new Date(agreement.createdAt)); document.setModificationDate(timestamp); document.setSubject(`Agreement ${agreement.id}, revision ${agreement.revision}`);
}

async function embedFonts(document: PDFDocument): Promise<Fonts> {
  document.registerFontkit(fontkit); const [regular, semibold, italic] = await fontFiles;
  return {
    regular: await document.embedFont(regular, { subset: true }), semibold: await document.embedFont(semibold, { subset: true }),
    italic: await document.embedFont(italic, { subset: true }), mono: await document.embedFont(StandardFonts.Helvetica),
  };
}

export async function renderAgreementPdf(agreement: Agreement, executed = false): Promise<Uint8Array> {
  const content = cleanContent(agreement.content);
  assertSupportedText(content + agreement.participants.map((participant) => `${participant.name}${participant.title ?? ''}${participant.signature?.typedName ?? ''}`).join(''));
  const document = await PDFDocument.create(); const fonts = await embedFonts(document); deterministicMetadata(document, agreement, executed);
  let cursor = contractPage(document, 1);
  cursor = drawWrapped(document, fonts, cursor, agreement, content, { size: DOCUMENT_PRESENTATION.bodyFontSizePx * CSS_TO_POINTS, leading: DOCUMENT_PRESENTATION.bodyFontSizePx * DOCUMENT_PRESENTATION.lineHeight * CSS_TO_POINTS });
  cursor.y -= DOCUMENT_PRESENTATION.paddingPx * CSS_TO_POINTS;
  cursor = await drawSignatureBlocks(document, fonts, cursor, agreement);
  if (executed) {
    cursor = appendixPage(document, fonts, cursor.pageNumber + 1, agreement);
    cursor = drawWrapped(document, fonts, cursor, agreement, 'ELECTRONIC COMPLETION RECORD', { size: 16, font: fonts.semibold, leading: 22, gap: 12 });
    cursor = drawWrapped(document, fonts, cursor, agreement, 'This audit appendix is part of the sealed PDF. It summarizes the electronic signing events; the platform’s detached cryptographic seal covers this page and every preceding contract page.', { color: COLORS.muted, gap: 12 });
    for (const [label, value] of [['Agreement ID', agreement.id], ['Revision', String(agreement.revision)], ['Executed at', agreement.executedAt ?? ''], ['Document content SHA-256', agreement.contentSha256]]) {
      cursor = drawWrapped(document, fonts, cursor, agreement, label!, { size: 7, font: fonts.semibold }); cursor = drawWrapped(document, fonts, cursor, agreement, value!, { size: 9, gap: 7 });
    }
    cursor = drawWrapped(document, fonts, cursor, agreement, 'SIGNING EVENTS', { size: 11, font: fonts.semibold, gap: 6 });
    for (const participant of agreement.participants.filter((item) => item.signature)) cursor = drawWrapped(document, fonts, cursor, agreement, `${participant.name} · ${participantParty(agreement, participant)} · ${participant.signature!.signedAt} · authenticated by ${participant.signature!.authenticationMethod}`, { size: 8.5, gap: 5 });
    if (agreement.verificationCode) {
      const verificationUrl = new URL(`/verify/${agreement.verificationCode}`, config.WEB_URL).toString();
      cursor = drawWrapped(document, fonts, cursor, agreement, 'VERIFY THIS DOCUMENT', { size: 11, font: fonts.semibold, gap: 4 }); cursor = drawWrapped(document, fonts, cursor, agreement, verificationUrl, { size: 8.5, color: COLORS.accent, gap: 8 });
    }
    drawWrapped(document, fonts, cursor, agreement, 'The platform seal is an organizational seal over the evidence package. It is not represented as the signer’s qualified electronic signature. Certificate-chain trust, revocation and long-term validation status are reported separately.', { size: 8, color: COLORS.muted });
  }
  return document.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
}

export async function renderCompletionCertificatePdf(agreement: Agreement, executedPdfSha256: string, sealSummary: string): Promise<Uint8Array> {
  const document = await PDFDocument.create(); const fonts = await embedFonts(document); deterministicMetadata(document, agreement, true);
  let cursor = appendixPage(document, fonts, 1, agreement);
  cursor = drawWrapped(document, fonts, cursor, agreement, 'COMPLETION CERTIFICATE', { size: 18, font: fonts.semibold, gap: 14 });
  cursor = drawWrapped(document, fonts, cursor, agreement, 'This certificate is a human-readable summary of the electronic transaction evidence retained by ByteCrunch Contracts. It is not an X.509 certificate and does not by itself establish a qualified electronic signature.', { color: COLORS.muted, gap: 12 });
  const rows = [['Agreement', agreement.title], ['Agreement ID', agreement.id], ['Revision', String(agreement.revision)], ['Executed at', agreement.executedAt ?? ''], ['Content SHA-256', agreement.contentSha256], ['Executed PDF SHA-256', executedPdfSha256], ['Platform seal', sealSummary]];
  for (const [label, value] of rows) { cursor = drawWrapped(document, fonts, cursor, agreement, label!, { size: 7, font: fonts.semibold }); cursor = drawWrapped(document, fonts, cursor, agreement, value!, { size: 9, gap: 7 }); }
  cursor = drawWrapped(document, fonts, cursor, agreement, 'SIGNING EVENTS', { size: 12, font: fonts.semibold, gap: 8 });
  for (const participant of agreement.participants.filter((item) => item.signature)) {
    const signature = participant.signature!;
    cursor = drawWrapped(document, fonts, cursor, agreement, `${participant.name} · ${participantParty(agreement, participant)} · ${signature.signedAt} · ${signature.authenticationMethod} · evidence ${signature.providerSignatureId ?? 'recorded'}`, { size: 8.5, gap: 5 });
  }
  return document.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
}
