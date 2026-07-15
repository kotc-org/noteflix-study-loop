import { describe, expect, it, vi } from "vitest";

import { NoteflixApiError, NoteflixClient } from "../src/noteflix/client.js";
import { createPrivateNoteInputSchema } from "../src/noteflix/input.js";
import { testConfig } from "./fixtures.js";

describe("Noteflix production API adapter", () => {
  it("preflights the canonical subscription gate with service OIDC and the exact OAuth UID", async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      data: { userId: "firebase-user-1", isPremium: true },
    });
    const serviceIdentity = { getIdTokenClient: vi.fn().mockResolvedValue({ request }) };
    const client = new NoteflixClient(testConfig(), serviceIdentity);

    await expect(client.requireEligibleSubscription("firebase-user-1")).resolves.toBeUndefined();

    expect(serviceIdentity.getIdTokenClient).toHaveBeenCalledWith("https://ainotes.noteflix.test");
    expect(request).toHaveBeenCalledTimes(1);
    const preflight = request.mock.calls[0]![0];
    expect(preflight).toMatchObject({
      url: "https://ainotes.noteflix.test/internal/claude-mcp/subscription-eligibility",
      method: "GET",
      timeout: testConfig().noteflixRequestTimeoutMs,
    });
    const headers = new Headers(preflight.headers);
    expect(headers.get("x-noteflix-integration")).toBe("claude-mcp");
    expect(headers.get("x-noteflix-user-id")).toBe("firebase-user-1");
    expect(preflight.data).toBeUndefined();
  });

  it.each([
    [403, { code: "UPGRADE_REQUIRED", error: "Premium subscription required" }, "subscription_required"],
    [403, { code: "SUBSCRIPTION_REQUIRED", error: "Subscription required" }, "subscription_required"],
    [503, { code: "SUBSCRIPTION_VERIFICATION_UNAVAILABLE" }, "subscription_check_unavailable"],
    [503, { code: "SUBSCRIPTION_CHECK_FAILED" }, "subscription_check_unavailable"],
    [401, { error: "Unauthorized" }, "service_identity_unauthorized"],
    [403, { error: "Forbidden" }, "service_identity_unauthorized"],
  ])("fails closed for subscription preflight status %s as %s", async (status, data, expectedCode) => {
    const request = vi.fn().mockResolvedValue({ status, data });
    const client = new NoteflixClient(testConfig(), {
      getIdTokenClient: vi.fn().mockResolvedValue({ request }),
    });

    await expect(client.requireEligibleSubscription("firebase-user-1")).rejects.toMatchObject({
      code: expectedCode,
      retryable: true,
      status,
    });
  });

  it("fails closed on a mismatched, non-premium, or non-exact preflight response", async () => {
    for (const data of [
      { userId: "other-user", isPremium: true },
      { userId: "firebase-user-1", isPremium: false },
      { userId: "firebase-user-1", isPremium: true, extra: "not allowed" },
    ]) {
      const request = vi.fn().mockResolvedValue({ status: 200, data });
      const client = new NoteflixClient(testConfig(), {
        getIdTokenClient: vi.fn().mockResolvedValue({ request }),
      });
      await expect(client.requireEligibleSubscription("firebase-user-1")).rejects.toMatchObject({
        code: "invalid_subscription_response",
        retryable: true,
      });
    }
  });

  it("treats an unreachable preflight as a retryable fail-closed denial", async () => {
    const client = new NoteflixClient(testConfig(), {
      getIdTokenClient: vi.fn().mockResolvedValue({
        request: vi.fn().mockRejectedValue(new Error("timeout")),
      }),
    });

    await expect(client.requireEligibleSubscription("firebase-user-1")).rejects.toMatchObject({
      code: "subscription_check_unavailable",
      retryable: true,
    });
  });

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

  it.each([
    [403, "UPGRADE_REQUIRED", "subscription_required"],
    [403, "SUBSCRIPTION_REQUIRED", "subscription_required"],
    [503, "SUBSCRIPTION_VERIFICATION_UNAVAILABLE", "subscription_check_unavailable"],
    [503, "SUBSCRIPTION_CHECK_FAILED", "subscription_check_unavailable"],
  ])("maps a create-time subscription race (%s %s) without claiming a write", async (status, code, expectedCode) => {
    const client = new NoteflixClient(testConfig(), {
      getIdTokenClient: vi.fn().mockResolvedValue({
        request: vi.fn().mockResolvedValue({ status, data: { code } }),
      }),
    });
    const input = createPrivateNoteInputSchema().parse({
      request_id: "550e8400-e29b-41d4-a716-446655440000",
      title: "Cell membranes",
      content_markdown: "Membrane notes",
    });

    await expect(client.createPrivateNote("firebase-user-1", input)).rejects.toMatchObject({
      code: expectedCode,
      retryable: true,
      status,
    });
  });

  it.each([401, 403])("keeps create-time service identity denial distinct from user OAuth (%s)", async (status) => {
    const client = new NoteflixClient(testConfig(), {
      getIdTokenClient: vi.fn().mockResolvedValue({
        request: vi.fn().mockResolvedValue({ status, data: { error: "Forbidden" } }),
      }),
    });
    const input = createPrivateNoteInputSchema().parse({
      request_id: "550e8400-e29b-41d4-a716-446655440000",
      title: "Cell membranes",
      content_markdown: "Membrane notes",
    });

    await expect(client.createPrivateNote("firebase-user-1", input)).rejects.toMatchObject({
      code: "service_identity_unauthorized",
      retryable: true,
      status,
    });
  });
});
