import { readFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import forge from 'node-forge';
import * as asn1js from 'asn1js';
import { ContentInfo, SignedData, Certificate } from 'pkijs';
import { PDFDocument } from 'pdf-lib';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { SignPdf } from '@signpdf/signpdf';
import { P12Signer } from '@signpdf/signer-p12';
import { extractSignature, SUBFILTER_ETSI_CADES_DETACHED } from '@signpdf/utils';
import { config } from './config.js';

export type PdfSealResult = {
  bytes: Uint8Array;
  profile: 'PAdES-B-B';
  provider: 'development_ephemeral' | 'deployment_p12';
  sealedAt: string;
};

export type PdfValidationResult = {
  schemaVersion: 1;
  byteRangeValid: boolean;
  cmsSignatureValid: boolean;
  documentIntegrityValid: boolean;
  certificateTrust: 'not_evaluated';
  profile: 'PAdES-B-B';
  signerCertificate: { subject: string; issuer: string; serialNumber: string; notBefore: string; notAfter: string } | null;
  limitations: string[];
};

let developmentP12: Buffer | undefined;
const developmentPassphrase = 'bytecrunch-local-seal';

function createDevelopmentP12(): Buffer {
  if (developmentP12) return developmentP12;
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const certificate = forge.pki.createCertificate(); certificate.publicKey = keys.publicKey;
  certificate.serialNumber = randomBytes(16).toString('hex');
  certificate.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  certificate.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const attributes = [{ name: 'commonName', value: 'ByteCrunch Local Development Seal' }, { name: 'organizationName', value: 'ByteCrunch Development' }];
  certificate.setSubject(attributes); certificate.setIssuer(attributes); certificate.setExtensions([{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true }]);
  certificate.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [certificate], developmentPassphrase, { algorithm: '3des' });
  developmentP12 = Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary'); return developmentP12;
}

async function sealCredentials(): Promise<{ bytes: Buffer; passphrase: string; provider: PdfSealResult['provider'] }> {
  if (config.PDF_SEAL_MODE === 'development') return { bytes: createDevelopmentP12(), passphrase: developmentPassphrase, provider: 'development_ephemeral' };
  if (config.PDF_SEAL_MODE === 'p12' && config.PDF_SEAL_P12_PATH) return { bytes: await readFile(config.PDF_SEAL_P12_PATH), passphrase: config.PDF_SEAL_P12_PASSWORD ?? '', provider: 'deployment_p12' };
  throw new Error('The PDF seal is not configured for this deployment.');
}

export async function sealPdf(input: Uint8Array, sealedAt: string): Promise<PdfSealResult> {
  const credentials = await sealCredentials(); const document = await PDFDocument.load(input);
  pdflibAddPlaceholder({
    pdfDoc: document, reason: 'Seal the executed agreement and its transaction evidence', contactInfo: config.PDF_SEAL_CONTACT,
    name: config.PDF_SEAL_NAME, location: config.PDF_SEAL_LOCATION, signingTime: new Date(sealedAt), signatureLength: 16_384,
    subFilter: SUBFILTER_ETSI_CADES_DETACHED, widgetRect: [0, 0, 0, 0], appName: 'ByteCrunch Contracts',
  });
  const prepared = await document.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
  const bytes = await new SignPdf().sign(Buffer.from(prepared), new P12Signer(credentials.bytes, { passphrase: credentials.passphrase }), new Date(sealedAt));
  return { bytes: new Uint8Array(bytes), profile: 'PAdES-B-B', provider: credentials.provider, sealedAt };
}

function arrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function distinguishedName(values: Certificate['subject']['typesAndValues']): string {
  return values.map((item) => `${item.type}=${String(item.value.valueBlock.value ?? item.value.valueBlock.valueHexView ?? '')}`).join(', ');
}

export async function validateSealedPdf(input: Uint8Array): Promise<PdfValidationResult> {
  let byteRangeValid = false; let cmsSignatureValid = false; let signerCertificate: PdfValidationResult['signerCertificate'] = null;
  try {
    const pdf = Buffer.from(input); const extracted = extractSignature(pdf) as { ByteRange: number[]; signature: string; signedData: Buffer };
    const [firstStart, firstLength, secondStart, secondLength] = extracted.ByteRange;
    byteRangeValid = firstStart === 0 && firstLength !== undefined && secondStart !== undefined && secondLength !== undefined && firstLength < secondStart && secondStart + secondLength === pdf.length;
    const cmsBytes = Buffer.from(extracted.signature, 'binary'); const decoded = asn1js.fromBER(arrayBuffer(cmsBytes));
    if (decoded.offset === -1) throw new Error('The CMS seal could not be decoded.');
    const contentInfo = new ContentInfo({ schema: decoded.result }); const signedData = new SignedData({ schema: contentInfo.content });
    const verified = await signedData.verify({ signer: 0, data: arrayBuffer(extracted.signedData), checkChain: false, extendedMode: true });
    cmsSignatureValid = typeof verified === 'boolean' ? verified : verified.signatureVerified === true;
    const certificate = signedData.certificates?.find((item): item is Certificate => item instanceof Certificate) ?? null;
    if (certificate) signerCertificate = { subject: distinguishedName(certificate.subject.typesAndValues), issuer: distinguishedName(certificate.issuer.typesAndValues), serialNumber: certificate.serialNumber.valueBlock.toString(), notBefore: certificate.notBefore.value.toISOString(), notAfter: certificate.notAfter.value.toISOString() };
  } catch { /* A structured invalid report is safer than turning verification into a 500. */ }
  return {
    schemaVersion: 1, byteRangeValid, cmsSignatureValid, documentIntegrityValid: byteRangeValid && cmsSignatureValid,
    certificateTrust: 'not_evaluated', profile: 'PAdES-B-B', signerCertificate,
    limitations: ['Certificate-chain trust, revocation and qualified trust-list status are not evaluated by the built-in verifier.', 'No trusted timestamp or long-term validation material is embedded; this is PAdES-B-B, not B-LT or B-LTA.'],
  };
}

export const pdfSha256 = (input: Uint8Array): string => createHash('sha256').update(input).digest('hex');
