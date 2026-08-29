# Identity and access roadmap

ByteCrunch operates and may host the CLM. It is not a parent workspace and is not automatically a party to customer agreements. A customer legal entity is the tenant, data boundary, template owner, and selectable contracting context. One global human account may be a member of several customer entities.

## Core records

| Record | Responsibility |
| --- | --- |
| `Account` | One human across the ByteCrunch installation |
| `AuthIdentity` | A verified way to authenticate that account, keyed by provider + issuer + subject |
| `CustomerEntity` | A paying or self-hosted customer legal entity and tenant |
| `EntityMembership` | The roles and permissions an account has for one customer entity |
| `EntityMemberInvitation` | A seven-day invitation to join one customer entity with an explicit role set |
| `AgreementParty` | An immutable snapshot of a contracting party for one agreement |
| `Participant` | A person's transactional role in one agreement |
| `AgreementAccess` | Durable account access to one participant assignment |
| `Invitation` | A short-lived bootstrap token used to claim an assignment |
| `AccessChallenge` | A short-lived, single-use return/recovery credential |

Customer entity membership must never be inferred from agreement onboarding. A recipient may confirm that they represent Acme for one agreement without becoming an Acme tenant administrator. Likewise, application permission to sign enables the signing action but does not itself establish legal authority to bind an entity.

## Member flow

1. Authenticate with OIDC; later versions may also support passkeys and verified email.
2. Resolve the global account by the stable authentication identity.
3. Resolve active customer-entity memberships.
4. Automatically use the only entity or restore the last authorized choice.
5. Display **Acting for: Entity** on every entity-scoped screen.
6. Authorize the chosen membership and permission on the server for every operation.

A verified SSO user with no memberships can create their first independent customer entity and becomes its administrator. This is customer onboarding for the hosted or self-hosted product; it does not create a ByteCrunch subsidiary or place the customer beneath a ByteCrunch workspace. A user arriving through an entity invitation accepts that scoped membership instead.

Templates, agreements, sender details, members, and policies follow the active entity. A future personal action inbox should span memberships so an entity switch cannot hide a required signature.

## Customer-entity invitation flow

1. An administrator opens **People**, enters the recipient's email, and selects one or more role bundles.
2. The server invalidates an older pending invitation for the same entity and email, stores only a token hash, and sends a seven-day link.
3. Opening the link previews the customer entity, masked recipient address, roles, and expiry without consuming it.
4. The recipient authenticates through the configured OIDC provider. The callback requires a verified email claim and returns to the invitation.
5. Explicit acceptance requires an exact match with the verified invited email, creates or reactivates only that entity membership, and consumes the invitation.
6. Administrators may edit role bundles or suspend entity access. The server prevents removal or suspension of the final active administrator.

An entity invitation grants application access only. It does not prove that the member has legal authority to bind the entity; signing capacity and intent are captured separately per agreement.

## Recipient flow

1. The sender creates an agreement participant and sends an invitation.
2. A GET displays the invitation landing experience but does not consume the token.
3. Explicit exchange creates or resolves an account, grants `AgreementAccess`, links the participant, and consumes the invitation.
4. The recipient reviews and signs in an agreement-scoped session.
5. If the browser/session is lost, reopening the accepted invitation sends a fresh 15-minute access email.
6. The fresh link is consumed once and restores access through the durable assignment.

Recipients can also open `/inbox` and request a six-digit email code. The request response does not reveal whether an account or assignment exists. Challenges expire after ten minutes, lock after five failed attempts, are throttled per address, and are stored as keyed hashes rather than plaintext codes. Successful verification creates an eight-hour account-level recipient session. Selecting an inbox item then creates the existing agreement-scoped participant session, preserving the narrow authorization boundary.

After verified email access, a recipient can enroll one or more discoverable WebAuthn passkeys. Registration and authentication require authenticator user verification, validate the expected relying-party ID and origin, persist credential counters, and never store private-key material. Authentication is username-less: the signed credential identifies the account, then the server creates the same narrow recipient session. Original invitation and recovery exchanges also create this inbox session so a recipient is not challenged twice.

Optional organisation SSO, credential recovery/revocation history, and recent-authentication requirements immediately before higher-assurance signing remain future work. Production deployments must set `WEBAUTHN_RP_ID` to their registrable host and `WEBAUTHN_ORIGIN` to the exact HTTPS browser origin; localhost works without HTTPS for local development.

## Roles and permissions

Initial role bundles are administrator, template manager, contract manager, signatory, and viewer. Runtime permissions are explicit: entity/member management, template read/write, agreement read/write, and agreement signing. Entity-scoped route families enforce these membership permissions, and administrators can invite members and assign multiple bundles. Custom roles, invitation revoke/resend controls, recent-authentication policy, and finer resource-level authorization remain future milestones.

## Signing assurance

Signing must bind explicit intent and claimed capacity to an immutable document hash. Production evidence should record the signer account and participant, customer entity and party snapshot, authentication method and age, consent text, UTC time, document hash, and relevant audit events. Any document change invalidates attached signatures.

The development witness is not represented as AdES, QES, PAdES, or a certified signature. Higher-assurance signatures belong behind a signing-provider boundary and require jurisdiction-specific review.
