import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createConsentRouter } from "../src/consent/router.js";
import { testConfig } from "./fixtures.js";

describe("consent endpoint security", () => {
  it("allows only the trusted Firebase and Google script origins required for sign-in", async () => {
    const provider = {
      completeConsent: vi.fn(),
      getConsentView: vi.fn().mockResolvedValue({
        clientName: "ChatGPT",
        scopes: ["notes:create", "offline_access"],
        callbackHostname: "chatgpt.com",
        loopbackCallback: false,
      }),
    };
    const config = testConfig({
      PUBLIC_BASE_URL: "https://gateway.noteflix.test",
      MCP_RESOURCE_URL: "https://gateway.noteflix.test/mcp",
    });
    const app = express().use(createConsentRouter(config, provider as never));

    const response = await request(app).get(`/consent?request_id=${"r".repeat(48)}`);

    expect(response.status).toBe(200);
    const policy = response.headers["content-security-policy"] as string;
    expect(policy).toContain("script-src");
    expect(policy).toContain("https://www.gstatic.com");
    expect(policy).toContain("https://apis.google.com");
    expect(policy).not.toContain("'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
    const nonce = policy.match(/script-src 'nonce-([^']+)'/)?.[1];
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{24}$/);
    expect(policy).toContain(`style-src 'nonce-${nonce}'`);
    expect(response.text).toContain(`<style nonce="${nonce}">`);
    expect(response.text).toContain(`<script type="module" nonce="${nonce}">`);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
  });

  it("requires the exact PUBLIC_BASE_URL origin before parsing the completion body", async () => {
    const completeConsent = vi.fn().mockResolvedValue({
      redirectUrl: "https://chatgpt.com/connector/oauth/callback_123?code=safe",
    });
    const provider = {
      completeConsent,
      getConsentView: vi.fn(),
    };
    const config = testConfig({
      PUBLIC_BASE_URL: "https://gateway.noteflix.test",
      MCP_RESOURCE_URL: "https://gateway.noteflix.test/mcp",
    });
    const app = express().use(createConsentRouter(config, provider as never));
    const body = {
      request_id: "r".repeat(48),
      decision: "deny",
    };

    const missing = await request(app).post("/consent/complete").send(body);
    expect(missing.status).toBe(403);
    expect(missing.body).toEqual({ error: "invalid_origin" });

    const crossSiteMalformed = await request(app)
      .post("/consent/complete")
      .set("origin", "https://attacker.test")
      .set("content-type", "application/json")
      .send("{");
    expect(crossSiteMalformed.status).toBe(403);
    expect(crossSiteMalformed.body).toEqual({ error: "invalid_origin" });

    const nonExact = await request(app)
      .post("/consent/complete")
      .set("origin", "https://gateway.noteflix.test/")
      .send(body);
    expect(nonExact.status).toBe(403);
    expect(completeConsent).not.toHaveBeenCalled();

    const sameOrigin = await request(app)
      .post("/consent/complete")
      .set("origin", config.publicBaseUrl.origin)
      .send(body);
    expect(sameOrigin.status).toBe(200);
    expect(sameOrigin.body).toEqual({
      redirect_url: "https://chatgpt.com/connector/oauth/callback_123?code=safe",
    });
    expect(completeConsent).toHaveBeenCalledOnce();
    expect(completeConsent).toHaveBeenCalledWith({
      requestToken: "r".repeat(48),
      decision: "deny",
    });
  });
});
