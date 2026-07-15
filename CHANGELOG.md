# Changelog

All notable changes to Noteflix Study Loop are documented here.

## 0.2.0 — 2026-07-15

- Added a remote OAuth MCP connection at the first-party `https://noteflix.com/mcp` endpoint with `notes:create` as its sole data-action scope and `offline_access` for refresh-token renewal.
- Added `save-to-noteflix`, which requires explicit save intent, an exact private-note preview, and a separate confirmation before mutation.
- Added idempotent private note creation and a returned Noteflix app link.
- Updated privacy, security, support, and reviewer documentation for the authenticated service.
- Restricted study sources to text supplied in the current request; the plugin does not inspect uploads, prior chats, memory, connectors, or existing Noteflix data.
- Explicitly excluded AI video, audio, image, podcast, and other media-generation tools from the directory-submitted plugin.
- Restricted OAuth redirects to the documented `claude.ai` hosted callback and Claude Code's `localhost` or `127.0.0.1` loopback `/callback`, made the return hostname visible during consent, and required an exact resource parameter on every grant and token exchange.
- Isolated gateway security state in a named Firestore database and retained per-account MCP rate limits without a shared-IP throttle on authenticated traffic.
- Removed gateway-generated note segments, summaries, and key points so only the confirmed payload is forwarded.
- Replaced Firebase custom-token impersonation with public Identity Toolkit consent verification and a dedicated Google OIDC service-to-service note route.
- Required exact first-party Origin validation before consent completion and moved all public OAuth/MCP metadata and consent traffic onto `noteflix.com`.

## 0.1.0 — 2026-07-15

- Added source-faithful study-guide organization.
- Added source-clause flashcard and direct-retrieval practice-set generation with separated answer keys.
- Added adaptive, one-question-at-a-time review and session scorecards.
- Added time-bounded review planning with buffers and missed-session fallbacks.
- Added shared source-fidelity, prompt-injection, privacy, and academic-integrity guidance.
- Added a self-contained sample, reviewer guide, support information, and privacy statement.
