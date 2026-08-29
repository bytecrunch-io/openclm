# Architecture

Bytecrunch Contracts is split at explicit, generated API boundaries.

```text
Browser / host application
       |
       | OIDC session or OAuth2 bearer token
       v
TypeSpec public contract -> Hono API -> Zod runtime validation -> domain invariants
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
- External identities are stored as tenant-scoped opaque subject IDs.
- Agreement content is hashed whenever an accepted suggestion changes it.
- Executed state requires every party's minimum signature requirement and every unassigned required signature to be satisfied. Normal agreements do not impose a signing order.
- Review edits are stored as private turn-scoped suggestions until the reviewer explicitly sends the review.
- A turn draft is always diffed cumulatively against its immutable revision. Nearby edits are grouped into one review hunk and repeated edits retain the same suggestion identity, thread, and attribution.
- Incoming redlines require an explicit accept or keep-original decision. Editing the same clause inline instead creates an attributed counterproposal, links it to the incoming redline, and marks the earlier proposal as countered. Counterproposals travel in the next review round and do not change the accepted content hash or revision until the receiving party accepts them.
- `{{signature_blocks}}` is a structural template placeholder. The renderer replaces it with the agreement's live signature fields; the placeholder remains in the hashed agreement content while signature evidence is recorded separately against that hash.
- Entity templates support `{{sender.legal_name}}`, `{{sender.business_address}}`, `{{counterparty.legal_name}}`, and `{{counterparty.business_address}}`. Unknown values remain as template variables until confirmed; the renderer never substitutes editorial text such as “details pending.”
- Reopening a signing revision requires an explicit destructive confirmation. Every attached signature is removed from the active document but retained in `invalidatedSignatures` with its original content hash, actor, time, and invalidation reason before a new review turn begins.

## Authentication

Humans authenticate through generic OIDC Authorization Code + PKCE. Server integrations use OAuth2 bearer tokens issued for the API audience. The bundled Keycloak realm is local infrastructure, not an application dependency; any conforming provider can replace it.

## Signing boundary

The current `sign` operation is a development witness used to exercise lifecycle invariants and integrations. Production signing must be implemented behind a provider interface that freezes a rendered artifact, sends the exact hash to every signatory, verifies provider callbacks, stores the sealed artifact, and records audit evidence. No development signature should be represented as PAdES, AdES, QES, or legally certified.

## Persistence roadmap

The initial PostgreSQL repository stores validated aggregate snapshots in JSONB. This keeps the first vertical slice easy to evolve. Before high-volume production use, extract participants, immutable revisions, audit events, webhook delivery attempts, and signing envelopes into relational append-only tables.

Webhook delivery is currently best-effort. A transactional outbox, retry scheduler, delivery history, and manual replay are required before production use.
