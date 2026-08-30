# Electronic signing and sealed-PDF test plan

## Purpose and release claim

This plan verifies Bytecrunch Contracts' built-in ordinary electronic-signature flow and its PAdES-B-B organizational seal. It covers the exact document presented for signature, authenticated intent and authority evidence, unordered multi-party signing, signature invalidation, immutable artifacts, completion records, cryptographic integrity, recovery, privacy, and interoperability.

Passing this plan supports only this claim:

> The application records an authenticated electronic-signing ceremony, binds each signer to a frozen PDF by SHA-256, and seals the final evidence-bearing PDF with the deployment operator's certificate so later byte changes are detectable.

It does not establish an advanced or qualified electronic signature, a signer-owned certificate, certificate trust, a qualified timestamp, revocation status, or PAdES-B-LT/B-LTA. Those require a separate QTSP/DSS profile and test plan.

Backup/restore drilling and penetration testing are explicit project-owner exclusions for this release. They are not marked as passed by this document.

## Environments and evidence

Run automated tests on every pull request. Run the staging and interoperability sections against the exact release image and production-like configuration before enabling `SIGNING_MODE=platform`.

Record for each manual run:

- release commit and container digest;
- environment URL, browser/OS/device versions, PostgreSQL version, and artifact-storage adapter;
- seal certificate subject, issuer, serial, validity dates, SHA-256 fingerprint, and whether the chain is independently trusted;
- test-case ID, operator, UTC timestamp, result, screenshots, downloaded artifacts and their SHA-256 values;
- issue link and accepted owner for every deviation.

Never use production contracts, production invitation links, or the production private key in automated/local tests.

## Release configurations

| Profile | Required configuration | Expected result |
| --- | --- | --- |
| Local | `NODE_ENV=development`, `SIGNING_MODE=development`, `PDF_SEAL_MODE=development` | Full flow works with an ephemeral self-signed seal and is visibly treated as development evidence. |
| Staging platform | `NODE_ENV=staging`, `SIGNING_MODE=platform`, `PDF_SEAL_MODE=p12` | Full flow uses a non-production deployment PKCS#12 credential. |
| Production review-only | `NODE_ENV=production`, `SIGNING_MODE=disabled`, `PDF_SEAL_MODE=disabled` | Review works; signing returns a controlled unavailable response. |
| Production signing | `NODE_ENV=production`, `SIGNING_MODE=platform`, `PDF_SEAL_MODE=p12` | Startup requires a readable P12 path and password; executed artifacts use the deployment certificate. |

## Automated gate

Run from a clean checkout with Node.js 22 or newer:

```bash
npm ci
npm run check
npm test
npm run build
npm audit --omit=dev
docker compose config --quiet
git diff --check
```

Required outcome: every command exits zero; generated OpenAPI is unchanged after `npm run check`; no high/critical production dependency vulnerability is unreviewed.

The current automated suite directly covers deterministic PDF output, explicit unsupported-glyph failure, pagination, frozen-artifact binding, PAdES ByteRange parsing, CMS signature verification, single-byte tamper failure, completion artifacts, public verification, and the principal two-party lifecycle.

## A. Rendering and frozen-envelope tests

| ID | Test | Expected result | Level |
| --- | --- | --- | --- |
| PDF-001 | Render the same fully materialized agreement twice with identical timestamps and fields. | Bytes and SHA-256 are identical. | Automated |
| PDF-002 | Render empty lines, numbered clauses, uppercase headings, long words, and a document spanning at least five pages. | No clipping/overlap; header/footer and page numbers are present on every page. | Automated + visual |
| PDF-003 | Render Danish and Western European party names/addresses. | Characters are correct in application, signing PDF, executed PDF, and certificate. | Manual |
| PDF-004 | Render a currently unsupported glyph set such as CJK. | Preparation fails clearly before signing; no replacement boxes or corrupted artifact is stored. | Automated |
| PDF-005 | Use typed signatures and PNG drawings with transparent and semi-transparent pixels. | Marks are visibly embedded in the document; page color shows through transparent pixels and no canvas-colored rectangle appears. | Manual |
| PDF-006 | Include large and malformed PNG signature inputs. | Schema size/type limits reject invalid data; renderer safely falls back or fails without partial execution. | Automated extension |
| PDF-007 | Prepare a revision for signing twice. | One signing PDF exists for the revision/content hash and the same active envelope is reused. | Automated extension |
| PDF-008 | Compare the signing PDF hash with every resulting `SignatureRecord.signedArtifactSha256`. | Every value exactly matches; envelope ID and revision match. | Automated |
| PDF-009 | Change accepted contract text and prepare a new revision. | A new content hash, signing PDF, and envelope are created; the old artifacts remain immutable. | Automated extension |
| PDF-010 | Inspect the executed PDF. | Signature blocks and the electronic completion record are inside the PDF; raw `{{signature_blocks}}` is absent. | Manual |

## B. Identity, intent, authority, and signer ordering

