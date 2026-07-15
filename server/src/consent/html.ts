import type { AppConfig } from "../config.js";
import type { ConsentView } from "../oauth/provider.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export function buildConsentHtml(
  view: ConsentView,
  requestToken: string,
  config: AppConfig,
  nonce: string,
): string {
  const clientName = escapeHtml(view.clientName);
  const callbackHostname = escapeHtml(view.callbackHostname);
  const callbackNotice = view.loopbackCallback
    ? `<p class="warning"><strong>Local callback:</strong> after approval, this browser returns to <code>${callbackHostname}</code> on this device. Approve only if you started this connection in Claude.</p>`
    : `<p class="callback">After approval, this browser returns to <strong>${callbackHostname}</strong>.</p>`;
  const scopeItems = view.scopes
    .map((scope) => {
      const label =
        scope === "notes:create"
          ? "Create private notes in your Noteflix account"
          : "Allow Claude to refresh this connection";
      return `<li><strong>${escapeHtml(label)}</strong><span>${escapeHtml(scope)}</span></li>`;
    })
    .join("");
  const scriptConfig = safeJson({
    firebase: config.firebaseWebConfig,
    requestToken,
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Connect Noteflix to Claude</title>
  <style nonce="${nonce}">
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #090b10; color: #f8fafc; }
    main { width: min(92vw, 480px); padding: 32px; border: 1px solid #2a2f3a; border-radius: 20px; background: #11151d; box-shadow: 0 24px 80px #0008; }
    .brand { display: flex; align-items: center; gap: 12px; color: #ff4d5e; font-weight: 800; letter-spacing: .02em; }
    h1 { font-size: 1.6rem; margin: 24px 0 8px; }
    p { color: #aab2c0; line-height: 1.55; }
    ul { list-style: none; padding: 0; margin: 24px 0; }
    li { display: grid; gap: 4px; padding: 14px 0; border-top: 1px solid #262b35; }
    li span { color: #7f8998; font: 12px ui-monospace, monospace; }
    form { display: grid; gap: 12px; }
    input, button { box-sizing: border-box; width: 100%; padding: 13px 14px; border-radius: 10px; border: 1px solid #303744; font: inherit; }
    input { background: #0b0e14; color: white; }
    button { cursor: pointer; background: #ed354b; border-color: #ed354b; color: white; font-weight: 750; }
    button.secondary { background: transparent; border-color: #3a4250; }
    button:disabled { opacity: .55; cursor: wait; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    #account, #error { min-height: 20px; font-size: 14px; }
    #error { color: #ff8995; }
    .fine { font-size: 12px; }
    .callback, .warning { padding: 12px 14px; border-radius: 10px; background: #171c25; }
    .warning { border: 1px solid #b7791f; color: #f6d48f; }
    code { font: 12px ui-monospace, monospace; }
    [hidden] { display: none !important; }
  </style>
</head>
<body>
  <main>
    <div class="brand"><span aria-hidden="true">N</span> NOTEFLIX</div>
    <h1>Connect ${clientName}</h1>
    <p>Sign in to Noteflix, then choose whether Claude may use the permissions below. Notes created through this connection are always private.</p>
    ${callbackNotice}
    <ul>${scopeItems}</ul>
    <section id="signin">
      <form id="email-form">
        <input id="email" type="email" autocomplete="email" placeholder="Email" required>
        <input id="password" type="password" autocomplete="current-password" placeholder="Password" required>
        <button type="submit">Sign in with email</button>
      </form>
      <p class="fine">or</p>
      <button id="google" class="secondary" type="button">Continue with Google</button>
    </section>
    <section id="decision" hidden>
      <p id="account"></p>
      <div class="row">
        <button id="deny" class="secondary" type="button">Deny</button>
        <button id="allow" type="button">Allow</button>
      </div>
    </section>
    <p id="error" role="alert"></p>
    <p class="fine">Noteflix never shares your password with Claude. This screen grants only the permissions listed above.</p>
  </main>
  <script type="module" nonce="${nonce}">
    import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
    import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

    const cfg = ${scriptConfig};
    const auth = getAuth(initializeApp(cfg.firebase));
    const signin = document.querySelector("#signin");
    const decision = document.querySelector("#decision");
    const account = document.querySelector("#account");
    const error = document.querySelector("#error");
    const buttons = [...document.querySelectorAll("button")];

    const busy = (value) => buttons.forEach((button) => { button.disabled = value; });
    const showError = (cause) => { error.textContent = cause?.message || "Could not complete sign-in."; };
    onAuthStateChanged(auth, (user) => {
      signin.hidden = Boolean(user);
      decision.hidden = !user;
      account.textContent = user ? "Signed in as " + (user.email || "your Noteflix account") : "";
    });

    document.querySelector("#email-form").addEventListener("submit", async (event) => {
      event.preventDefault(); error.textContent = ""; busy(true);
      try { await signInWithEmailAndPassword(auth, document.querySelector("#email").value, document.querySelector("#password").value); }
      catch (cause) { showError(cause); }
      finally { busy(false); }
    });
    document.querySelector("#google").addEventListener("click", async () => {
      error.textContent = ""; busy(true);
      try { await signInWithPopup(auth, new GoogleAuthProvider()); }
      catch (cause) { showError(cause); }
      finally { busy(false); }
    });

    async function complete(decisionValue) {
      error.textContent = ""; busy(true);
      try {
        const firebaseIdToken = decisionValue === "allow" ? await auth.currentUser?.getIdToken(true) : undefined;
        const response = await fetch("/consent/complete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ request_id: cfg.requestToken, decision: decisionValue, firebase_id_token: firebaseIdToken }),
        });
        const result = await response.json();
        if (!response.ok || !result.redirect_url) throw new Error(result.error || "Authorization failed.");
        window.location.assign(result.redirect_url);
      } catch (cause) { showError(cause); busy(false); }
    }
    document.querySelector("#allow").addEventListener("click", () => complete("allow"));
    document.querySelector("#deny").addEventListener("click", () => complete("deny"));
  </script>
</body>
</html>`;
}
