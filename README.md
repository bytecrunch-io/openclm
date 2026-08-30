# Bytecrunch Contracts

Open-source agreement infrastructure for review, redlining, execution, and integration. The standalone application is branded with the Bytecrunch design system while its API remains generic enough for data rooms, onboarding tools, marketplaces, and internal systems.

## What works

- Entity-owned contract templates with an in-app library, document preview, supported-variable palette, and immutable version history
- Agreement creation from representative emails; internal person IDs are assigned automatically
- Draft, review, signing, and executed lifecycle states
- Anchored, attributed redlines with word-level diffs, threaded replies, and accept/reject resolution
- Inline counterproposals with linked attribution and symmetric approval across review rounds
- Document-level feedback plus editable, removable redline drafts during the active review turn
- Consolidated hand-back notifications with unread state, deep links, and retrying email delivery through an outbox
- Immutable revision counters and SHA-256 content hashes
- Multiple required signatories
- Prominent next-action guidance and a sender attention queue
- Responsive typed/drawn signature ceremony with touch support and document-bound signature blocks
- Legal entities, agreement parties, and per-party signature requirements
- Global human accounts with memberships in one or more customer entities
- A visible “Acting for” entity switcher; templates, agreements, and sender details follow the selected customer entity
- First-run onboarding that lets a verified SSO user establish an independent customer entity when they were not invited to one
- Entity-scoped role and permission foundations for administrators, template managers, contract managers, signatories, and viewers
- Customer-entity member administration with email invitations, multi-role assignment, suspension, and final-administrator protection
- Invitation acceptance through the configured OIDC provider, restricted to the verified invited email
- Optional counterparty details with recipient confirmation and sender approval for material changes
- One-time participant invitations that create durable account-to-agreement access
- Safe return access: an accepted invitation sends a fresh, single-use 15-minute email link instead of becoming a dead end
- Cross-entity **My work** inbox for staff and an account-level recipient inbox for invited parties
- Non-enumerating six-digit recipient sign-in codes with short expiry, attempt limits, throttling, and narrow agreement-session handoff
- Discoverable WebAuthn passkeys with required user verification, checked RP/origin, signature-counter persistence, and local `localhost` support
- External onboarding with title, signing capacity, and authority confirmation
- External reviewer/signatory portal with signatory nomination
- Agreement-status query and multi-requirement evaluation API
- Integration-scoped identity links, short-lived host-mediated handoffs, and status queries
- HMAC-signed lifecycle webhooks
- Generic OIDC SSO and OAuth2 bearer-token validation
- Runtime validation with Zod at API and UI boundaries
- TypeSpec source with generated OpenAPI 3.1
- PostgreSQL and in-memory repositories
- Dark/light Bytecrunch interface
- Fully local Docker stack

ByteCrunch is the platform operator, not a parent workspace or implicit contracting party. In the hosted product each customer legal entity is its own tenant; one account may be a member of several customer entities. See [identity and access](./docs/identity-and-access.md).

The current signing action is a clearly labeled development witness. It is not a certified electronic-signature implementation. See the [architecture](./docs/architecture.md) and [UX audit](./docs/ux-audit.md) before using this with real contracts.

## Run the full local stack

```bash
docker compose up --build
# On installations using the standalone Compose binary:
docker-compose up --build
```

Then open:

| Service | URL / credentials |
| --- | --- |
| Contracts | http://localhost:3000 |
| API | http://localhost:3001 |
| OpenAPI | http://localhost:3001/openapi.yaml |
| Keycloak | http://localhost:8080 (`admin` / `admin`) |
| Local user | `admin@bytecrunch.local` / `bytecrunch` |
| Mailpit | http://localhost:8025 |
| MinIO | http://localhost:9001 (`contracts` / `contracts-local-secret`) |

Everything runs locally. There is no required hosted database, identity provider, object store, email service, font CDN, telemetry endpoint, or license server.

## Test the two-party flow

