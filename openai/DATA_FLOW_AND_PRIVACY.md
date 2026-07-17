# Data flow and privacy disclosure

This document is the source copy for the ChatGPT app's public privacy disclosure and submission answers. It distinguishes connector control data from product data and public derived media.

## Account and authorization boundary

The user authenticates directly with Noteflix through OAuth with PKCE. The app does not receive the user's Noteflix password. The grant is bound to the exact MCP resource and the Firebase UID verified during consent. Each tool enforces its own scope:

- `notes:create` for one private-note creation;
- `videos:read` for allowance and status reads;
- `videos:create` plus `videos:publish` for an explicitly approved public video; and
- optional `offline_access` for refresh-token renewal only.

Noteflix checks eligibility for that exact UID before a mutation. It does not substitute an organization, service, reviewer, or different user's entitlement or allowance. The connector does not return card details, prices, purchases, email, plan name, product ID, billing provider, or raw entitlement records.

## Tool-by-tool data flow

### Create a private note

After explicit save intent, an exact payload preview, and separate confirmation, ChatGPT sends the approved title, Markdown content, optional approved summary and key points, a UUID request ID, and the OAuth-bound account identity to Noteflix. The integration forces private visibility. It cannot list, read, search, update, publish, or delete existing notes, and note creation does not automatically start video generation.

### Check video allowance

The connector sends the OAuth-bound account identity to the Noteflix allowance endpoint. It returns eligibility as a boolean, whether generation is available, used/in-flight/completed/limit/remaining counts, and the UTC period/reset timestamps. This read does not consume a credit and excludes billing and identity profile fields.

### Create a public AI video

Only after explicit confirmation, ChatGPT sends the owned private note ID, selected style and mode, a UUID request ID, and three true confirmation flags: generation and one-credit impact, public/shareable/potentially discoverable publication, and ownership or permission to use the source.

The Noteflix product backend retrieves the private source note for the same UID and uses its content to derive a slide outline, visuals, and narration. The inspected implementation uses Google Cloud/Firebase for service infrastructure and storage; Google Vertex AI/Gemini and Google Cloud text-to-speech capabilities for parts of generation; and a configurable narration path whose current default is ElevenLabs, with Google alternatives in the fallback chain. Noteflix assembles the video in its cloud worker and stores the resulting media in Firebase/Google Cloud Storage.

The private source note remains private. The derivative video is intentionally public, shareable, and potentially discoverable. It receives a readable Noteflix watch-page slug. The tool returns the watch page and privacy-safe status metadata, never the raw storage object URL, download token, provider prompt, or provider response.

### Check video status

The connector sends the video ID and OAuth-bound identity. Noteflix returns only status, progress, public privacy, readable slug/watch URL, a user-facing message, next action, and recommended check delay. Another user's video ID is rejected.

## Data visibility

| Data | Visibility |
|---|---|
| OAuth credentials and tokens | Control data; never public |
| Private note title/body/summary/key points | Private to the connected Noteflix account and authorized processors |
| Video-generation source note | Private input used by the generation pipeline; not exposed on the public watch route |
| Derived video and allowed public metadata | Public, shareable, and potentially discoverable after explicit approval |
| Readable watch slug | Public; tombstoned when publication is revoked so it is not silently reassigned |
| Allowance and subscription eligibility | Private to the connected account; no price, purchase, provider, email, or plan fields returned |

## Retention

The connector control service is configured for synchronous expiry checks and Firestore TTL cleanup with these maximum periods:

- authorization request: 10 minutes;
- authorization code: 5 minutes;
- access-token record: 1 hour;
- refresh-token and dynamic-client records: 30 days;
- per-account rate-limit record: its active window plus approximately 24 hours; and
- private-note idempotency receipt: 30 days. The receipt contains a hashed account identifier, request ID, input hash, status, and safe note receipt, but not the note body, summary, or key points.

Private notes and generated videos are Noteflix product data, not connector TTL data. They remain until the user deletes the relevant product data or Noteflix removes it under its verified product-retention policy. Public-slug tombstones may be retained to prevent a deleted link from being reassigned. The public policy must state an exact tombstone/storage retention period if the product commits to one; none is verified in this repository.

Connector application logs are designed to exclude note bodies and OAuth token values. Infrastructure and generation-provider logs remain subject to the verified production configuration and vendor terms. Do not promise a log or provider-retention period until it has been confirmed.

## Deletion and revocation

- Revoking the ChatGPT–Noteflix grant stops future use of its tokens. It does not delete notes or videos already created.
- The owner can delete an individual video in Noteflix. The inspected application path deletes the video record, tombstones its public slug, cancels an unfinished job, and revokes the readable watch page.
- Deleting a source note through the inspected Noteflix path deletes matching video records and tombstones their public slugs before removing the note.
- Account deletion is available in Noteflix, but the inspected canonical account-deletion routine does not visibly enumerate the top-level `videos` collection or public-slug mappings. This must be fixed or proven by an end-to-end test before the public policy claims account deletion removes public videos.
- The inspected video-deletion transaction does not visibly delete the underlying Firebase Storage object. The product must delete that object or document and enforce a bounded storage-retention policy before claiming physical media deletion.
- Privacy and deletion requests that cannot be completed in the product go to support@noteflix.com.

## Processors and recipients

The public privacy policy should identify, at minimum, the following roles without implying endorsement:

- OpenAI/ChatGPT processes conversation content and tool interactions under the user's OpenAI account settings and applicable OpenAI terms.
- Noteflix operates the OAuth service, MCP gateway, product backend, and public watch experience.
- Google Cloud and Firebase provide hosting, identity verification, database, storage, and generation infrastructure; Google Vertex AI/Gemini and Google Cloud text-to-speech capabilities are used by the inspected video pipeline.
- ElevenLabs receives narration text when its configured text-to-speech path is used; the inspected worker currently defaults to that path.

Confirm the actual production provider configuration, subprocessors, cross-border transfer terms, and vendor retention before publishing this disclosure. Do not list a provider merely because unused code exists, and do not omit a provider that receives production note-derived content.

## Age and education safety

Noteflix Study & Video is intended for general audiences age 13 and older and is not directed to children under 13. It should not solicit unnecessary personal information, school identifiers, grades, health records, or payment data. Users should remove personal or confidential information that is not needed for the study task.

The app supports study-note organization and explanation. It should decline direct assistance that would complete a live, proctored, or graded assessment and instead offer concept review, hints, or analogous practice. AI-generated videos may contain mistakes; users should verify important educational claims against their source material.

The age statement cannot go live until the existing adult-only repository copy, product terms, consent flow, support copy, and privacy obligations are aligned for a 13+ audience.
