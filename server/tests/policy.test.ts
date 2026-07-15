import { describe, expect, it } from "vitest";

import { normalizeScopes, requireExactResource, validateRegisteredClient } from "../src/oauth/policy.js";

describe("OAuth policy", () => {
  it("requires notes:create and allows offline_access", () => {
    expect(normalizeScopes(undefined)).toEqual(["notes:create"]);
    expect(normalizeScopes(["offline_access", "notes:create"])).toEqual(["notes:create", "offline_access"]);
    expect(() => normalizeScopes(["profile", "notes:create"])).toThrow(/Unsupported scope/);
    expect(() => normalizeScopes(["offline_access"])).toThrow(/required/);
  });

  it("binds every grant and token to the exact MCP audience", () => {
    const resource = new URL("https://mcp.noteflix.com/mcp");
    expect(requireExactResource(new URL(resource), resource).href).toBe(resource.href);
    expect(() => requireExactResource(undefined, resource)).toThrow(/audience/);
    expect(() => requireExactResource(new URL(`${resource.href}#fragment`), resource)).toThrow(/audience/);
    expect(() => requireExactResource(new URL("https://mcp.noteflix.com/other"), resource)).toThrow(/audience/);
  });

  it("allows only the documented hosted callback and Claude Code HTTP loopback callbacks", () => {
    const base = {
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      token_endpoint_auth_method: "none",
    };
    expect(() => validateRegisteredClient(base)).not.toThrow();
    expect(() => validateRegisteredClient({ ...base, redirect_uris: ["http://127.0.0.1:9876/callback"] })).not.toThrow();
    expect(() => validateRegisteredClient({ ...base, redirect_uris: ["http://localhost:49152/callback"] })).not.toThrow();
    expect(() => validateRegisteredClient({ ...base, redirect_uris: ["https://claude.com/api/mcp/auth_callback"] })).toThrow(/exact Claude/);
    expect(() => validateRegisteredClient({ ...base, redirect_uris: ["http://[::1]:49152/callback"] })).toThrow(/loopback/);
    expect(() => validateRegisteredClient({ ...base, redirect_uris: ["https://attacker.test/callback"] })).toThrow(/exact Claude/);
    expect(() => validateRegisteredClient({ ...base, redirect_uris: ["https://claude.ai.evil.test/api/mcp/auth_callback"] })).toThrow(/exact Claude/);
    expect(() => validateRegisteredClient({ ...base, redirect_uris: ["https://claude.ai/api/mcp/auth_callback?next=evil"] })).toThrow(/query/);
    expect(() => validateRegisteredClient({ ...base, redirect_uris: ["http://127.0.0.1:9876/not-callback"] })).toThrow(/loopback/);
    expect(() => validateRegisteredClient({ ...base, redirect_uris: ["https://claude.ai/api/mcp/auth_callback#fragment"] })).toThrow(/fragment/);
  });
});