1. Open http://localhost:3000 and sign in as `admin@bytecrunch.local` / `bytecrunch`.
2. Create an agreement with one or more counterparty representatives. The expected legal entity is optional; mix reviewers and signatories and choose the number of signatures required.
3. Open the agreement and select **Send invite** next to the participant.
4. Open http://localhost:8025 and select the invitation email.
5. Open its **Review agreement** link in an incognito/private browser window.
6. Confirm the recipient, legal entity, capacity, and signing authority. If the recipient changes prefilled entity details, approve the proposal in the administrator view.
7. Select contract text, submit a redline, edit or remove it while it remains a private draft, and return the review turn.
8. In the administrator browser, check the notification bell and Mailpit, reply or resolve the redline, then send the final revision for signature.
9. Return to the external browser, open the signing ceremony, type or draw a signature, confirm intent, and sign.
10. In the administrator workspace, follow the prominent **Countersign required** action and sign the exact same revision.
11. Verify that both signature blocks appear, the agreement becomes executed, and the agreement-status API returns `satisfied: true`.
12. Close the participant browser, reopen the original invitation, then open the fresh return email in Mailpit. The new 15-minute link restores access without reusing the accepted invitation.
13. Alternatively, open http://localhost:3000/inbox, enter the invited email, copy the six-digit code from Mailpit, and open any agreement assigned to that address.
14. From the recipient inbox, select **Add a passkey** and complete the browser prompt. Sign out and use **Use a passkey** to return without another email.

To exercise multi-entity membership, select **Add entity** next to **Acting for**. Creating and switching to it gives that customer entity its own template copy, agreements, sender identity, and data boundary.

To manage templates, choose the customer entity under **Acting for**, then open **Templates**. Administrators and template managers can create a template or publish an edited draft as its next immutable version. Existing agreements retain the exact template version they started with; new agreements use the latest version for the selected entity. Members with template read access can inspect the library and version history without changing it.

In a non-development OIDC deployment, a verified user with no invitation or existing memberships sees first-run customer-entity onboarding after sign-in. Invited users skip that setup and accept only the entity and roles named in their invitation.

To exercise entity administration, open **People**, invite a second Keycloak user, select one or more roles, and open the resulting email in Mailpit. The recipient can return through the same invitation after signing in with the verified invited address. Role changes and suspension apply only to the selected customer entity; the final active administrator cannot remove their own administrative access.

An automated equivalent runs against the Docker services:

```bash
npm run e2e:local
```

The automated tests cover multi-entity selection and isolation, entity-owned template versioning and agreement snapshots, durable invite claiming, single-use return challenges, non-enumerating recipient code login, cross-entity inboxes, multiple participants without external IDs, entity onboarding, private draft editing, consolidated notifications, owner resolution, and document-bound signatures. The Docker flow additionally covers Mailpit delivery, OAuth2 client credentials, and integration-scoped handoff/status verification.

## Run application code directly

This uses in-memory storage and a deterministic local development identity:

```bash
npm install
npm run api:generate
npm run dev
```

Copy `.env.example` to `.env` when you want to override defaults. The API uses PostgreSQL when `DATABASE_URL` is present and the in-memory repository otherwise.

## API boundary

The source contract lives at `packages/api-spec/tsp/main.tsp`.

```bash
npm run api:generate
```

Runtime schemas and lifecycle invariants live in `packages/domain`. Public handlers validate untrusted input with those schemas, and the browser validates responses again.

For an embedded/data-room flow, first register an integration and have the host backend create a short-lived session. The `subject` is accepted only from the OAuth2-authenticated backend and is mapped to an internal person within that integration’s namespace:

```http
POST /v1/integration-sessions
Authorization: Bearer <access-token>

{
  "integrationKey": "fiftysixty",
  "subject": "user_01JXYZ",
  "email": "visitor@example.com",
  "templateKey": "mutual-nda",
  "returnUrl": "https://fiftysixty.com/projects"
}
```

After execution, the host can gate its data room with:

```http
GET /v1/integration-status?integrationKey=fiftysixty&subject=user_01JXYZ&templateKey=mutual-nda&minimumVersion=1
Authorization: Bearer <access-token>
```

## Verification

```bash
npm run check
npm test
npm run build
docker compose config
# or: docker-compose config
```

## Next production milestones

1. Require recent authentication for configurable signing-assurance profiles and record the authentication method in append-only signing evidence.
2. Expand route-family authorization into resource-level policy tests and add invitation resend/revoke controls.
3. Add recent-authentication checks, signing-capacity evidence, and an append-only signing/audit evidence package.
4. Add a signing-provider interface and a self-hosted PAdES-capable provider.
5. Persist immutable revision and audit-event tables rather than aggregate snapshots alone.
6. Add webhook outbox persistence, retries, replay, and delivery inspection.
7. Store original, rendered, and executed artifacts in the configured S3-compatible store.
8. Add scoped client administration, PDF rendering, malware scanning, retention controls, and backups.

## License

No license has been selected yet. Choose the server and SDK licensing strategy before accepting external contributions.
