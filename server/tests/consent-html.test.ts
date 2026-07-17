import { describe, expect, it } from "vitest";

import { buildConsentHtml } from "../src/consent/html.js";
import { testConfig } from "./fixtures.js";

describe("OAuth consent return destination", () => {
  it("shows the hosted ChatGPT callback and neutral account/privacy terms", () => {
    const html = buildConsentHtml(
      {
        clientName: "ChatGPT",
        scopes: ["notes:create", "videos:create", "videos:read", "videos:publish", "offline_access"],
        callbackHostname: "chatgpt.com",
        loopbackCallback: false,
      },
      "r".repeat(32),
      testConfig(),
      "nonce",
    );
    expect(html).toContain("Connect Noteflix to ChatGPT");
    expect(html).toContain("returns to <strong>chatgpt.com</strong>");
    expect(html).not.toContain("Local callback:");
    expect(html).toContain("only to the exact Noteflix account shown below");
    expect(html).toContain("An active Noteflix subscription is required");
    expect(html).toContain("Create private notes in this Noteflix account");
    expect(html).toContain("Publish generated videos so anyone with the link can watch");
    expect(html).toContain("This connection can act only on this account");
    expect(html).toContain("age 13 and older");
    expect(html).not.toMatch(/manage (?:your )?plan|upgrade|subscribe now/i);
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
    expect(html).toContain("Approve only if you started this Noteflix connection in a local app.");
  });
});
