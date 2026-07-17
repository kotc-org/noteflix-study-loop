import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

import { createNoteflixMcpServer } from "../src/mcp.js";
import type {
  RequestedPublicVideo,
  VideoAllowance,
} from "../src/noteflix/client.js";
import { NoteflixApiError } from "../src/noteflix/client.js";
import {
  VIDEOS_CREATE_SCOPE,
  VIDEOS_PUBLISH_SCOPE,
  VIDEOS_READ_SCOPE,
} from "../src/oauth/policy.js";
import { testConfig } from "./fixtures.js";

const UID = "video-user-1";
const REQUEST = {
  request_id: "550e8400-e29b-41d4-a716-446655440000",
  note_id: "note-123",
  style: "whiteboard" as const,
  mode: "brief" as const,
  user_confirmed_generation: true as const,
  user_confirmed_publication: true as const,
  user_confirmed_source_rights: true as const,
};

const VIDEO: RequestedPublicVideo = {
  video_id: "video-123",
  note_id: REQUEST.note_id,
  slug: "cell-membranes-explained",
  status: "queued",
  style: REQUEST.style,
  mode: REQUEST.mode,
  privacy: "public",
  url: "https://noteflix.test/watch/cell-membranes-explained",
  ai_generated: true,
};

const ALLOWANCE: VideoAllowance = {
  eligible: true,
  can_generate: true,
  reason: "available",
  used: 2,
  in_flight: 1,
  completed: 1,
  limit: 20,
  remaining: 18,
  period_start: "2026-07-01T00:00:00.000Z",
  resets_at: "2026-08-01T00:00:00.000Z",
  message: "18 of 20 public-video credits remain this month.",
};

function clients() {
  return {
    requireEligibleSubscription: vi.fn().mockResolvedValue(undefined),
    createPrivateNote: vi.fn(),
    getVideoAllowance: vi.fn().mockResolvedValue(ALLOWANCE),
    createPublicNoteVideo: vi.fn().mockResolvedValue(VIDEO),
    getVideoStatus: vi.fn(),
  };
}

async function callTool(
  scopes: string[],
  noteflixClient: ReturnType<typeof clients>,
  name: string,
  args: Record<string, unknown>,
  rate = { allowed: true, retryAfterSeconds: 0 },
) {
  const generationRateLimit = vi.fn().mockResolvedValue(rate);
  const server = createNoteflixMcpServer({
    uid: UID,
    scopes,
    config: testConfig(),
    noteflixClient,
    idempotency: { run: vi.fn() },
    generationRateLimit,
  });
  const client = new Client({ name: "video-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return {
      result: await client.callTool({ name, arguments: args }),
      generationRateLimit,
    };
  } finally {
    await client.close();
    await server.close();
  }
}

describe("public video MCP safety contract", () => {
  it("reads an exact-user allowance without exposing billing or upgrade fields", async () => {
    const noteflixClient = clients();
    const { result } = await callTool(
      [VIDEOS_READ_SCOPE],
      noteflixClient,
      "get_video_allowance",
      {},
    );

    expect(result).toMatchObject({ structuredContent: ALLOWANCE });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("manage_url");
    expect(serialized).not.toContain("upgrade_url");
    expect(serialized).not.toContain("subscription");
    expect(noteflixClient.getVideoAllowance).toHaveBeenCalledWith(UID);
  });

  it("rejects generation until all three current-conversation confirmations are true", async () => {
    const noteflixClient = clients();
    const { result, generationRateLimit } = await callTool(
      [VIDEOS_CREATE_SCOPE, VIDEOS_PUBLISH_SCOPE],
      noteflixClient,
      "create_public_note_video",
      { ...REQUEST, user_confirmed_publication: false },
    );

    expect(result).toMatchObject({ isError: true });
    expect(noteflixClient.requireEligibleSubscription).not.toHaveBeenCalled();
    expect(noteflixClient.createPublicNoteVideo).not.toHaveBeenCalled();
    expect(generationRateLimit).not.toHaveBeenCalled();
  });

  it("uses only the OAuth-bound UID after eligibility and rate checks", async () => {
    const noteflixClient = clients();
    const { result, generationRateLimit } = await callTool(
      [VIDEOS_CREATE_SCOPE, VIDEOS_PUBLISH_SCOPE],
      noteflixClient,
      "create_public_note_video",
      REQUEST,
    );

    expect(result).toMatchObject({
      structuredContent: { status: "queued", video: VIDEO },
    });
    expect(noteflixClient.requireEligibleSubscription).toHaveBeenCalledWith(UID);
    expect(generationRateLimit).toHaveBeenCalledOnce();
    expect(noteflixClient.createPublicNoteVideo).toHaveBeenCalledWith(UID, REQUEST);
  });

  it("returns a tool-level OAuth challenge and performs no write when scopes are missing", async () => {
    const noteflixClient = clients();
    const { result, generationRateLimit } = await callTool(
      [VIDEOS_READ_SCOPE],
      noteflixClient,
      "create_public_note_video",
      REQUEST,
    );

    expect(result).toMatchObject({
      isError: true,
      _meta: {
        "mcp/www_authenticate": expect.stringContaining("insufficient_scope"),
      },
    });
    expect(noteflixClient.requireEligibleSubscription).not.toHaveBeenCalled();
    expect(noteflixClient.createPublicNoteVideo).not.toHaveBeenCalled();
    expect(generationRateLimit).not.toHaveBeenCalled();
  });

  it("does not give request-ID retry guidance for a read-only allowance failure", async () => {
    const noteflixClient = clients();
    noteflixClient.getVideoAllowance.mockRejectedValue(
      new NoteflixApiError(
        "video_allowance_unavailable",
        "Noteflix could not check the public-video allowance right now.",
        true,
      ),
    );

    const { result } = await callTool(
      [VIDEOS_READ_SCOPE],
      noteflixClient,
      "get_video_allowance",
      {},
    );

    expect(result).toMatchObject({ isError: true });
    expect(JSON.stringify(result)).not.toContain("request_id");
  });

  it("reports the short-term wait and preserves request-ID guidance for a throttled write", async () => {
    const noteflixClient = clients();
    const { result } = await callTool(
      [VIDEOS_CREATE_SCOPE, VIDEOS_PUBLISH_SCOPE],
      noteflixClient,
      "create_public_note_video",
      REQUEST,
      { allowed: false, retryAfterSeconds: 37 },
    );

    expect(result).toMatchObject({ isError: true });
    expect(JSON.stringify(result)).toContain("37 seconds");
    expect(JSON.stringify(result)).toContain("same request_id");
    expect(noteflixClient.createPublicNoteVideo).not.toHaveBeenCalled();
  });
});
