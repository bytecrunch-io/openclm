# Production readiness

Bytecrunch Contracts now has a production-oriented application boundary, but it is not yet approved for real contract execution. Treat production review/collaboration and production electronic signing as separate release gates.

## Implemented safeguards

- Production configuration fails closed unless PostgreSQL, OIDC, HTTPS URLs, SMTP, and non-development secrets are configured.
- The local signature witness cannot be enabled with `NODE_ENV=production`. A deployment may run with `SIGNING_MODE=disabled` while a signing provider is being implemented.
- Signature orchestration has a provider interface. Development signatures record a provider reference, authentication method, versioned consent, timestamp, and exact content hash.
- Entering signing freezes an immutable, hashed JSON snapshot. Execution creates a downloadable completion manifest containing active and invalidated signature evidence.
- `/health` reports liveness. `/health/ready` reports whether persistent storage, OIDC, and a non-development signing mode are present.
- Agreement lifecycle events are written to an append-only table with their revision, status, content hash, timestamp, and event digest.
- Lifecycle aggregate updates, audit-event appends, and webhook-outbox inserts share one PostgreSQL transaction.
- Webhook deliveries use a persistent outbox, exponential retry, delivery IDs, response/error history, administrative inspection, and manual replay.
- Production webhook registration and delivery require HTTPS and reject hostnames or resolved addresses that point at local/private networks. Production infrastructure should additionally restrict API egress at the network layer.
- Integration condition evaluation is scoped by customer entity, integration, and opaque subject. Unlinked subjects return unmet conditions without exposing agreement data.
- Staff signing is bound to the authenticated account's own creator-participant record; external subject identifiers cannot be used at the staff signing boundary.

## Release gates still open

### Contract execution

The built-in signing provider is a development witness. Before enabling real signatures, choose the required assurance level by contract type and jurisdiction, then implement an external provider adapter that renders and freezes a deterministic PDF, binds every signer to that artifact, verifies signed callbacks, stores the sealed artifact and provider evidence, and produces a completion certificate. Keep signing disabled in production until this is complete. The current JSON snapshot and completion manifest make the lifecycle testable but are not substitutes for a signed PDF or provider certificate.

The European Commission distinguishes simple, advanced, and qualified electronic signatures and provides DSS as an open-source implementation/reference for formats including PAdES. This is an architecture input, not a claim that any deployment is legally compliant. Obtain legal review for supported jurisdictions and use cases.

### Evidence and persistence

- Move the provider-attributed signature evidence currently retained in agreement snapshots/manifests into normalized immutable relational records, including callback evidence and artifact references.
- Make initial agreement creation, invitation issuance, notification enqueue, and signing-artifact creation participate in explicit workflow transactions. Lifecycle aggregate updates, audit appends, and webhook enqueue are already atomic, but these adjacent records currently use separate transactions and require idempotent recovery.
- Add immutable object storage with retention locks for source, final, executed, and certificate artifacts.
- Define retention, deletion, legal-hold, export, and data-residency policies.

### Operations and security

- Put secrets in a managed secret store and document rotation procedures.
- Run PostgreSQL backup/restore drills and object-store recovery tests.
- Add metrics, tracing, alerting, queue-depth/age alerts, and webhook dead-letter operations.
- Add dependency, container, SAST, DAST, and secret scanning to CI.
- Complete resource-level authorization tests, abuse/rate-limit controls, formal accessibility testing, privacy review, threat modelling, penetration testing, and an external security review.
- Select an open-source license and establish a private security contact with a disclosure SLA.

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
SMTP_HOST=...
SIGNING_MODE=disabled
```

`SIGNING_MODE=disabled` is the only safe production setting currently available. Introducing another value must require a real provider implementation and provider-specific readiness checks, not merely a configuration change.

## Reference baselines

- [European Commission eSignature](https://eidas.ec.europa.eu/)
- [European Commission DSS and supported signature formats](https://ec.europa.eu/digital-building-blocks/sites/display/DIGITAL/Digital+Signature+Service+-++DSS)
- [NIST SP 800-63-4 Digital Identity Guidelines](https://pages.nist.gov/800-63-4/sp800-63.html)
- [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
