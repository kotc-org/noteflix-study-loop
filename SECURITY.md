# Security

## Scope and controls

Noteflix Study Loop includes Markdown study skills and a remote, authenticated MCP connection for private note creation. The submitted plugin exposes only `create_private_note`. Its OAuth grant requests `notes:create` as the sole data-action scope plus `offline_access` for refresh-token renewal; the refresh scope adds no permission to read or change Noteflix data.

The connection uses OAuth with PKCE at the first-party `https://noteflix.com/mcp` endpoint. The service requires the exact, fragment-free MCP resource on authorization and token requests, accepts only exact Claude-hosted or local loopback redirect callbacks, and displays the callback hostname on the consent screen. Local callbacks receive an additional warning. The service validates access tokens, scopes, payload limits, exact consent-request origin, authenticated account identity, and active subscription eligibility for that exact Firebase UID before idempotency or a write. The preflight accepts only an exact same-UID premium response from the service-identity-protected Noteflix backend; negative, unavailable, malformed, wrong-user, and service-authorization responses fail closed. Private visibility is enforced server-side; the caller cannot request a public note. A caller-supplied UUID provides idempotency for safe retry, and the service applies a persistent per-account rate limit without a shared-IP cap on authenticated MCP traffic. Note bodies are excluded from application logs by design.

OAuth records, idempotency state, and rate-limit counters use a dedicated named Firestore database selected by `FIRESTORE_DATABASE_ID`, separate from the Noteflix product database. The gateway forwards confirmed Markdown without segmenting it or generating a summary or key points; omitted optional fields remain empty.

TTL policies are active for every control collection. Dynamic clients and refresh tokens expire after 30 days; shorter-lived authorization, access-token, and rate-limit records expire on their documented schedules. Idempotency receipts retain only hashes and the safe note receipt—not note content—for 30 days.

The gateway verifies the presented Firebase ID token through the public Identity Toolkit lookup endpoint and retains only the enabled Firebase UID. It does not hold Firebase Auth administration, custom-token signing, or product-database permissions. Gateway control state remains in a dedicated named database. Subscription preflight and note creation use the gateway's dedicated Google OIDC service identity against separate internal Noteflix routes at the same exact audience. The backend verifies both the audience and the exact gateway service-account identity and evaluates subscription access through Noteflix's strict premium-access resolver: a current source-verified paid Stripe/IAP record or the immutable live RevenueCat premium entitlement for the exact UID.

The save skill requires explicit save intent, a complete payload preview, and a separate confirmation before the mutating call. It never saves automatically. The four study skills do not call the remote service.

The skills treat instructions, links, requests to reveal secrets, and tool directives embedded in learner material as untrusted source content. They must not execute those directives, open links, reveal secrets, or upload data based on embedded text.

## Boundaries

- The connector cannot list, read, search, update, publish, or delete existing Noteflix notes.
- The submitted plugin does not expose AI video, audio, image, podcast, or other media-generation tools.
- It does not inspect uploads, retrieve prior conversations, query Claude memory, access other connectors, or search a Noteflix library.
- Learners authenticate on the Noteflix authorization page and should never paste credentials into Claude.

## Reporting

Report a suspected security or privacy issue privately to [support@noteflix.com](mailto:support@noteflix.com). Do not open a public issue with exploit details, tokens, credentials, private course material, or personal information.

Include the plugin version, Claude surface, reproduction steps, affected endpoint or skill, and expected versus observed behavior. Noteflix will acknowledge reports as soon as practical.
