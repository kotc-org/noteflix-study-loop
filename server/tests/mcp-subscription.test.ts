import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

import { createNoteflixMcpServer } from "../src/mcp.js";
import { NoteflixApiError, type CreatedPrivateNote } from "../src/noteflix/client.js";
import { testConfig } from "./fixtures.js";

const UID = "firebase-user-1";
const INPUT = {
  request_id: "550e8400-e29b-41d4-a716-446655440000",
  title: "Cell membranes",
  content_markdown: "# Cell membranes\n\nThe membrane surrounds the cell.",
};
const CREATED: CreatedPrivateNote = {
  id: "note-123",
  title: INPUT.title,
  slug: "cell-membranes",
  url: "https://noteflix.test/ai-notetaker/notes/cell-membranes",
  visibility: "private",
};

async function withClient<T>(
  dependencies: Parameters<typeof createNoteflixMcpServer>[0],
  run: (client: Client) => Promise<T>,
): Promise<T> {
  const server = createNoteflixMcpServer(dependencies);
  const client = new Client({ name: "subscription-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

describe("create_private_note subscription gate", () => {
  it("denies before idempotency or the Noteflix write when the OAuth UID is ineligible", async () => {
    const noteflixClient = {
      requireEligibleSubscription: vi.fn().mockRejectedValue(
        new NoteflixApiError(
          "subscription_required",
          "An active eligible Noteflix subscription is required.",
          true,
        ),
      ),
      createPrivateNote: vi.fn(),
    };
    const idempotency = { run: vi.fn() };

    const result = await withClient({
      uid: UID,
      config: testConfig(),
      idempotency,
      noteflixClient,
    }, (client) => client.callTool({ name: "create_private_note", arguments: INPUT }));

    expect(result).toMatchObject({
      isError: true,
      content: [{
        type: "text",
        text: expect.stringContaining("subscription_required"),
      }],
    });
    expect(noteflixClient.requireEligibleSubscription).toHaveBeenCalledWith(UID);
    expect(idempotency.run).not.toHaveBeenCalled();
    expect(noteflixClient.createPrivateNote).not.toHaveBeenCalled();
  });

  it("checks and forwards only the OAuth-bound UID when the subscription is eligible", async () => {
    const noteflixClient = {
      requireEligibleSubscription: vi.fn().mockResolvedValue(undefined),
      createPrivateNote: vi.fn().mockResolvedValue(CREATED),
    };
    const idempotency = {
      run: vi.fn(async (input: { operation: () => Promise<CreatedPrivateNote> }) => ({
        result: await input.operation(),
        cached: false,
      })),
    };

    const result = await withClient({
      uid: UID,
      config: testConfig(),
      idempotency,
      noteflixClient,
    }, (client) => client.callTool({ name: "create_private_note", arguments: INPUT }));

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      status: "created",
      request_id: INPUT.request_id,
      cached: false,
      note: CREATED,
    });
    expect(noteflixClient.requireEligibleSubscription).toHaveBeenCalledWith(UID);
    expect(noteflixClient.createPrivateNote).toHaveBeenCalledWith(UID, INPUT);
    expect(noteflixClient.requireEligibleSubscription.mock.invocationCallOrder[0])
      .toBeLessThan(idempotency.run.mock.invocationCallOrder[0]!);
    expect(idempotency.run.mock.invocationCallOrder[0])
      .toBeLessThan(noteflixClient.createPrivateNote.mock.invocationCallOrder[0]!);
  });
});
