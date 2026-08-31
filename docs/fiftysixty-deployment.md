# FiftySixty single-host deployment

This profile runs ByteCrunch Contracts as a standalone customer-entity CLM on one EC2 host. FiftySixty is created through the normal company onboarding flow, not as a special platform workspace. Cognito authenticates staff and Google Drive receives a downstream copy of each executed PDF; PostgreSQL plus the filesystem artifact volume remain authoritative.

## 1. Add the Cognito client

In the FiftySixty `AuthStack`, create a dedicated confidential user-pool client for Contracts. Reuse the existing user pool and Google identity provider, enable authorization-code flow with `openid`, `email`, and `profile`, generate a secret, and configure:

- callback: `https://api.contracts.fiftysixty.com/auth/callback`
- logout: `https://contracts.fiftysixty.com`
- supported identity provider: Google

Do not reuse the console public client or the machine-to-machine client. The CLM keys identities by the Cognito issuer plus `sub`; Google is intentionally not a second CLM identity system. The existing Cognito pre-signup policy continues to decide which email domains may authenticate.

After creating the FiftySixty entity, install **Enterprise SSO** in Settings and enter the client details there. The issuer and Hosted UI endpoint split is intentional: tokens are verified against the regional Cognito issuer while browser authorization uses `auth.fiftysixty.com`. The environment-based OIDC values remain the platform/recovery login, not the entity connection.

## 2. Prepare Google Drive export

Create a dedicated Google service account and a destination folder for executed contracts. For direct service-account access, use a Shared Drive and share only that folder with the service-account email; service accounts do not have personal Drive storage quota. Install **Google Drive** in the entity Settings, then paste the credential JSON and destination folder ID. The environment credential remains a self-hosting fallback when no entity installation exists.

If Workspace policy requires domain-wide delegation, authorize the Drive scope and enter a dedicated automation user in the plugin form. Delegation is optional and broader than sharing one folder.

The export plugin queries by agreement ID plus sealed-artifact SHA-256 before uploading, so retries do not create duplicates. Export happens after the sealed PDF is durably retained. A Drive failure is logged and retried the next time completion is ensured; it never reverses an execution.

## 3. Configure the customer entity

Copy `deploy/fiftysixty.env.example` to `deploy/.env.fiftysixty` and populate every required platform value. URL-encode the database password when placing it in `DATABASE_URL`. For a clean self-service test, leave the optional `BOOTSTRAP_*` and `EXECUTED_EXPORT_*` values unset, sign in through the platform provider, and create FiftySixty in the three-step onboarding flow. The bootstrap variables remain useful for unattended self-host migrations.

After the initial administrator logs in, open **Settings → Entity branding** to upload the square logo, the horizontal logo-and-name logomark, and select the brand colours. The logomark is used as the primary workspace lockup with the Contracts product label; the square logo is its compact fallback. Images are limited to PNG, JPEG, WebP, or self-contained SVG under 300 KB and are stored with the entity. Active SVG content and external references are rejected. Participant contract pages inherit the sender entity's presentation, with a quiet ByteCrunch platform attribution.

## 4. Run on EC2

A nano instance is acceptable for an initial low-volume test, but image builds and PDF sealing can exhaust its memory. Build images in CI or use temporary swap during deployment, monitor memory, and move up an instance size before real volume.

Install Docker Compose, place the repository on the host, and terminate TLS in a trusted reverse proxy or load balancer. Route the web origin to `127.0.0.1:3000` and the API origin to `127.0.0.1:3001`; never expose PostgreSQL publicly.

```bash
cd deploy
cp fiftysixty.env.example .env.fiftysixty
mkdir -p secrets
docker compose --env-file .env.fiftysixty -f docker-compose.fiftysixty.yml up -d --build
```

The compose file intentionally omits Keycloak and Mailpit. Persist and encrypt both named volumes, restrict the EC2 security group to HTTPS and operator SSH, and mount the PKCS#12 seal read-only under `deploy/secrets`. A mounted Google credential is needed only when using the environment fallback instead of the entity plugin installation.

## 5. Acceptance checks

1. A configured FiftySixty administrator signs in through Google → Cognito and lands in the `fiftysixty` entity.
2. A second allowed-domain employee signs in and receives contract-manager/signatory permissions but cannot manage members or branding.
3. An unapproved email cannot pass Cognito; an authenticated user outside the bootstrap domains receives no automatic entity membership.
4. Branding appears in both the staff shell and a private recipient invite.
5. Execute a two-party agreement, validate the sealed ByteCrunch PDF, and confirm exactly one matching PDF appears in the target Drive folder.
6. Temporarily deny Drive access and execute a test agreement. Execution must still complete and retain all evidence locally; restore access and use `POST /v1/agreements/{agreementId}/finalize` to complete the export retry.

Use the full [signing test plan](./signing-test-plan.md) before production signatures.
