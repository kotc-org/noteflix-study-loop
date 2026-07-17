import { describe, expect, it, vi } from "vitest";

import { NoteflixApiError, NoteflixClient } from "../src/noteflix/client.js";
import {
  createPrivateNoteInputSchema,
  createPublicNoteVideoInputSchema,
} from "../src/noteflix/input.js";
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

  it.each([
    [400, "RESTRICTED_DATA_NOT_ALLOWED", "restricted_data_not_allowed", false],
    [503, "CHECK_UNAVAILABLE", "restricted_data_check_unavailable", true],
  ] as const)(
    "maps note privacy failure %s %s without exposing the backend body",
    async (status, backendCode, expectedCode, retryable) => {
      const client = new NoteflixClient(testConfig(), {
        getIdTokenClient: vi.fn().mockResolvedValue({
          request: vi.fn().mockResolvedValue({
            status,
            data: {
              code: backendCode,
              matchedValue: "must not leak",
              matchedCategory: "must not leak",
            },
          }),
        }),
      });
      const input = createPrivateNoteInputSchema().parse({
        request_id: "550e8400-e29b-41d4-a716-446655440000",
        title: "Cell membranes",
        content_markdown: "Membrane notes",
      });

      const error = await client.createPrivateNote("firebase-user-1", input).catch((cause) => cause);

      expect(error).toMatchObject({
        code: expectedCode,
        retryable,
        status,
      });
      expect(JSON.stringify(error)).not.toContain("matchedValue");
      expect(JSON.stringify(error)).not.toContain("matchedCategory");
      expect(JSON.stringify(error)).not.toContain("must not leak");
    },
  );

  it("reads only privacy-safe video allowance counts for the exact OAuth UID", async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        schemaVersion: 1,
        userId: "firebase-user-1",
        eligible: true,
        canGenerate: true,
        reason: "available",
        used: 3,
        reserved: 1,
        consumed: 2,
        limit: 20,
        remaining: 17,
        periodStart: "2026-07-01T00:00:00.000Z",
        periodEnd: "2026-08-01T00:00:00.000Z",
      },
    });
    const client = new NoteflixClient(testConfig(), {
      getIdTokenClient: vi.fn().mockResolvedValue({ request }),
    });

    const allowance = await client.getVideoAllowance("firebase-user-1");
    expect(allowance).toEqual({
      eligible: true,
      can_generate: true,
      reason: "available",
      used: 3,
      in_flight: 1,
      completed: 2,
      limit: 20,
      remaining: 17,
      period_start: "2026-07-01T00:00:00.000Z",
      resets_at: "2026-08-01T00:00:00.000Z",
      message: "17 of 20 public-video credits remain this month.",
    });
    const init = request.mock.calls[0]![0];
    expect(init.url).toBe(
      "https://ainotes.noteflix.test/internal/claude-media/v2/video-allowance",
    );
    const headers = new Headers(init.headers);
    expect(headers.get("x-noteflix-integration")).toBe("claude-media-mcp");
    expect(headers.get("x-noteflix-user-id")).toBe("firebase-user-1");
    expect(JSON.stringify(allowance)).not.toContain("manage");
    expect(JSON.stringify(allowance)).not.toContain("billing");
  });

  it("fails closed when a video allowance response is for a different UID", async () => {
    const client = new NoteflixClient(testConfig(), {
      getIdTokenClient: vi.fn().mockResolvedValue({
        request: vi.fn().mockResolvedValue({
          status: 200,
          data: {
            schemaVersion: 1,
            userId: "other-user",
            eligible: true,
            canGenerate: true,
            reason: "available",
            used: 0,
            reserved: 0,
            consumed: 0,
            limit: 20,
            remaining: 20,
            periodStart: "2026-07-01T00:00:00.000Z",
            periodEnd: "2026-08-01T00:00:00.000Z",
          },
        }),
      }),
    });

    await expect(client.getVideoAllowance("firebase-user-1")).rejects.toMatchObject({
      code: "subscription_identity_mismatch",
      retryable: false,
    });
  });

  it("queues a public video with exact UID binding and a readable Noteflix slug URL", async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        id: "video-123",
        noteId: "note-123",
        slug: "cell-membranes-explained",
        status: "queued",
        style: "whiteboard",
        mode: "brief",
        privacy: "public",
      },
    });
    const client = new NoteflixClient(testConfig(), {
      getIdTokenClient: vi.fn().mockResolvedValue({ request }),
    });
    const input = createPublicNoteVideoInputSchema.parse({
      request_id: "550e8400-e29b-41d4-a716-446655440000",
      note_id: "note-123",
      style: "whiteboard",
      mode: "brief",
      user_confirmed_generation: true,
      user_confirmed_publication: true,
      user_confirmed_source_rights: true,
    });

    const video = await client.createPublicNoteVideo("firebase-user-1", input);
    expect(video).toEqual({
      video_id: "video-123",
      note_id: "note-123",
      slug: "cell-membranes-explained",
      status: "queued",
      style: "whiteboard",
      mode: "brief",
      privacy: "public",
      url: "https://noteflix.test/watch/cell-membranes-explained",
      ai_generated: true,
    });
    const init = request.mock.calls[0]![0];
    expect(init.url).toBe(
      "https://ainotes.noteflix.test/internal/claude-media/v2/ai-notes/note-123/public-notebook-video",
    );
    expect(init.data).toEqual({
      noteflixUserId: "firebase-user-1",
      style: "whiteboard",
      mode: "brief",
      user_confirmed_publication: true,
    });
    const headers = new Headers(init.headers);
    expect(headers.get("x-noteflix-integration")).toBe("claude-media-mcp");
    expect(headers.get("idempotency-key")).toBe(input.request_id);
    expect(headers.get("x-request-id")).toBe(input.request_id);
  });

  it.each([
    [
      400,
      "RESTRICTED_DATA_NOT_ALLOWED",
      "restricted_data_not_allowed",
      false,
    ],
    [
      503,
      "CHECK_UNAVAILABLE",
      "restricted_data_check_unavailable",
      true,
    ],
    [
      400,
      "CONTENT_MODERATION_REJECTED",
      "content_moderation_rejected",
      false,
    ],
    [
      503,
      "CONTENT_MODERATION_UNAVAILABLE",
      "content_moderation_unavailable",
      true,
    ],
  ] as const)(
    "maps public privacy or safety failure %s %s without exposing the backend body",
    async (status, backendCode, expectedCode, retryable) => {
      const client = new NoteflixClient(testConfig(), {
        getIdTokenClient: vi.fn().mockResolvedValue({
          request: vi.fn().mockResolvedValue({
            status,
            data: { code: backendCode, internalPrompt: "must not leak" },
          }),
        }),
      });
      const input = createPublicNoteVideoInputSchema.parse({
        request_id: "550e8400-e29b-41d4-a716-446655440000",
        note_id: "note-123",
        style: "whiteboard",
        mode: "brief",
        user_confirmed_generation: true,
        user_confirmed_publication: true,
        user_confirmed_source_rights: true,
      });

      const error = await client
        .createPublicNoteVideo("firebase-user-1", input)
        .catch((cause) => cause);

      expect(error).toMatchObject({
        code: expectedCode,
        retryable,
        status,
      });
      expect(JSON.stringify(error)).not.toContain("internalPrompt");
      expect(JSON.stringify(error)).not.toContain("must not leak");
    },
  );

  it("maps a public video status without exposing raw media fields", async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        id: "video-123",
        noteId: "note-123",
        slug: "cell-membranes-explained",
        status: "completed",
        progress: 99.6,
        updatedAt: "2026-07-16T20:00:00.000Z",
        privacy: "public",
      },
    });
    const client = new NoteflixClient(testConfig(), {
      getIdTokenClient: vi.fn().mockResolvedValue({ request }),
    });

    const status = await client.getVideoStatus("firebase-user-1", "video-123");
    expect(status).toMatchObject({
      video_id: "video-123",
      note_id: "note-123",
      slug: "cell-membranes-explained",
      status: "ready",
      progress: 100,
      privacy: "public",
      url: "https://noteflix.test/watch/cell-membranes-explained",
      ai_generated: true,
      next_action: "open_video",
      recommended_check_after_seconds: null,
    });
    expect(JSON.stringify(status)).not.toContain("storage");
    expect(JSON.stringify(status)).not.toContain("download");
  });

  it("returns a neutral gate for ineligible video accounts without an upgrade URL", async () => {
    const client = new NoteflixClient(testConfig(), {
      getIdTokenClient: vi.fn().mockResolvedValue({
        request: vi.fn().mockResolvedValue({
          status: 403,
          data: { code: "UPGRADE_REQUIRED", upgradeUrl: "/subscription" },
        }),
      }),
    });

    const error = await client.getVideoAllowance("firebase-user-1").catch((cause) => cause);
    expect(error).toMatchObject({
      code: "active_subscription_required",
      retryable: false,
      status: 403,
    });
    expect(JSON.stringify(error)).not.toContain("upgradeUrl");
    expect(JSON.stringify(error)).not.toContain("/subscription");
  });
});
