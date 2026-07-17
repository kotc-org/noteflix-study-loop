import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { testConfig } from "./fixtures.js";

function contractApp() {
  const inertDb = {} as never;
  return createApp(testConfig(), { db: inertDb });
}

function authorizationClientDb() {
  const callback = "https://chatgpt.com/connector/oauth/state-preservation-test";
  const storedClient = {
    client_id: "state-preservation-client",
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: [callback],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    registrationExpiresAtMs: Date.now() + 60_000,
  };
  const get = vi.fn().mockResolvedValue({
    exists: true,
    data: () => storedClient,
  });
  return {
    callback,
    db: {
      collection: vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue({ get }),
      }),
    } as never,
  };
}

describe("remote MCP HTTP contract", () => {
  it("publishes path-specific protected-resource metadata with the exact audience", async () => {
    const response = await request(contractApp()).get("/.well-known/oauth-protected-resource/mcp");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      resource: "http://localhost:8080/mcp",
      authorization_servers: ["http://localhost:8080/"],
      scopes_supported: [
        "notes:create",
        "videos:create",
        "videos:read",
        "videos:publish",
        "offline_access",
      ],
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
    expect(response.headers["www-authenticate"]).not.toContain('scope=');
    expect(response.headers["www-authenticate"]).toContain(
      'resource_metadata="http://localhost:8080/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it("preserves OAuth state on post-validation PKCE errors without opening redirects", async () => {
    const { callback, db } = authorizationClientDb();
    const app = createApp(testConfig(), { db });
    const common = {
      response_type: "code",
      client_id: "state-preservation-client",
      redirect_uri: callback,
      state: "synthetic-state-value",
    };

    const missing = await request(app).get("/authorize").query(common);
    expect(missing.status).toBe(302);
    const missingLocation = new URL(missing.headers.location as string);
    expect(`${missingLocation.origin}${missingLocation.pathname}`).toBe(callback);
    expect(missingLocation.searchParams.get("error")).toBe("invalid_request");
    expect(missingLocation.searchParams.get("state")).toBe(common.state);

    const plain = await request(app)
      .post("/authorize")
      .type("form")
      .send({
        ...common,
        code_challenge: "synthetic-code-challenge",
        code_challenge_method: "plain",
      });
    expect(plain.status).toBe(302);
    const plainLocation = new URL(plain.headers.location as string);
    expect(`${plainLocation.origin}${plainLocation.pathname}`).toBe(callback);
    expect(plainLocation.searchParams.get("error")).toBe("invalid_request");
    expect(plainLocation.searchParams.get("state")).toBe(common.state);

    const unregistered = await request(app).get("/authorize").query({
      ...common,
      redirect_uri: "https://attacker.test/callback",
    });
    expect(unregistered.status).toBe(400);
    expect(unregistered.headers).not.toHaveProperty("location");
  });

  it("serves only the configured OpenAI domain-verification token", async () => {
    const token = "openai-domain-verification-token_123";
    const app = createApp(testConfig({ OPENAI_APPS_CHALLENGE_TOKEN: token }), {
      db: {} as never,
    });
    const response = await request(app).get("/.well-known/openai-apps-challenge");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.text).toBe(token);

    const absent = await request(contractApp()).get("/.well-known/openai-apps-challenge");
    expect(absent.status).toBe(404);
    expect(absent.text).not.toContain(token);
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

    const chatgpt = await request(createApp(testConfig({
      MCP_ALLOWED_ORIGINS: "https://chatgpt.com,https://claude.ai",
    }), { db: {} as never }))
      .post("/mcp")
      .set("origin", "https://chatgpt.com")
      .send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(chatgpt.status).toBe(401);

    const undocumentedClaudeOrigin = await request(contractApp())
      .post("/mcp")
      .set("origin", "https://claude.com")
      .send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(undocumentedClaudeOrigin.status).toBe(403);
  });
});
