# UX audit

Audit date: 2026-08-30

Scope: standalone sender and participant journeys across agreement creation, invitations, onboarding, turn-based review, redlining, signing, countersigning, completion, notifications, responsive behavior, accessibility, and recovery states.

## Executive assessment

The product now has a coherent review model and a strong Bytecrunch visual identity. The largest usability gap was action hierarchy: lifecycle status was visible, but the person responsible for moving an agreement forward had to infer their next action from small controls. Signing also behaved like a status toggle rather than a deliberate ceremony.

This pass adds an explicit next-action layer, touch-friendly typed/drawn signing, document-bound signature evidence, visible signature blocks, sealed executed PDFs, completion records, and a public verification experience. The built-in production mode is ordinary electronic signing with an organizational PAdES-B-B seal, not AES/QES.

## Current scorecard

| Area | Assessment | Notes |
| --- | --- | --- |
| Visual identity | Strong | Consistent Bytecrunch type, color, grid, hairlines, motion, and button treatment. |
| Creation | Good | Optional entity details and multiple participants are clear; the agreement picker uses each entity's latest template version. |
| Template management | Good | The active entity has a permission-aware library, document preview, variable insertion, and immutable version history. |
| Onboarding | Good | Identity, entity, capacity, and authority are explained before review. |
| Review turns | Strong | Draft work is quiet and editable; hand-back creates a single summary. |
| Redlining | Good | The active reviewer edits a clean private draft directly in the document; saving derives a synchronized sidebar diff. Granular structured-document operations remain future work. |
| Action clarity | Strong after this pass | Dashboard attention queue and agreement-level next-action banner make ownership explicit. |
| Signing ceremony | Good for local development | Typed/drawn marks, touch input, intent confirmation, exact hash, and visible blocks are present. |
| Production signing assurance | Conditional | Frozen-PDF binding, normalized evidence, PAdES-B-B sealing, completion certificates, integrity verification, and a deployment P12 mode exist. Certificate procurement, assurance policy, interoperability testing, and legal acceptance remain operator gates. |
| Mobile | Good baseline | Review and touch signing reflow to one column; long-document navigation still needs a mobile progress pattern. |
| Accessibility | Fair | Typed signing, global focus styling, reduced-motion support, and shared accessible dialog behavior are present; document semantics and complete workflows still need a full screen-reader pass. |
| Multi-entity identity | Good | Global accounts, explicit customer-entity context, isolated data, durable recipient access, member administration, and cross-entity personal inboxes are implemented. |

## Changes completed in this pass

- Added a dashboard “Needs your attention” queue.
- Added one prominent next-action banner to every active agreement state.
- Replaced forced counterparty-first signing with an unordered required-signature set.
- Added “Sign & request signatures” and “Request signatures” completion choices.
- Removed review-round language from primary actions; rounds remain audit metadata.
- Limited invite controls to participants who are not invited or whose invitation is still pending.
- Added direct private-draft editing with generated redlines in the review sidebar.
- Added semantic sender/counterparty template variables and first-class sender legal parties.
- Added a focused signature ceremony with typed and drawn modes.
- Made drawing use pointer events so mouse, pen, and touch share the same path.
- Bound every recorded signature to the exact SHA-256 content fingerprint and timestamp.
- Added a document-native closing signature section with entity, signature, name, title/capacity, and date fields.
- Added responsive signing layouts for desktop and phone.
- Kept an explicit local-development witness disclaimer.
- Added a persistent **Acting for** selector so sender identity, templates, and agreements follow the selected customer entity.
- Separated global accounts, customer-entity memberships, agreement participants, and durable agreement access.
- Replaced the accepted-invite dead end with a fresh, single-use 15-minute return link delivered to the invited email.
- Added a permission-aware **People** workspace for verified-email member invitations, multi-role assignment, and entity-scoped suspension.
- Added non-consuming invitation previews, OIDC return-to handling, explicit acceptance, and final-administrator protection.
- Added first-run onboarding for a verified SSO user with no memberships, clearly framing the new entity as an independent customer tenant.
- Added a prioritized **My work** inbox across customer entities and a recipient inbox that can be recovered with a privacy-preserving email code.
- Added passkey enrollment after verified recipient access and a prominent passkey return path, while retaining email code as recovery.
- Added an entity-scoped **Templates** workspace with document previews, supported-variable insertion, and immutable version history.
- Made agreement creation show only the latest version of each template while preserving the chosen version in existing agreements.
- Centralized system/light/dark preference across staff, recipient, membership, and external-review routes.
- Added reusable button, icon-button, alert, loading, and dialog primitives; the signing dialog now contains and restores focus, supports Escape, and locks background scrolling.
- Added a global reduced-motion baseline and semantic theme tokens for scrolling and document-paper surfaces.

