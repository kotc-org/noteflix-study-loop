import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";

import { createNoteflixMcpServer } from "../src/mcp.js";
import {
  NOTES_CREATE_SCOPE,
  VIDEOS_CREATE_SCOPE,
  VIDEOS_PUBLISH_SCOPE,
  VIDEOS_READ_SCOPE,
} from "../src/oauth/policy.js";
import { testConfig } from "./fixtures.js";

function catalogServer() {
  return createNoteflixMcpServer({
    uid: "catalog-user",
    scopes: [
      NOTES_CREATE_SCOPE,
      VIDEOS_CREATE_SCOPE,
      VIDEOS_READ_SCOPE,
      VIDEOS_PUBLISH_SCOPE,
    ],
    config: testConfig(),
    noteflixClient: {
      requireEligibleSubscription: vi.fn(),
      createPrivateNote: vi.fn(),
      getVideoAllowance: vi.fn(),
      createPublicNoteVideo: vi.fn(),
      getVideoStatus: vi.fn(),
    },
    idempotency: { run: vi.fn() },
    generationRateLimit: vi.fn().mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
    }),
  });
}

async function listTools() {
  const server = catalogServer();
  const client = new Client({ name: "catalog-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
    await server.close();
  }
}

async function rawToolsList() {
  const server = catalogServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const sendRequest = async (message: JSONRPCMessage) => {
    if (!("id" in message)) throw new Error("A raw test request must include an id");
    const id = message.id;
    const response = new Promise<JSONRPCMessage>((resolve) => {
      clientTransport.onmessage = (incoming) => {
        if ("id" in incoming && incoming.id === id) resolve(incoming);
      };
    });
    await clientTransport.send(message);
    return response;
  };

  try {
    await sendRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "raw-catalog-test", version: "1" },
      },
    });
    await clientTransport.send({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    const response = await sendRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    if (!("result" in response)) throw new Error("tools/list did not return a result");
    return response.result as {
      tools: Array<{
        name: string;
        securitySchemes?: unknown;
        _meta?: { securitySchemes?: unknown };
      }>;
    };
  } finally {
    await clientTransport.close();
    await server.close();
  }
}

describe("OpenAI app tool catalog", () => {
  it("emits current and legacy OAuth security-scheme fields on the wire", async () => {
    const { tools } = await rawToolsList();
    expect(tools).toHaveLength(4);
    for (const tool of tools) {
      expect(tool.securitySchemes, tool.name).toEqual(
        tool._meta?.securitySchemes,
      );
      expect(tool.securitySchemes, tool.name).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: "oauth2" })]),
      );
    }
  });

  it("publishes four narrowly scoped tools with exact schemas and safety annotations", async () => {
    const tools = await listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      "create_private_note",
      "get_video_allowance",
      "create_public_note_video",
      "get_video_status",
    ]);

    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
    expect(byName.create_private_note?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(byName.create_private_note?._meta?.securitySchemes).toEqual([
      { type: "oauth2", scopes: [NOTES_CREATE_SCOPE] },
    ]);
    expect(byName.create_private_note?.description).toContain("payment-card data");
    expect(byName.create_private_note?.description).toContain("identifiable health information");
    const contentSchema = byName.create_private_note?.inputSchema.properties
      ?.content_markdown as { description?: string } | undefined;
    expect(contentSchema?.description).toContain("authentication tokens");

    expect(byName.get_video_allowance?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(byName.get_video_allowance?._meta?.securitySchemes).toEqual([
      { type: "oauth2", scopes: [VIDEOS_READ_SCOPE] },
    ]);

    expect(byName.create_public_note_video?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(byName.create_public_note_video?._meta?.securitySchemes).toEqual([
      {
        type: "oauth2",
        scopes: [VIDEOS_CREATE_SCOPE, VIDEOS_PUBLISH_SCOPE],
      },
    ]);
    expect(byName.create_public_note_video?.description).toContain("payment-card data");
    expect(byName.create_public_note_video?.description).toContain("verification codes");
    expect(byName.create_public_note_video?.inputSchema.required).toEqual(
      expect.arrayContaining([
        "request_id",
        "note_id",
        "user_confirmed_generation",
        "user_confirmed_publication",
        "user_confirmed_source_rights",
      ]),
    );

    expect(byName.get_video_status?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(byName.get_video_status?._meta?.securitySchemes).toEqual([
      { type: "oauth2", scopes: [VIDEOS_READ_SCOPE] },
    ]);

    for (const tool of tools) {
      expect(tool.title).toBeTruthy();
      expect(tool.description?.length).toBeGreaterThan(40);
      expect(tool.outputSchema?.type).toBe("object");
      expect(tool._meta).not.toHaveProperty("openai/outputTemplate");
    }
  });
});
