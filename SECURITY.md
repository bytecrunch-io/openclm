# Security policy

This repository is not yet suitable for production contract execution or certified electronic signatures. Production configuration fails closed and disables the development signature witness, but those safeguards do not replace a signing provider, legal review, or security assessment.

Please report suspected vulnerabilities privately to the project maintainers. Do not include active invitation links, recipient codes, passkey material, session cookies, contract contents, personal data, or production credentials in a public issue.

Browser mutations are restricted to the configured application origin. Production webhook URLs require HTTPS, are checked against local/private destinations, and cannot redirect; production infrastructure must still enforce outbound network policy to mitigate DNS rebinding and parser discrepancies.

Public sign-in and token exchanges use a database-backed limiter so replicas share counters. Only enable `TRUST_PROXY` when the edge proxy removes client-supplied forwarding headers and writes its own trusted client address.

CI runs dependency auditing, CodeQL, filesystem secret/misconfiguration scanning, and API/web container scanning. Before a hosted release, the project still needs a dedicated private security contact and disclosure SLA, secret rotation procedures, normalized append-only signing evidence, retention controls, backup/restore testing, and an external security review. Track the concrete gates in [production readiness](./docs/production-readiness.md).
