# Submission readiness audit

Status reflects the repository and related Noteflix code inspected on July 16, 2026. This file is an internal submission gate, not public listing copy.

## Blocking contradictions

1. **Age policy conflicts.** Root `README.md`, `PRIVACY.md`, and `SUBMISSION.md` say adults/higher education, not under 18, and not K–12. The in-progress consent copy and ChatGPT target say age 13+. Product terms and child/teen privacy handling were not found. Do not submit a 13+ claim until every surface and the legal/privacy obligations are aligned.
2. **Claude-only/no-video documents conflict with the ChatGPT app.** Root `README.md`, `PRIVACY.md`, `SUPPORT.md`, `SECURITY.md`, `SUBMISSION.md`, and `REVIEW_CHECKLIST.md` describe Claude, one `create_private_note` tool, and no video generation. `server/README.md` also says “Noteflix Claude MCP gateway” and one tool. Those files cannot be used as the ChatGPT listing or privacy URL without a scoped rewrite or separate first-party ChatGPT pages.
3. **Subscription upsell and stale brand language remains in runtime code.** `server/src/noteflix/client.ts` contains “create notes through Claude” and tells an ineligible user to “Subscribe or restore purchases.” The ChatGPT app must use neutral existing-account language with no subscribe, restore, upgrade, checkout, pricing, or plan-management prompt.
4. **No verified terms document or URL.** No root terms file was found. A first-party terms URL must be published and verified rather than inferred.
5. **Privacy URL is not ChatGPT/video ready.** The root policy mentions Anthropic/Claude, says no video is generated, and lacks the public derivative, readable slug, generation provider, and video deletion/storage disclosures.

## Data-deletion blockers

1. **Underlying media deletion is not visible in the inspected video-delete path.** `functions/src/entrypoints/ai-notes.ts` deletes the video document and tombstones the public slug, but the inspected transaction does not delete the `storagePath` object. Public routing is revoked, yet physical media deletion cannot be claimed.
2. **Account deletion does not visibly sweep public video data.** `shared/accountDeletion.ts` recursively deletes owned `aiNotes`, `notes`, folders, and selected account collections, but its inspected lists do not include the top-level `videos`, `videoGenerationJobs`, or public-video slug collection. Because public resolution reads video plus slug without consulting the source note, an end-to-end account-delete test or code fix is mandatory.
3. **Storage/tombstone retention is unspecified.** No bounded retention for deleted video objects or public slug tombstones was verified. Publish an exact policy only after implementation and operations agree.

## Deployment and review blockers

- Final ChatGPT MCP hostname and deployed revision are not recorded in this package.
- The OpenAI Apps domain-challenge value must come from the portal and be configured privately on the final host.
- The exact ChatGPT OAuth callback must be verified from a real developer-mode/portal registration, even though the in-progress policy recognizes the current expected callback shape.
- OpenAI organization identity verification and Apps Management write permission are not evidenced here.
- A no-MFA reviewer account, private credentials, sample note/video IDs, starting allowance, and cleanup evidence must be prepared privately.
- Production provider configuration must confirm whether note-derived narration text goes to ElevenLabs, Google, or both in fallback order; public disclosures must match reality.
- Exactly five positive and three negative production tests remain to be recorded.

## Non-blocking implementation naming

Internal backend routes, fields, and counters still use compatibility names such as `claude-mcp`, `claude-media`, and `claudeMediaAllowanceState`. These names are not automatically a user-facing policy failure if they remain internal and both ChatGPT and Claude deliberately share the same per-user allowance. They should be generalized when practical, and no Claude branding should leak into ChatGPT tool descriptions, errors, consent, listing copy, URLs, or reviewer instructions.

## Safe decisions already reflected in the package

- The listing uses a neutral existing-account requirement and contains no digital-subscription upsell.
- Private note creation and public video publication are separated; a created note never automatically becomes a video.
- The public-video prompt requires generation/credit, public-discoverability, and source-rights confirmations.
- All allowance and mutation language binds to the exact OAuth-connected account.
- Availability selects all portal countries while identifying the developer's stated USA base without inventing a legal-entity claim.
- Existing verified Noteflix icon assets are reused; no OpenAI endorsement or trademark claim is fabricated.
- Credentials and secrets stay out of source control.

## Root-file decision

No root privacy, support, submission, terms, or README file was changed in this pass. That preserves the existing Claude submission and avoids silently replacing its adult-only/no-video policy with an incompatible ChatGPT policy. The ChatGPT app needs separate live first-party policy/support/terms pages or an intentional, product-wide reconciliation before submission.
