# FiftySixty single-host deployment

This profile runs ByteCrunch Contracts as a standalone customer-entity CLM on one EC2 host. FiftySixty is a customer entity, not a special platform workspace. Cognito authenticates staff and Google Drive receives a downstream copy of each executed PDF; PostgreSQL plus the filesystem artifact volume remain authoritative.

## 1. Add the Cognito client

In the FiftySixty `AuthStack`, create a dedicated confidential user-pool client for Contracts. Reuse the existing user pool and Google identity provider, enable authorization-code flow with `openid`, `email`, and `profile`, generate a secret, and configure:

- callback: `https://api.contracts.fiftysixty.com/auth/callback`
- logout: `https://contracts.fiftysixty.com`
- supported identity provider: Google

Do not reuse the console public client or the machine-to-machine client. The CLM keys identities by the Cognito issuer plus `sub`; Google is intentionally not a second CLM identity system. The existing Cognito pre-signup policy continues to decide which email domains may authenticate.

Copy the new client ID and secret into `deploy/.env.fiftysixty`. The issuer and Hosted UI endpoint split in the example is intentional: tokens are verified against the regional Cognito issuer while browser authorization uses `auth.fiftysixty.com`.

## 2. Prepare Google Drive export

Create a dedicated Google service account and a destination folder for executed contracts. For direct service-account access, use a Shared Drive and share only that folder with the service-account email; service accounts do not have personal Drive storage quota. Put its JSON credential at `deploy/secrets/google-service-account.json` with mode `0600` and set `GOOGLE_DRIVE_FOLDER_ID`.

If Workspace policy requires domain-wide delegation, authorize the Drive scope and set `GOOGLE_DRIVE_IMPERSONATE_EMAIL` to a dedicated automation user. Delegation is optional and broader than sharing one folder.

The export plugin queries by agreement ID plus sealed-artifact SHA-256 before uploading, so retries do not create duplicates. Export happens after the sealed PDF is durably retained. A Drive failure is logged and retried the next time completion is ensured; it never reverses an execution.

## 3. Configure the customer entity

Copy `deploy/fiftysixty.env.example` to `deploy/.env.fiftysixty` and populate every `CHANGE_` value. URL-encode the database password when placing it in `DATABASE_URL`. `BOOTSTRAP_MEMBER_EMAIL_DOMAINS` maps verified first-time staff into the FiftySixty entity as contract managers and signatories. Only addresses in `BOOTSTRAP_ADMIN_EMAILS` become entity administrators.

After the initial administrator logs in, open **Settings → Entity branding** to upload the logo and logomark and select the brand colours. Images are limited to PNG, JPEG, or WebP under 300 KB and are stored with the entity. Participant contract pages inherit the sender entity's presentation.

## 4. Run on EC2

A nano instance is acceptable for an initial low-volume test, but image builds and PDF sealing can exhaust its memory. Build images in CI or use temporary swap during deployment, monitor memory, and move up an instance size before real volume.

Install Docker Compose, place the repository on the host, and terminate TLS in a trusted reverse proxy or load balancer. Route the web origin to `127.0.0.1:3000` and the API origin to `127.0.0.1:3001`; never expose PostgreSQL publicly.

```bash
cd deploy
cp fiftysixty.env.example .env.fiftysixty
mkdir -p secrets
docker compose --env-file .env.fiftysixty -f docker-compose.fiftysixty.yml up -d --build
```

The compose file intentionally omits Keycloak and Mailpit. Persist and encrypt both named volumes, restrict the EC2 security group to HTTPS and operator SSH, and mount the PKCS#12 seal plus Google credential read-only under `deploy/secrets`.

## 5. Acceptance checks

1. A configured FiftySixty administrator signs in through Google → Cognito and lands in the `fiftysixty` entity.
2. A second allowed-domain employee signs in and receives contract-manager/signatory permissions but cannot manage members or branding.
3. An unapproved email cannot pass Cognito; an authenticated user outside the bootstrap domains receives no automatic entity membership.
4. Branding appears in both the staff shell and a private recipient invite.
5. Execute a two-party agreement, validate the sealed ByteCrunch PDF, and confirm exactly one matching PDF appears in the target Drive folder.
6. Temporarily deny Drive access and execute a test agreement. Execution must still complete and retain all evidence locally; restore access and use `POST /v1/agreements/{agreementId}/finalize` to complete the export retry.

Use the full [signing test plan](./signing-test-plan.md) before production signatures.