| ID | Test | Expected result |
| --- | --- | --- |
| SIG-001 | Staff signs with OIDC after selecting the correct customer entity. | Evidence records `oidc`, the account-linked participant, entity/party, capacity, consent version, UTC time, content hash, PDF hash, and envelope ID. |
| SIG-002 | Recipient signs from a fresh invite, email-code return, passkey return, and integration handoff. | Evidence records the actual authentication method; no flow can select another participant record. |
| SIG-003 | Decline intent checkbox or omit `intentConfirmed: true`. | Request is rejected and no status/evidence/artifact changes. |
| SIG-004 | Sign before onboarding or without authority confirmation. | Request is rejected with an actionable message. |
| SIG-005 | Sender signs first, then counterparty. | First signature yields `partially_signed`; second yields `executed`. |
| SIG-006 | Counterparty signs first, then sender. | Same final result and evidence set; no hidden order dependency. |
| SIG-007 | Configure multiple parties, several signatories, optional signers, and `minimumSignatures` below signer count. | Execution occurs only when each party's required threshold is met; optional unsigned people do not block it. |
| SIG-008 | Submit two simultaneous sign requests for one participant. | Exactly one active evidence row and one accepted ceremony result; the other request is rejected/idempotently resolved. This is a required concurrency test before launch. |
| SIG-009 | Attempt staff signing for a participant linked to another account or external subject. | Rejected; no evidence is created. |
| SIG-010 | Close the browser after signing and return through `/inbox`. | Agreement and signature remain available through durable account access; the invitation token is not reusable as authentication. |

## C. Review reopening and invalidation

| ID | Test | Expected result |
| --- | --- | --- |
| INV-001 | One party signs; an unsigned reviewer chooses reopen, reads the warning, and submits the exact confirmation. | Active signatures are removed from the agreement view, append-only evidence becomes invalidated, the envelope becomes invalidated, and review resumes. |
| INV-002 | Cancel either confirmation step. | Nothing changes. |
| INV-003 | A participant who already signed attempts to reopen. | Rejected under the current policy. |
| INV-004 | Edit after reopening and prepare again. | New revision/envelope/PDF; prior signature and artifact remain in invalidated history and cannot count toward execution. |
| INV-005 | Attempt to sign against the invalidated or stale envelope directly. | Rejected before evidence mutation. |
| INV-006 | Reopen after full execution. | Rejected; executed artifact set remains immutable. Any amendment must be a new agreement/workflow. |

## D. Seal and cryptographic validation

| ID | Test | Expected result |
| --- | --- | --- |
| CRY-001 | Complete an agreement in platform mode. | Executed PDF contains `/ByteRange`, a detached CMS signature with `ETSI.CAdES.detached`, and reports profile `PAdES-B-B`. |
| CRY-002 | Run built-in validation immediately. | `byteRangeValid`, `cmsSignatureValid`, and `documentIntegrityValid` are true. |
| CRY-003 | Flip one covered byte without changing file length. | CMS and document-integrity results are false. |
| CRY-004 | Append bytes, truncate, replace the signature contents, or alter ByteRange values. | Validation fails closed for every mutation. |
| CRY-005 | Compare artifact bytes with metadata and `x-content-sha256`. | All SHA-256 values match exactly; storage read rejects mismatches. |
| CRY-006 | Start production platform mode with missing path, wrong password, corrupt P12, expired certificate, or key/certificate mismatch. | Missing configuration fails startup. Invalid credential material fails finalization without losing committed signer evidence; the error is observable and retryable. Expiry must be caught by release monitoring/manual validation even though CMS math can remain valid. |
| CRY-007 | Inspect the CMS signer certificate. | Subject, issuer, serial, and validity match the mounted deployment credential, never the ephemeral local certificate. |
| CRY-008 | Validate with Adobe Acrobat/Reader and at least one independent validator (recommended: EU DSS deployed privately). | Signature structure is recognized; integrity passes. Record trust-chain warnings separately and do not reinterpret them. |
| CRY-009 | Validate with the certificate removed from local trust stores. | Built-in result remains `certificateTrust: not_evaluated`; UI does not claim qualified/trusted status. |
| CRY-010 | Rotate to a new P12 and execute a synthetic agreement. | New PDF uses the new certificate; old PDF remains byte-identical and independently validates with its embedded old certificate. |

## E. Artifacts, completion, and recovery

Every execution must produce exactly one current-revision artifact of each kind:

1. `signing_snapshot` (`application/json`)
2. `signing_pdf` (`application/pdf`)
3. `executed_pdf` (`application/pdf`)
4. `validation_report` (`application/json`)
5. `completion_certificate` (`application/pdf`)
6. `completion_manifest` (`application/json`)

