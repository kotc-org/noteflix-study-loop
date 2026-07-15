import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import { InvalidGrantError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";

import type { AppConfig } from "../config.js";
import { decryptSecret, encryptSecret, hashOpaque } from "../security/crypto.js";
import { validateRegisteredClient } from "./policy.js";

export type AuthorizationRequestRecord = {
  clientId: string;
  clientName: string;
  redirectUri: string;
  state?: string;
  scopes: string[];
  codeChallenge: string;
  resource: string;
  expiresAtMs: number;
  consumedAtMs?: number;
};

export type AuthorizationCodeRecord = {
  clientId: string;
  uid: string;
  redirectUri: string;
  scopes: string[];
  codeChallenge: string;
  resource: string;
  expiresAtMs: number;
  consumedAtMs?: number;
};

export type StoredTokenRecord = {
  clientId: string;
  uid: string;
  scopes: string[];
  resource: string;
  createdAtMs: number;
  expiresAtMs: number;
  revokedAtMs?: number;
  rotatedAtMs?: number;
};

export interface OAuthStore extends OAuthRegisteredClientsStore {
  createAuthorizationRequest(rawRequestToken: string, record: AuthorizationRequestRecord): Promise<void>;
  getAuthorizationRequest(rawRequestToken: string): Promise<AuthorizationRequestRecord | undefined>;
  completeAuthorizationRequest(
    rawRequestToken: string,
    rawAuthorizationCode: string | undefined,
    uid: string | undefined,
  ): Promise<AuthorizationRequestRecord>;
  getAuthorizationCode(rawCode: string): Promise<AuthorizationCodeRecord | undefined>;
  consumeAuthorizationCode(rawCode: string, clientId: string): Promise<AuthorizationCodeRecord>;
  createAccessToken(rawToken: string, record: StoredTokenRecord): Promise<void>;
  createRefreshToken(rawToken: string, record: StoredTokenRecord): Promise<void>;
  getAccessToken(rawToken: string): Promise<StoredTokenRecord | undefined>;
  rotateRefreshToken(
    rawOldToken: string,
    rawNewToken: string,
    clientId: string,
    scopes: string[],
    resource: string,
  ): Promise<StoredTokenRecord>;
  revoke(rawToken: string, clientId: string): Promise<void>;
}

type StoredClient = Omit<OAuthClientInformationFull, "client_secret"> & {
  client_secret_ciphertext?: string;
  registrationExpiresAtMs: number;
};

const isLive = (record: { expiresAtMs: number; consumedAtMs?: number; revokedAtMs?: number }, now: number) =>
  record.expiresAtMs > now && record.consumedAtMs === undefined && record.revokedAtMs === undefined;

function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => withoutUndefined(item)) as T;
  }
  if (
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, withoutUndefined(item)]),
    ) as T;
  }
  return value;
}

export class FirestoreOAuthStore implements OAuthStore {
  private readonly names;

