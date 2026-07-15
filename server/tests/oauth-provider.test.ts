import type { Response } from "express";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { describe, expect, it, vi } from "vitest";

import type {
  AuthorizationCodeRecord,
  AuthorizationRequestRecord,
  OAuthStore,
  StoredTokenRecord,
} from "../src/oauth/firestore-store.js";
import { NoteflixOAuthProvider } from "../src/oauth/provider.js";
import { testConfig } from "./fixtures.js";

class MemoryOAuthStore implements OAuthStore {
  request?: { token: string; record: AuthorizationRequestRecord };
  codes = new Map<string, AuthorizationCodeRecord>();
  access = new Map<string, StoredTokenRecord>();
  refresh = new Map<string, StoredTokenRecord>();

  async getClient(): Promise<OAuthClientInformationFull | undefined> { return undefined; }
  async registerClient(client: never): Promise<OAuthClientInformationFull> { return client; }
  async createAuthorizationRequest(token: string, record: AuthorizationRequestRecord): Promise<void> {
    this.request = { token, record };
  }
  async getAuthorizationRequest(token: string): Promise<AuthorizationRequestRecord | undefined> {
    return this.request?.token === token ? this.request.record : undefined;
  }
  async completeAuthorizationRequest(token: string, code: string | undefined, uid: string | undefined): Promise<AuthorizationRequestRecord> {
    if (!this.request || this.request.token !== token) throw new Error("missing request");
    if (code && uid) {
      this.codes.set(code, {
        clientId: this.request.record.clientId,
        uid,
        redirectUri: this.request.record.redirectUri,
        scopes: this.request.record.scopes,
        codeChallenge: this.request.record.codeChallenge,
        resource: this.request.record.resource,
        expiresAtMs: Date.now() + 60_000,
      });
    }
    return this.request.record;
  }
  async getAuthorizationCode(code: string): Promise<AuthorizationCodeRecord | undefined> { return this.codes.get(code); }
  async consumeAuthorizationCode(code: string): Promise<AuthorizationCodeRecord> {
    const record = this.codes.get(code);
    if (!record) throw new Error("missing code");
    this.codes.delete(code);
    return record;
  }
  async createAccessToken(token: string, record: StoredTokenRecord): Promise<void> { this.access.set(token, record); }
  async createRefreshToken(token: string, record: StoredTokenRecord): Promise<void> { this.refresh.set(token, record); }
  async getAccessToken(token: string): Promise<StoredTokenRecord | undefined> { return this.access.get(token); }
  async rotateRefreshToken(oldToken: string, newToken: string, clientId: string, scopes: string[], resource: string): Promise<StoredTokenRecord> {
    const old = this.refresh.get(oldToken);
    if (!old) throw new Error("missing refresh token");
    this.refresh.delete(oldToken);
    const next = { ...old, clientId, scopes, resource };
    this.refresh.set(newToken, next);
    return next;
  }
  async revoke(token: string): Promise<void> { this.access.delete(token); this.refresh.delete(token); }
}

describe("OAuth provider flow", () => {
  it("binds Firebase consent, authorization code, access token, and refresh token to one resource", async () => {
    const store = new MemoryOAuthStore();
    const identityVerifier = { verify: vi.fn().mockResolvedValue({ uid: "firebase-user-1" }) };
    const config = testConfig();
    const provider = new NoteflixOAuthProvider(store, identityVerifier, config);
    const client: OAuthClientInformationFull = {
      client_id: "claude-client",
      client_id_issued_at: 1,
      client_name: "Claude",
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      token_endpoint_auth_method: "none",
    };
    const redirect = vi.fn();
    await expect(
      provider.authorize(
        client,
        {
          scopes: ["notes:create"],
          codeChallenge: "challenge",
          redirectUri: "https://attacker.test/callback",
          resource: config.mcpResourceUrl,
        },
        { redirect } as unknown as Response,
      ),
    ).rejects.toThrow(/not registered/);
    await provider.authorize(
      client,
      {
        scopes: ["notes:create", "offline_access"],
        codeChallenge: "challenge",
        redirectUri: client.redirect_uris[0]!,
        state: "state-1",
        resource: config.mcpResourceUrl,
      },
      { redirect } as unknown as Response,
    );
    const consentLocation = new URL(redirect.mock.calls[0]![1]);
    const requestToken = consentLocation.searchParams.get("request_id")!;
    await expect(provider.getConsentView(requestToken)).resolves.toMatchObject({
      clientName: "Claude",
      callbackHostname: "claude.ai",
      loopbackCallback: false,
    });
    const completed = await provider.completeConsent({
      requestToken,
      decision: "allow",
      firebaseIdToken: "firebase-id-token",
    });
    expect(identityVerifier.verify).toHaveBeenCalledWith("firebase-id-token");
    const authorizationCode = new URL(completed.redirectUrl).searchParams.get("code")!;
    expect(await provider.challengeForAuthorizationCode(client, authorizationCode)).toBe("challenge");
    await expect(
      provider.exchangeAuthorizationCode(
        client,
        authorizationCode,
        undefined,
        client.redirect_uris[0],
        new URL("http://localhost:8080/not-mcp"),
      ),
    ).rejects.toThrow(/audience/);
    await expect(
      provider.exchangeAuthorizationCode(
        client,
        authorizationCode,
        undefined,
        client.redirect_uris[0],
        undefined,
      ),
    ).rejects.toThrow(/audience/);

    const tokens = await provider.exchangeAuthorizationCode(
      client,
      authorizationCode,
      undefined,
      client.redirect_uris[0],
      config.mcpResourceUrl,
    );
    expect(tokens.refresh_token).toBeTruthy();
    const authInfo = await provider.verifyAccessToken(tokens.access_token);
    expect(authInfo).toMatchObject({
      clientId: "claude-client",
      scopes: ["notes:create", "offline_access"],
      extra: { uid: "firebase-user-1" },
    });
    expect(authInfo.resource?.href).toBe("http://localhost:8080/mcp");
  });
});
