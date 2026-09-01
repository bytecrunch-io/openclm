# Production readiness

Bytecrunch Contracts has a production-oriented application boundary and an ordinary electronic-signature implementation. Enabling that implementation remains an operator release decision: accept the intended assurance level, procure and protect the platform seal, and complete the relevant cases in the signing test plan. Treat review/collaboration, ordinary electronic signing, and any future advanced/qualified signing as separate release gates.

## Implemented safeguards

- Production configuration fails closed unless PostgreSQL, OIDC, HTTPS URLs, SMTP, and non-development secrets are configured.
- The local signature witness and ephemeral development seal cannot run with `NODE_ENV=production`. Production signing requires `SIGNING_MODE=platform`, `PDF_SEAL_MODE=p12`, and a mounted deployment PKCS#12 credential; review-only deployments use disabled modes.
- Signature orchestration records a provider reference, authentication method, versioned consent, timestamp, exact content hash, frozen signing-PDF hash, and signing-envelope ID.
- Provider-attributed signature evidence is normalized independently from agreement JSON and committed in the same transaction as its lifecycle event; reopening review appends evidence that explicitly supersedes the active signature record.
- Entering signing freezes immutable JSON and deterministic PDF artifacts. Execution renders document-native marks and a completion page, applies a PAdES-B-B detached CMS organizational seal, verifies its ByteRange and CMS signature, and stores the sealed PDF, completion certificate, validation report, and manifest.
- Executed artifacts have an opaque public verification code and a rate-limited verification page/API. The result intentionally separates document integrity from certificate-chain/trust-list status.
- Finalization is content-addressed, resumable, and idempotent through staff and recipient endpoints if storage or sealing fails after signature evidence commits.
- `/health` reports liveness. `/health/ready` actively probes storage and reports whether persistent storage, OIDC, and a safe non-development signing configuration are present. Disabled signing is safe for review-only deployment; it is not labelled as production signing.
- Agreement lifecycle events are written to an append-only table with their revision, status, content hash, timestamp, and event digest.
- Lifecycle aggregate updates, audit-event appends, and webhook-outbox inserts share one PostgreSQL transaction.
- Webhook deliveries use a persistent outbox, exponential retry, delivery IDs, response/error history, administrative inspection, and manual replay.
- Production webhook registration and delivery require HTTPS and reject hostnames or resolved addresses that point at local/private networks. Production infrastructure should additionally restrict API egress at the network layer.
- Webhook delivery refuses redirects, and browser state-changing requests with an `Origin` header must match the configured application origin.
- Sensitive public authentication and token-exchange routes use a PostgreSQL-backed rate limiter shared by all API replicas. Forwarded client-address headers are ignored unless `TRUST_PROXY=true` is explicitly configured behind a sanitising proxy.
- Entity-owned integration secrets are stored as hashes and shown only at creation/rotation. Client-credential tokens expire after five minutes, are audience-bound and scope-bound, and machine endpoints re-resolve the current entity integration on every request.
- Integration condition evaluation is scoped by customer entity, configured issuer, and opaque subject. Unknown subjects return unmet conditions without exposing agreement data, and decisions are correlation-ID-bearing and non-cacheable.
- Shared-OIDC handoffs require Authorization Code + PKCE and validate state, nonce, ID-token signature, issuer, audience, verified email, and exact expected subject before issuing an agreement-scoped participant session. The issuer, subject, authentication method, and provider authentication time are retained in signature evidence.
- Staff signing is bound to the authenticated account's own creator-participant record; external subject identifiers cannot be used at the staff signing boundary.
- Artifact bytes use a provider-neutral, content-addressed storage capability with integrity verification. Production rejects inline database storage; the filesystem/PVC adapter is available for deployment testing.
- Every new evidence artifact records a configurable earliest-disposal date (seven years by default) and legal-hold metadata; no automatic deletion path exists.
- Prometheus request/latency/process metrics are bearer-protected, and delivery attempts become explicit dead letters after a configurable bound.
- Replicated workers claim email and webhook records with PostgreSQL row locks; both delivery channels have entity-scoped inspection/replay APIs and queue depth/age metrics.
- Dependency audit, CodeQL, secret/misconfiguration scanning, container scanning, and automated dependency updates are configured in GitHub Actions.
- The operations runbook defines deployment modes, monitoring, secret rotation, backup/restore drills, and incident response.

## Release gates still open

### Contract execution assurance

