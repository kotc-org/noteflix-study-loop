# Noteflix Claude MCP gateway

Production-oriented Node 20 / TypeScript gateway for connecting Claude to a real Noteflix account. It exposes one deliberately narrow side-effecting tool: `create_private_note`.

The server is designed for Cloud Run but is not deployed by this package. It uses the official MCP TypeScript SDK's stateless Streamable HTTP transport and `mcpAuthRouter` OAuth endpoints.

## API shape

| Interface | Contract |
| --- | --- |
| MCP resource | `https://noteflix.com/mcp` |
| MCP transport | Stateless Streamable HTTP at `POST /mcp`; JSON responses |
| OAuth discovery | `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource/mcp`, plus root PRM compatibility alias |
| OAuth endpoints | `GET\|POST /authorize`, `POST /token`, `POST /register`, `POST /revoke` |
| Consent | `GET /consent`, `POST /consent/complete` |
| Health | `GET /health` |

An unauthenticated MCP request returns `401` with a `WWW-Authenticate` header pointing at the path-specific Protected Resource Metadata document. Authorization and token requests must supply the exact, fragment-free `MCP_RESOURCE_URL`; missing or different resource values are rejected. Access tokens are valid only for that audience and must include `notes:create`.

### Tool input

```json
{
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "Cell membranes",
  "content_markdown": "# Cell membranes\n\n...",
  "summary": "Optional concise summary",
  "key_points": ["Optional point"]
}
```

The input schema is strict. Unknown fields, publishing controls, collaborator IDs, URLs, user IDs, and arbitrary derived-asset requests are rejected.

### Noteflix write

The gateway uses its dedicated Google service identity to obtain an OIDC token for the exact `NOTEFLIX_INTERNAL_AUDIENCE` and sends exactly one authenticated request to `POST /internal/claude-mcp/ai-notes`. It does not mint or exchange Firebase custom tokens. The consented Firebase UID is included as `noteflixUserId`, and the backend accepts it only from the authorized gateway service identity. The gateway constructs the downstream body itself. It sends the confirmed Markdown once as the sole `notes` element and as `sourceText`; it never segments or summarizes that text. Omitted optional summary and key points become an empty string and empty array:

```json
{
  "noteflixUserId": "the consented Firebase UID",
  "title": "Cell membranes",
  "notes": ["# Cell membranes\n\n..."],
  "summary": "Optional confirmed summary, or an empty string",
  "keyPoints": ["Only confirmed points; otherwise this is empty"],
  "sourceText": "...",
  "sourceType": "text",
  "sourceUrl": null,
  "accessType": "PRIVATE_INVITE",
  "isVisible": false,
  "isPublic": false,
  "visibility": "private",
  "integrationSource": "claude-mcp",
  "derivedAssets": []
}
```

The adapter returns only the note ID, title, slug, private visibility, and a Noteflix URL. It never forwards arbitrary MCP input fields or reflects arbitrary backend response fields.

## OAuth and trust boundaries

- Dynamic Client Registration records, authorization requests, authorization codes, access tokens, rotating refresh tokens, idempotency records, and persistent rate-limit counters live in the dedicated Firestore database named by `FIRESTORE_DATABASE_ID`, not the Noteflix product database.
- Authorization requests, authorization codes, access tokens, and refresh tokens are opaque random values. Firestore stores only their SHA-256 hashes as document IDs.
- Public clients use PKCE S256. Confidential DCR client secrets are AES-256-GCM encrypted at rest; keep the encryption key stable.
- Dynamic registration accepts only the documented hosted Claude callback at `https://claude.ai/api/mcp/auth_callback`, plus HTTP loopback callbacks on ephemeral ports at the exact `/callback` path for `localhost` and `127.0.0.1`. Arbitrary HTTPS callbacks, IPv6 loopback, and other local hostnames are rejected.
- Consent uses the same Firebase Web Auth project as Noteflix. Email/password and Google sign-in happen in the browser. Before issuing an authorization code, the server submits the presented ID token to Firebase Identity Toolkit `accounts:lookup` and accepts only one enabled `localId`; it has no Firebase Auth administration or token-signing permission.
- The consent screen shows the return hostname and adds an explicit warning for local loopback callbacks, so an untrusted `client_name` cannot hide the redirect destination.
- Refresh tokens rotate on every use. Old refresh tokens and revoked tokens cannot be reused.
- `Origin` is optional for native/server clients. When supplied, it must exactly match `MCP_ALLOWED_ORIGINS` or the gateway's own origin; otherwise `/mcp` returns `403`.
- Authenticated MCP traffic is limited persistently per Firebase UID. It is not throttled by a shared source-IP bucket, which avoids one Claude egress address consuming every user's quota; OAuth and consent endpoints retain their narrower abuse limits.
- The Noteflix write endpoint accepts Google OIDC from the dedicated gateway service account for the exact audience. The gateway has no permission to mint Firebase user tokens, and the internal route is not exposed through the public Firebase-user-authenticated API.
- Request bodies and note content are never logged. Startup/shutdown logs contain operational metadata only.

