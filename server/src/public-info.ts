import { Router, type Response } from "express";

import type { AppConfig } from "./config.js";

const PUBLIC_PAGE_CSP = [
  "default-src 'none'",
  "style-src 'self'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const PUBLIC_CSS = `
:root {
  color-scheme: light;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #1f2937;
  background: #fff8f7;
}
* { box-sizing: border-box; }
body { margin: 0; line-height: 1.65; }
a { color: #a91f36; }
a:focus-visible { outline: 3px solid #ed354b; outline-offset: 3px; }
.shell { width: min(880px, calc(100% - 32px)); margin: 0 auto; }
header { border-bottom: 1px solid #f4c9ce; background: #ffffff; }
.header-inner { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 20px 0; }
.brand { color: #8f1730; font-size: 1.25rem; font-weight: 800; letter-spacing: -0.02em; text-decoration: none; }
nav { display: flex; flex-wrap: wrap; gap: 16px; }
nav a { color: #4b5563; font-size: 0.95rem; font-weight: 650; text-decoration: none; }
nav a:hover { color: #a91f36; }
main { padding: 56px 0 72px; }
.eyebrow { color: #a91f36; font-size: 0.78rem; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; }
h1, h2 { color: #171717; line-height: 1.2; letter-spacing: -0.025em; }
h1 { max-width: 760px; margin: 8px 0 18px; font-size: clamp(2.1rem, 7vw, 3.6rem); }
h2 { margin-top: 36px; font-size: 1.35rem; }
.lede { max-width: 740px; color: #4b5563; font-size: 1.12rem; }
.card { margin: 30px 0; padding: 24px; border: 1px solid #f1c4ca; border-radius: 18px; background: #ffffff; box-shadow: 0 14px 34px rgba(126, 24, 45, 0.07); }
.card h2 { margin-top: 0; }
ul, ol { padding-left: 1.35rem; }
li + li { margin-top: 8px; }
.button { display: inline-block; margin-top: 10px; padding: 11px 16px; border-radius: 999px; background: #a91f36; color: white; font-weight: 750; text-decoration: none; }
.meta { color: #6b7280; font-size: 0.92rem; }
footer { padding: 26px 0 42px; border-top: 1px solid #f4c9ce; color: #6b7280; font-size: 0.9rem; }
@media (max-width: 680px) {
  .header-inner { align-items: flex-start; flex-direction: column; }
  main { padding-top: 38px; }
}
`;

function navigation() {
  return `<nav aria-label="Noteflix plugin information">
    <a href="/about">About</a>
    <a href="/support">Support</a>
    <a href="/privacy">Privacy</a>
    <a href="/terms">Terms</a>
  </nav>`;
}

function page(baseUrl: URL, title: string, eyebrow: string, lead: string, content: string): string {
  const origin = baseUrl.origin;
  return `<!doctype html>
<html lang="en-US">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${lead}">
  <title>${title} · Noteflix</title>
  <link rel="stylesheet" href="/noteflix-public.css">
</head>
<body>
  <header>
    <div class="shell header-inner">
      <a class="brand" href="/about">Noteflix</a>
      ${navigation()}
    </div>
  </header>
  <main class="shell">
    <div class="eyebrow">${eyebrow}</div>
    <h1>${title}</h1>
    <p class="lede">${lead}</p>
    ${content}
  </main>
  <footer>
    <div class="shell">Noteflix ChatGPT plugin · <a href="${origin}/support">Contact support</a> · Updated August 28, 2026</div>
  </footer>
</body>
</html>`;
}

function sendPage(res: Response, body: string) {
  return res
    .set({
      "Cache-Control": "public, max-age=300",
      "Content-Security-Policy": PUBLIC_PAGE_CSP,
      "X-Frame-Options": "DENY",
    })
    .status(200)
    .type("html")
    .send(body);
}

export function createPublicInfoRouter(config: AppConfig): Router {
  const router = Router();

  router.get("/noteflix-public.css", (_req, res) =>
    res
      .set("Cache-Control", "public, max-age=3600")
      .status(200)
      .type("text/css")
      .send(PUBLIC_CSS));

  router.get("/about", (_req, res) => sendPage(res, page(
    config.publicBaseUrl,
    "Turn supplied study text into learning tools",
    "Noteflix for ChatGPT",
    "Noteflix organizes text you provide into source-faithful study guides, practice, quizzes, and review plans, then saves an approved result privately only when you ask.",
    `<section class="card">
      <h2>What the plugin can do</h2>
      <ul>
        <li>Organize text from the current conversation into a study guide without inventing unsupported facts.</li>
        <li>Create flashcards, direct-retrieval practice, and one-question-at-a-time review.</li>
        <li>Build a realistic review plan from the time and deadline you provide.</li>
        <li>After showing the exact payload and receiving separate confirmation, create one private note in the connected Noteflix account.</li>
      </ul>
    </section>
    <section>
      <h2>Private by design</h2>
      <p>The production connector exposes one account action: <code>create_private_note</code>. It cannot list, read, search, update, publish, share, or delete existing notes, and it does not generate media. Saving requires the <code>notes:create</code> permission and an eligible Noteflix account.</p>
      <p>The plugin is for general audiences age 13 and older and is not directed to children under 13. AI-generated learning material may contain mistakes, so verify important claims against your source.</p>
      <a class="button" href="/support">Get support</a>
    </section>`,
  )));

  router.get("/support", (_req, res) => sendPage(res, page(
    config.publicBaseUrl,
    "Noteflix plugin support",
    "Support",
    "Get help connecting Noteflix, approving a private-note save, resolving an error, revoking access, or deleting data.",
    `<section class="card">
      <h2>Contact</h2>
      <p>Email <a href="mailto:support@noteflix.com">support@noteflix.com</a>. Remove note bodies, credentials, OAuth tokens, personal identifiers, payment data, and private course material before sending a support request.</p>
    </section>
    <section>
      <h2>Before reporting a save problem</h2>
      <ol>
        <li>Confirm Noteflix is connected in ChatGPT and that you granted <code>notes:create</code>.</li>
        <li>Confirm the connected Noteflix account is eligible to save a note.</li>
        <li>Make sure ChatGPT showed the full title and Markdown payload and received a separate affirmative confirmation.</li>
        <li>If a request timed out, retry with the same request ID so idempotency protection can prevent a duplicate.</li>
        <li>Include the approximate timestamp, plugin version, and displayed error code in your message—without including the note content.</li>
      </ol>
      <h2>Disconnect and delete</h2>
      <p>Disconnect Noteflix from ChatGPT to stop future connector access. Disconnecting does not delete notes already saved. Delete a note or account from the Noteflix product controls, or email support for a privacy or deletion request you cannot complete in the app.</p>
    </section>`,
  )));

  router.get("/privacy", (_req, res) => sendPage(res, page(
    config.publicBaseUrl,
    "Privacy for the Noteflix ChatGPT plugin",
    "Privacy policy",
    "This policy explains the note-only connector’s account boundary, approved-save data flow, retention, processors, and deletion options.",
    `<p class="meta"><strong>Effective:</strong> August 28, 2026</p>
    <section>
      <h2>Data the plugin handles</h2>
      <p>Study workflows use text you supply in the current ChatGPT conversation. The plugin does not inspect uploads, retrieve prior chats, query model memory, or search your existing Noteflix library.</p>
      <p>Only after explicit save intent, an exact payload preview, and separate confirmation, ChatGPT sends the approved title, Markdown body, optional approved summary and key points, a random request ID, and the identity bound to your OAuth grant. Noteflix also processes OAuth records, eligibility decisions, timestamps, request outcomes, and limited security and rate-limit metadata needed to operate and protect the service.</p>
    </section>
    <section>
      <h2>How the data is used</h2>
      <ul>
        <li>Verify the <code>notes:create</code> permission and eligibility for the exact connected account.</li>
        <li>Reject restricted data before hashing, eligibility lookup, or a product write.</li>
        <li>Create one private note and return a minimized receipt.</li>
        <li>Prevent duplicate saves, abuse, and unauthorized access.</li>
      </ul>
      <p>The connector cannot read or change existing notes, publish content, generate media, manage subscriptions, or return payment, email, plan, or raw entitlement details.</p>
    </section>
    <section>
      <h2>Retention</h2>
      <ul>
        <li>Authorization requests: 10 minutes; authorization codes: 5 minutes; access-token records: 1 hour.</li>
        <li>Refresh-token records: 30 days and rotated on use.</li>
        <li>The public ChatGPT client-registration record is retained for the operating life of the connector or until administratively removed. It contains callback/client metadata, not a Noteflix user identity or note body. Other dynamic client registrations expire after 30 days.</li>
        <li>Idempotency receipts: 30 days. They contain hashes and a minimized receipt, not the note body, summary, or key points.</li>
        <li>Rate-limit records: the active window plus approximately 24 hours.</li>
      </ul>
      <p>A private note remains in the connected Noteflix account until the user deletes that note or deletes the account. Production logs use bounded retention and are designed to exclude note bodies, OAuth tokens, passwords, challenge values, and reviewer credentials.</p>
    </section>
    <section>
      <h2>Sharing and processors</h2>
      <p>OpenAI processes conversation content and tool interactions under the user’s OpenAI settings and terms. Noteflix operates the OAuth service, MCP gateway, eligibility authority, and private-note backend. Google Cloud and Firebase provide hosting, identity, database, and storage infrastructure. The note-only path does not invoke media-generation or public-publication providers.</p>
      <h2>Your choices</h2>
      <p>Disconnect Noteflix in ChatGPT to stop future connector access. This does not delete previously saved notes. Use Noteflix product controls to delete notes or the account. For privacy and deletion requests that cannot be completed there, email <a href="mailto:support@noteflix.com">support@noteflix.com</a>.</p>
      <h2>Restricted data and age</h2>
      <p>Do not submit payment-card data, identifiable protected health information, government identifiers, passwords, API keys, authentication tokens, one-time passwords, or verification codes. The plugin is for general audiences age 13 and older and is not directed to children under 13.</p>
    </section>`,
  )));

  router.get("/terms", (_req, res) => sendPage(res, page(
    config.publicBaseUrl,
    "Terms for the Noteflix ChatGPT plugin",
    "Terms of service",
    "These terms govern the Noteflix plugin’s source-faithful study workflows and confirmed private-note connection.",
    `<p class="meta"><strong>Effective:</strong> August 28, 2026</p>
    <section>
      <h2>Scope and eligibility</h2>
      <p>These terms apply to the Noteflix ChatGPT plugin and supplement the terms governing your Noteflix and OpenAI accounts. You must be at least 13 years old and legally permitted to use the service. Creating a private note requires an eligible Noteflix account connected through OAuth.</p>
      <h2>How the plugin works</h2>
      <p>Study skills operate on text you provide in the current conversation. The connector creates a private note only after it shows the exact payload and receives separate confirmation. It does not read existing notes, publish content, generate media, or sell or manage subscriptions inside ChatGPT.</p>
      <h2>Your responsibilities</h2>
      <ul>
        <li>Provide only content you have the right to use and save.</li>
        <li>Do not submit restricted personal, financial, health, government-ID, password, token, or verification-code data.</li>
        <li>Do not use the plugin for unlawful activity, security abuse, impersonation, harassment, or prohibited academic misconduct.</li>
        <li>Review the exact private-note preview before confirming a save.</li>
      </ul>
      <h2>Educational limitations</h2>
      <p>AI-generated study material may be incomplete or incorrect and is not a grade prediction, professional advice, or a substitute for your course materials. Verify important claims against the original source and follow your school’s academic-integrity rules.</p>
      <h2>Availability and enforcement</h2>
      <p>The plugin is provided on an as-available basis. Features may change, pause, or be withdrawn, and access may be limited to protect users, enforce these terms, or maintain service security. To the extent permitted by law, Noteflix is not responsible for decisions made solely from AI-generated study output.</p>
      <h2>Privacy, changes, and contact</h2>
      <p>The <a href="/privacy">plugin privacy policy</a> explains data handling and deletion. Material changes to these terms will update the effective date on this page. Questions may be sent to <a href="mailto:support@noteflix.com">support@noteflix.com</a>.</p>
    </section>`,
  )));

  return router;
}