The built-in production mode supports an authenticated ordinary electronic signature and a deployment-owned PAdES-B-B platform seal. Before enabling it, choose the required assurance level by contract type and jurisdiction, obtain an appropriate document-seal certificate, protect its private key, and pass the automated and selected manual cases in the signing test plan. The platform seal proves integrity of the final evidence-bearing PDF; it is not represented as a signer-owned certificate and does not by itself establish signer identity or authority.

If a use case requires advanced or qualified signatures, trusted timestamps, revocation material, or long-term validation, add a QTSP/DSS adapter. Such an adapter must verify provider callbacks, retain raw provider evidence, validate against the applicable trusted list, and emit PAdES-B-LT/B-LTA as required. Do not relabel the built-in mode.

The European Commission distinguishes simple, advanced, and qualified electronic signatures and provides DSS as an open-source implementation/reference for formats including PAdES. This is an architecture input, not a claim that any deployment is legally compliant. Obtain legal review for supported jurisdictions and use cases.

### Evidence and persistence

- For a future external/QTSP mode, extend normalized evidence with verified callback payloads and provider transaction references.
- Make initial agreement creation, invitation issuance, notification enqueue, and signing-artifact creation participate in explicit workflow transactions. Lifecycle aggregate updates, audit appends, and webhook enqueue are already atomic, but these adjacent records currently use separate transactions and require idempotent recovery.
- Select and implement the deployment's durable storage adapter and infrastructure retention policy. The application boundary is provider-neutral; filesystem/PVC is built in, while GCS, OCI, S3-compatible object lock, or Arweave require provider-specific adapters and recovery tests.
- Approve jurisdiction/customer-specific retention, deletion, legal-hold, export, and data-residency policies. The application records retention/hold metadata and supports evidence download, but final policy and controlled disposal require an accountable operator and the selected storage backend.

### Operations and security

- Configure the deployment's managed secret store and execute the documented rotation procedures.
- Execute and record PostgreSQL/artifact recovery drills in the selected infrastructure.
- Add distributed tracing and production alert rules in the selected observability platform.
- Run the manual ZAP workflow against staging, then add and execute authenticated contexts for staff and recipient roles; CI already covers dependency, CodeQL, secret/misconfiguration, and container scanning.
- Complete resource-level authorization tests, abuse/rate-limit controls, formal accessibility testing, privacy review, threat modelling, penetration testing, and an external security review.
- Establish a private security contact with a disclosure SLA. The code is licensed AGPL-3.0-only.

## Production configuration

Set at least:

```dotenv
NODE_ENV=production
DATABASE_URL=postgresql://...
AUTH_MODE=oidc
WEB_URL=https://contracts.example.com
OIDC_ISSUER_URL=https://identity.example.com/realms/contracts
OIDC_CLIENT_ID=bytecrunch-contracts
OIDC_CLIENT_SECRET=...
OIDC_REDIRECT_URI=https://api.contracts.example.com/auth/callback
SESSION_SECRET=<unique 32+ character secret>
WEBHOOK_SIGNING_SECRET=<unique 32+ character secret>
RATE_LIMIT_SECRET=<unique 32+ character secret>
TRUST_PROXY=true
METRICS_TOKEN=<unique 32+ character secret>
DELIVERY_MAX_ATTEMPTS=10
SMTP_HOST=...
SIGNING_MODE=disabled
PDF_SEAL_MODE=disabled
ARTIFACT_STORAGE_DRIVER=filesystem
ARTIFACT_STORAGE_PATH=/var/lib/bytecrunch/artifacts
ARTIFACT_RETENTION_DAYS=2555
```

For the built-in production mode replace those two values with:

```dotenv
SIGNING_MODE=platform
PDF_SEAL_MODE=p12
PDF_SEAL_P12_PATH=/run/secrets/contracts-seal.p12
PDF_SEAL_P12_PASSWORD=<secret-manager-value>
PDF_SEAL_NAME=Your Company Contracts
PDF_SEAL_LOCATION=Copenhagen, Denmark
PDF_SEAL_CONTACT=contracts@example.com
```

The built-in verifier checks PDF ByteRange coverage and CMS signature mathematics. It explicitly reports certificate trust as `not_evaluated`; independent chain, revocation, trust-list, and interoperability validation is a release test, not an inferred application claim.

## Reference baselines

- [European Commission eSignature](https://eidas.ec.europa.eu/)
- [European Commission DSS and supported signature formats](https://ec.europa.eu/digital-building-blocks/sites/display/DIGITAL/Digital+Signature+Service+-++DSS)
- [NIST SP 800-63-4 Digital Identity Guidelines](https://pages.nist.gov/800-63-4/sp800-63.html)
- [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
