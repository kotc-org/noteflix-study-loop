# ChatGPT submission checklist

Do not mark the plugin ready merely because the portal accepts a draft. Verify every blocking item against the note-only production configuration.

## Product and policy

- [ ] Plugin name is **Noteflix** and category is **Education & Research**.
- [ ] Publisher display name exactly matches the verified identity in the submitting OpenAI organization.
- [ ] Audience is consistently age 13+ and not directed to under-13 users across terms, privacy, support, consent, listing, and runtime behavior.
- [ ] Existing-account language is neutral. No tool, error, starter prompt, listing field, or UI says subscribe, upgrade, buy, restore, manage plan, view price, open checkout, or get more credits.
- [ ] Country selection is limited to actual ChatGPT plugin and Noteflix availability.
- [ ] Developer location is entered as USA without using it as an unverified legal-entity claim.
- [ ] First-party privacy, terms, and support URLs are live, consistent with the note-only product, and monitored.
- [ ] The listing does not describe, imply, or demonstrate video generation, allowance, status, public publication, or any other disabled capability.

## MCP and OAuth

- [ ] Production MCP is reachable on the first-party HTTPS `https://chatgpt.noteflix.com/mcp` URL.
- [ ] Streamable HTTP, JSON-RPC initialization, tool listing, and tool calls pass in production.
- [ ] The catalog contains exactly `create_private_note`; `ENABLE_VIDEO_TOOLS=false` is verified on the deployed revision.
- [ ] Protected-resource and authorization-server metadata advertise only `notes:create` and optional `offline_access` for the exact MCP resource.
- [ ] Requests for `videos:read`, `videos:create`, or `videos:publish` fail as unsupported scopes.
- [ ] OAuth uses authorization code plus PKCE and verifies issuer, resource, audience, token expiry, scope, and exact Firebase UID.
- [ ] Dynamic client registration accepts the exact ChatGPT callback supplied during registration and rejects untrusted callbacks.
- [ ] Exact public ChatGPT DCR registrations remain valid for the operating life of the connector; confidential, Claude, loopback, and verifier registrations retain the finite 30-day cleanup horizon.
- [ ] `create_private_note` declares exact input/output schemas, mirrored OAuth security schemes, a clear title/description, and accurate annotations: `readOnlyHint: false`, `destructiveHint: false`, `openWorldHint: false`, and `idempotentHint: true`.
- [ ] The tool cannot publish, share, generate media, select a user ID, set visibility, or automatically create derived assets.
- [ ] Safe retries reuse the same request ID and identical inputs; changed-input reuse fails.
- [ ] No custom web component is submitted. Portal CSP is deny-all: `connectDomains: []`, `resourceDomains: []`, and `frameDomains: []`.

## Dedicated backend contract

- [ ] The gateway calls only the dedicated OpenAI note routes: `/internal/openai-mcp/subscription-eligibility` and `/internal/openai-mcp/ai-notes`.
- [ ] Requests use `x-noteflix-integration: openai-mcp`; stored records use `integrationSource: openai-mcp`.
- [ ] The backend accepts only the dedicated gateway service identity and exact configured OIDC audience.
- [ ] A different UID, malformed entitlement response, entitlement outage, or service-identity error fails closed before idempotency or mutation.
- [ ] The backend independently repeats restricted-data and exact-subscription checks immediately before the write.

## Production domain and challenge

- [ ] The final MCP host is controlled by Noteflix and is not a temporary Cloud Run hostname in the listing.
- [ ] DNS resolves, TLS is valid, and health, OAuth metadata, consent, token, and MCP routes work through the custom hostname.
- [ ] The portal's exact domain-challenge token is stored as a runtime config value and never committed.
- [ ] `GET /.well-known/openai-apps-challenge` returns only the exact challenge value with no wrapper, whitespace, HTML, or redirect.
- [ ] Domain ownership verification succeeds in the submission portal.

## Privacy, retention, and deletion

- [ ] Restricted-data rejection runs before eligibility, input hashing, idempotency, or backend calls and never echoes the matched value or category.
- [ ] Connector logs exclude note bodies, credentials, OAuth tokens, challenge tokens, and reviewer credentials.
- [ ] OAuth, idempotency, and rate-limit TTL policies are active in the isolated production Firestore database.
- [ ] A created note remains private and contains no automatic video, audio, image, podcast, quiz, flashcard, game, or other derived asset.
- [ ] Revocation stops future connector access without falsely claiming to delete already-created product data.
- [ ] A reviewer can delete the created note and account through the documented first-party Noteflix controls.

## Reviewer package

- [ ] The dedicated reviewer account passes every item in `REVIEWER_ACCOUNT.md` and requires no MFA, email code, or secondary verification.
- [ ] Credentials appear only in private portal instructions.
- [ ] Exactly five positive and three negative scenarios from `REVIEW_SCENARIOS.md` pass on ChatGPT web and mobile.
- [ ] Evidence includes the one-tool catalog, note-only scopes, no pre-confirmation mutation, exact payload, same-UID binding, private visibility, idempotent replay, restricted-data refusal, and cleanup.
- [ ] The first-party directory and composer icon derivatives render correctly in the portal's light- and dark-mode previews.
- [ ] Release notes match the deployed one-tool catalog and contain no future feature.

## OpenAI organization and portal

- [ ] The individual or business identity is verified in the same OpenAI organization/project used for submission.
- [ ] The submitter has Apps Management Write (`api.apps.write`) and Read (`api.apps.read`) permission.
- [ ] The submitting project meets current OpenAI submission-region requirements.
- [ ] Create the portal item using **Create plugin → With MCP** and enter the final production endpoint/authentication configuration.
- [ ] Select **Universal** and enter `https://chatgpt.noteflix.com/mcp`; do not reference the existing development integration ID.
- [ ] Tool scan completes with exactly one explained tool, one action scope, and no unexpected schema, permission, domain, or unsafe description.
- [ ] Country availability, category, logo, descriptions, starter prompts, privacy, terms, support, release notes, and a reviewer-accessible private demo-recording URL are entered from the verified package.
- [ ] Submit only after every no-ship condition in `READINESS_AUDIT.md` is closed.
- [ ] Obtain fresh owner confirmation immediately before selecting **Submit for Review**.
- [ ] After approval, obtain separate fresh owner confirmation immediately before selecting **Publish**.
- [ ] Save the submission ID, timestamp, organization/project, deployed revisions, endpoint, challenge result, asset hash, and portal status in private evidence.
