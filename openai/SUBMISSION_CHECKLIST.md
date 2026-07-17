# ChatGPT submission checklist

Do not mark the app ready merely because the portal accepts a draft. Every blocking item below must be verified with the production service and reviewer account.

## Product and policy

- [ ] App name is **Noteflix Study & Video** and category is **Education**.
- [ ] Publisher display name exactly matches the verified identity in the submitting OpenAI organization.
- [ ] Audience is consistently age 13+ and not directed to under-13 users across product terms, privacy, support, consent, listing, and runtime behavior.
- [ ] Live-assessment and general educational safety behavior is tested.
- [ ] Existing-account language is neutral. No tool, error, starter prompt, listing field, or UI says subscribe, upgrade, buy, restore, manage plan, view price, open checkout, or get more credits.
- [ ] All-country selection is enabled in the portal; the listing qualifies it by actual ChatGPT Apps and Noteflix service availability.
- [ ] Developer location is entered as USA without using it as an unverified legal-entity claim.
- [ ] A live first-party privacy URL contains the complete ChatGPT/private-note/public-video/processor/retention/deletion disclosure.
- [ ] A live first-party terms URL exists and is verified; do not invent one from repository context.
- [ ] Support email and first-party support page are live and monitored.

## MCP and OAuth

- [ ] Production MCP is reachable on a first-party HTTPS `/mcp` URL.
- [ ] Streamable HTTP, JSON-RPC, initialization, tool listing, and tool calls pass in the production environment.
- [ ] Protected-resource and authorization-server metadata are correct for the exact MCP resource.
- [ ] OAuth uses authorization code plus PKCE and verifies issuer/resource/audience, token expiry, scopes, and exact Firebase UID.
- [ ] Dynamic client registration accepts the exact ChatGPT callback actually supplied during developer-mode or portal registration and rejects untrusted callbacks.
- [ ] `notes:create`, `videos:read`, `videos:create`, `videos:publish`, and optional `offline_access` behave as described.
- [ ] Every tool declares an exact input schema, output schema, security scheme, title/description, and accurate `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint` annotations.
- [ ] `create_public_note_video` is marked open-world and consequential; all three explicit confirmation fields are enforced server-side.
- [ ] `create_private_note` cannot publish or automatically generate media.
- [ ] Allowance and status tools do not expose plan, price, email, payment, billing-provider, provider-prompt, raw storage, or other-user data.
- [ ] Safe retries reuse the same request ID and identical inputs; changed-input reuse fails.
- [ ] No custom web component is submitted unless its resource metadata and exact CSP have been separately audited. No wildcard CSP domain is used.

## Production domain and challenge

- [ ] The final MCP host is controlled by Noteflix and is not a temporary Cloud Run hostname in the public listing.
- [ ] The portal's exact domain-challenge token is stored as a secret/config value, never committed.
- [ ] `GET /.well-known/openai-apps-challenge` on the final host returns only the exact challenge token with no JSON wrapper, HTML, whitespace, or redirect.
- [ ] Domain ownership verification succeeds in the submission portal.
- [ ] Health, OAuth metadata, consent, token, and MCP routes remain available after challenge configuration.

## Exact-user account and allowance

- [ ] A real eligible test proves note and video actions use only the OAuth-bound user's Firebase UID.
- [ ] A different UID, another user's note/video ID, malformed subscription response, entitlement outage, or service-identity error fails closed before mutation.
- [ ] The connected user's allowance—not an organization, reviewer, gateway, or service account—is read and consumed.
- [ ] One accepted generation reserves one credit; success consumes it; failed, abandoned, or deleted in-flight generation refunds it; idempotent replay does not double-charge.
- [ ] Short-term per-user generation safety limit is tested.

## Privacy and deletion

- [ ] OAuth, idempotency, and rate-limit TTL policies exist in the production Firestore database and are verified by collection policy.
- [ ] Connector logs exclude note bodies, passwords, OAuth tokens, challenge tokens, and private reviewer credentials.
- [ ] The production video worker's actual Google/ElevenLabs provider path is confirmed and matches the public processor disclosure.
- [ ] Deleting a public video tombstones its slug and makes its watch page/playback unavailable.
- [ ] Deleting a public video also deletes or places a verified bounded retention on its underlying storage object.
- [ ] Deleting a source note removes/tombstones every derived public video and handles storage objects.
- [ ] Account deletion sweeps top-level videos, generation jobs, public-slug mappings/tombstones as intended, storage objects, and associated allowance ledgers—or the live policy accurately documents a lawful bounded retention exception.
- [ ] Revocation behavior is disclosed separately from product-data deletion.

## Reviewer package

- [ ] The dedicated reviewer account passes every item in `REVIEWER_ACCOUNT.md` and requires no 2FA/MFA or secondary verification.
- [ ] Credentials and sample IDs appear only in private portal instructions.
- [ ] Exactly five positive and three negative scenarios from `REVIEW_SCENARIOS.md` pass against production.
- [ ] Demo evidence includes tool calls, structured output, same-UID binding, allowance before/after, private-note visibility, signed-out public watch success, signed-out source-note denial, and cleanup.
- [ ] The 1024 × 1024 first-party icon in `ASSETS.md` renders correctly in the portal.
- [ ] Release notes from `LISTING.md` match the deployed tool catalog and contain no future or unshipped feature.

## OpenAI organization and portal

- [ ] The individual or business identity is verified in the same OpenAI organization/project used for submission.
- [ ] The submitter has Apps Management write permission.
- [ ] Create the portal item as an MCP-backed app and enter the final production endpoint/authentication configuration.
- [ ] Tool scan completes with no unexplained extra tools, schemas, permissions, domains, or unsafe descriptions.
- [ ] Country availability, category, logo, descriptions, starter prompts, privacy, terms, support, release notes, and private demo instructions are entered exactly from the verified package.
- [ ] Submit for review only after every blocker in `READINESS_AUDIT.md` is closed or the product behavior and public policy are corrected together.
- [ ] Save the submission ID, timestamp, organization/project, deployed revision, endpoint, challenge verification result, asset hash, and portal status in private evidence.
