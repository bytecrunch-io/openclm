# Contributing

Bytecrunch Contracts is still an early-stage project. Issues and design discussions are welcome, but do not use the current signing witness for production agreements.

## Development setup

Use Node.js 22 or newer and npm. For the application processes with in-memory persistence:

```bash
npm ci
npm run api:generate
npm run dev
```

For PostgreSQL, Keycloak, and Mailpit, use the full local stack documented in the README.

## Before opening a pull request

```bash
npm run check
npm test
npm run build
docker compose config --quiet
git diff --check
```

Keep TypeSpec, runtime Zod schemas, handlers, client validation, and tests synchronized whenever an API boundary changes. Keep lifecycle rules and role bundles in `packages/domain`; transport and persistence code should consume them rather than redefining them.

UI work should use the tokens and primitives described in `docs/design-system.md`. New page-level CSS belongs in `styles.css`; reusable controls belong in `components/` and `design-components.css`.

## Commits

Prefer small, focused commits with an imperative subject, for example `feat: add entity-scoped templates`. Never include credentials, generated build output, local databases, or invitation/session tokens.

## Licensing

No open-source license has been selected yet. Until one is added, external contributions cannot be accepted under clear reuse terms. Licensing should be resolved before opening the repository for general contribution.
