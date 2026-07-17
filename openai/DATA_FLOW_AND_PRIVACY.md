# Data flow and privacy disclosure

This is the source copy for the ChatGPT app's public privacy disclosure and submission answers. It distinguishes short-lived connector control data from private Noteflix product data and intentionally public derived media.

## Account and authorization boundary

The user authenticates directly with Noteflix through OAuth 2.1 authorization code flow with PKCE. The app never receives the user's Noteflix password. The grant is bound to the exact MCP resource and to the Firebase UID verified during consent. Each tool enforces its own scope:

- `notes:create` for one private-note creation;
- `videos:read` for allowance and status reads;
- `videos:create` plus `videos:publish` for an explicitly approved public video; and
- optional `offline_access` for refresh-token renewal only.

Noteflix checks eligibility for that exact UID before a mutation. It never substitutes an organization, service, reviewer, or different user's entitlement or allowance. The connector does not return card details, prices, purchases, email, plan name, product ID, billing provider, or raw entitlement records.

## Restricted-data boundary

This app is not designed to receive payment-card data, identifiable protected health information, government-issued identifiers, passwords, API keys, authentication tokens, one-time passwords, or verification codes.

- Private-note inputs are checked deterministically inside the gateway before subscription lookup, input hashing, idempotency storage, or any Noteflix backend request.
- The Noteflix note endpoint repeats the check before entitlement resolution or a database write.
- Public-video source text is checked inside Noteflix immediately after the owned private note is loaded and before idempotency reservation, allowance use, moderation-provider calls, or generation-provider calls.
- The public-text safety service repeats the check before profanity or Vertex AI classification, and the worker repeats it immediately after loading legacy job content before any Gemini, text-to-speech, image, or rendering step.
- Rejection and check-failure responses use static codes and never echo the matched value or detected category.

Ordinary non-identifying medical, legal, and educational study content remains supported. Users must replace restricted values with non-identifying placeholders before asking the app to save or render content.

## Tool-by-tool data flow

### Create a private note

After explicit save intent and an exact payload preview, ChatGPT sends the approved title, Markdown content, optional approved summary and key points, a UUID request ID, and the OAuth-bound account identity to Noteflix. The integration forces private visibility. It cannot list, read, search, update, publish, or delete existing notes, and note creation never automatically starts video generation.

### Check video allowance

The connector sends the OAuth-bound account identity to the Noteflix allowance endpoint. It returns eligibility as a boolean, generation availability, used/in-flight/completed/limit/remaining counts, and UTC period/reset timestamps. This read consumes no credit and excludes billing and identity-profile fields.

### Create a public AI video

Only after explicit confirmation, ChatGPT sends the owned private note ID, selected style and mode, a UUID request ID, and three true confirmation flags: generation and one-credit impact, public/shareable/potentially discoverable publication, and ownership or permission to use the source.

The Noteflix product backend retrieves the private source note for the same UID and uses its content to derive a slide outline, visuals, and narration. Google Cloud and Firebase provide application infrastructure, identity verification, database, and storage. Google Vertex AI/Gemini is used for outline, generation, and public-text safety tasks. The production worker's default narration route is ElevenLabs, with Google text-to-speech alternatives in the fallback path. Noteflix assembles the video in its cloud worker and stores the resulting media in Firebase/Google Cloud Storage.

The private source note remains private. The derivative video is intentionally public, shareable, and potentially discoverable. It receives a readable Noteflix watch-page slug. The tool returns the watch page and privacy-safe status metadata, never a raw storage URL, download token, provider prompt, or provider response.

### Check video status

The connector sends the video ID and OAuth-bound identity. Noteflix returns only status, progress, public privacy, readable slug/watch URL, a user-facing message, next action, and recommended check delay. Another user's video ID is rejected.

## Data visibility

| Data | Visibility |
|---|---|
| OAuth credentials and tokens | Private connector control data; never public |
| Private note title/body/summary/key points | Private to the connected Noteflix account and authorized processors |
| Video-generation source note | Private input used by the generation pipeline; not exposed on the public watch route |
| Derived video and allowed public metadata | Public, shareable, and potentially discoverable after explicit approval |
| Readable watch slug | Public; tombstoned when publication is revoked so it is not silently reassigned |
| Allowance and subscription eligibility | Private to the connected account; no price, purchase, provider, email, or plan fields returned |

## Retention

The connector enforces expiry synchronously and configures Firestore TTL cleanup for:

- authorization requests: 10 minutes;
- authorization codes: 5 minutes;
- access-token records: 1 hour;
- refresh-token and dynamic-client records: 30 days;
- per-account rate-limit records: the active window plus approximately 24 hours; and
- private-note idempotency receipts: 30 days. A receipt stores a hashed account identifier, request ID, input hash, status, and safe note receipt, but not the note body, summary, or key points.

Expired connector records stop authorizing access immediately. Firestore TTL deletion is asynchronous and normally removes an expired record within approximately 24 hours.

Private notes and generated videos are Noteflix product data and remain until the user deletes the relevant item or account. Failed storage cleanup is retried until successful. Public-slug and source-note deletion tombstones are retained indefinitely to prevent deleted public links or late jobs from being revived. A one-way hashed account-deletion tombstone is retained indefinitely to prevent late media writes after account deletion. Per-user allowance and credit-control records remain until account deletion. Production application logs are retained for 30 days and are designed to exclude note bodies, OAuth tokens, credentials, challenge values, and private reviewer secrets. Generation-provider retention follows the applicable provider schedule disclosed in the live policy and provider terms.

## Deletion and revocation

- Revoking the ChatGPT–Noteflix OAuth grant stops future connector access. It does not delete Noteflix product data already created.
- Deleting a public video revokes its watch mapping, tombstones its slug, cancels an unfinished job, refunds a still-reserved credit, deletes all known current and noncurrent objects under its canonical storage prefix, and retains a private retry receipt only while storage cleanup is incomplete.
- Deleting a source note creates a durable deletion barrier, removes every derived public video, tombstones its public slugs, and completes or retries storage cleanup before the note-deletion process is considered complete.
- Account deletion first creates a one-way hashed deletion barrier, then removes owned videos, generation jobs, idempotency requests, legacy video records, allowance documents and credit ledgers, and retries pending storage deletion before the canonical account sweep completes.
- Worker write barriers check video, note, and account deletion state before and after storage writes. A retry-enabled Storage-finalize function independently deletes a canonical video prefix when an upload finishes after deletion or after a worker crash.
- Privacy and deletion requests that cannot be completed in the product go to support@noteflix.com.

## Processors and recipients

- OpenAI/ChatGPT processes conversation content and tool interactions under the user's OpenAI account settings and applicable OpenAI terms.
- Noteflix operates the OAuth service, MCP gateway, product backend, and public watch experience.
- Google Cloud and Firebase provide hosting, identity, database, storage, and generation infrastructure; Google Vertex AI/Gemini and Google text-to-speech capabilities are used by the video pipeline.
- ElevenLabs receives narration text when the default production text-to-speech path is used.

Provider processing and cross-border handling follow the live Noteflix privacy disclosure and the applicable provider terms. These disclosures describe the production path without implying provider endorsement.

## Age and education safety

Noteflix Study & Video is for general audiences age 13 and older and is not directed to children under 13. It does not solicit unnecessary personal information, school identifiers, grades, health records, payment data, or authentication secrets. AI-generated notes and videos may contain mistakes; users should verify important educational claims against their source material.
