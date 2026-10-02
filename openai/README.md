# ChatGPT submission package

This directory contains the review copy and evidence checklist for the first ChatGPT release of **Noteflix**. The submitted deployment is note-only: `ENABLE_VIDEO_TOOLS=false`, one `create_private_note` tool, and no video scopes.

Use these files together:

- [`LISTING.md`](LISTING.md) — portal-ready listing fields, starter prompts, availability, and release notes;
- [`MARKETPLACE_HANDOFF.md`](MARKETPLACE_HANDOFF.md) — verified production/package status and remaining public-portal actions;
- [`REVIEW_SCENARIOS.md`](REVIEW_SCENARIOS.md) — exactly five positive and three negative note-only reviewer scenarios;
- [`REVIEWER_ACCOUNT.md`](REVIEWER_ACCOUNT.md) — private demo-account preparation and cleanup checklist;
- [`REVIEW_EVIDENCE.md`](REVIEW_EVIDENCE.md) — required private, redacted evidence/recording checklist for this MCP-backed submission;
- [`DATA_FLOW_AND_PRIVACY.md`](DATA_FLOW_AND_PRIVACY.md) — exact-account data flow, privacy disclosure, retention, deletion, and processors;
- [`ASSETS.md`](ASSETS.md) — verified first-party Noteflix image inventory;
- [`SUBMISSION_CHECKLIST.md`](SUBMISSION_CHECKLIST.md) — build, deployment, portal, and review gates; and
- [`READINESS_AUDIT.md`](READINESS_AUDIT.md) — remaining production, evidence, and portal gates that must not be concealed from review.

The repository root documents describe the separate Claude submission and remain scoped to it. The ChatGPT plugin uses first-party information, support, privacy, and terms pages at `https://chatgpt.noteflix.com/about`, `/support`, `/privacy`, and `/terms`; production deployment must keep those pages synchronized with this package.

Optional video implementation retained in source is outside this release. It must not be enabled, advertised, granted, demonstrated, or included in reviewer instructions.

No reviewer credentials, OAuth tokens, challenge tokens, API keys, legal-entity assertions, or unverified vendor promises belong in this directory.
