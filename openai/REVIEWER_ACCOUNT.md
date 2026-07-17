# Reviewer account checklist

Prepare a dedicated, non-production Noteflix reviewer account and transmit its credentials only through the OpenAI submission portal's private reviewer fields.

Verified production snapshot: password sign-in through the OAuth consent flow succeeded without MFA; the OAuth token record and eligible entitlement resolve for the exact Firebase UID; repeated allowance reads were unchanged and still report generation available. A harmless private note, ready public-video fixture, and known-good locked second-account denial fixture are stored privately. A real deterministic creation replay returned the same receipt with zero allowance change. Signed-out verification passed for the public watch page, allowlisted metadata, playback, and the existing exact-owner private note's denial. Clean-browser login and the portal-private instruction paste remain open.

## Before submission

- [x] Use a unique email/password account that the review team can access without an API key, email link, SMS code, authenticator, passkey, SSO administrator, 2FA, or MFA.
- [ ] Confirm the password works in a clean signed-out browser and does not require a first-login reset.
- [x] Pre-provision an active eligible Noteflix entitlement. Reviewers must not purchase, restore, upgrade, or manage a subscription.
- [x] Verify the entitlement resolves for the exact Firebase UID produced by this account's OAuth sign-in.
- [x] Keep at least one public-video allowance credit available and clear the short-term generation rate limit before review.
- [x] Add one owned private sample note with harmless, non-personal educational content and enough material for a brief video.
- [x] Confirm the sample note ID is accepted only for this reviewer account.
- [x] Keep one existing ready public sample video for a non-mutating status test in case a fresh render is delayed.
- [x] Prepare one harmless video ID owned by a separate locked synthetic account for the cross-account denial test. Reviewers receive only its ID, never that account's credentials.
- [x] Confirm the sample video's readable watch page works signed out and reveals no source-note body, user email, raw storage URL, generation prompt, or provider metadata.
- [x] Confirm the private source note does not work signed out and is not exposed through the public watch route.
- [ ] Record the reviewer account email, password, sample note ID, ready video ID, foreign-account video ID, expected watch URL, starting allowance, and cleanup steps in the portal's private instructions—not in source control.
- [x] Confirm the account contains no real learner records, grades, credentials, protected health information, payment details, or proprietary course material.

## Private reviewer instructions template

Paste this template into the portal only after replacing every bracketed field with verified values:

```text
Noteflix sign-in URL: [FIRST-PARTY SIGN-IN URL]
Reviewer email: [PRIVATE REVIEWER EMAIL]
Reviewer password: [PRIVATE REVIEWER PASSWORD]
MFA/2FA: disabled; no secondary verification is required
Entitlement: pre-provisioned and active; no purchase is needed
Private sample note ID: [PRIVATE NOTE ID]
Ready sample video ID: [VIDEO ID]
Foreign-account video ID (denial fixture only): [FOREIGN VIDEO ID]
Expected public watch page: [READABLE FIRST-PARTY WATCH URL]
Expected starting allowance: [VERIFIED COUNTS AND UTC RESET]

Connect Noteflix through the normal OAuth screen in ChatGPT. The consent screen should identify ChatGPT and the exact Noteflix account. Run REVIEW_SCENARIOS.md in order on ChatGPT web and mobile. Do not purchase or change a subscription. Delete artifacts using the cleanup steps below.
```

## After review

- [ ] Delete the newly created private note in Noteflix.
- [ ] Delete the newly generated public video and confirm its readable watch page no longer resolves.
- [ ] Confirm the public slug is tombstoned and not reassigned to unrelated content.
- [ ] Confirm a failed or abandoned render refunded its reserved allowance credit.
- [ ] Revoke the ChatGPT–Noteflix OAuth grant.
- [ ] Rotate the reviewer password after the review cycle.
- [ ] Inspect logs without recording note bodies, credentials, or token values.

The deployed deletion behavior and durable late-upload cleanup must pass the production verification gates in [`READINESS_AUDIT.md`](READINESS_AUDIT.md) before these instructions are pasted into the portal.
