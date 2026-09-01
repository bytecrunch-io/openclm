# Customer integration setup

This guide is for a customer-entity administrator connecting Bytecrunch Contracts to the company's identity provider, backend product, or document system. Everything specific to the entity is configured under **Settings**. Deployment-wide URLs, TLS, encryption keys, and the available plugin catalog remain the hosting operator's responsibility.

## Choose the path first

| Goal | Configure in Contracts | Do not configure |
| --- | --- | --- |
| Use Contracts by itself | Nothing beyond company details and branding | No API client or customer OIDC is required |
| Let employees manage contracts with company SSO | **Enterprise SSO** | No product API client is required |
| Let authenticated product users sign and let the backend check conditions | **Customer identity (OIDC)** and an API client in **Customer OIDC** mode | Do not reuse Enterprise SSO or put the API secret in browser code |
| Copy executed PDFs to a document system | The appropriate export plugin, currently Google Drive | No identity connection is required solely for export |

The guided setup panel in Settings shows these paths and derives readiness from the selected entity's live plugin and API-client records.

## Before configuring OIDC

Create a dedicated confidential web/OIDC client at the identity provider. Use Authorization Code flow, enable `openid`, `profile`, and `email`, and ensure ID tokens contain:

- stable `sub`;
- `email` and `email_verified: true`;
- `name` or `preferred_username` when available;
- `auth_time` when the provider supports it.

Register the exact callback shown in the Contracts setup panel. Workforce and participant callbacks are different. Use exact HTTPS URLs in production; do not use wildcards. Store the provider client secret only through the Contracts configuration form, where it is encrypted and never returned.

### Amazon Cognito

Create separate app clients for workforce and participant authentication. Enable authorization-code grant and the three scopes above, generate a client secret, and add the exact callback shown by Contracts.

For a conventional user-pool issuer:

| Contracts field | Cognito value |
| --- | --- |
| Issuer URL | `https://cognito-idp.<region>.amazonaws.com/<user-pool-id>` or the exact `iss` used by the pool |
| Authorization endpoint override | `https://<managed-login-or-custom-domain>/oauth2/authorize` |
| Token endpoint override | `https://<managed-login-or-custom-domain>/oauth2/token` |
| JWKS URI override | Usually leave empty for discovery; otherwise use the `jwks_uri` advertised by the issuer |
| Client ID / secret | The dedicated Contracts app client's credentials |

Cognito intentionally separates its token issuer from a managed-login/custom browser domain. Contracts supports that split through endpoint overrides. Confirm values using the pool's `/.well-known/openid-configuration`; see AWS's [user-pool OIDC endpoints](https://docs.aws.amazon.com/cognito/latest/developerguide/federation-endpoints.html) and [managed-login authorization code example](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-managed-login.html).

### Auth0

Create a **Regular Web Application**, add the exact Contracts callback under Allowed Callback URLs, and use Authorization Code flow. Auth0 recommends exact production callback URLs rather than wildcards.

| Contracts field | Auth0 value |
| --- | --- |
| Issuer URL | `https://<tenant-or-custom-domain>/` |
| Endpoint overrides | Normally empty; use discovery from the same domain |
| Client ID / secret | The Regular Web Application credentials |

See Auth0's [application settings](https://auth0.com/docs/get-started/applications/application-settings) and [authorization-code request](https://auth0.com/docs/api/authentication/authorization-code-flow/authorize-application).

### Keycloak

Create a confidential OpenID Connect client, enable Standard Flow, disable broad redirect patterns, and enter the exact callback in Valid Redirect URIs.

| Contracts field | Keycloak value |
| --- | --- |
| Issuer URL | `https://<keycloak-host>/realms/<realm>` |
| Endpoint overrides | Normally empty |
| Client ID / secret | The confidential client's credentials |

Keycloak publishes discovery at `/realms/<realm>/.well-known/openid-configuration`. See its [OIDC endpoint and redirect-URI guidance](https://www.keycloak.org/securing-apps/oidc-layers).

### Other conforming OIDC providers

Open `<issuer>/.well-known/openid-configuration` and confirm that `issuer`, `authorization_endpoint`, `token_endpoint`, and `jwks_uri` are present. The issuer must exactly match the ID token's `iss`; do not substitute a login-page URL. Use overrides only when the provider deliberately serves browser authorization from a different domain.

## Workforce SSO setup

1. Select **Employee SSO** in the guided setup panel.
2. Register the displayed `/auth/entity-callback` URL at the provider.
3. Configure **Enterprise SSO**. Add only verified email domains that may join the entity.
4. Run **Test connection**.
5. Sign out and open the displayed company-login URL in a private browser.
6. Confirm that an allowed employee receives the intended non-administrator membership and that an unapproved domain receives none.

Workforce SSO grants application membership. It does not establish authority to sign a particular contract; capacity, authority confirmation, and intent are captured in the signing ceremony.

## Product participant and condition setup

1. Select **Product + signing** in the guided setup panel.
2. Register the displayed `/auth/participant-callback` at the provider using a dedicated participant client.
3. Configure and test **Customer identity (OIDC)**.
4. Create an entity API client in **Customer OIDC** mode and enter the exact URL to which the signing journey may return.
5. Store the one-time client ID and secret in the integrating backend's secret manager. Rotate it immediately if it was logged, committed, or sent to a browser.
6. Copy the customized backend example from Settings.

The backend obtains a five-minute token from `POST /oauth/token`, using HTTP Basic client authentication. It then calls:

- `POST /integration/v1/conditions/evaluate` to ask for contract facts;
- `POST /integration/v1/signing-sessions` to create a ten-minute browser handoff.

Use the `sub` from the backend's already-verified product session. Contracts performs its own OIDC authorization before accepting a shared-OIDC handoff and requires the returned token's `iss + sub` to match. Email is a contact attribute, not the identity key.

Never call these endpoints directly from a browser and never treat the Contracts response as a general identity token. The integrating product decides what a satisfied condition enables.

## Acceptance test

Use test accounts and a non-production template:

1. Evaluate the required condition for a known test `sub`; expect `met: false`, a decision ID, and `Cache-Control: no-store`.
2. Create a signing handoff for that same subject and open it in a private browser.
3. Authenticate as the expected provider account, complete onboarding, and sign.
4. Evaluate again and confirm the intended condition is met.
5. Start a second handoff for subject A but authenticate as subject B; Contracts must reject it before showing the agreement.
6. Use a return URL not present in the client allowlist; creation must fail.
7. Rotate the API-client secret; the previous secret must stop obtaining tokens immediately.
8. Request only `conditions:read` and verify that the resulting token cannot create a signing session.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Callback or redirect mismatch | Copy the exact callback from Settings, including scheme, host, port, and path |
| Issuer mismatch | Compare the ID token's `iss` with the configured issuer; a branded login domain is often not the issuer |
| Discovery or JWKS failure | Open the issuer's well-known document from the Contracts host and confirm public DNS/TLS access |
| Verified-email error | Ensure the client requests `email` and that the provider emits boolean `email_verified: true` |
| Subject mismatch | The backend must use `sub` from the same issuer/session that Contracts authenticates |
| Condition remains unmet | Confirm entity, integration key, issuer, subject, template key, version, and whether the condition requires one signature or full execution |
| `invalid_client` | Check the client ID and current one-time secret; rotate from Settings if the secret was lost |
| `insufficient_scope` | Request a scope assigned to that API client and required by the endpoint |

Do not work around identity errors by matching email addresses or changing to host-asserted mode. Use host assertion only when the integration intentionally accepts full responsibility for authenticating the subject and that assurance decision has been reviewed.
