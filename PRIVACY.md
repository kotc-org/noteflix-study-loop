# Privacy

Last updated: July 15, 2026

Noteflix Study Loop is a Claude plugin for adults and higher-education learners. It is not designed for users under 18 or K–12 student deployment.

Four study skills operate on text the learner supplies in the current Claude request. Those skills do not send that text to Noteflix. The separate `save-to-noteflix` skill sends data to Noteflix only after the learner explicitly requests a save, reviews the exact payload, and provides a separate confirmation.

## Data sent on an approved save

After confirmation, the plugin sends these fields to the Noteflix service:

- the exact note title and Markdown content shown in the save preview;
- the exact optional summary and key points shown in the preview, if present;
- a random request ID used to prevent duplicate creation; and
- the authenticated Noteflix account identity associated with the OAuth grant.

The integration forces the created note to private visibility. It does not send unapproved drafts, generate derived media, or transmit uploads, prior conversations, Claude memory, connector data, or existing Noteflix content.

## OAuth and service data

The connection uses OAuth and requests `notes:create` plus `offline_access`. `notes:create` is the sole data-action scope. `offline_access` permits refresh-token renewal and does not authorize reading, listing, updating, publishing, or deleting Noteflix data. The learner authenticates directly with Noteflix; the plugin does not receive or store the learner's Noteflix password. Noteflix retains the authorization and client records needed to operate and secure the OAuth connection until they expire, are revoked, or are removed under Noteflix's retention practices. Standard security metadata, such as timestamps, IP address, request outcome, and rate-limit counters, may be processed to prevent abuse and diagnose failures. The integration is designed not to log note bodies.

The remote service runs on Google Cloud and Firebase infrastructure. Claude's processing of current-request text remains governed by the learner's Anthropic account, settings, and applicable Anthropic terms.

## Retention and deletion

The connector control service uses automatic TTL deletion in an isolated database. Its configured maximum retention periods are:

- authorization requests: 10 minutes;
- authorization codes: 5 minutes;
- access-token records: 1 hour;
- refresh-token and dynamic-client records: 30 days;
- per-account rate-limit records: the rate-limit window plus approximately 24 hours; and
- idempotency receipts: 30 days. A receipt contains a hashed account identifier, request ID, input hash, status, and—after success—the note ID, title, private app link, and private visibility. It does not contain the note body, summary, or key points.

Revoking a grant prevents its tokens from being used even before their physical TTL deletion. Infrastructure logs follow the Google Cloud retention settings for the Noteflix project and are designed not to contain note bodies or OAuth token values.

A saved private note remains in the learner's Noteflix account until the learner deletes it or deletes the account. Learners can manage and delete their data in the Noteflix app. Account deletion is available from [Noteflix settings](https://noteflix.com/noteflix-settings) and permanently deletes the account and associated data according to the in-app notice.

Learners can revoke the Claude–Noteflix connection from Claude's connector settings. Revocation prevents future note creation with that grant; it does not delete notes already saved. For a deletion or privacy request that cannot be completed in the app, contact [support@noteflix.com](mailto:support@noteflix.com).

The current Noteflix privacy policy is available at [https://noteflix.com/privacy](https://noteflix.com/privacy).

## Source and data boundaries

The plugin does not inspect uploads, enumerate attachments, retrieve prior conversations, query Claude memory, access other connectors, or search existing Noteflix notes. Learners must paste or otherwise supply study source text in the current request.

The study skills minimize unnecessary repetition of personal identifiers and suggest redaction when identifiers are not needed for learning. Learners should not save credentials, regulated records, or personal data that is unnecessary for the study task.

## Changes

Material changes to this policy will be documented in the repository changelog and reflected by the “Last updated” date.

## Contact

Privacy or support questions: [support@noteflix.com](mailto:support@noteflix.com)

Website: [https://noteflix.com](https://noteflix.com)
