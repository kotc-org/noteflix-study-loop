# Submission readiness audit

This is the source readiness gate for the note-only launch, not a deployment receipt or public listing copy. Historical verification does not prove the current release and must not be reused as submission evidence. Record live deployment and portal results separately in private evidence.

## Implemented and locally regression-verified

- Safe configuration default: `ENABLE_VIDEO_TOOLS=false`.
- Default MCP catalog contains exactly `create_private_note`; optional video tools return only when the flag is explicitly `true`.
- Default OAuth discovery and grants contain `notes:create` plus optional `offline_access`; video scopes are rejected while disabled.
- Legacy mixed note/video refresh grants are narrowed to note-only permission; video-only grants cannot expand into note access.
- Note-only OAuth resource name is exactly **Noteflix**.
- Wire-level `tools/list` emits the OAuth security scheme both at top level and in the `_meta` compatibility mirror.
- `create_private_note` uses a strict allowlisted schema, explicit confirmation workflow, forced private visibility, no derived assets, and UUID idempotency.
- Restricted-data checks run before eligibility, hashing, idempotency, and backend calls and do not echo matched values or categories.
- Dedicated OpenAI backend contract uses `/internal/openai-mcp/subscription-eligibility`, `/internal/openai-mcp/ai-notes`, `x-noteflix-integration: openai-mcp`, and `integrationSource: openai-mcp`. Private-note POST requests also send `x-noteflix-user-id` matching the OAuth-bound `noteflixUserId` in the body.
- Exact OAuth UID binding, PKCE, dynamic client registration policy, token rotation/revocation, state preservation, origin restrictions, and fail-closed entitlement handling remain covered by tests.
- The verifier defaults to the one-tool note-only catalog. Its video checks require an explicit local `ENABLE_VIDEO_TOOLS=true` and are outside this launch.
- Listing, privacy, reviewer scenarios, reviewer-account instructions, and submission checklist describe only the note-only catalog.

## Production deployment gates

- [ ] Record the exact reviewed gateway revision, immutable image digest, serving traffic, and dedicated runtime identity in private evidence.
- [ ] Record the exact reviewed dedicated backend revision, immutable image digest, and runtime identity for the `/internal/openai-mcp/*` contract in private evidence.
- [ ] Verify that the production gateway uses only the dedicated OpenAI note routes and exact OIDC audience, not historical `/internal/claude-mcp/*` routes or identities.
- [ ] Verify DNS, managed TLS, public product/support/privacy/terms pages, OAuth metadata, PKCE authorization, note-only scopes, the one-tool MCP catalog, and durable public ChatGPT dynamic registration through the configured custom hostname.
- [ ] Verify that optional video code remains disabled on the submitted revision. It must not be enabled during this release.

## Domain and portal gates

1. Sign in to the OpenAI Platform organization that will own the public listing and confirm it has a verified developer or business identity plus Apps Management Read/Write permission.
2. Create a new **With MCP** marketplace draft using the Universal endpoint `https://chatgpt.noteflix.com/mcp`; do not reference the existing development integration ID.
3. Obtain the exact OpenAI domain-challenge value from the draft, store it as a secret/config value, deploy it, and verify the challenge route returns only that value.
4. Run **Scan Tools** and confirm the draft discovers exactly `create_private_note`, the `notes:create` action scope, and the five reviewed skills.
5. Provide verified no-MFA demo credentials, the five positive and three negative cases, three starter prompts, listing fields, availability, release notes, and policy attestations.
6. Obtain fresh owner confirmation immediately before selecting **Submit for Review**. Approval does not publish automatically; obtain separate fresh confirmation before selecting **Publish** after approval.

## Required production evidence

- Health, protected-resource metadata, authorization-server metadata, DCR, PKCE consent, token exchange, token refresh, token revocation, CORS/origin checks, and post-revocation denial through the custom hostname.
- Exact raw one-tool catalog and mirrored OAuth security scheme.
- Default note-only scopes and rejection of every video scope.
- Dedicated gateway service account accepted only by the dedicated OpenAI backend route and exact OIDC audience.
- Exact-UID eligibility and a real confirmed private note created only in the reviewer account.
- No tool call before confirmation, no automatic media/derived assets, private visibility, minimized receipt, and no cross-account data.
- Idempotent replay returns the original receipt without a duplicate; changed-input reuse fails.
- Restricted-data input fails before entitlement or mutation without echoing the value.
- The five positive and three negative scenarios pass on ChatGPT web and mobile.
- Created review notes are deleted and the OAuth grant is revoked after testing.

## No-ship conditions

Do not submit while any of these is true:

- the deployed catalog contains any tool other than `create_private_note`;
- video scopes appear in OAuth discovery, consent, or a new grant;
- `ENABLE_VIDEO_TOOLS` is true on the submitted revision;
- the note path uses a Claude route, header identity, or stored integration source;
- the dedicated backend function or exact service-identity check is unavailable;
- the custom MCP hostname lacks valid DNS/TLS;
- the OpenAI domain challenge is unverified;
- privacy, terms, support, listing, and deployed behavior do not match;
- reviewer sign-in requires secondary verification or lacks a current eligible entitlement;
- the exact eight reviewer scenarios have not passed on web and mobile; or
- verified identity or Apps Management write permission is absent.
