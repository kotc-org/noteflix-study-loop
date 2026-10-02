# Reviewer account checklist

Prepare a dedicated non-production Noteflix reviewer account and transmit its credentials only through the OpenAI submission portal's private reviewer fields. The note-only review does not require a pre-existing note, video, allowance, media fixture, or cross-account object ID.

## Before submission

- [ ] Use a unique email/password account that reviewers can access without an API key, email link, SMS code, authenticator, passkey, SSO administrator, 2FA, or MFA.
- [ ] Confirm the password works in a clean signed-out browser and does not require a first-login reset.
- [ ] Confirm sign-in works from an ordinary external network with no VPN, allowlist, private network, or company-only access requirement.
- [ ] Pre-provision an active eligible Noteflix entitlement. Reviewers must not purchase, restore, upgrade, or manage a subscription.
- [ ] Confirm the password and entitlement will remain valid for the entire expected review window.
- [ ] Verify the entitlement resolves for the exact Firebase UID produced by this account's OAuth sign-in.
- [ ] Confirm the account contains no real learner records, grades, credentials, protected health information, payment details, or proprietary course material.
- [ ] Confirm the deployed consent screen requests only private-note access and optional connection renewal.
- [ ] Confirm the deployed MCP catalog contains exactly `create_private_note`.
- [ ] Put only the reviewer email, password, and user-facing cleanup steps in the portal's private instructions. Keep the expected Firebase UID hash in separate private internal evidence, never in source control or public listing copy.

## Private reviewer instructions template

Paste this template into the portal only after replacing every bracketed field with verified values:

```text
Noteflix sign-in URL: [FIRST-PARTY SIGN-IN URL]
Reviewer email: [PRIVATE REVIEWER EMAIL]
Reviewer password: [PRIVATE REVIEWER PASSWORD]
MFA/2FA: disabled; no secondary verification is required
Entitlement: pre-provisioned and active; no purchase is needed

Connect Noteflix through the normal OAuth screen in ChatGPT. The consent screen should identify ChatGPT and the exact Noteflix account and request only private-note access plus optional connection renewal. Run REVIEW_SCENARIOS.md in order on ChatGPT web and mobile. Do not purchase or change a subscription. Delete created test notes using the cleanup steps below.
```

## After review

- [ ] Delete every private note created during review and confirm it no longer appears in the account.
- [ ] Revoke the ChatGPT–Noteflix OAuth grant.
- [ ] Rotate the reviewer password after the review cycle.
- [ ] Inspect logs without recording note bodies, credentials, token values, or reviewer identity data.

Do not paste reviewer instructions until every production gate in [`READINESS_AUDIT.md`](READINESS_AUDIT.md) is closed.
