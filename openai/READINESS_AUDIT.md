# Submission readiness audit

Status reflects the ChatGPT app, Noteflix backend, and live first-party surfaces inspected on July 16, 2026. This is an internal gate, not public listing copy.

## Implemented and verified locally

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
- Current Cloud Run service: `noteflix-openai-mcp` in `us-central1`.
- The Cloud Run service passed health, OAuth metadata, protected-resource metadata, CORS, 401 challenge, strict DCR failure, and synthetic DCR/authorization-code happy-path checks on its platform hostname.
- The dedicated private reviewer credential passes Firebase password sign-in without MFA. Credentials remain in Secret Manager and must be copied only into the portal's private reviewer field.
- Connector Firestore TTL policies are active in the isolated `noteflix-openai-mcp` database.
- The production Cloud Logging bucket retains application logs for 30 days.

## Remaining deployment gates

1. Merge the backend hardening branch only after the full Functions test suite, TypeScript build, and Firestore rules emulator pass; deploy Functions and Firestore rules from `develop` and verify the new storage-finalize function is active.
2. Merge and deploy the matching live legal disclosure only after backend enforcement is live. Re-fetch all four first-party URLs and verify the deployed bundle hash.
3. Merge and deploy the gateway hardening branch, then repeat production MCP/OAuth/tool-list conformance checks against the deployed revision.
4. Add the exact `chatgpt.noteflix.com` CNAME required by the Cloud Run domain mapping and wait for a valid certificate. The public listing must use `https://chatgpt.noteflix.com/mcp`, not the temporary Cloud Run hostname.
5. Obtain the exact OpenAI Apps domain-challenge value from the portal, store it as a secret/config value, deploy it, and verify the challenge route returns only that value.

## Remaining review-evidence gates

- Confirm the submitter's verified OpenAI identity and Apps Management write permission in the same organization/project used for submission.
- Confirm the exact callback registered by the real OpenAI portal item; the server must accept that exact trusted callback and continue rejecting every unregistered callback.
- Create or verify the reviewer account's harmless private sample note, deterministic ready-video fixture, separate-account denial fixture, readable watch URL, and starting allowance. Keep fixture IDs private.
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
- a production deletion/storage test fails;
- the exact eight reviewer scenarios have not passed; or
- identity verification or Apps Management write permission is absent.
