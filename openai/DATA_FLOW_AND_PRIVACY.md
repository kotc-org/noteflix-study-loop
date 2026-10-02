# Data flow and privacy disclosure

This is source copy for the ChatGPT plugin's public privacy disclosure and submission answers. It describes the note-only production configuration with `ENABLE_VIDEO_TOOLS=false`.

## Account and authorization boundary

The user authenticates directly with Noteflix through OAuth authorization code flow with PKCE. The plugin never receives the user's Noteflix password. The grant is bound to the exact MCP resource and Firebase UID verified during consent.

- `notes:create` authorizes creation of one private note.
- Optional `offline_access` permits refresh-token renewal only and adds no Noteflix data access.

No read, search, update, publish, share, delete, media, billing, or subscription-management scope is advertised or accepted. Noteflix checks current eligibility for the exact UID before every write. It never substitutes an organization, gateway, service, reviewer, or different user's entitlement. The connector does not return card details, prices, purchases, email, plan name, product ID, billing provider, or raw entitlement records.

Legacy refresh grants containing both note and video scopes are narrowed to `notes:create` plus `offline_access` when video mode is disabled. A legacy video-only refresh grant cannot gain note access and fails rather than expanding permission.

## Restricted-data boundary

This plugin is not designed to receive payment-card data, identifiable protected health information, government-issued identifiers, passwords, API keys, authentication tokens, one-time passwords, or verification codes.

- Note inputs are checked deterministically inside the gateway before subscription lookup, input hashing, idempotency storage, or a Noteflix backend request.
- The dedicated OpenAI note endpoint repeats the check before entitlement resolution or a database write.
- Rejection and check-failure responses use static codes and never echo the matched value or detected category.

Ordinary non-identifying medical, legal, and educational study content remains supported. Users must replace restricted values with non-identifying placeholders before asking the plugin to save content.

## Study workflow data flow

Study-guide, practice, quiz-first review, and planning skills operate on text the user supplies in the current ChatGPT conversation. The plugin does not inspect uploads, retrieve prior chats, query model memory, or search existing Noteflix content. OpenAI processes conversation content under the user's OpenAI settings and applicable terms.

## Private-note data flow

After explicit save intent and an exact payload preview, ChatGPT sends the approved title, Markdown content, optional approved summary and key points, a UUID request ID, and OAuth-bound account identity to the MCP gateway.

The gateway:

1. validates a strict allowlisted schema;
2. rejects restricted data;
3. verifies the `notes:create` scope;
4. asks the dedicated Noteflix OpenAI backend to verify eligibility for the exact UID;
5. reserves or reuses an idempotency receipt; and
6. calls `/internal/openai-mcp/ai-notes` using the dedicated service identity, `x-noteflix-integration: openai-mcp`, and `integrationSource: openai-mcp`, with `x-noteflix-user-id` matching the OAuth-bound `noteflixUserId` in the request body.

The integration forces private visibility and an empty derived-assets list. It cannot list, read, search, update, publish, share, or delete an existing note. It does not start video, audio, image, podcast, flashcard, quiz, game, or other media generation.

The tool returns only a minimized receipt: created/cached status, note ID, title, optional slug, private Noteflix URL, and `visibility: private`. It does not return the note body, account profile, entitlement record, backend response, or credential.

## Data visibility

| Data | Visibility |
|---|---|
| OAuth credentials and tokens | Private connector control data; never public |
| Private note title/body/summary/key points | Private to the connected Noteflix account and authorized infrastructure processors |
| Idempotency receipt | Private gateway control data; contains hashes and a minimized safe receipt, not note content |
| Subscription eligibility | Private exact-account decision; no price, purchase, provider, email, or plan fields returned |
| Study text in the conversation | Processed under the user's OpenAI account settings and applicable OpenAI terms |

No user content created through this plugin is intentionally made public.

## Retention

The connector enforces expiry synchronously and configures Firestore TTL cleanup for:

- authorization requests: 10 minutes;
- authorization codes: 5 minutes;
- access-token records: 1 hour;
- refresh-token records: 30 days;
- the exact public ChatGPT client-registration record: the operating life of the connector or until administrative removal; it contains callback/client metadata, not a Noteflix UID or note body;
- other dynamic-client records: 30 days;
- per-account rate-limit records: the active window plus approximately 24 hours; and
- private-note idempotency receipts: 30 days.

An idempotency receipt stores a hashed account identifier, request ID, input hash, status, and minimized safe note receipt. It does not store the note body, summary, or key points. Expired records stop authorizing access immediately; TTL deletion is asynchronous and normally removes expired records later.

Private notes are Noteflix product data and remain until the user deletes the note or account. Production application logs use bounded retention and are designed to exclude note bodies, OAuth tokens, passwords, challenge values, and reviewer credentials.

## Deletion and revocation

- Revoking the ChatGPT–Noteflix OAuth grant stops future connector access. It does not delete a note already created in Noteflix.
- Users can delete individual notes or their Noteflix account through the documented first-party product controls.
- Privacy and deletion requests that cannot be completed in the product go to support@noteflix.com.

## Processors and recipients

- OpenAI/ChatGPT processes conversation content and tool interactions under the user's OpenAI account settings and applicable OpenAI terms.
- Noteflix operates the OAuth service, MCP gateway, eligibility authority, and private-note product backend.
- Google Cloud and Firebase provide hosting, identity, database, and storage infrastructure used for the connector and Noteflix product.

The submitted note-only path does not invoke a video, image, speech, media-generation, or public-publication provider.

## Age and education safety

Noteflix is for general audiences age 13 and older and is not directed to children under 13. It does not solicit unnecessary personal information, school identifiers, grades, health records, payment data, or authentication secrets. AI-generated study material may contain mistakes; users should verify important educational claims against their source material.

## Disabled optional implementation

The codebase retains optional video implementation for a future independently reviewed release. In the submitted deployment, `ENABLE_VIDEO_TOOLS=false`; the server does not register video tools, advertise or grant video scopes, show video consent copy, or include video behavior in listing and reviewer materials. That dormant mode is not launched, verified, or represented as available.
