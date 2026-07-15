import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createConsentRouter } from "../src/consent/router.js";
import { testConfig } from "./fixtures.js";

describe("consent endpoint security", () => {
  it("requires the exact PUBLIC_BASE_URL origin before parsing the completion body", async () => {
    const completeConsent = vi.fn().mockResolvedValue({
      redirectUrl: "https://claude.ai/api/mcp/auth_callback?code=safe",
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
      redirect_url: "https://claude.ai/api/mcp/auth_callback?code=safe",
    });
    expect(completeConsent).toHaveBeenCalledOnce();
    expect(completeConsent).toHaveBeenCalledWith({
      requestToken: "r".repeat(48),
      decision: "deny",
    });
  });
});
