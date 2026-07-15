import { describe, expect, it } from "vitest";

import { buildConsentHtml } from "../src/consent/html.js";
import { testConfig } from "./fixtures.js";

describe("OAuth consent return destination", () => {
  it("shows the hosted Claude callback hostname", () => {
    const html = buildConsentHtml(
      {
        clientName: "Claude",
        scopes: ["notes:create"],
        callbackHostname: "claude.ai",
        loopbackCallback: false,
      },
      "r".repeat(32),
      testConfig(),
      "nonce",
    );
    expect(html).toContain("returns to <strong>claude.ai</strong>");
    expect(html).not.toContain("Local callback:");
    expect(html).not.toContain("revoke access from your Noteflix account");
  });

  it("warns when approval returns to a loopback callback", () => {
    const html = buildConsentHtml(
      {
        clientName: "Claude Code",
        scopes: ["notes:create", "offline_access"],
        callbackHostname: "127.0.0.1",
        loopbackCallback: true,
      },
      "r".repeat(32),
      testConfig(),
      "nonce",
    );
    expect(html).toContain("<strong>Local callback:</strong>");
    expect(html).toContain("<code>127.0.0.1</code>");
    expect(html).toContain("Approve only if you started this connection in Claude.");
  });
});