## Idempotency and failure behavior

`request_id` is a required UUID and is scoped to the Firebase UID. An identical successful retry returns the stored result without writing again. Reusing an ID with changed content is rejected.

Failures that definitely happen before a Noteflix write (for example failure to acquire the service identity client) can reacquire the same idempotency record. A network timeout, 5xx, malformed success response, or abandoned in-flight lease is treated as outcome-unknown and is never automatically repeated. The caller is told to check the Noteflix library before choosing a new request ID. The gateway enforces request-ID idempotency before calling Noteflix and forwards the same UUID to the internal endpoint as `Idempotency-Key` and `X-Request-ID`; the internal endpoint receives these headers, but this gateway does not claim that it independently enforces them.

## Local development

Requirements: Node 20, Application Default Credentials with access to the named gateway Firestore database and the internal Noteflix Cloud Run route, and Firebase Auth email/password and Google providers enabled.

```bash
cp .env.example .env
npm ci
npm run check
npm run dev
```

Load `.env` with your preferred local secret manager or shell. The process intentionally does not add a dotenv dependency.

Useful contract checks:

```bash
curl -i -X POST http://localhost:8080/mcp \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'

curl http://localhost:8080/.well-known/oauth-protected-resource/mcp
```

## Cloud Run preparation (not executed)

1. Create a dedicated named Firestore database for gateway security state, set its ID as `FIRESTORE_DATABASE_ID`, and do not use the Noteflix product database.
2. Create a dedicated runtime service account. Restrict its Firestore data access to the named gateway database with a resource condition where supported. If the target Cloud Run service is IAM-private, grant `roles/run.invoker` only on that service. Do not grant Firebase Auth administration, service-account token-creator, or product-database access. The backend must independently verify the OIDC audience and exact gateway service-account identity on the internal route.
3. Put `OAUTH_CLIENT_SECRET_ENCRYPTION_KEY` in Secret Manager. Treat OAuth tokens and the encryption key as credentials.
4. Set `PUBLIC_BASE_URL` to the final HTTPS issuer origin and `MCP_RESOURCE_URL` to that same origin plus `/mcp`. These values are protocol identifiers and must not change after clients connect.
5. Configure the remaining values from `.env.example`, including the exact `NOTEFLIX_INTERNAL_AUDIENCE`, `FIRESTORE_DATABASE_ID`, the production Noteflix Firebase Web App values, and explicit allowed origins.
6. Build the container and deploy with a minimum of zero or more instances. Stateless MCP requests and Firestore persistence support horizontal scaling.
7. Configure Firestore TTL policies on `deleteAfter` for authorization requests, codes, tokens, idempotency records, and rate-limit documents. TTL cleanup is hygiene; every lookup also enforces expiry synchronously.
8. Verify discovery, DCR, PKCE, consent, token rotation, revocation, origin rejection, and a real private note in a non-production Firebase test user before directory submission.

Example build only:

```bash
docker build -t noteflix-claude-mcp .
```

## Configuration

See `.env.example`. Production startup rejects non-HTTPS public, MCP, internal-audience, and app URLs. `PUBLIC_BASE_URL` must be an origin with no path, and `MCP_RESOURCE_URL` must be the same origin at the exact `/mcp` path. `NOTEFLIX_INTERNAL_AUDIENCE` must be the origin-only Cloud Run audience for the service-authenticated backend. `FIRESTORE_DATABASE_ID` selects the dedicated named database used for OAuth, idempotency, and per-user rate-limit state; production rejects `(default)`.

Changing `OAUTH_CLIENT_SECRET_ENCRYPTION_KEY` invalidates stored confidential client secrets. Changing the issuer or resource URL invalidates existing OAuth relationships. Plan either change as a versioned migration.

## Tests

`npm run check` performs strict TypeScript checking, unit/contract tests, and a production build. Tests cover:

- opaque hashing and client-secret encryption;
- strict tool input and the allowlisted private Noteflix payload;
- OAuth scopes, current documented Claude redirect allowlisting, visible loopback consent warnings, and required exact resource binding;
- idempotent success, retryable pre-request failure, and outcome-unknown behavior;
- public Identity Toolkit consent verification and service-OIDC authorization for the real `/internal/claude-mcp/ai-notes` adapter contract;
- path-specific protected-resource metadata, exact `401 WWW-Authenticate` discovery, exact payload forwarding, and Origin rejection.

No test sends data to Noteflix or Firebase.
