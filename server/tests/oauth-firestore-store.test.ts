import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { FirestoreOAuthStore } from "../src/oauth/firestore-store.js";
import { testConfig } from "./fixtures.js";

type StoredDocument = Record<string, unknown>;

function memoryFirestore() {
  const documents = new Map<string, StoredDocument>();
  const db = {
    collection: (collectionName: string) => ({
      doc: (documentId: string) => {
        const key = `${collectionName}/${documentId}`;
        return {
          create: async (value: StoredDocument) => {
            if (documents.has(key)) throw new Error("document already exists");
            documents.set(key, value);
          },
          get: async () => {
            const value = documents.get(key);
            return {
              exists: value !== undefined,
              data: () => value,
            };
          },
        };
      },
    }),
  } as unknown as Firestore;
  return { db, documents };
}

function publicClient(
  clientId: string,
  redirectUri: string,
): OAuthClientInformationFull & { client_id_issued_at: number } {
  return {
    client_id: clientId,
    client_id_issued_at: 1_700_000_000,
    redirect_uris: [redirectUri],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    client_name: "ChatGPT",
    scope: "notes:create offline_access",
  };
}

describe("Firestore OAuth client registration lifetime", () => {
  it("stores exact public ChatGPT clients without TTL fields and retrieves them under a future clock", async () => {
    const { db, documents } = memoryFirestore();
    const config = testConfig();
    const client = publicClient(
      "durable-chatgpt-client",
      "https://chatgpt.com/connector/oauth/callback_123",
    );

    await new FirestoreOAuthStore(db, config, () => 1_700_000_000_000)
      .registerClient(client);

    const stored = documents.get(
      `${config.collectionPrefix}_oauth_clients/${client.client_id}`,
    );
    expect(stored).toBeDefined();
    expect(stored).not.toHaveProperty("registrationExpiresAtMs");
    expect(stored).not.toHaveProperty("deleteAfter");
    expect(stored).not.toHaveProperty("client_secret");
    expect(stored).not.toHaveProperty("client_secret_ciphertext");

    const retrieved = await new FirestoreOAuthStore(
      db,
      config,
      () => 2_100_000_000_000,
    ).getClient(client.client_id);
    expect(retrieved).toEqual(client);
  });

  it("keeps non-ChatGPT registrations finite and rejects them after expiry", async () => {
    const { db, documents } = memoryFirestore();
    const config = testConfig();
    const now = 1_700_000_000_000;
    const client = publicClient(
      "finite-claude-client",
      "https://claude.ai/api/mcp/auth_callback",
    );

    await new FirestoreOAuthStore(db, config, () => now).registerClient(client);

    const stored = documents.get(
      `${config.collectionPrefix}_oauth_clients/${client.client_id}`,
    );
    const expectedExpiry = now + config.clientRegistrationTtlSeconds * 1000;
    expect(stored?.registrationExpiresAtMs).toBe(expectedExpiry);
    expect(stored?.deleteAfter).toBeInstanceOf(Timestamp);
    expect((stored?.deleteAfter as Timestamp).toMillis()).toBe(expectedExpiry);
    expect(await new FirestoreOAuthStore(db, config, () => expectedExpiry - 1)
      .getClient(client.client_id)).toEqual(client);
    expect(await new FirestoreOAuthStore(db, config, () => expectedExpiry)
      .getClient(client.client_id)).toBeUndefined();
  });

  it("keeps confidential ChatGPT-callback registrations finite", async () => {
    const { db, documents } = memoryFirestore();
    const config = testConfig();
    const client = {
      ...publicClient(
        "finite-confidential-client",
        "https://chatgpt.com/connector/oauth/callback_123",
      ),
      token_endpoint_auth_method: "client_secret_post" as const,
      client_secret: "confidential-client-secret",
    };

    await new FirestoreOAuthStore(db, config, () => 1_700_000_000_000)
      .registerClient(client);

    const stored = documents.get(
      `${config.collectionPrefix}_oauth_clients/${client.client_id}`,
    );
    expect(stored).toHaveProperty("registrationExpiresAtMs");
    expect(stored).toHaveProperty("deleteAfter");
    expect(stored).not.toHaveProperty("client_secret");
    expect(stored).toHaveProperty("client_secret_ciphertext");
  });

  it("keeps production verifier registrations finite even with a ChatGPT callback", async () => {
    const { db, documents } = memoryFirestore();
    const config = testConfig();
    const now = 1_700_000_000_000;
    const client = {
      ...publicClient(
        "finite-production-verifier",
        "https://chatgpt.com/connector/oauth/noteflix_readonly_verifier",
      ),
      software_id: "noteflix-production-readonly-verifier",
    };

    await new FirestoreOAuthStore(db, config, () => now).registerClient(client);

    const stored = documents.get(
      `${config.collectionPrefix}_oauth_clients/${client.client_id}`,
    );
    const expectedExpiry = now + config.clientRegistrationTtlSeconds * 1000;
    expect(stored?.registrationExpiresAtMs).toBe(expectedExpiry);
    expect((stored?.deleteAfter as Timestamp).toMillis()).toBe(expectedExpiry);
  });

  it("fails closed for a non-ChatGPT record whose expiry fields are missing", async () => {
    const { db, documents } = memoryFirestore();
    const config = testConfig();
    const client = publicClient(
      "malformed-expiryless-claude-client",
      "https://claude.ai/api/mcp/auth_callback",
    );
    documents.set(
      `${config.collectionPrefix}_oauth_clients/${client.client_id}`,
      client,
    );

    expect(await new FirestoreOAuthStore(db, config).getClient(client.client_id))
      .toBeUndefined();
  });
});
