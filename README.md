# Bytecrunch Contracts

Bytecrunch Contracts is a self-hostable contract lifecycle management application for creating agreements, negotiating tracked changes, collecting signatures, and exposing agreement status to other systems.

It is designed to work as a standalone product first. Each customer legal entity is an independent tenant and contracting context; Bytecrunch operates the software and is never an implicit party to customer agreements. One account may represent several entities and explicitly chooses the entity it is acting for.

> [!WARNING]
> This is an early development release. The built-in signature flow is a development witness, not a certified electronic-signature implementation. No open-source license has been selected yet, so the source is visible but reuse and external contribution terms are not established.

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
- Immutable signing snapshots and downloadable, hashed completion manifests

### Accounts and access

- Global human accounts with memberships in multiple customer entities
- Explicit **Acting for** context for templates, agreements, people, and sender details
- Entity-scoped administrator, template manager, contract manager, signatory, and viewer roles
- Generic OIDC Authorization Code + PKCE for staff SSO
- Low-friction recipient invitations that become durable agreement access
- Recipient return through short-lived email codes or discoverable WebAuthn passkeys
- Cross-entity personal work inboxes

### Integration and local operation

- TypeSpec source with generated OpenAPI 3.1
- Zod validation at domain, API-input, and browser-response boundaries
- OAuth2 bearer authentication for backend integrations
- Integration-scoped identity links, short-lived handoffs, and signed lifecycle webhooks
- Generic integration-scoped `subject_signed` and `agreement_executed` condition evaluation
- Append-only lifecycle events and durable, retryable, replayable webhook deliveries
- PostgreSQL and in-memory repository adapters
- Local PostgreSQL, Keycloak, Mailpit, API, and web application through Docker Compose
- System, light, and dark Bytecrunch themes

More detail is available in [architecture](./docs/architecture.md), [identity and access](./docs/identity-and-access.md), [artifact storage](./docs/artifact-storage.md), the [design system](./docs/design-system.md), the [UX audit](./docs/ux-audit.md), and the [production-readiness checklist](./docs/production-readiness.md).

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
10. Close the recipient session and return through `/inbox` with a Mailpit code; optionally enroll a passkey and use it for the next return.

Create another customer entity with **Add entity** to verify that templates, agreements, people, and sender identity change with the selected context. Open **People** to test member invitations and role assignment.

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

The standalone app is the primary implementation target. The integration surface is intentionally backend-mediated: another system authenticates with OAuth2, supplies an opaque subject within its own integration namespace, optionally creates a short-lived contract handoff, and evaluates contract conditions. Bytecrunch Contracts reports facts; the integrating system owns every access rule, gate, or business decision.

```http
POST /v1/integration-sessions
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
POST /v1/conditions/evaluate
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

`subject_signed` means the linked person has a valid signature on the current content revision. `agreement_executed` means every required signature for a qualifying agreement has been collected. The opaque subject is never collected in the normal standalone UI, and an unlinked subject simply produces unmet conditions without exposing another person’s agreements.

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

## Production gaps

Production configuration now fails closed, lifecycle events are append-only, lifecycle aggregate/event/webhook writes are atomic, signature orchestration has a provider boundary, execution creates immutable evidence manifests, and webhook delivery is durable and replayable. Before real contract execution, the project still needs a real signing-provider adapter, sealed PDF artifacts and certificates, normalized provider evidence, recovery for adjacent invitation/notification/artifact workflows, production object storage, retention and privacy controls, backup/restore procedures, finer resource-level authorization tests, operational observability, and an external security review. See [production readiness](./docs/production-readiness.md) and [SECURITY.md](./SECURITY.md).

## License

Bytecrunch Contracts is licensed under the [GNU Affero General Public License v3.0](./LICENSE). If you run a modified version as a network service, the AGPL requires offering its corresponding source to users of that service. Commercial licensing can be offered separately by the copyright holder.
