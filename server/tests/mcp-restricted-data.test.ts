import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

import { createNoteflixMcpServer } from "../src/mcp.js";
import type { CreatedPrivateNote } from "../src/noteflix/client.js";
import { NOTES_CREATE_SCOPE } from "../src/oauth/policy.js";
import { testConfig } from "./fixtures.js";

const UID = "restricted-data-user";
const REQUEST_ID = "550e8400-e29b-41d4-a716-446655440000";
const CREATED: CreatedPrivateNote = {
  id: "note-123",
  title: "Medical ethics",
  slug: "medical-ethics",
  url: "https://noteflix.test/ai-notetaker/notes/medical-ethics",
  visibility: "private",
};

function dependencies() {
  const noteflixClient = {
    requireEligibleSubscription: vi.fn().mockResolvedValue(undefined),
    createPrivateNote: vi.fn().mockResolvedValue(CREATED),
    getVideoAllowance: vi.fn(),
    createPublicNoteVideo: vi.fn(),
    getVideoStatus: vi.fn(),
  };
  const idempotency = {
    run: vi.fn(async (input: { operation: () => Promise<CreatedPrivateNote> }) => ({
      result: await input.operation(),
      cached: false,
    })),
  };
  return { noteflixClient, idempotency };
}

async function createPrivateNote(
  args: Record<string, unknown>,
  runtime: ReturnType<typeof dependencies>,
) {
  const server = createNoteflixMcpServer({
    uid: UID,
    scopes: [NOTES_CREATE_SCOPE],
    config: testConfig(),
    ...runtime,
    generationRateLimit: vi.fn().mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
    }),
  });
  const client = new Client({ name: "restricted-data-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await client.callTool({ name: "create_private_note", arguments: args });
  } finally {
    await client.close();
    await server.close();
  }
}

describe("create_private_note restricted-data boundary", () => {
  it.each([
    ["title", { title: "SSN: 123-45-6789" }, "123-45-6789"],
    ["content", { content_markdown: "Card number: 4242 4242 4242 4242" }, "4242 4242 4242 4242"],
    ["summary", { summary: "Password: CorrectHorseBatteryStaple" }, "CorrectHorseBatteryStaple"],
    ["key points", { key_points: ["MRN: A1234567"] }, "A1234567"],
  ])("rejects restricted data in %s before eligibility or idempotency", async (_field, patch, secret) => {
    const runtime = dependencies();
    const result = await createPrivateNote({
      request_id: REQUEST_ID,
      title: "Medical ethics",
      content_markdown: "A general discussion of medical ethics and informed consent.",
      ...patch,
    }, runtime);

    expect(result).toMatchObject({ isError: true });
    const serialized = JSON.stringify(result);
    expect(serialized).toContain("restricted_data_not_allowed");
    expect(serialized).toContain("No note was created");
    expect(serialized).not.toContain(secret);
    expect(runtime.noteflixClient.requireEligibleSubscription).not.toHaveBeenCalled();
    expect(runtime.idempotency.run).not.toHaveBeenCalled();
    expect(runtime.noteflixClient.createPrivateNote).not.toHaveBeenCalled();
  });

  it("allows ordinary medical and legal study content", async () => {
    const runtime = dependencies();
    const result = await createPrivateNote({
      request_id: REQUEST_ID,
      title: "Medical ethics",
      content_markdown: [
        "# Informed consent",
        "A 45-year-old patient considers two treatment options.",
        "Compare autonomy and beneficence, then review the general HIPAA definition of PHI.",
      ].join("\n\n"),
    }, runtime);

    expect(result).toMatchObject({
      structuredContent: {
        status: "created",
        cached: false,
        note: CREATED,
      },
    });
    expect(runtime.noteflixClient.requireEligibleSubscription).toHaveBeenCalledWith(UID);
    expect(runtime.idempotency.run).toHaveBeenCalledOnce();
    expect(runtime.noteflixClient.createPrivateNote).toHaveBeenCalledOnce();
  });
});
