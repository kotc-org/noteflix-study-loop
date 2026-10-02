# Private review evidence checklist

The live OpenAI plugin-submission portal requires a reviewer-accessible demo-recording URL for this submission. Use this checklist to create a private, redacted recording that demonstrates the plugin in Developer Mode; the recording is review evidence, not public listing media.

## Before capture

- Use the dedicated sanitized reviewer account from `REVIEWER_ACCOUNT.md`.
- Close unrelated tabs and hide bookmarks, notifications, password managers, developer consoles, and account-switcher menus.
- Never record a password, OAuth code, access/refresh token, challenge token, request ID, Firebase UID, account hash, browser cookie, or private portal field.
- Start after sign-in, or pause/redact the entire credential-entry and OAuth callback sequence.
- Show the date, tested ChatGPT surface, MCP hostname, gateway revision, and backend revision in a separate non-secret title card.

## Capture order

1. Connect Noteflix and show the note-only consent wording.
2. Show that the catalog contains exactly `create_private_note` and no media or existing-note tools.
3. Run Positive 2 to demonstrate a source-faithful workflow with no mutation.
4. Run Positive 3, visibly stopping after the exact preview and saving only after the separate confirmation.
5. Open the reviewer account’s Noteflix library and show the created note is private; obscure account identifiers.
6. Run Negative 2 to show that an edit requires a fresh preview and confirmation.
7. Run a sanitized restricted-data refusal using obvious placeholders; do not record even fake password-like or verification-code values.
8. Delete created test notes and revoke the OAuth grant after capture.

## Evidence handling

- Keep separate web and mobile captures if both surfaces are requested.
- Store the recording in private access-controlled storage with the submission ID and UTC timestamp.
- Upload the recording to access-controlled storage and provide a reviewer-accessible private URL in the portal's required **Demo Recording URL** field.
- Remove the recording after the review/appeal window unless a longer retention period is required for an active review.