  constructor(
    private readonly db: Firestore,
    private readonly config: AppConfig,
    private readonly now: () => number = Date.now,
  ) {
    const prefix = config.collectionPrefix;
    this.names = {
      clients: `${prefix}_oauth_clients`,
      requests: `${prefix}_oauth_authorization_requests`,
      codes: `${prefix}_oauth_codes`,
      access: `${prefix}_oauth_access_tokens`,
      refresh: `${prefix}_oauth_refresh_tokens`,
    };
  }

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const snapshot = await this.db.collection(this.names.clients).doc(clientId).get();
    if (!snapshot.exists) return undefined;
    const stored = snapshot.data() as StoredClient;
    if (stored.registrationExpiresAtMs <= this.now()) return undefined;
    const {
      client_secret_ciphertext: ciphertext,
      registrationExpiresAtMs: _registrationExpiresAtMs,
      deleteAfter: _deleteAfter,
      ...metadata
    } = stored as StoredClient & { deleteAfter?: Timestamp };
    const client = {
      ...metadata,
      ...(ciphertext ? { client_secret: decryptSecret(ciphertext, this.config.oauthClientSecretEncryptionKey) } : {}),
    };
    validateRegisteredClient(client);
    return client;
  }

  async registerClient(
    client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at"> & {
      client_id: string;
      client_id_issued_at: number;
    },
  ): Promise<OAuthClientInformationFull> {
    validateRegisteredClient(client);
    const { client_secret: secret, ...metadata } = client;
    const registrationExpiresAtMs =
      this.now() + this.config.clientRegistrationTtlSeconds * 1000;
    const stored: StoredClient = {
      ...metadata,
      registrationExpiresAtMs,
      ...(secret
        ? { client_secret_ciphertext: encryptSecret(secret, this.config.oauthClientSecretEncryptionKey) }
        : {}),
    };
    await this.db
      .collection(this.names.clients)
      .doc(client.client_id)
      .create(withoutUndefined({
        ...stored,
        deleteAfter: Timestamp.fromMillis(registrationExpiresAtMs),
      }));
    return client;
  }

  async createAuthorizationRequest(rawRequestToken: string, record: AuthorizationRequestRecord): Promise<void> {
    await this.db
      .collection(this.names.requests)
      .doc(hashOpaque(rawRequestToken))
      .create({ ...record, deleteAfter: Timestamp.fromMillis(record.expiresAtMs) });
  }

  async getAuthorizationRequest(rawRequestToken: string): Promise<AuthorizationRequestRecord | undefined> {
    const snapshot = await this.db.collection(this.names.requests).doc(hashOpaque(rawRequestToken)).get();
    if (!snapshot.exists) return undefined;
    const record = snapshot.data() as AuthorizationRequestRecord;
    return isLive(record, this.now()) ? record : undefined;
  }

  async completeAuthorizationRequest(
    rawRequestToken: string,
    rawAuthorizationCode: string | undefined,
    uid: string | undefined,
  ): Promise<AuthorizationRequestRecord> {
    const requestRef = this.db.collection(this.names.requests).doc(hashOpaque(rawRequestToken));
    const codeRef = rawAuthorizationCode
      ? this.db.collection(this.names.codes).doc(hashOpaque(rawAuthorizationCode))
      : undefined;
    return this.db.runTransaction(async (transaction) => {
      const requestSnapshot = await transaction.get(requestRef);
      if (!requestSnapshot.exists) throw new InvalidGrantError("Authorization request is invalid or expired");
      const request = requestSnapshot.data() as AuthorizationRequestRecord;
      const now = this.now();
      if (!isLive(request, now)) throw new InvalidGrantError("Authorization request is invalid or expired");
      transaction.update(requestRef, { consumedAtMs: now });
      if (codeRef && rawAuthorizationCode && uid) {
        const code: AuthorizationCodeRecord = {
          clientId: request.clientId,
          uid,
          redirectUri: request.redirectUri,
          scopes: request.scopes,
          codeChallenge: request.codeChallenge,
          resource: request.resource,
          expiresAtMs: now + this.config.authorizationCodeTtlSeconds * 1000,
        };
        transaction.create(codeRef, { ...code, deleteAfter: Timestamp.fromMillis(code.expiresAtMs) });
      }
      return request;
    });
  }

  async getAuthorizationCode(rawCode: string): Promise<AuthorizationCodeRecord | undefined> {
    const snapshot = await this.db.collection(this.names.codes).doc(hashOpaque(rawCode)).get();
    if (!snapshot.exists) return undefined;
    const record = snapshot.data() as AuthorizationCodeRecord;
    return isLive(record, this.now()) ? record : undefined;
  }

  async consumeAuthorizationCode(rawCode: string, clientId: string): Promise<AuthorizationCodeRecord> {
    const ref = this.db.collection(this.names.codes).doc(hashOpaque(rawCode));
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new InvalidGrantError("Authorization code is invalid or expired");
      const record = snapshot.data() as AuthorizationCodeRecord;
      const now = this.now();
      if (!isLive(record, now) || record.clientId !== clientId) {
        throw new InvalidGrantError("Authorization code is invalid or expired");
      }
      transaction.update(ref, { consumedAtMs: now });
      return record;
    });
  }

  async createAccessToken(rawToken: string, record: StoredTokenRecord): Promise<void> {
    await this.db
      .collection(this.names.access)
      .doc(hashOpaque(rawToken))
      .create({ ...record, deleteAfter: Timestamp.fromMillis(record.expiresAtMs) });
  }

  async createRefreshToken(rawToken: string, record: StoredTokenRecord): Promise<void> {
    await this.db
      .collection(this.names.refresh)
      .doc(hashOpaque(rawToken))
      .create({ ...record, deleteAfter: Timestamp.fromMillis(record.expiresAtMs) });
  }

  async getAccessToken(rawToken: string): Promise<StoredTokenRecord | undefined> {
    const snapshot = await this.db.collection(this.names.access).doc(hashOpaque(rawToken)).get();
    if (!snapshot.exists) return undefined;
    const record = snapshot.data() as StoredTokenRecord;
    return isLive(record, this.now()) ? record : undefined;
  }

  async rotateRefreshToken(
    rawOldToken: string,
    rawNewToken: string,
    clientId: string,
    scopes: string[],
    resource: string,
  ): Promise<StoredTokenRecord> {
    const oldRef = this.db.collection(this.names.refresh).doc(hashOpaque(rawOldToken));
    const newRef = this.db.collection(this.names.refresh).doc(hashOpaque(rawNewToken));
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(oldRef);
      if (!snapshot.exists) throw new InvalidGrantError("Refresh token is invalid or expired");
      const old = snapshot.data() as StoredTokenRecord;
      const now = this.now();
      if (!isLive(old, now) || old.clientId !== clientId || old.resource !== resource) {
        throw new InvalidGrantError("Refresh token is invalid or expired");
      }
      if (scopes.some((scope) => !old.scopes.includes(scope))) {
        throw new InvalidGrantError("Refresh scope exceeds the original grant");
      }
      const next: StoredTokenRecord = {
        clientId,
        uid: old.uid,
        scopes,
        resource,
        createdAtMs: now,
        expiresAtMs: now + this.config.refreshTokenTtlSeconds * 1000,
      };
      transaction.update(oldRef, { rotatedAtMs: now, revokedAtMs: now });
      transaction.create(newRef, { ...next, deleteAfter: Timestamp.fromMillis(next.expiresAtMs) });
      return next;
    });
  }

  async revoke(rawToken: string, clientId: string): Promise<void> {
    const now = this.now();
    for (const name of [this.names.access, this.names.refresh]) {
      const ref = this.db.collection(name).doc(hashOpaque(rawToken));
      await this.db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) return;
        const record = snapshot.data() as StoredTokenRecord;
        if (record.clientId === clientId && record.revokedAtMs === undefined) {
          transaction.update(ref, { revokedAtMs: now });
        }
      });
    }
  }
}
