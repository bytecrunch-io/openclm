# Production readiness

Bytecrunch Contracts now has a production-oriented application boundary, but it is not yet approved for real contract execution. Treat production review/collaboration and production electronic signing as separate release gates.

## Implemented safeguards

- Production configuration fails closed unless PostgreSQL, OIDC, HTTPS URLs, SMTP, and non-development secrets are configured.
- The local signature witness cannot be enabled with `NODE_ENV=production`. A deployment may run with `SIGNING_MODE=disabled` while a signing provider is being implemented.
- Signature orchestration has a provider interface. Development signatures record a provider reference, authentication method, versioned consent, timestamp, and exact content hash.
- Provider-attributed signature evidence is normalized independently from agreement JSON and committed in the same transaction as its lifecycle event; reopening review appends evidence that explicitly supersedes the active signature record.
- Entering signing freezes an immutable, hashed JSON snapshot. Execution creates a downloadable completion manifest containing active and invalidated signature evidence.
- `/health` reports liveness. `/health/ready` actively probes storage and reports whether persistent storage, OIDC, and a safe non-development signing configuration are present. Disabled signing is safe for review-only deployment; it is not labelled as production signing.
- Agreement lifecycle events are written to an append-only table with their revision, status, content hash, timestamp, and event digest.
- Lifecycle aggregate updates, audit-event appends, and webhook-outbox inserts share one PostgreSQL transaction.
- Webhook deliveries use a persistent outbox, exponential retry, delivery IDs, response/error history, administrative inspection, and manual replay.
- Production webhook registration and delivery require HTTPS and reject hostnames or resolved addresses that point at local/private networks. Production infrastructure should additionally restrict API egress at the network layer.
- Webhook delivery refuses redirects, and browser state-changing requests with an `Origin` header must match the configured application origin.
- Sensitive public authentication and token-exchange routes use a PostgreSQL-backed rate limiter shared by all API replicas. Forwarded client-address headers are ignored unless `TRUST_PROXY=true` is explicitly configured behind a sanitising proxy.
- Integration condition evaluation is scoped by customer entity, integration, and opaque subject. Unlinked subjects return unmet conditions without exposing agreement data.
- Staff signing is bound to the authenticated account's own creator-participant record; external subject identifiers cannot be used at the staff signing boundary.
- Artifact bytes use a provider-neutral, content-addressed storage capability with integrity verification. Production rejects inline database storage; the filesystem/PVC adapter is available for deployment testing.
- Every new evidence artifact records a configurable earliest-disposal date (seven years by default) and legal-hold metadata; no automatic deletion path exists.
- Prometheus request/latency/process metrics are bearer-protected, and delivery attempts become explicit dead letters after a configurable bound.
- Replicated workers claim email and webhook records with PostgreSQL row locks; both delivery channels have entity-scoped inspection/replay APIs and queue depth/age metrics.
- Dependency audit, CodeQL, secret/misconfiguration scanning, container scanning, and automated dependency updates are configured in GitHub Actions.
- The operations runbook defines deployment modes, monitoring, secret rotation, backup/restore drills, and incident response.

## Release gates still open

### Contract execution

The built-in signing provider is a development witness. Before enabling real signatures, choose the required assurance level by contract type and jurisdiction, then implement an external provider adapter that renders and freezes a deterministic PDF, binds every signer to that artifact, verifies signed callbacks, stores the sealed artifact and provider evidence, and produces a completion certificate. Keep signing disabled in production until this is complete. The current JSON snapshot and completion manifest make the lifecycle testable but are not substitutes for a signed PDF or provider certificate.

The European Commission distinguishes simple, advanced, and qualified electronic signatures and provides DSS as an open-source implementation/reference for formats including PAdES. This is an architecture input, not a claim that any deployment is legally compliant. Obtain legal review for supported jurisdictions and use cases.

### Evidence and persistence

- Extend normalized signature evidence with the selected provider's verified callback payload and sealed-artifact references.
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
ARTIFACT_STORAGE_DRIVER=filesystem
ARTIFACT_STORAGE_PATH=/var/lib/bytecrunch/artifacts
ARTIFACT_RETENTION_DAYS=2555
```

`SIGNING_MODE=disabled` is the only safe production setting currently available. Introducing another value must require a real provider implementation and provider-specific readiness checks, not merely a configuration change.

## Reference baselines

- [European Commission eSignature](https://eidas.ec.europa.eu/)
- [European Commission DSS and supported signature formats](https://ec.europa.eu/digital-building-blocks/sites/display/DIGITAL/Digital+Signature+Service+-++DSS)
- [NIST SP 800-63-4 Digital Identity Guidelines](https://pages.nist.gov/800-63-4/sp800-63.html)
- [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
