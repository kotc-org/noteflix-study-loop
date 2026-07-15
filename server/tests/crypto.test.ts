import { describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret, hashOpaque, opaqueToken } from "../src/security/crypto.js";

describe("opaque credential helpers", () => {
  it("generates high-entropy URL-safe values and stable one-way document keys", () => {
    const token = opaqueToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(hashOpaque(token)).toBe(hashOpaque(token));
    expect(hashOpaque(token)).not.toContain(token);
  });

  it("encrypts confidential DCR client secrets at rest", () => {
    const key = Buffer.alloc(32, 9);
    const ciphertext = encryptSecret("client-secret", key);
    expect(ciphertext).not.toContain("client-secret");
    expect(decryptSecret(ciphertext, key)).toBe("client-secret");
    expect(() => decryptSecret(ciphertext, Buffer.alloc(32, 8))).toThrow();
  });
});
