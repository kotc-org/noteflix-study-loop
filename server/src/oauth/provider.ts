import type { Response } from "express";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  AccessDeniedError,
  InvalidGrantError,
  InvalidRequestError,
  InvalidTargetError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

import type { AppConfig } from "../config.js";
import { opaqueToken } from "../security/crypto.js";
import type { OAuthStore, StoredTokenRecord } from "./firestore-store.js";
import type { NoteflixIdentityVerifier } from "./identity.js";
import {
  defaultScopesForRedirectUri,
  normalizeScopes,
  OFFLINE_ACCESS_SCOPE,
  requireExactResource,
  trustedClientDisplayName,
  validateRegisteredClient,
} from "./policy.js";

export type ConsentView = {
  clientName: string;
  scopes: string[];
  callbackHostname: string;
  loopbackCallback: boolean;
};

export type ConsentCompletion = {
  redirectUrl: string;
};

export class NoteflixOAuthProvider implements OAuthServerProvider {
  readonly skipLocalPkceValidation = false;

  constructor(
    readonly clientsStore: OAuthStore,
    private readonly identityVerifier: NoteflixIdentityVerifier,
    private readonly config: AppConfig,
    private readonly now: () => number = Date.now,
  ) {}

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    validateRegisteredClient(client);
    if (!client.redirect_uris.includes(params.redirectUri)) {
      throw new InvalidRequestError("redirect_uri is not registered for this client");
    }
    const scopes = normalizeScopes(
      params.scopes && params.scopes.length > 0
        ? params.scopes
        : defaultScopesForRedirectUri(params.redirectUri),
    );
    const resource = requireExactResource(params.resource, this.config.mcpResourceUrl);
    const requestToken = opaqueToken();
    const record = {
      clientId: client.client_id,
      clientName: trustedClientDisplayName(params.redirectUri),
      redirectUri: params.redirectUri,
      ...(params.state ? { state: params.state } : {}),
      scopes,
      codeChallenge: params.codeChallenge,
      resource: resource.href,
      expiresAtMs: this.now() + this.config.authorizationRequestTtlSeconds * 1000,
    };
    await this.clientsStore.createAuthorizationRequest(requestToken, record);

