# Marketplace handoff template

This document describes the reusable handoff process. It does not assert that a deployment, portal configuration, verification, or publication has been completed. Keep account identities, app/version/submission IDs, deployment receipts, private recording URLs, and credentials in private access-controlled evidence.

## Reviewed package

- The public MCP endpoint is configured through `.mcp.json`.
- The default launch exposes only `create_private_note`, using `notes:create` and optional `offline_access`.
- Video tools remain disabled unless their separate backend, consent, and end-to-end review gates pass.
- The source package contains five study skills, the Codex plugin manifest, and the first-party directory/composer icons documented in `ASSETS.md`.
- Public listing copy, reviewer scenarios, privacy disclosures, and submission checks live in this directory.

## Before a handoff

1. Record the exact reviewed Git commit, package hash, backend and gateway revisions, deployed image digests, UTC timestamp, and responsible owner in private evidence.
2. Run the gateway's `npm run check` under the declared Node.js runtime. Validate the dedicated backend separately.
3. Verify the first-party MCP endpoint, public information pages, TLS, OAuth metadata, note-only consent, exact-user binding, and the deployed one-tool catalog.
4. Complete every production gate in `READINESS_AUDIT.md` and `SUBMISSION_CHECKLIST.md`; do not infer deployment success from local tests.
5. Confirm the installed skill bundle and package assets match the reviewed source. Use the hashes in `ASSETS.md` to verify the icon files.

## Portal actions

1. Enter the verified listing copy and public URLs from `LISTING.md`.
2. Provision a sanitized eligible reviewer account using `REVIEWER_ACCOUNT.md`. Supply its credentials only in the portal's private reviewer instructions.
3. Run the five positive and three negative scenarios on the required web and mobile surfaces. Capture the redacted Developer Mode demonstration using `REVIEW_EVIDENCE.md`.
4. Enter the reviewer-accessible private recording URL only in the portal and retain it only for the review/appeal window.
5. Verify the skill snapshot, exact one-tool scan, annotations, icons, availability, publisher identity, and policy attestations against the current portal requirements.
6. Obtain fresh owner confirmation immediately before selecting **Submit for Review**.
7. After approval, obtain separate fresh owner confirmation immediately before selecting **Publish**. Review approval alone does not publish the plugin.

## Operational utilities

- `deploy-marketplace-challenge.ps1` configures a runtime challenge for its explicitly pinned deployment target. Review that target and image digest before any execution; this source handoff does not execute it.
- `rotate-marketplace-reviewer.ps1` requires the verified reviewer UID, email, display name, and Secret Manager name as explicit parameters. It retains exact-account, enabled/email-verified, password-only-provider, and no-MFA checks and does not embed reviewer identity or credentials.
- Before an authorized rotation, set `NOTEFLIX_REVIEWER_ROTATION_CONFIRMATION` to `ROTATE_DEDICATED_REVIEWER_ONLY`. The script prompts for the new password using `Read-Host -AsSecureString`; never pass a password on the command line or commit it.
- Keep private originals and operational receipts outside the published repository. A Git push does not deploy, submit, rotate an account, or publish the marketplace item.
