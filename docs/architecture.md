# Architecture

Bytecrunch Contracts is split at explicit, generated API boundaries.

```text
Browser / host application
       |
       | OIDC session or OAuth2 bearer token
       v
global account -> customer-entity membership -> TypeSpec API -> Zod validation -> domain invariants
                                              |
                     +------------------------+----------------------+
                     |                        |                      |
                 PostgreSQL             object storage        signing provider
                     |
                     +-> best-effort signed webhooks -> host system
```

## Boundary rules

- `packages/api-spec/tsp/main.tsp` is the public HTTP contract.
- `packages/domain` owns runtime schemas and lifecycle invariants.
- API handlers parse every request before invoking domain operations.
- The UI parses API responses instead of trusting TypeScript casts.
- ByteCrunch is the platform operator. Each customer legal entity is its own tenant and contracting context; there is no ByteCrunch parent workspace in the customer model.
- Human accounts are global and may have memberships in several customer entities. Entity membership and server-side permission checks provide tenant access; the client-side entity selector is not a security boundary.
- OIDC identities use provider, issuer, and subject as their stable key. Verified email is a contact/recovery attribute and is not used as an OIDC subject.
- External integration identities remain tenant- and integration-scoped opaque subject IDs.
- Agreement participants and agreement access are separate: the participant records the role in the transaction, while durable agreement access links that participant to a global account.
- Agreement content is hashed whenever an accepted suggestion changes it.
- Executed state requires every party's minimum signature requirement and every unassigned required signature to be satisfied. Normal agreements do not impose a signing order.
- Review edits and comments are stored as private turn-scoped work until the reviewer explicitly sends the review. Agreement responses omit the active side's current-round work from the waiting party in both directions; sending the review advances the round and publishes it.
- A turn draft is always diffed cumulatively against its immutable revision. Nearby edits are grouped into one review hunk and repeated edits retain the same suggestion identity, thread, and attribution.
- Incoming redlines are projected into the active editor as the returned document version and require an explicit accept or keep-original decision. Editing the highlighted proposed wording inline instead creates an attributed counterproposal, links it to the incoming redline, and marks the earlier proposal as countered. Counterproposals travel in the next review round and do not change the accepted content hash or revision until the receiving party accepts them.
- `{{signature_blocks}}` is a structural template placeholder. The renderer replaces it with the agreement's live signature fields; the placeholder remains in the hashed agreement content while signature evidence is recorded separately against that hash.
- Entity templates support `{{sender.legal_name}}`, `{{sender.business_address}}`, `{{counterparty.legal_name}}`, and `{{counterparty.business_address}}`. Unknown values remain as template variables until confirmed; the renderer never substitutes editorial text such as “details pending.”
- A template key is stable inside one customer entity. Publishing an edit creates the next immutable version for that entity; it does not alter another entity's library or any agreement that already snapshots a template version. Agreement creation resolves the latest version of the selected key.
- Role-to-permission bundles are domain policy and live in `packages/domain`; API authorization and membership creation consume the same policy rather than maintaining parallel permission lists.
- Reopening a signing revision requires an explicit destructive confirmation from an unsigned reviewer. A participant who has already approved and signed cannot initiate reopening. Every attached signature is removed from the active document but retained in `invalidatedSignatures` with its original content hash, actor, time, and invalidation reason before a new review turn begins.

## Authentication

Members authenticate through generic OIDC Authorization Code + PKCE. The authenticated account selects one of its active customer-entity memberships through the `X-Bytecrunch-Entity-Id` request context. Every entity-scoped request resolves and authorizes that membership on the server.

An external invitation is a bootstrap credential, not permanent access. Its first explicit exchange creates or resolves a global account, grants an agreement-specific access record, links the participant to that account, and consumes the invitation. Opening an accepted invitation requests a fresh 15-minute, single-use email challenge. This means a closed or cleared browser can recover without turning the original URL into a permanent bearer credential. Invitation URLs are never consumed by a GET, which avoids corporate link scanners accepting an invitation on the recipient's behalf.

Server integrations use OAuth2 bearer tokens issued for the API audience. The bundled Keycloak realm is local infrastructure, not an application dependency; any conforming provider can replace it.

## Signing boundary

The current `sign` operation is a development witness used to exercise lifecycle invariants and integrations. Production signing must be implemented behind a provider interface that freezes a rendered artifact, sends the exact hash to every signatory, verifies provider callbacks, stores the sealed artifact, and records audit evidence. No development signature should be represented as PAdES, AdES, QES, or legally certified.

## Persistence roadmap

The initial PostgreSQL repository stores validated aggregate snapshots in JSONB. This keeps the first vertical slice easy to evolve. Before high-volume production use, extract participants, immutable revisions, audit events, webhook delivery attempts, and signing envelopes into relational append-only tables.

Webhook delivery is currently best-effort. A transactional outbox, retry scheduler, delivery history, and manual replay are required before production use.

## Codebase boundaries

The repository is a TypeScript npm workspace: `packages/domain` owns runtime schemas and state invariants, `packages/api-spec` owns the public HTTP description, `apps/api` owns authentication, authorization, transport, orchestration, and persistence adapters, and `apps/web` owns the standalone user experience. Shared UI behavior belongs in `apps/web/src/components`, while the token and component CSS layers are kept separate from product-specific layouts. See the [design system](./design-system.md).

`apps/api/src/app.ts` is the composition root. Customer entity/membership routes and platform routes (notifications, integrations, status checks, and webhooks) live in `apps/api/src/routes` and receive their repository and orchestration dependencies explicitly. Agreement lifecycle and public-participant endpoints remain the next cohesive families to extract. Lifecycle decisions should first move into domain services with unit tests; route modules should preserve the TypeSpec boundary and avoid introducing a second source of domain truth.
