# Artifact storage

Agreement evidence uses the `ArtifactStorage` capability in `apps/api/src/artifact-storage.ts`. Domain records contain an opaque storage key and SHA-256 digest; they do not contain bucket names, cloud URLs, or provider SDK types.

## Built-in adapters

- `database` stores base64 content in the artifact metadata record. It is convenient for tests and local development and is rejected by production configuration.
- `filesystem` stores content-addressed, write-once files beneath `ARTIFACT_STORAGE_PATH`. Reusing a key with different bytes fails. This works with a durable local disk or mounted persistent volume, but the volume provider must supply backup, replication, encryption, residency, and retention guarantees.

## Adapter contract

An adapter implements three operations:

1. `put(key, bytes, expectedSha256)` writes immutable bytes or verifies that identical bytes already occupy the key.
2. `get(...)` returns bytes and verifies the stored SHA-256 digest before release.
3. `healthCheck()` reports whether the backend is reachable for readiness checks.

Cloud-specific concerns stay inside the adapter. A GCS adapter may use generations and retention policies; OCI may use Object Storage retention rules; an S3-compatible adapter may use object lock; and an Arweave adapter may return a transaction identifier as the opaque key. An adapter must not report a successful write until the durability level required by the deployment has been reached.

`ARTIFACT_RETENTION_DAYS` records the earliest permitted disposal date on every artifact; the default is seven years. The application has no automatic deletion path and therefore retains artifacts after that date until an authorised policy process is implemented. `legalHold` is reserved in metadata and must prevent disposal when a future adapter adds deletion. Infrastructure retention must be at least as long as the recorded application retention.

The current filesystem adapter is sufficient for deployment testing with a backed-up volume. Before relying on evidence retention, select a backend and add its adapter plus provider-specific integration tests and infrastructure policy checks.
