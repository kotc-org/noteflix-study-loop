# Noteflix OpenAI MCP gateway

Production Node 20 / TypeScript gateway for connecting ChatGPT and other trusted MCP clients to the user's real Noteflix account. It exposes four narrow tools:

| Tool | Effect | OAuth scopes |
| --- | --- | --- |
| `create_private_note` | Saves one private note | `notes:create` |
| `get_video_allowance` | Reads the user's current video allowance | `videos:read` |
| `create_public_note_video` | Consumes the connected user's allowance to queue a public, shareable study video from one of their notes | `videos:create`, `videos:publish` |
| `get_video_status` | Reads rendering status for one of the user's videos | `videos:read` |

The server uses the official MCP TypeScript SDK's stateless Streamable HTTP transport and OAuth routing. It is designed for a dedicated Cloud Run service and does not replace the existing Claude services.

## HTTP and discovery contract

| Interface | Contract |
| --- | --- |
| MCP resource | Final production origin plus the exact `/mcp` path |
| MCP transport | Stateless Streamable HTTP at `POST /mcp`; JSON responses |
| OAuth metadata | `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource/mcp`, with a root protected-resource compatibility alias |
| OAuth endpoints | `GET\|POST /authorize`, `POST /token`, `POST /register`, `POST /revoke` |
| Consent | `GET /consent`, `POST /consent/complete` |
| OpenAI domain challenge | `GET /.well-known/openai-apps-challenge` after `OPENAI_APPS_CHALLENGE_TOKEN` is configured |
| Health | `GET /health` |

Unauthenticated MCP requests return `401` with a `WWW-Authenticate` link to the path-specific Protected Resource Metadata document. Authorization and token requests must use the exact, fragment-free `MCP_RESOURCE_URL`. Access and refresh grants are audience-bound and each tool enforces its own scope.

## User identity and subscription boundary

OAuth consent uses the same Firebase Authentication project as Noteflix. The gateway validates the presented Firebase ID token through Identity Toolkit and binds the grant to that token's exact Firebase UID. A caller cannot provide or override a UID in tool input.

Every action applies only to the connected UID. The gateway calls service-identity-protected Noteflix routes, and the backend independently verifies both the dedicated gateway service account and exact user identity. The backend remains authoritative for current subscription eligibility, note ownership, video allowance, idempotency, moderation, and publication state.

An existing eligible Noteflix account is required. The tools do not offer, sell, link to, or manage a subscription in ChatGPT. An ineligible account receives a neutral eligibility error.

## Tool safety

### Private notes

`create_private_note` accepts a strict UUID `request_id`, title, Markdown content, and optional confirmed summary/key points. Unknown fields, publishing controls, arbitrary URLs, collaborator IDs, user IDs, and derived-asset requests are rejected. The gateway constructs a fixed private downstream payload: the note is invisible, unlisted, and not rendered into a video.

A deterministic in-process privacy gate rejects payment-card data, identifiable health information, government identifiers, passwords, API keys, authentication tokens, one-time passwords, and verification codes before subscription lookup, input hashing, idempotency storage, or a backend call. It returns only a static error and never echoes the matched value or category. The Noteflix backend repeats the check before a write.

Identical retries reuse the same UUID. Reusing an ID with different content is rejected. A network timeout or ambiguous downstream response is not automatically retried; the caller is told to check the user's Noteflix library before choosing a new request ID.

### Public videos

`create_public_note_video` requires:

- a note ID owned by the connected user;
- a current allowance credit on that same user's eligible plan;
- one UUID `request_id` for backend idempotency;
- explicit `true` confirmations for generation, public publication, and source rights;
- a readable public slug plus one of the allowlisted styles and modes.

Creating a note never starts a render. The publication tool is intentionally separate because it consumes one user-specific allowance credit and produces an open-world public URL. Public source and generated text are moderated fail closed by the Noteflix backend, and the video is not anonymously resolvable unless it reaches the approved published state.

The backend reads and checks the owned source note for restricted data before idempotency reservation, allowance use, external moderation, or generation. Legacy queued jobs repeat the check immediately after loading the note and before any model, speech, image, or rendering call.

Tool responses return only allowlisted fields. Public videos use `https://noteflix.com/watch/{readable-slug}`; raw storage URLs and backend payloads are never returned.

## OAuth and trust boundaries