## Prioritized findings

### P0 — required before real contracts

1. Add a QTSP/DSS provider only for use cases that require AES/QES, trusted timestamps, revocation data, or PAdES-B-LT/B-LTA.
2. Store signing evidence in append-only records, not only the mutable agreement aggregate. Include signer identity, authentication method, timestamps, document hash, consent text/version, provider evidence, and relevant delivery events.
3. Produce a final downloadable PDF with signatures applied to deterministic fields and a completion certificate. The current HTML signature blocks are visual evidence inside the app, not a sealed document.
4. Define signature assurance profiles by use case and jurisdiction. Basic NDAs may use simple electronic signatures; higher-risk contracts may require stronger authentication or qualified signatures.
5. Add retention, revocation/voiding, privacy, and evidence-export policies.

### P1 — highest UX value next

1. Add optional organisation SSO and recent-authentication checks before higher-assurance signatures.
2. Add resource-level authorization tests beyond the current route-family checks, plus invitation resend/revoke and membership audit history.
3. Add a secure “continue on phone” handoff using a short-lived, one-time QR token. Do not encode the reusable invitation/session credential directly in the QR code.
4. Add explicit signature-field placement to templates for agreements that need placement other than the standard closing signature section.
5. Add a lifecycle timeline showing sent, opened, reviewed, returned, signature requested, viewed, signed, and executed events.
6. Add “remind next signer,” resend, and delivery-status controls beside the currently responsible participant.
7. Add decline-to-sign, delegate/reassign, and report-a-problem paths so signing is not a forced dead end.
8. Add a final review step that scrolls the signer through required fields and clearly distinguishes review completion from signature adoption.
9. Add downloadable original, final revision, executed artifact, and audit certificate actions.

### P2 — refinement

1. Add a required-signature summary during creation; ordered routing should remain an optional advanced workflow.
2. Add keyboard shortcuts and previous/next navigation for large redline sets.
3. Separate “activity” from “needs action” in notifications and allow agreement-level notification preferences.
4. Improve narrow-screen agreement tables into stacked rows instead of horizontal scrolling.
5. Add empty states for no feedback, no redlines, and signatures not yet requested.
6. Add automated keyboard and screen-reader regression coverage for dialogs, and live-region announcements to every async action.
7. Run formal WCAG contrast, keyboard, screen-reader, zoom, reduced-motion, and touch-target testing.

## Next-action state model

| Agreement state | Owner sees | Counterparty sees |
| --- | --- | --- |
| Draft | Invite the counterparty | No access until invited |
| Review with counterparty | Waiting for counterparty review | Edit directly; send changes when ready |
| Review with sender | Resolve/edit and send changes, or finish review | Waiting for sender |
| Out for signature | Sign now or wait; all signatories are eligible | Sign now or wait; all signatories are eligible |
| Partially signed | Remaining signatures are clearly identified | Remaining signatures are clearly identified |
| Executed | Agreement executed | Agreement executed |

## Signing design rationale

The ceremony follows a short sequence: identify the exact revision, create or adopt a mark, explicitly confirm intent, record the evidence, and show the result in context. Typed signing is the keyboard-accessible default; drawing is optional and touch-enabled. The signature’s legal weight must come from the evidence and provider process, not from how handwritten the mark looks.

For mobile, the document already renders as responsive HTML and the signing surface uses touch events. Mature products additionally guide signers through required fields and support secure multi-channel delivery; those patterns should inform the P1 work without copying their visual language.