| ID | Test | Expected result |
| --- | --- | --- |
| ART-001 | Download all artifacts as authorized staff and recipient. | Correct media type, safe filename, SHA-256 header, and bytes; storage internals and inline base64 are never returned as metadata. |
| ART-002 | Read completion manifest v3. | It references envelope, signatures, normalized evidence, executed PDF, validation report, certificate, seal profile/provider, verification code, and exact hashes. |
| ART-003 | Inspect standalone completion certificate. | Human-readable agreement/revision/time/hash/seal/signing summary; clearly says it is not an X.509 or qualified-signature certificate. |
| ART-004 | Fail storage before executed PDF write, after executed PDF, after validation report, and after completion certificate. | Signer event remains committed once. Calling either finalize endpoint resumes without duplicate/conflicting artifacts and produces a complete set. |
| ART-005 | Call finalization repeatedly and concurrently. | Same artifact IDs/hashes are returned; uniqueness conflicts do not surface to users. Add a concurrency regression test before launch. |
| ART-006 | Corrupt stored bytes behind the adapter. | Download/finalization rejects the artifact through SHA-256 integrity checking and emits an operational error. |
| ART-007 | Run with filesystem/PVC and the selected production adapter. | Content addressing, immutable writes, health checks, retention metadata, and recovery semantics are equivalent. |

## F. Public verification and privacy

| ID | Test | Expected result |
| --- | --- | --- |
| VER-001 | Open `/verify/{code}` from the executed PDF or app. | Title, revision, completion time, parties/signers, artifact hash, seal profile, integrity result, limitations, and download work without login. |
| VER-002 | Use a random, malformed, draft-agreement, or invalidated code. | Uniform 404-style response; no tenant, email, existence, or status leak. |
| VER-003 | Enumerate codes and exceed the request limit. | 192-bit random codes are impractical to guess and shared rate limiting returns 429. |
| VER-004 | Inspect response and page source. | No participant email, IP address, invitation token, authentication credential, private storage key, or raw evidence payload is exposed. |
| VER-005 | Tamper with a downloaded PDF and compare its SHA-256 to the verification page. | Hash differs and independent/built-in validation fails. |
| VER-006 | Exercise desktop/mobile, system/light/dark themes, keyboard-only use, and screen reader labels. | Status is conveyed in text, not color alone; focus, button loading, wrapping, and download remain usable. |

## G. Security and abuse regression

- Tenant A cannot list/download/finalize Tenant B artifacts using raw IDs.
- Recipient A cannot access Recipient B's artifacts or signing action by changing agreement/participant IDs.
- Public verification cannot be used to download non-executed or superseded signing PDFs.
- State-changing session/finalization requests enforce origin/CSRF policy; all public authentication and verification routes use the shared limiter.
- SVG, HTML, JavaScript, control characters, path traversal, CR/LF filenames, oversized content, malformed data URLs, and hostile template variables cannot become executable PDF/app content or storage paths.
- Logs and errors contain no P12 password, private key, signature image data, invitation token, login code, session cookie, artifact bytes, or raw PII evidence.
- A signer cannot replace `signedArtifactSha256`, envelope ID, signing time, authentication method, provider ID, or consent text through request input.
- Production refuses the ephemeral witness/seal and inline database artifact storage.

Resource authorization and concurrency cases above are required regression work. The separate penetration-test release gate is excluded, not silently satisfied.

## H. Browser and document-reader matrix

Manually execute the two-party flow in current stable versions of:

- Chrome and Safari on macOS;
- Edge on Windows;
- Safari on iOS and Chrome on Android;
- Adobe Acrobat Reader on macOS and Windows;
- the browser-native PDF viewers used above;
- one independent standards validator.

For each, verify invite/onboarding, direct review, typed signature, drawn transparent signature, sender-first and recipient-first signing, sealed-PDF download, signature-panel recognition, completion-page readability, and verification-page download. Record layout or trust warnings verbatim.

## I. Performance and capacity

Use representative documents at 1, 25, 100, and 500 pages, with 2, 10, and 50 signatories where supported. Measure render time, seal time, finalization latency, memory peak, output size, download latency, and concurrent finalization behavior. Define deployment-specific SLOs before launch. At minimum:

- the API must not block unrelated health or read requests during RSA/PDF work;
- request/body limits must reject pathological documents and signature images before memory exhaustion;
- storage capacity alerts must account for six immutable artifacts per executed revision;
- timeouts must leave execution recoverable through idempotent finalization.

If synchronous sealing breaches the deployment latency budget, move finalization to a durable worker and expose a `finalizing` state; do not weaken artifact or evidence semantics.

## J. Acceptance checklist

Production platform signing may be enabled only when:

- all automated commands pass on the release commit;
- SIG-008 and ART-005 concurrency tests are implemented and pass;
- the actual production-style P12 succeeds in staging and its custody/rotation owner is recorded;
- PDF rendering is accepted for the organization's real templates, addresses, transparent signatures, page counts, and supported character sets;
- Acrobat plus an independent validator recognize the PAdES-B-B structure and detect tampering;
- storage-failure recovery/finalization cases pass with the selected artifact adapter;
- public verification privacy, rate-limit, accessibility, and mobile checks pass;
- legal/product owners explicitly accept ordinary-signature assurance for the intended agreement classes and jurisdictions;
- monitoring covers finalization failures, incomplete executed artifact sets, certificate expiry, storage errors/capacity, and verification error rate;
- every accepted exclusion has an owner and review date.

The release must remain `SIGNING_MODE=disabled` if any applicable required item is unresolved. A future AES/QES or PAdES-B-LT/B-LTA claim requires a new assurance profile rather than an exception to this checklist.
