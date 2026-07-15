import { describe, expect, it, vi } from "vitest";

import { NoteflixApiError, NoteflixClient } from "../src/noteflix/client.js";
import { createPrivateNoteInputSchema } from "../src/noteflix/input.js";
import { testConfig } from "./fixtures.js";

describe("Noteflix production API adapter", () => {
  it("uses service OIDC and posts only the user binding plus private integration payload", async () => {
    const config = testConfig();
    const request = vi.fn().mockResolvedValue({
      status: 200,
      data: { id: "note-123", slug: "cell-membranes", title: "Cell membranes", ignored: "secret" },
    });
    const serviceIdentity = { getIdTokenClient: vi.fn().mockResolvedValue({ request }) };
    const client = new NoteflixClient(config, serviceIdentity);
    const input = createPrivateNoteInputSchema().parse({
      request_id: "550e8400-e29b-41d4-a716-446655440000",
      title: "Cell membranes",
      content_markdown: "# Membranes\n\nA phospholipid bilayer encloses the cell.",
    });

    const created = await client.createPrivateNote("firebase-user-1", input);
    expect(serviceIdentity.getIdTokenClient).toHaveBeenCalledWith("https://ainotes.noteflix.test");
    const noteInit = request.mock.calls[0]![0];
    expect(noteInit.url).toBe("https://ainotes.noteflix.test/internal/claude-mcp/ai-notes");
    const payload = noteInit.data;
    expect(payload).toMatchObject({
      noteflixUserId: "firebase-user-1",
      notes: [input.content_markdown],
      summary: "",
      keyPoints: [],
      accessType: "PRIVATE_INVITE",
      isVisible: false,
      isPublic: false,
      visibility: "private",
      integrationSource: "claude-mcp",
      derivedAssets: [],
    });
    expect(Object.keys(payload)).not.toContain("userId");
    expect(new Headers(noteInit.headers).get("idempotency-key")).toBe(input.request_id);
    expect(created).toEqual({
      id: "note-123",
      title: "Cell membranes",
      slug: "cell-membranes",
      url: "https://noteflix.test/ai-notetaker/notes/cell-membranes",
      visibility: "private",
    });
  });

  it("marks service-identity acquisition failures as safely retryable before any write", async () => {
    const serviceIdentity = {
      getIdTokenClient: vi.fn().mockRejectedValue(new Error("metadata unavailable")),
    };
    const client = new NoteflixClient(testConfig(), serviceIdentity);
    const input = createPrivateNoteInputSchema().parse({
      request_id: "550e8400-e29b-41d4-a716-446655440000",
      title: "Cell membranes",
      content_markdown: "Membrane notes",
    });

    const result = client.createPrivateNote("firebase-user-1", input);
    await expect(result).rejects.toBeInstanceOf(NoteflixApiError);
    await expect(result).rejects.toMatchObject({
      code: "service_identity_unavailable",
      retryable: true,
    });
  });
});
