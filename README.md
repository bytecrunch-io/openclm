# Bytecrunch Contracts

Bytecrunch Contracts is a self-hostable contract lifecycle management application for creating agreements, negotiating tracked changes, collecting signatures, and exposing agreement status to other systems.

It is designed to work as a standalone product first. Each customer legal entity is an independent tenant and contracting context; Bytecrunch operates the software and is never an implicit party to customer agreements. One account may represent several entities and explicitly chooses the entity it is acting for.

> [!WARNING]
> This is an early development release. The built-in production path implements an ordinary electronic-signature ceremony plus a PAdES-B-B organizational seal over the final PDF. It is not an advanced or qualified electronic signature, does not include long-term-validation material, and still requires deployment and jurisdiction-specific acceptance. The project is licensed under AGPL-3.0-only; review that choice before the first public release if a different open-source/commercial model is intended.

## Current capabilities

### Agreements and negotiation

- Entity-owned, immutable template versions with previews, variables, and history
- Multiple counterparties, reviewers, and required signatories
- Turn-based private review drafts with direct document editing
- Anchored word-level redlines, counterproposals, comments, threads, and accept/reject decisions
- Consolidated hand-back notifications instead of per-keystroke email noise
- Unordered signing, countersigning, signature invalidation when negotiation reopens, and document-native signature blocks
- Content revisions bound to SHA-256 fingerprints
- Provider-attributed signature evidence with authentication method and versioned consent text
- Frozen signing PDFs that every signature binds to by SHA-256
- Executed PDFs with document-native signatures, an embedded completion record, and a PAdES-B-B detached CMS platform seal
- Standalone completion certificates, machine-readable manifests, CMS validation reports, and public opaque-code verification

### Accounts and access

- Global human accounts with memberships in multiple customer entities
- Explicit **Acting for** context for templates, agreements, people, and sender details
- Entity-scoped administrator, template manager, contract manager, signatory, and viewer roles
- Per-entity display name, colour scheme, square logo, and horizontal company logomark, including safe SVG assets
- Guided first-company onboarding for legal details, branding, and optional integrations
- Generic OIDC Authorization Code + PKCE for staff SSO
- Entity-owned enterprise OIDC connections with company-specific login URLs and verified-domain membership
- Verified-domain customer-entity bootstrap with an explicit administrator allowlist
- Low-friction recipient invitations that become durable agreement access
- Recipient return through short-lived email codes or discoverable WebAuthn passkeys
- Cross-entity personal work inboxes

### Integration and local operation

- TypeSpec source with generated OpenAPI 3.1
- Zod validation at domain, API-input, and browser-response boundaries
- Entity-owned OAuth2 client credentials with one-time secret display, rotation, short-lived scoped tokens, and signed lifecycle webhooks
- External principals keyed by verified OIDC `issuer + subject`, plus short-lived signing handoffs
- Generic integration-scoped `subject_signed` and `agreement_executed` condition evaluation
- Append-only lifecycle events and durable, retryable, replayable webhook deliveries
- PostgreSQL and in-memory repository adapters
- Optional, idempotent Google Drive export of executed PDFs behind a provider interface
- Operator-controlled plugin catalog with entity installation, encrypted credentials, connection tests, and disconnect controls
- Local PostgreSQL, Keycloak, Mailpit, API, and web application through Docker Compose
- System, light, and dark Bytecrunch themes

More detail is available in [architecture](./docs/architecture.md), [identity and access](./docs/identity-and-access.md), the customer-facing [integration setup guide](./docs/integration-onboarding.md), [artifact storage](./docs/artifact-storage.md), the [deployment guide](./docs/deployment.md), the [FiftySixty deployment profile](./docs/fiftysixty-deployment.md), [operations](./docs/operations.md), the [signing test plan](./docs/signing-test-plan.md), the [design system](./docs/design-system.md), the [UX audit](./docs/ux-audit.md), and the [production-readiness checklist](./docs/production-readiness.md).

## Architecture

```text
browser / host backend
        │
        │ OIDC session or OAuth2 access token
        ▼
TypeSpec HTTP boundary → API orchestration → domain schemas and invariants
                              │
                              ├── repository → PostgreSQL / in-memory
                              ├── email → SMTP / development console
                              ├── executed export plugin → Google Drive / future adapters
                              └── lifecycle webhooks
```

The API contract lives in `packages/api-spec/tsp/main.tsp`; generated OpenAPI is committed at `packages/api-spec/generated/openapi.yaml`. Runtime types and lifecycle policy live in `packages/domain`. See [architecture](./docs/architecture.md) for the boundary rules and known production gaps.

## Run the complete local stack

Requirements: Docker with Compose support. From the repository root:

```bash
docker compose up --build
# Older standalone Compose installations can use:
docker-compose up --build
```

| Service | Address or credentials |
| --- | --- |
| Contracts | http://localhost:3000 |
| API | http://localhost:3001 |
| OpenAPI | http://localhost:3001/openapi.yaml |
| Keycloak | http://localhost:8080 (`admin` / `admin`) |
| Test user | `admin@bytecrunch.local` / `bytecrunch` |
| First-company test user | `founder@acme.test` / `onboarding` |
| Mailpit | http://localhost:8025 |

The stack has no required hosted identity, database, email, font, telemetry, or license service. Compose configuration is for local development and its credentials must not be reused in a deployment.

## Exercise the main workflow

