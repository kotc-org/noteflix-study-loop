# Submission readiness audit

Status reflects the production release verified on July 16, 2026 in America/Chicago; some GCP deployment timestamps are July 17 UTC. This is an internal gate, not public listing copy.

## Implemented and regression-verified

- Four-tool catalog: private note creation, allowance read, confirmed public-video generation, and exact-owner video status.
- Exact OAuth UID binding, scope checks, PKCE, dynamic client registration policy, idempotency, fail-closed subscription checks, and per-user allowance accounting.
- Wire-level `tools/list` emits each OAuth scheme both at top level and in the `_meta` compatibility mirror.
- OAuth error redirects preserve `state` only for an exact validated callback; malformed or unregistered callbacks never receive a redirect.
- Restricted-data checks run before note eligibility/idempotency/backend calls and before public-video allowance/provider calls. Static errors do not echo matched values or categories.
- Public-video publication requires three literal confirmations and returns a readable first-party watch page, never a raw media URL.
- Tool annotations match the current OpenAI definition: the public-video tool is not read-only, is not destructive because it does not delete or overwrite, is open-world because it publishes externally, and is idempotent for identical retries.
- Public slug revocation, storage-prefix deletion, retry receipts, source-note deletion barriers, account deletion sweeps, worker write barriers, and retry-enabled late-upload cleanup are implemented with focused tests.
- Firestore rules deny every client, including product admins, direct access to connector allowance/idempotency, slug, deletion receipt, and deletion tombstone control collections.
- The submission packet defines exactly five positive and three negative scenarios using the deployed snake_case structured-output contract.

## Live surfaces already verified

- Website: `https://noteflix.com`
- App information: `https://noteflix.com/openai-app`
- Privacy: `https://noteflix.com/openai-app/privacy`
- Terms: `https://noteflix.com/openai-app/terms`
- Support: `https://noteflix.com/openai-app/support`
- Gateway PR #2 is merged to `main` at `23e01d6c10db053bca5c8c0eb82c301f250dc935`. Cloud Run revision `noteflix-openai-mcp-00002-ncz` serves 100% of traffic in `us-central1`.
- Backend PR #17 is merged to `develop` at `3b8b42ad3931c1df512144c608080784b21af926`. CI run `29549100241` passed; Functions and Firestore rules are deployed; the video worker and retry-enabled late-upload cleanup function are active.
- Frontend PR #17 is merged to `develop` at `9c1b685633342214c4691c0501434c47e3eff75c`. The deployed web bundle matches SHA-256 `e9d474147ea5976af2638b047fc741b5e790c623c2df7724be957845a4218eba`, and all four first-party app-information/legal/support URLs return 200.
- The Cloud Run service passed health, OAuth metadata, protected-resource metadata, CORS, 401 challenge, strict DCR failure, and authorization-code happy-path checks on its platform hostname.
- A production OAuth/MCP verifier passed live DCR with the exact ChatGPT callback, PKCE consent, direct access-token-record-to-Firebase-UID correlation, exact-UID eligibility, the four-tool catalog, exact raw top-level/`_meta` OAuth schemes and scopes, public-video annotations, unchanged repeated allowance reads, token revocation, and post-revocation denial.
- The dedicated private reviewer credential passes Firebase password sign-in without MFA. Credentials remain in Secret Manager and must be copied only into the portal's private reviewer field.
- A harmless reviewer fixture was created through the production gateway. The initial request consumed exactly one reviewer-account credit and reached ready/public. A real replay of the deterministic creation tool returned the same receipt and changed every allowance counter by zero; the exact-user consumed-credit ledger, request claim, and allowance counter match the OAuth UID. Signed-out checks proved that the readable watch page, allowlisted metadata, and playback work while the existing exact-owner private source-note API returns 404.
- A locked second synthetic Firebase account has its own active 60-day reviewer entitlement, private note, public ready video, request claim, allowance counter, and consumed-credit ledger. Its one generation consumed only its own credit. The primary reviewer is denied status for this known-good second-owner public video without receiving its ID or product metadata. Credentials and all fixture IDs/URLs remain only in Secret Manager.
- Connector Firestore TTL policies are active in the isolated `noteflix-openai-mcp` database.
- The production Cloud Logging bucket retains application logs for 30 days.

## Remaining domain and portal deployment gates

1. Add the exact `chatgpt.noteflix.com` CNAME required by the Cloud Run domain mapping and wait for a valid certificate. DNS currently has no CNAME and the mapping remains `CertificatePending`; the required record is `chatgpt` to `ghs.googlehosted.com.`. The public listing must use `https://chatgpt.noteflix.com/mcp`, not the temporary Cloud Run hostname.
2. Obtain the exact OpenAI Apps domain-challenge value from the portal, store it as a secret/config value, deploy it, and verify the challenge route returns only that value before completing domain verification.

## Remaining review-evidence gates

- Confirm the submitter's verified OpenAI identity and Apps Management write permission in the same organization/project used for submission.
- Confirm the exact callback registered by the real OpenAI portal item; the server must accept that exact trusted callback and continue rejecting every unregistered callback.
- Run the exact five positive and three negative scenarios against production on ChatGPT web and mobile. Record tool calls, structured results, exact-UID evidence, allowance before/after, signed-out public-watch behavior, signed-out private-note denial, and cleanup.
- Verify a created private note contains no automatic derived media; one accepted public generation changes only the connected user's allowance; idempotent replay does not double-charge; failure/deletion refunds a reservation.
- Verify video deletion, source-note deletion, account deletion, failed cleanup retry, and a simulated late Storage finalize against the deployed revision.
- Upload and inspect the verified 1024 × 1024 Noteflix icon, enter the listing/CSP/country fields, complete the questionnaire, and submit. Record the submission ID, timestamp, organization/project, endpoint, revision, challenge result, asset hash, and resulting portal status.

## Internal compatibility naming

Some first-party backend routes and counters retain internal compatibility names such as `claude-mcp`, `claude-media`, and `claudeMediaAllowanceState` because Claude and ChatGPT share the same exact-user product allowance. These internal names do not appear in ChatGPT tool descriptions, OAuth consent copy, listing copy, public URLs, or reviewer instructions.

## No-ship conditions

Do not submit while any of these is true:

- the custom first-party MCP hostname lacks a valid certificate;
- the portal challenge is unverified;
- production backend, legal disclosure, and gateway behavior do not match;
- a reviewer fixture or no-MFA sign-in is missing;
- required production deletion/storage verification is missing or fails;
- the exact eight reviewer scenarios have not passed; or
- identity verification or Apps Management write permission is absent.
