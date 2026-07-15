import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { testConfig } from "./fixtures.js";

function contractApp() {
  const inertDb = {} as never;
  return createApp(testConfig(), { db: inertDb });
}

describe("remote MCP HTTP contract", () => {
  it("publishes path-specific protected-resource metadata with the exact audience", async () => {
    const response = await request(contractApp()).get("/.well-known/oauth-protected-resource/mcp");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      resource: "http://localhost:8080/mcp",
      authorization_servers: ["http://localhost:8080/"],
      scopes_supported: ["notes:create", "offline_access"],
    });
  });

  it("advertises revocation for both public and confidential DCR clients", async () => {
    const response = await request(contractApp()).get("/.well-known/oauth-authorization-server");
    expect(response.status).toBe(200);
    expect(response.body.revocation_endpoint_auth_methods_supported).toEqual([
      "client_secret_post",
      "none",
    ]);
  });

  it("returns OAuth discovery on an unauthenticated MCP POST", async () => {
    const response = await request(contractApp())
      .post("/mcp")
      .set("content-type", "application/json")
      .send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(response.status).toBe(401);
    expect(response.headers["www-authenticate"]).toContain('scope="notes:create"');
    expect(response.headers["www-authenticate"]).toContain(
      'resource_metadata="http://localhost:8080/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it("rejects unapproved supplied origins before MCP processing", async () => {
    const denied = await request(contractApp())
      .post("/mcp")
      .set("origin", "https://attacker.test")
      .send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(denied.status).toBe(403);
    expect(denied.body).toEqual({ error: "invalid_origin" });

    const allowed = await request(contractApp())
      .post("/mcp")
      .set("origin", "https://claude.ai")
      .send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(allowed.status).toBe(401);

    const undocumentedClaudeOrigin = await request(contractApp())
      .post("/mcp")
      .set("origin", "https://claude.com")
      .send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(undocumentedClaudeOrigin.status).toBe(403);
  });
});
