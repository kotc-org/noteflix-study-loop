import { describe, expect, it, vi } from "vitest";

import { IdentityToolkitVerifier } from "../src/oauth/identity.js";
import { testConfig } from "./fixtures.js";

describe("Firebase Identity Toolkit consent verifier", () => {
  const token = (overrides: Record<string, unknown> = {}) => {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    return `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
      aud: "noteflix-test",
      iss: "https://securetoken.google.com/noteflix-test",
      sub: "firebase-user-1",
      auth_time: 100,
      exp: 10_000,
      ...overrides,
    })}.signature`;
  };

  it("looks up the presented ID token and returns only the enabled Firebase UID", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          users: [{ localId: "firebase-user-1", validSince: "99", disabled: false, email: "not-forwarded@example.test" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const config = testConfig();
    const verifier = new IdentityToolkitVerifier(config, fetchMock, () => 1_000_000);

    await expect(verifier.verify(token())).resolves.toEqual({ uid: "firebase-user-1" });
    const [target, init] = fetchMock.mock.calls[0]!;
    const url = new URL(String(target));
    expect(`${url.origin}${url.pathname}`).toBe("https://identitytoolkit.googleapis.com/v1/accounts:lookup");
    expect(url.searchParams.get("key")).toBe("test-web-api-key");
    expect(new Headers(init?.headers).get("origin")).toBe(config.publicBaseUrl.origin);
    expect(new Headers(init?.headers).get("referer")).toBe(`${config.publicBaseUrl.origin}/`);
    expect(JSON.parse(String(init?.body))).toEqual({ idToken: token() });
  });

  it("rejects disabled, missing, and rejected identities", async () => {
    const disabled = new IdentityToolkitVerifier(
      testConfig(),
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ users: [{ localId: "firebase-user-1", validSince: "99", disabled: true }] }), { status: 200 }),
      ),
      () => 1_000_000,
    );
    const missing = new IdentityToolkitVerifier(
      testConfig(),
      vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ users: [] }), { status: 200 })),
      () => 1_000_000,
    );
    const invalid = new IdentityToolkitVerifier(
      testConfig(),
      vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 400 })),
      () => 1_000_000,
    );

    await expect(disabled.verify(token())).rejects.toThrow(/disabled/);
    await expect(missing.verify(token())).rejects.toThrow(/invalid/);
    await expect(invalid.verify(token())).rejects.toThrow(/invalid or expired/);
  });

  it("rejects a revoked token and a token for another Firebase project", async () => {
    const revoked = new IdentityToolkitVerifier(
      testConfig(),
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({
          users: [{ localId: "firebase-user-1", validSince: "101", disabled: false }],
        }), { status: 200 }),
      ),
      () => 1_000_000,
    );
    await expect(revoked.verify(token())).rejects.toThrow(/revoked/);

    const fetchMock = vi.fn<typeof fetch>();
    const wrongProject = new IdentityToolkitVerifier(
      testConfig(),
      fetchMock,
      () => 1_000_000,
    );
    await expect(wrongProject.verify(token({ aud: "attacker-project" }))).rejects.toThrow(/invalid/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
