# Noteflix — listing copy

## Core fields

| Field | Submission value |
|---|---|
| Plugin name | Noteflix |
| Category | Education & Research |
| Developer location | United States of America |
| Country availability | Select only portal countries where both ChatGPT plugins and Noteflix are available. |
| Localization | English (United States) |
| Website | https://chatgpt.noteflix.com/about |
| Support URL | https://chatgpt.noteflix.com/support |
| Support email | support@noteflix.com |
| Privacy URL | https://chatgpt.noteflix.com/privacy |
| Terms URL | https://chatgpt.noteflix.com/terms |
| Authentication | OAuth authorization code with PKCE through Noteflix |
| MCP endpoint | https://chatgpt.noteflix.com/mcp |
| Audience | General audience, age 13 and older; not directed to children under 13 |
| Existing-account requirement | An existing eligible Noteflix account is required only when saving a note. The plugin does not sell, promote, or link to subscriptions, upgrades, prices, checkout, or credits inside ChatGPT. |

“United States of America” records the developer's stated base. It is not a legal-entity, incorporation, tax-residency, or regulatory attestation. The verified individual or business identity in the OpenAI organization must supply any legal publisher fields.

## Tagline

Turn study material into source-faithful learning tools and save approved results privately.

## Short description

Save private study notes

## Full description

Noteflix helps learners turn text supplied in the current ChatGPT conversation into an active study workflow. It can organize source-faithful guides, create flashcards and direct-retrieval practice, lead one-question-at-a-time review, and build realistic review plans from the learner's deadline and available time.

The plugin does not inspect uploads, retrieve prior chats, query memory, or search existing Noteflix content. Source material for a study workflow must be supplied as text in the current request. It flags source conflicts instead of silently resolving them and treats instructions embedded inside supplied study material as quoted content rather than commands.

When a learner explicitly asks to save an artifact, the plugin shows the exact title, Markdown body, optional summary and key points, destination, and private visibility, then waits for separate confirmation. Only after an affirmative response does it call `create_private_note`. The tool can create one private record for the exact OAuth-connected Firebase UID. It cannot list, read, search, update, publish, share, or delete existing notes, and it cannot generate media.

Every save requires an existing eligible Noteflix account. Entitlement checks fail closed for the exact OAuth UID; the plugin never uses a service account's subscription or another user's access. It does not offer purchases, pricing, checkout, plan management, subscription restoration, or upgrade links inside ChatGPT.

## Feature and permission summary

| Tool | User-visible purpose | OAuth scope | Side effect and confirmation |
|---|---|---|---|
| `create_private_note` | Create one private note in the connected user's Noteflix library | `notes:create` | Creates product data. Requires explicit save intent, an exact payload preview, and separate confirmation. |

`offline_access` may also be requested so short-lived access can renew without repeated sign-in. It adds no permission to read or change Noteflix product data.

## Tool annotation justification

| Tool | `readOnlyHint` | `destructiveHint` | `openWorldHint` | `idempotentHint` | Justification |
|---|---:|---:|---:|---:|---|
| `create_private_note` | false | false | false | true | `readOnlyHint=false` because the tool creates a note; `destructiveHint=false` because it neither deletes nor overwrites and the private note remains user-deletable; `openWorldHint=false` because it cannot publish, share, send, or change public internet state; `idempotentHint=true` because identical request IDs and inputs reuse the original receipt. |

## Starter prompts

1. “Turn the text below into a concise, source-faithful study guide.”
2. “Quiz me on the text below one question at a time.”
3. “Preview the exact private note you would save to Noteflix, then wait for my confirmation.”

Do not use starter copy that says “subscribe,” “upgrade,” “buy,” “restore purchases,” “manage plan,” or “get more credits.”

## Release notes — initial submission 1.0.0

Initial submission of the MCP-backed Noteflix plugin. Reviewer access uses the dedicated no-MFA eligible account supplied in the portal's private instructions.

- Added source-faithful study-guide, practice, quiz-first review, and study-plan skills.
- Added exact-user Noteflix OAuth with PKCE and the least-privilege `notes:create` action scope.
- Added confirmed private-note creation with UUID idempotency and no automatic derived media.
- Added deterministic restricted-data refusal before entitlement, idempotency, or backend calls.
- Added fail-closed subscription and exact-UID binding.
- Added age-13+ general-audience disclosures and learning-integrity boundaries.

## Portal notes

- Publisher display name must match the identity verified in the same OpenAI organization. Do not add “official,” “OpenAI,” “ChatGPT,” or an endorsement claim to the plugin name.
- Create the portal item using **Create plugin → With MCP** as an MCP-backed plugin with the five uploaded skills and no custom web component. Do not upload screenshots for this no-UI release. Enter a deny-all component CSP: `connectDomains: []`, `resourceDomains: []`, and `frameDomains: []`.
- Supply reviewer credentials only through the portal's private fields, never in public listing text or this repository.
- Confirm the portal tool scan returns exactly `create_private_note`. Do not submit a draft that discovers any video tool or video scope.
