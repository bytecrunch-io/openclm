import { randomUUID } from "node:crypto";
import {
  SignatureRecordSchema,
  type Agreement,
  type Participant,
  type SignatureInput,
  type SignatureRecord,
} from "@bytecrunch/contracts-domain";
import { config } from "./config.js";

export type SignatureAuthenticationMethod =
  SignatureRecord["authenticationMethod"];

export interface SigningProvider {
  readonly kind: "development_witness" | "platform_electronic_signature" | "external_provider";
  sign(input: {
    agreement: Agreement;
    participant: Participant;
    signature?: SignatureInput;
    authenticationMethod: SignatureAuthenticationMethod;
    signedAt: string;
  }): Promise<SignatureRecord>;
}

class PlatformSigningProvider implements SigningProvider {
  readonly kind: SigningProvider['kind'];
  constructor(kind: SigningProvider['kind']) { this.kind = kind; }

  async sign(
    input: Parameters<SigningProvider["sign"]>[0],
  ): Promise<SignatureRecord> {
    if (!['development', 'platform'].includes(config.SIGNING_MODE))
      throw new Error(
        "Electronic signing is not configured for this deployment.",
      );
    const envelope = input.agreement.signingEnvelope;
    if (!envelope || envelope.status !== 'active' || envelope.revision !== input.agreement.revision || envelope.contentSha256 !== input.agreement.contentSha256) {
      throw new Error('The frozen signing document is missing or stale. Prepare the current revision for signature again.');
    }
    return SignatureRecordSchema.parse({
      ...(input.signature ?? {
        method: "typed" as const,
        typedName: input.participant.name,
        imageDataUrl: null,
      }),
      signedContentSha256: input.agreement.contentSha256,
      signedArtifactSha256: envelope.signingArtifactSha256,
      signingEnvelopeId: envelope.id,
      signedAt: input.signedAt,
      provider: this.kind,
      providerSignatureId: `devsig_${randomUUID()}`,
      authenticationMethod: input.authenticationMethod,
      consentText:
        "I intend to sign this agreement electronically and adopt this mark as my signature.",
      consentVersion: "2026-08-30",
    });
  }
}

const developmentProvider = new PlatformSigningProvider('development_witness');
const platformProvider = new PlatformSigningProvider('platform_electronic_signature');

export function signingProvider(): SigningProvider {
  if (config.SIGNING_MODE === "development") return developmentProvider;
  if (config.SIGNING_MODE === "platform") return platformProvider;
  throw new Error("Electronic signing is not configured for this deployment.");
}
