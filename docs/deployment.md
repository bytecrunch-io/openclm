# Deployment guide

The first deployment should be an isolated staging environment. It can exercise the complete workflow with the development signing witness, but its agreements and signatures are test data and must never be represented as production electronic signatures.

## Runtime topology

Deploy the web image and API image behind HTTPS, with PostgreSQL, SMTP, an OIDC provider, and durable artifact storage. Build the web image with `VITE_API_URL` set to the public API origin. Give the API a persistent, writable mount at `ARTIFACT_STORAGE_PATH` and run at least one API replica.

The application is not coupled to S3. Its agreement layer uses a provider-neutral artifact capability and persists only an opaque storage key plus SHA-256 digest. The built-in `filesystem` adapter works with any durable mounted volume. A later GCS, OCI Object Storage, S3-compatible, or Arweave implementation belongs behind that interface and must define its own immutability, health, retention, and recovery behavior.

## Staging configuration

Start with [`deploy/staging.env.example`](../deploy/staging.env.example). Put populated secrets in the hosting platform's secret manager, not an environment file in the repository. Staging configuration fails closed unless it has PostgreSQL, OIDC, HTTPS browser endpoints, SMTP, non-default secrets, and non-inline artifact storage.

Use:

```dotenv
NODE_ENV=staging
SIGNING_MODE=development
ARTIFACT_STORAGE_DRIVER=filesystem
ARTIFACT_STORAGE_PATH=/var/lib/bytecrunch/artifacts
```

The artifact path may be a Kubernetes persistent volume, a managed container volume, or a mounted network filesystem. Confirm that its platform-level backup, encryption, retention, replication, and residency settings match the intended test. A successful application readiness check verifies the mount is readable and writable; it does not replace a restore drill.

The web and API origins may differ. Configure the OIDC client with the exact API callback URI, the web origin, and the expected logout/redirect URIs. `WEBAUTHN_RP_ID` is the web registrable host and `WEBAUTHN_ORIGIN` is its exact HTTPS origin. Set `TRUST_PROXY=true` only when the edge proxy removes client-supplied forwarding headers and writes trusted values itself.

## Deployment checks

After migrations/startup, both probes must pass:

```text
GET /health
GET /health/ready
```

Run the automated public-surface smoke check from a trusted operator machine:

```bash
DEPLOYMENT_WEB_URL=https://contracts-staging.example.com \
DEPLOYMENT_API_URL=https://api.contracts-staging.example.com \
METRICS_TOKEN='<metrics-token>' \
npm run smoke:deployment
```

Then complete the manual two-browser workflow in the README: create an entity-owned template, invite a recipient, negotiate, return through email-code login, sign in both orders, reopen before the second signature, and download the evidence artifacts. Confirm email delivery, webhook signatures/retries, dead-letter replay, tenant switching, and that `/metrics` is not reachable without its bearer token.

Run the manually dispatched **Staging DAST** GitHub workflow against these same HTTPS origins. It uses the official ZAP packaged baseline and OpenAPI scans and retains their reports as workflow artifacts. The public scan is a starting point; configure an authenticated ZAP context for staff and recipient roles before treating the DAST release gate as complete.

Before any production deployment, set `NODE_ENV=production` and keep `SIGNING_MODE=disabled`. Real contract execution remains blocked until a reviewed signing adapter produces and verifies a deterministic sealed document and provider evidence. Follow the remaining gates in [production readiness](./production-readiness.md) and the backup/incident procedures in [operations](./operations.md).
