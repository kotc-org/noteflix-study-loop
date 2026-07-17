# Noteflix Study & Video — listing copy

## Core fields

| Field | Submission value |
|---|---|
| Plugin name | Noteflix Study & Video |
| Category | Education |
| Developer location | United States of America |
| Country availability | Select every portal country where both ChatGPT plugins and Noteflix are available. The scoped terms support worldwide availability subject to local law and service availability. |
| Localization | English (United States) |
| Website | https://noteflix.com |
| Support URL | https://noteflix.com/openai-app/support |
| Support email | support@noteflix.com |
| Privacy URL | https://noteflix.com/openai-app/privacy |
| Terms URL | https://noteflix.com/openai-app/terms |
| Authentication | OAuth with PKCE through Noteflix |
| MCP endpoint | https://chatgpt.noteflix.com/mcp |
| Audience | General audience, age 13 and older; not directed to children under 13 |
| Existing-account requirement | An existing eligible Noteflix account is required for account actions. The app does not sell, promote, or link to subscriptions, upgrades, prices, checkout, or credits inside ChatGPT. |

“United States of America” above records the developer's stated base. It is not a legal-entity, incorporation, tax-residency, or regulatory attestation. The verified individual or business identity in the OpenAI organization must supply any legal publisher fields.

## Tagline

Turn study material into private notes and, with explicit approval, public AI explainer videos.

## Short description

Connect your existing eligible Noteflix account to save private study notes, check your video allowance, and explicitly create shareable AI explainer videos with readable Noteflix links.

## Full description

Noteflix Study & Video connects ChatGPT to the user's real Noteflix account through OAuth. It can create a private note from an exact title and Markdown body the user has approved. It cannot list, read, search, update, publish, or delete existing notes.

For video, the app can read the connected account's monthly public-video allowance without exposing plan, price, payment, email, or billing-provider details. After the user chooses an owned private note, a style, and a length, the app must explain that generation uses one allowance credit and that the result will be public, shareable, and potentially discoverable. It must also obtain confirmation that the user owns or has permission to publish the source. Only then can it queue an AI-generated video. The private source note stays private; the resulting video receives a readable `noteflix.com/watch/<slug>` page. The app can then check whether that video is queued, processing, ready, or failed.

All account actions are bound to the exact Firebase UID authenticated in the Noteflix OAuth grant. A current eligible Noteflix account is required and every entitlement check fails closed. The app does not use a service account's subscription or a different user's allowance. It does not offer purchases, pricing, checkout, plan management, subscription restoration, or upgrade links inside ChatGPT.

The app is intended for general audiences age 13 and older and is not directed to children under 13. It supports study-note organization and explanation and does not claim to predict grades.

## Feature and permission summary

| Tool | User-visible purpose | OAuth scopes | Side effect and confirmation |
|---|---|---|---|
| `create_private_note` | Create one private note in the connected user's Noteflix library | `notes:create` | Creates product data. Require explicit save intent, an exact payload preview, and separate confirmation. |
| `get_video_allowance` | Read the connected user's monthly public-video allowance | `videos:read` | Read-only; consumes no credit. |
| `create_public_note_video` | Generate and publish a public AI video from an owned private note | `videos:create`, `videos:publish` | Reserves one allowance credit. Require explicit confirmation of generation/credit impact, public discoverability, and source rights. Never call automatically after note creation. |
| `get_video_status` | Read generation/publication status for a connected user's video | `videos:read` | Read-only; returns the readable watch page, not a raw storage URL. |

`offline_access` may also be requested so short-lived access can renew without repeated sign-in. It adds no permission to read or change Noteflix product data.

## Tool annotation justifications

| Tool | `readOnlyHint` | `destructiveHint` | `openWorldHint` | `idempotentHint` | Justification |
|---|---:|---:|---:|---:|---|
| `create_private_note` | false | false | false | true | Creates one private record in the connected account; it does not delete/overwrite data or publish externally. Identical retries reuse one receipt. |
| `get_video_allowance` | true | false | false | true | Reads a minimized account-bound allowance snapshot and makes no external change. |
| `create_public_note_video` | false | false | true | true | Publishes externally visible content and consumes one finite allowance unit, but does not delete or overwrite user data. The open-world annotation and all three server-enforced confirmations communicate the consequence. Identical retries do not create or charge twice. |
| `get_video_status` | true | false | false | true | Reads status for one exact-account video and makes no external change. |

## Starter prompts

1. “Turn the text below into a concise study note. Show me the exact title and Markdown you would save privately to Noteflix, then wait for my approval.”
2. “Check my connected Noteflix account's public-video allowance. Do not generate anything.”
3. “For my private Noteflix note ID below, propose a brief whiteboard explainer. Tell me the one-credit and public-discoverability impact, then wait for all required confirmations before generating it.”
4. “Check the Noteflix video ID below and tell me whether it is queued, processing, ready, or failed. If it is ready, give me its readable Noteflix watch page.”

Do not use starter copy that says “subscribe,” “upgrade,” “buy,” “restore purchases,” “manage plan,” or “get more credits.”

## Release notes — initial submission 1.0.0

Initial submission of the MCP-backed Noteflix Study & Video plugin. Reviewer access uses the dedicated no-MFA eligible account and fixtures supplied in the portal's private instructions.

- Added exact-user Noteflix OAuth with PKCE and per-tool least-privilege scopes.
- Added confirmed private-note creation with UUID idempotency and no automatic derived media.
- Added a read-only monthly public-video allowance check for the connected account.
- Added explicitly confirmed AI video generation from an owned private note, with one-credit disclosure, source-rights confirmation, and public/discoverable output disclosure.
- Added readable public watch-page slugs while keeping the source note private and excluding raw media URLs from tool results.
- Added read-only video status checks and privacy-safe structured results.
- Added fail-closed subscription and exact-UID binding; the app never consumes another user's or a service account's allowance.
- Added age-13+ general-audience disclosures and restricted-data boundaries.

## Portal notes

- Publisher display name must match the identity verified in the same OpenAI organization. Do not add “official,” “OpenAI,” “ChatGPT,” or any endorsement claim to the app name.
- Submit as an MCP-backed app without a custom web component. Enter a deny-all component CSP because this release has no iframe or widget fetches: `connectDomains: []`, `resourceDomains: []`, and `frameDomains: []`. Do not add wildcard CSP entries.
- Supply demo credentials and sample IDs only through the portal's private reviewer fields, never in public listing text or this repository.