    const consentUrl = new URL("/consent", this.config.publicBaseUrl);
    consentUrl.searchParams.set("request_id", requestToken);
    res.redirect(302, consentUrl.href);
  }

  async getConsentView(requestToken: string): Promise<ConsentView | undefined> {
    const request = await this.clientsStore.getAuthorizationRequest(requestToken);
    if (!request) return undefined;
    const callback = new URL(request.redirectUri);
    return {
      clientName: request.clientName,
      scopes: request.scopes,
      callbackHostname: callback.hostname,
      loopbackCallback: callback.protocol === "http:",
    };
  }

  async completeConsent(input: {
    requestToken: string;
    decision: "allow" | "deny";
    firebaseIdToken?: string;
  }): Promise<ConsentCompletion> {
    if (input.decision === "deny") {
      const request = await this.clientsStore.completeAuthorizationRequest(
        input.requestToken,
        undefined,
        undefined,
      );
      const redirect = new URL(request.redirectUri);
      redirect.searchParams.set("error", new AccessDeniedError("The user denied access").errorCode);
      redirect.searchParams.set("error_description", "The user denied access");
      if (request.state) redirect.searchParams.set("state", request.state);
      return { redirectUrl: redirect.href };
    }

    if (!input.firebaseIdToken) {
      throw new AccessDeniedError("Sign in to Noteflix before granting access");
    }
    const decoded = await this.identityVerifier.verify(input.firebaseIdToken);
    if (!decoded.uid) throw new AccessDeniedError("The Noteflix identity is invalid");

    const authorizationCode = opaqueToken();
    const request = await this.clientsStore.completeAuthorizationRequest(
      input.requestToken,
      authorizationCode,
      decoded.uid,
    );
    const redirect = new URL(request.redirectUri);
    redirect.searchParams.set("code", authorizationCode);
    if (request.state) redirect.searchParams.set("state", request.state);
    return { redirectUrl: redirect.href };
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const code = await this.clientsStore.getAuthorizationCode(authorizationCode);
    if (!code || code.clientId !== client.client_id) {
      throw new InvalidGrantError("Authorization code is invalid or expired");
    }
    return code.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const preview = await this.clientsStore.getAuthorizationCode(authorizationCode);
    if (!preview || preview.clientId !== client.client_id) {
      throw new InvalidGrantError("Authorization code is invalid or expired");
    }
    if (!redirectUri || redirectUri !== preview.redirectUri) {
      throw new InvalidGrantError("redirect_uri does not match the authorization request");
    }
    const target = requireExactResource(resource, this.config.mcpResourceUrl);
    if (preview.resource !== target.href) {
      throw new InvalidTargetError("The resource audience does not match the authorization grant");
    }

    const grant = await this.clientsStore.consumeAuthorizationCode(
      authorizationCode,
      client.client_id,
    );
    return this.issueInitialTokens(grant.clientId, grant.uid, grant.scopes, grant.resource);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const target = requireExactResource(resource, this.config.mcpResourceUrl);
    const nextScopes = !scopes || scopes.length === 0 ? undefined : normalizeScopes(scopes);
    const nextRefreshToken = opaqueToken();
    const rotated = await this.clientsStore.rotateRefreshToken(
      refreshToken,
      nextRefreshToken,
      client.client_id,
      nextScopes,
      target.href,
    );
    const { raw: accessToken, record: accessRecord } = this.newAccessToken(
      rotated.clientId,
      rotated.uid,
      rotated.scopes,
      rotated.resource,
    );
    await this.clientsStore.createAccessToken(accessToken, accessRecord);
    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: this.config.accessTokenTtlSeconds,
      scope: rotated.scopes.join(" "),
      refresh_token: nextRefreshToken,
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const record = await this.clientsStore.getAccessToken(token);
    if (!record || record.resource !== this.config.mcpResourceUrl.href) {
      throw new InvalidTokenError("Access token is invalid, expired, or revoked");
    }
    return {
      token,
      clientId: record.clientId,
      scopes: record.scopes,
      expiresAt: Math.floor(record.expiresAtMs / 1000),
      resource: new URL(record.resource),
      extra: { uid: record.uid },
    };
  }

  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    await this.clientsStore.revoke(request.token, client.client_id);
  }

  private async issueInitialTokens(
    clientId: string,
    uid: string,
    scopes: string[],
    resource: string,
  ): Promise<OAuthTokens> {
    const { raw: accessToken, record: accessRecord } = this.newAccessToken(
      clientId,
      uid,
      scopes,
      resource,
    );
    await this.clientsStore.createAccessToken(accessToken, accessRecord);

    const tokens: OAuthTokens = {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: this.config.accessTokenTtlSeconds,
      scope: scopes.join(" "),
    };
    if (scopes.includes(OFFLINE_ACCESS_SCOPE)) {
      const refreshToken = opaqueToken();
      const now = this.now();
      await this.clientsStore.createRefreshToken(refreshToken, {
        clientId,
        uid,
        scopes,
        resource,
        createdAtMs: now,
        expiresAtMs: now + this.config.refreshTokenTtlSeconds * 1000,
      });
      tokens.refresh_token = refreshToken;
    }
    return tokens;
  }

  private newAccessToken(
    clientId: string,
    uid: string,
    scopes: string[],
    resource: string,
  ): { raw: string; record: StoredTokenRecord } {
    const now = this.now();
    return {
      raw: opaqueToken(),
      record: {
        clientId,
        uid,
        scopes,
        resource,
        createdAtMs: now,
        expiresAtMs: now + this.config.accessTokenTtlSeconds * 1000,
      },
    };
  }
}

export function uidFromAuthInfo(auth: AuthInfo | undefined): string {
  const uid = auth?.extra?.uid;
  if (
    typeof uid !== "string" ||
    uid.length === 0 ||
    uid.length > 128 ||
    uid.trim() !== uid
  ) {
    throw new InvalidTokenError("The access token has no Noteflix user binding");
  }
  return uid;
}