1. Sign in at http://localhost:3000 with the test user.
2. Choose the customer entity under **Acting for**. Open **Templates** to create or version an entity-owned agreement template.
3. Create an agreement and add one or more counterparty representatives as reviewers or signatories.
4. Open the agreement and send its participant invitation.
5. Find the email in Mailpit and open **Review agreement** in a private browser window.
6. Confirm the recipient’s identity, entity, capacity, and signing authority.
7. Edit the document directly. Tracked changes remain private until the recipient sends the review.
8. Resolve or counter the changes as the sender, then either return another review or move the agreed revision to signing.
9. Sign from either side in either order. Verify that all required signature blocks appear and the agreement becomes executed.
10. Download the sealed PDF, open **Verify**, and confirm its SHA-256 and CMS integrity. The PDF includes its verification URL and electronic completion record.
11. Close the recipient session and return through `/inbox` with a Mailpit code; optionally enroll a passkey and use it for the next return.

Create another customer entity with **Add entity** to verify that templates, agreements, people, and sender identity change with the selected context. Open **People** to test member invitations and role assignment.

To exercise self-service onboarding, sign out and use `founder@acme.test` / `onboarding`. Complete the company and brand steps, then configure Enterprise SSO with issuer `http://localhost:8080/realms/bytecrunch`, client ID `bytecrunch-contracts`, client secret `local-development-secret`, and allowed domain `acme.test`. After finishing, sign out and use the company SSO field with the entity slug. Existing Compose volumes created before this user was added must be recreated or the user added through Keycloak administration because realm imports only run on initial setup.

An automated end-to-end equivalent runs against the Compose services:

```bash
npm run e2e:local
```

## Run application processes directly

Requirements: Node.js 22 or newer and npm.

```bash
npm ci
npm run api:generate
npm run dev
```

Without `DATABASE_URL`, the API uses in-memory persistence and a deterministic development identity. Copy `.env.example` to `.env` to override configuration. Do not use the example secrets outside local development.

## API and integration boundary

The standalone app is the primary implementation target. Integrations are a separate backend boundary. An entity administrator creates an API client in **Settings**, stores its one-time secret, and the integrating backend exchanges those credentials for a five-minute scoped token. Browser code never receives the client secret or condition API token. Bytecrunch Contracts reports contract facts; the integrating system owns every access rule, gate, or business decision.

For the recommended `shared_oidc` mode, the entity also configures **Customer identity (OIDC)**. The integrating backend supplies the stable `sub` from its own authenticated session. Before a signing session is accepted, Contracts authenticates the participant directly against that provider and requires the ID token's exact `iss + sub`. Email remains a verified contact attribute, not the identity key. `host_asserted` mode is available only for a backend that intentionally owns the complete authentication boundary.

First obtain a token using HTTP Basic client authentication:

```http
POST /oauth/token
Authorization: Basic base64(client_id:client_secret)
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&scope=conditions%3Aread%20signing_sessions%3Awrite
```

```http
POST /integration/v1/signing-sessions
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "integrationKey": "customer-portal",
  "subject": "user_01JXYZ",
  "email": "visitor@example.com",
  "templateKey": "mutual-nda",
  "returnUrl": "https://portal.example/workflows"
}
```

```http
POST /integration/v1/conditions/evaluate
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "integrationKey": "customer-portal",
  "subject": "user_01JXYZ",
  "operator": "all",
  "conditions": [
    { "kind": "subject_signed", "templateKey": "mutual-nda", "minimumVersion": 1 },
    { "kind": "agreement_executed", "templateKey": "non-circumvention", "minimumVersion": 2 }
  ]
}
```

`subject_signed` means the external principal has a valid signature on the current content revision. `agreement_executed` means every required signature for a qualifying agreement has been collected. The opaque subject is never collected in the normal standalone UI, and an unknown `iss + sub` simply produces unmet conditions without exposing another person’s agreements. Responses include a decision ID, evaluation time, issuer, and `Cache-Control: no-store`.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `apps/web` | React standalone app, recipient portal, component library, and themes |
| `apps/api` | Hono composition root, route families, authentication, notifications, and repository adapters |
| `packages/domain` | Zod schemas, role policy, and agreement lifecycle invariants |
| `packages/api-spec` | TypeSpec source and generated OpenAPI document |
| `infra` | Local PostgreSQL and Keycloak configuration |
| `scripts` | Local end-to-end verification |
| `docs` | Architecture, identity, design-system, and UX decisions |

## Verification

```bash
npm run check
npm test
npm run build
docker compose config --quiet
git diff --check
```

The CI workflow runs the same checks for pushes and pull requests. Read [CONTRIBUTING.md](./CONTRIBUTING.md) before changing API boundaries or shared UI.

## Production boundary

The ordinary-signature path is implemented end to end: authenticated intent and authority evidence, frozen-PDF binding, immutable artifacts, document-native marks, PAdES-B-B sealing, CMS integrity verification, completion records, idempotent finalization, and public verification. Production uses a deployment-owned PKCS#12 seal and provider-neutral durable artifact storage.

This is deliberately not marketed as AES/QES. Qualified signing, trusted timestamps, revocation material, and B-LT/B-LTA require a QTSP/DSS-style adapter and legal acceptance for the intended contracts and jurisdictions. Remaining launch decisions include the deployment storage/retention policy, seal-certificate procurement and trust expectations, resource-level authorization expansion, privacy/legal review, and the manual interoperability cases in the [signing test plan](./docs/signing-test-plan.md). The backup drill and penetration test are currently accepted exclusions at the project owner's direction, not completed controls. See [production readiness](./docs/production-readiness.md) and [SECURITY.md](./SECURITY.md).

## License

Bytecrunch Contracts is licensed under the [GNU Affero General Public License v3.0](./LICENSE). If you run a modified version as a network service, the AGPL requires offering its corresponding source to users of that service. Commercial licensing can be offered separately by the copyright holder.
