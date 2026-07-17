import { describe, expect, it } from "vitest";

import {
  defaultScopesForRedirectUri,
  normalizeScopes,
  requireExactResource,
  trustedClientDisplayName,
  validateRegisteredClient,
} from "../src/oauth/policy.js";

describe("OAuth policy", () => {
  it("defaults to every action scope and permits least-privilege action grants", () => {
    expect(normalizeScopes(undefined)).toEqual([
      "notes:create",
      "videos:create",
      "videos:read",
      "videos:publish",
    ]);
    expect(normalizeScopes(["offline_access", "notes:create"])).toEqual(["notes:create", "offline_access"]);
    expect(normalizeScopes(["videos:read"])).toEqual(["videos:read"]);
    expect(normalizeScopes(["videos:publish", "videos:create", "videos:create"])).toEqual([
      "videos:create",
      "videos:publish",
    ]);
    expect(() => normalizeScopes(["profile", "notes:create"])).toThrow(/Unsupported scope/);
    expect(() => normalizeScopes(["offline_access"])).toThrow(/action scope/);
  });

  it("binds every grant and token to the exact MCP audience", () => {
    const resource = new URL("https://mcp.noteflix.com/mcp");
    expect(requireExactResource(new URL(resource), resource).href).toBe(resource.href);
    expect(() => requireExactResource(undefined, resource)).toThrow(/audience/);
    expect(() => requireExactResource(new URL(`${resource.href}#fragment`), resource)).toThrow(/audience/);
    expect(() => requireExactResource(new URL("https://mcp.noteflix.com/other"), resource)).toThrow(/audience/);
  });

  it("allows only exact ChatGPT, Claude, and safe HTTP loopback callbacks", () => {
    const base = {
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      token_endpoint_auth_method: "none",
    };
    expect(() => validateRegisteredClient(base)).not.toThrow();
    expect(() => validateRegisteredClient({ ...base, redirect_uris: ["https://chatgpt.com/connector/oauth/callback_123-ABC"] })).not.toThrow();
    expect(() => validateRegisteredClient({ ...base, redirect_uris: ["http://127.0.0.1:9876/callback"] })).not.toThrow();
    expect(() => validateRegisteredClient({ ...base, redirect_uris: ["http://localhost:49152/callback"] })).not.toThrow();
    expect(() => validateRegisteredClient({ ...base, redirect_uris: ["http://[::1]:49152/callback"] })).not.toThrow();
    expect(() => validateRegisteredClient({ ...base, redirect_uris: ["https://claude.com/api/mcp/auth_callback"] })).toThrow(/exact ChatGPT or Claude/);
    expect(() => validateRegisteredClient({ ...base, redirect_uris: ["https://attacker.test/callback"] })).toThrow(/exact ChatGPT or Claude/);
    expect(() => validateRegisteredClient({ ...base, redirect_uris: ["https://chatgpt.com.evil.test/connector/oauth/callback_123"] })).toThrow(/exact ChatGPT or Claude/);
    expect(() => validateRegisteredClient({ ...base, redirect_uris: ["https://chatgpt.com/connector/oauth/one/two"] })).toThrow(/exact ChatGPT or Claude/);
    expect(() => validateRegisteredClient({ ...base, redirect_uris: ["https://chatgpt.com/connector/oauth/callback.123"] })).toThrow(/exact ChatGPT or Claude/);
    expect(() => validateRegisteredClient({ ...base, redirect_uris: ["https://claude.ai.evil.test/api/mcp/auth_callback"] })).toThrow(/exact ChatGPT or Claude/);
    expect(() => validateRegisteredClient({ ...base, redirect_uris: ["https://claude.ai/api/mcp/auth_callback?next=evil"] })).toThrow(/query/);
    expect(() => validateRegisteredClient({ ...base, redirect_uris: ["http://127.0.0.1:9876/not-callback"] })).toThrow(/loopback/);
    expect(() => validateRegisteredClient({ ...base, redirect_uris: ["https://claude.ai/api/mcp/auth_callback#fragment"] })).toThrow(/fragment/);
  });

  it("derives display names only from a validated callback destination", () => {
    expect(trustedClientDisplayName("https://chatgpt.com/connector/oauth/callback_123")).toBe("ChatGPT");
    expect(trustedClientDisplayName("https://claude.ai/api/mcp/auth_callback")).toBe("Claude");
    expect(trustedClientDisplayName("http://localhost:49152/callback")).toBe("Local MCP client");
    expect(() => trustedClientDisplayName("https://chatgpt.com.evil.test/connector/oauth/callback_123")).toThrow(/not a trusted/);
    expect(() => trustedClientDisplayName("https://chatgpt.com/connector/oauth/callback_123?next=evil")).toThrow(/not a trusted/);
  });

  it("keeps scope-less Claude clients note-only and defaults ChatGPT to unified actions", () => {
    expect(defaultScopesForRedirectUri("https://claude.ai/api/mcp/auth_callback")).toEqual(["notes:create"]);
    expect(defaultScopesForRedirectUri("http://127.0.0.1:49152/callback")).toEqual(["notes:create"]);
    expect(defaultScopesForRedirectUri("https://chatgpt.com/connector/oauth/callback_123")).toEqual([
      "notes:create",
      "videos:create",
      "videos:read",
      "videos:publish",
    ]);
  });
});
