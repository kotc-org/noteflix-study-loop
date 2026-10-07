import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { testConfig } from "./fixtures.js";

describe("public content and protocol crawler policy", () => {
  const app = createApp(testConfig(), { db: {} as never });

  it.each(["Googlebot", "OAI-SearchBot", "bingbot"])(
    "allows %s to discover public content while excluding protocol routes",
    async (userAgent) => {
      const response = await request(app).get("/robots.txt").set("User-Agent", userAgent);
      expect(response.status).toBe(200);
      expect(response.type).toBe("text/plain");
      expect(response.headers["x-robots-tag"]).toBeUndefined();
      expect(response.text).toContain("User-agent: *\nAllow: /\n");
      expect(response.text.split("\n").filter((line) => line.startsWith("Disallow:"))).toEqual([
        "Disallow: /authorize",
        "Disallow: /register",
        "Disallow: /revoke",
        "Disallow: /token",
        "Disallow: /mcp",
        "Disallow: /consent",
      ]);
    },
  );

  it.each([
    ["/authorize", 400],
    ["/register", 405],
    ["/revoke", 405],
    ["/mcp", 405],
  ])("keeps GET %s protocol errors and marks them non-indexable", async (path, status) => {
    const response = await request(app).get(path);
    expect(response.status).toBe(status);
    expect(response.headers["x-robots-tag"]).toBe("noindex");
  });

  it("preserves the MCP authentication challenge instead of exposing private access", async () => {
    const response = await request(app)
      .post("/mcp")
      .send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(response.status).toBe(401);
    expect(response.headers["x-robots-tag"]).toBe("noindex");
    expect(response.headers["www-authenticate"]).toContain(
      'resource_metadata="http://localhost:8080/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it.each([
    "/about", "/support", "/privacy", "/terms",
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-protected-resource/mcp",
  ])("keeps public content and discovery reachable at %s", async (path) => {
    const response = await request(app).get(path).set("User-Agent", "OAI-SearchBot");
    expect(response.status).toBe(200);
    expect(response.headers["x-robots-tag"]).toBeUndefined();
  });
});
