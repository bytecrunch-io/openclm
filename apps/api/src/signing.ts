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
  readonly kind: "development_witness" | "external_provider";
  sign(input: {
    agreement: Agreement;
    participant: Participant;
    signature?: SignatureInput;
    authenticationMethod: SignatureAuthenticationMethod;
    signedAt: string;
  }): Promise<SignatureRecord>;
}

class DevelopmentSigningProvider implements SigningProvider {
  readonly kind = "development_witness" as const;

  async sign(
    input: Parameters<SigningProvider["sign"]>[0],
  ): Promise<SignatureRecord> {
    if (config.SIGNING_MODE !== "development")
      throw new Error(
        "Electronic signing is not configured for this deployment.",
      );
    return SignatureRecordSchema.parse({
      ...(input.signature ?? {
        method: "typed" as const,
        typedName: input.participant.name,
        imageDataUrl: null,
      }),
      signedContentSha256: input.agreement.contentSha256,
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

const developmentProvider = new DevelopmentSigningProvider();

export function signingProvider(): SigningProvider {
  if (config.SIGNING_MODE === "development") return developmentProvider;
  throw new Error("Electronic signing is not configured for this deployment.");
}
