# Operations runbook

## Deployment modes

- Local development uses Compose, local Keycloak, Mailpit, PostgreSQL, and the development signature witness.
- A deployed test environment uses `NODE_ENV=staging`, real HTTPS/OIDC/SMTP/PostgreSQL, isolated test data, and may use the development witness. Every screen and test agreement must be labelled non-production operationally.
- Production uses `NODE_ENV=production`. Configuration fails closed, inline artifact storage and the development witness/seal are rejected. Use `SIGNING_MODE=disabled` for review-only service, or `SIGNING_MODE=platform` with `PDF_SEAL_MODE=p12` after the signing release checklist is accepted.

Never promote a staging database, signing key, invitation, or artifact volume into production.

## Health and monitoring

- `/health` is the liveness probe.
- `/health/ready` actively checks PostgreSQL and artifact storage and verifies deployment safety settings.
- `/metrics` exposes Prometheus text format and requires `Authorization: Bearer $METRICS_TOKEN`.
- Alert on readiness failures, 5xx rate, p95 latency, process restarts/memory, SMTP failures, webhook failures/dead letters, PostgreSQL capacity/replication lag, artifact-volume capacity, certificate expiry, and backup age.

An execution commits signer evidence before producing adjacent PDF artifacts. If storage or the seal credential is temporarily unavailable, the agreement remains executed and no signer should sign again. After remediation call `POST /v1/agreements/{agreementId}/finalize` (or `POST /public/session/finalize` from the recipient session). Finalization is content-addressed and idempotently resumes from existing artifacts.

Webhook and email delivery stop retrying after `DELIVERY_MAX_ATTEMPTS`. Both channels claim work with PostgreSQL row locks so multiple API replicas do not concurrently send the same record. Entity-scoped delivery APIs expose dead letters and permit replay after remediation. Prometheus reports pending, failed, and dead-letter counts plus the oldest queued-item age for each channel.

## Backup and recovery

Back up PostgreSQL and artifact storage as one recovery set. Artifacts are content-addressed, so restoration can be verified against metadata digests.

Example PostgreSQL backup:

```bash
pg_dump --format=custom --no-owner --file=contracts.dump "$DATABASE_URL"
pg_restore --list contracts.dump
```

For filesystem storage, snapshot or copy the complete `ARTIFACT_STORAGE_PATH` using the volume provider's consistent snapshot mechanism. A cloud adapter must use its provider's versioning/retention and inventory export.

Recovery drill:

1. Restore PostgreSQL into an isolated database.
2. Restore artifacts into an isolated storage namespace.
3. Start the same application version with outbound email/webhooks blocked.
4. Verify readiness, tenant counts, agreement lifecycle history, and a sample of artifact SHA-256 headers.
5. Exercise recipient return access and export an executed evidence package.
6. Record recovery point, recovery time, operator, discrepancies, and corrective actions.

Run the drill before launch and at least quarterly. A backup is not accepted until a restoration drill succeeds.

## Secret rotation

Store secrets in the deployment platform's managed secret facility. Restrict access and audit reads. Rotate OIDC, SMTP, metrics, rate-limit, session, webhook, signing-provider, and storage credentials independently.

Rotating `SESSION_SECRET` invalidates active staff and recipient sessions. Plan a maintenance notice. Webhook-secret rotation requires a dual-key verification window in consumers; the application currently has one active webhook key, so coordinate the cutover. Never log invitation tokens, login codes, session cookies, or artifact content in production.

Rotate the PDF seal before expiry and retain old public certificates for historical validation. Mount the replacement PKCS#12 credential through the secret manager, restart the API, execute a synthetic agreement, and verify it in the built-in verifier plus the chosen independent PDF validator. Rotation changes only new seals; immutable historical PDFs are never re-signed.

## Incident response

1. Preserve logs, lifecycle events, evidence metadata, and affected artifact hashes.
2. Revoke exposed invitations/sessions and rotate the relevant credential.
3. Disable signing or outbound delivery if evidence integrity may be affected.
4. Identify affected tenants and legal/privacy notification obligations.
5. Restore only from a verified recovery point and publish a post-incident report.

Independent penetration testing, privacy/legal review, and jurisdiction-specific signing review remain external launch activities; record their scope, findings, remediation, and acceptance owner.