- Trusted hosted callbacks are the documented ChatGPT callback form `https://chatgpt.com/connector/oauth/{callback_id}` and the exact Claude callback `https://claude.ai/api/mcp/auth_callback`. Local development additionally permits HTTP loopback `/callback` URIs on `localhost`, `127.0.0.1`, and `[::1]`.
- ChatGPT defaults to all four action scopes. Claude and loopback registrations default to private-note access only unless they explicitly request a supported narrower or broader scope set.
- Public clients use PKCE S256. Confidential dynamic-registration secrets are AES-256-GCM encrypted at rest.
- Authorization requests, codes, access tokens, refresh tokens, and idempotency records are opaque. Firestore document IDs contain SHA-256 hashes, not plaintext tokens.
- Refresh tokens rotate on use; revoked or replaced credentials cannot be reused.
- OAuth state, rate limits, and idempotency live in the named gateway Firestore database, separate from the Noteflix product database.
- The runtime service account has no Firebase token-minting or product-database access. The backend accepts it only on the exact integration routes and exact OIDC audience.
- Request bodies, note content, OAuth credentials, and video source text are not logged.
- Browser `Origin`, when present, must match the configured trusted origins or the gateway's own origin.

## Local development

Requirements: Node 20, Application Default Credentials for the named gateway Firestore database and internal Noteflix Cloud Run service, plus the Noteflix Firebase Web Auth configuration.

```bash
cp .env.example .env
npm ci
npm run check
npm run dev
```

Load `.env` through the local shell or secret manager; the process intentionally has no dotenv dependency.

Useful contract checks:

```bash
curl -i -X POST http://localhost:8080/mcp \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'

curl http://localhost:8080/.well-known/oauth-protected-resource/mcp
```

## Production preparation

1. Deploy this package as a new Cloud Run service using the dedicated `noteflix-openai-mcp@studywnoteflix.iam.gserviceaccount.com` runtime identity. Do not repoint the live Claude services.
2. Use the dedicated named `noteflix-openai-mcp` Firestore database and the `noteflix_openai_mcp` collection prefix. Grant the runtime service account conditional Firestore access only to that database so it cannot read either Claude connector's OAuth state.
3. Store one stable 32-byte `OAUTH_CLIENT_SECRET_ENCRYPTION_KEY` in Secret Manager. Treat it and all OAuth tokens as credentials.
4. Set `PUBLIC_BASE_URL` to the final HTTPS origin and `MCP_RESOURCE_URL` to that origin plus `/mcp`. Changing either identifier invalidates existing OAuth relationships.
5. Configure the exact internal Cloud Run audience, Noteflix app origin, Firebase Web Auth values, documentation URL, and trusted client origins from `.env.example`.
6. Add the production custom domain to Firebase Authentication's authorized domains.
7. Configure Firestore TTL on `deleteAfter` for short-lived OAuth, idempotency, and rate-limit documents. Every lookup also enforces expiry synchronously.
8. When OpenAI provides the domain-verification value, set `OPENAI_APPS_CHALLENGE_TOKEN`; the challenge route returns that value alone as plain text.
9. Verify discovery, DCR, PKCE, consent, scoped reconnect challenges, token rotation/revocation, origin rejection, ineligible-account denial, a real private note, allowance status, and a separately confirmed public render before submission.

Build the production container with:

```bash
docker build -t noteflix-openai-mcp .
```

## Configuration

See `.env.example`. Production requires HTTPS for public, MCP, internal-audience, app, and documentation URLs. `PUBLIC_BASE_URL` must be an origin with no path; `MCP_RESOURCE_URL` must use the same origin and exact `/mcp` path. `NOTEFLIX_INTERNAL_AUDIENCE` must be an origin-only Cloud Run audience. Production rejects the default Firestore database.

## Tests

`npm run check` performs strict TypeScript checking, unit/contract tests, and a production build. Coverage includes:

- strict note/video schemas and allowlisted downstream payloads;
- tool catalog descriptions, annotations, OAuth security metadata, and per-tool scope challenges;
- exact OAuth resource binding, ChatGPT/Claude callback validation, PKCE, rotation, and revocation;
- Firebase-UID binding and fail-closed subscription checks;
- note idempotency and ambiguous-outcome behavior;
- user-specific allowance, explicit public-generation confirmations, safe video errors, and status output;
- deterministic restricted-data refusal before note/video mutations or provider calls;
- OpenAI challenge output, MCP discovery, exact `401 WWW-Authenticate`, and `Origin` rejection.

Tests do not send content to Noteflix, Firebase, or OpenAI.
