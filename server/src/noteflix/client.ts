import type { GoogleAuth, IdTokenClient } from "google-auth-library";
import { z } from "zod";

import type { AppConfig } from "../config.js";
import type {
  CreatePrivateNoteInput,
  CreatePublicNoteVideoInput,
  NotebookVideoMode,
  NotebookVideoStyle,
} from "./input.js";
import {
  buildPrivateNotePayload,
  publicVideoSlugSchema,
} from "./input.js";

const createResponseSchema = z
  .object({
    id: z.string().min(1).max(256),
    slug: z.string().max(512).optional().nullable(),
    title: z.string().max(500).optional(),
  })
  .passthrough();

const subscriptionEligibilityResponseSchema = z
  .object({
    userId: z.string().min(1).max(128),
    isPremium: z.literal(true),
  })
  .strict();

const backendIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

const publicVideoCreateResponseSchema = z
  .object({
    id: backendIdSchema,
    noteId: backendIdSchema,
    slug: publicVideoSlugSchema,
    status: z.enum(["pending", "queued"]),
    style: z.enum([
      "whiteboard",
      "watercolor",
      "papercraft",
      "anime",
      "retro",
      "heritage",
    ]),
    mode: z.enum(["brief", "detailed"]),
    privacy: z.literal("public"),
  })
  .strict();

const publicVideoStatusResponseSchema = z
  .object({
    id: backendIdSchema,
    noteId: backendIdSchema,
    slug: publicVideoSlugSchema,
    status: z.string().min(1).max(64),
    progress: z.number().finite(),
    updatedAt: z.string().datetime().nullable(),
    privacy: z.literal("public"),
  })
  .strict();

const videoAllowanceResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    userId: z.string().min(1).max(128).refine((uid) => uid.trim() === uid),
    eligible: z.literal(true),
    canGenerate: z.boolean(),
    reason: z.enum(["available", "limit_reached"]),
    used: z.number().int().nonnegative(),
    reserved: z.number().int().nonnegative(),
    consumed: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    remaining: z.number().int().nonnegative(),
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.used !== value.reserved + value.consumed) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Allowance used count does not match reserved plus consumed",
      });
    }
    if (value.remaining !== Math.max(value.limit - value.used, 0)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Allowance remaining count is invalid",
      });
    }
    if (value.canGenerate !== (value.remaining > 0)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Allowance generation flag is invalid",
      });
    }
  });

const backendErrorSchema = z
  .object({
    error: z.string().max(256).optional(),
    code: z.string().max(128).optional(),
    currentUsage: z.coerce.number().nonnegative().optional(),
    reserved: z.coerce.number().nonnegative().optional(),
    consumed: z.coerce.number().nonnegative().optional(),
    limit: z.coerce.number().nonnegative().optional(),
    remaining: z.coerce.number().nonnegative().optional(),
    resetsAt: z.string().datetime().optional(),
  })
  .strip();
const SUBSCRIPTION_REQUIRED_CODES = new Set([
  "UPGRADE_REQUIRED",
  "SUBSCRIPTION_REQUIRED",
]);
const SUBSCRIPTION_UNAVAILABLE_CODES = new Set([
  "SUBSCRIPTION_VERIFICATION_UNAVAILABLE",
  "SUBSCRIPTION_CHECK_FAILED",
]);
const RESTRICTED_DATA_CHECK_UNAVAILABLE_CODES = new Set([
  "CHECK_UNAVAILABLE",
  "RESTRICTED_DATA_CHECK_UNAVAILABLE",
]);

function backendErrorCode(data: unknown): string | undefined {
  const parsed = backendErrorSchema.safeParse(data);
  return parsed.success ? parsed.data.code : undefined;
}

export type CreatedPrivateNote = {
  id: string;
  title: string;
  slug: string | null;
  url: string;
  visibility: "private";
};

export type RequestedPublicVideo = {
  video_id: string;
  note_id: string;
  slug: string;
  status: "queued";
  style: NotebookVideoStyle;
  mode: NotebookVideoMode;
  privacy: "public";
  url: string;
  ai_generated: true;
};

export type PublicVideoStatus = {
  video_id: string;
  note_id: string;
  slug: string;
  status: "queued" | "processing" | "ready" | "failed";
  progress: number;
  privacy: "public";
  url: string;
  ai_generated: true;
  message: string;
  next_action: "check_again" | "open_video" | "review_failure";
  recommended_check_after_seconds: number | null;
};

export type VideoAllowance = {
  eligible: true;
  can_generate: boolean;
  reason: "available" | "limit_reached";
  used: number;
  in_flight: number;
  completed: number;
  limit: number;
  remaining: number;
  period_start: string;
  resets_at: string;
  message: string;
};

export type SafeNoteflixErrorDetails = {
  current_usage?: number;
  limit?: number;
  remaining?: number;
  resets_at?: string;
  retry_after_seconds?: number;
};

export class NoteflixApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly details?: SafeNoteflixErrorDetails,
  ) {
    super(message);
  }
}

export interface ServiceIdentityProvider {
  getIdTokenClient(targetAudience: string): Promise<Pick<IdTokenClient, "request">>;
}

export class NoteflixClient {
  constructor(
    private readonly config: AppConfig,
    private readonly serviceIdentity: Pick<GoogleAuth, "getIdTokenClient"> | ServiceIdentityProvider,
  ) {}

  /**
   * Re-checks the canonical Noteflix premium entitlement for the exact UID
   * bound to the OAuth access token. This read-only preflight runs before the
   * gateway reserves idempotency or attempts a note write.
   */
  async requireEligibleSubscription(uid: string): Promise<void> {
    const endpoint = new URL(
      "/internal/claude-mcp/subscription-eligibility",
      this.config.noteflixInternalAudience,
    );
    const identityClient = await this.getServiceIdentityClient();

    let response: { status: number; data: unknown };
    try {
      response = await identityClient.request({
        url: endpoint.href,
        method: "GET",
        headers: {
          "x-noteflix-integration": "claude-mcp",
          "x-noteflix-user-id": uid,
        },
        timeout: this.config.noteflixRequestTimeoutMs,
        validateStatus: () => true,
      });
    } catch {
      throw new NoteflixApiError(
        "subscription_check_unavailable",
        "Noteflix could not verify subscription eligibility, so no note was created. Try again later with the same request_id.",
        true,
      );
    }

    if (response.status === 200) {
      const parsed = subscriptionEligibilityResponseSchema.safeParse(response.data);
      if (!parsed.success || parsed.data.userId !== uid) {
        throw new NoteflixApiError(
          "invalid_subscription_response",
          "Noteflix returned an invalid subscription verification response, so no note was created.",
          true,
          response.status,
        );
      }
      return;
    }

    const code = backendErrorCode(response.data);
    if (response.status === 403 && code && SUBSCRIPTION_REQUIRED_CODES.has(code)) {
      throw new NoteflixApiError(
        "subscription_required",
        "This action requires an existing eligible Noteflix subscription. No note was created.",
        true,
        response.status,
      );
    }
    if (code && SUBSCRIPTION_UNAVAILABLE_CODES.has(code)) {
      throw new NoteflixApiError(
        "subscription_check_unavailable",
        "Noteflix could not verify subscription eligibility, so no note was created. Try again later with the same request_id.",
        true,
        response.status,
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new NoteflixApiError(
        "service_identity_unauthorized",
        "Noteflix service authorization is temporarily unavailable, so no note was created.",
        true,
        response.status,
      );
    }
    throw new NoteflixApiError(
      "subscription_check_unavailable",
      "Noteflix could not verify subscription eligibility, so no note was created. Try again later with the same request_id.",
      true,
      response.status,
    );
  }

  async createPrivateNote(
    uid: string,
    input: CreatePrivateNoteInput,
  ): Promise<CreatedPrivateNote> {
    const endpoint = new URL("/internal/claude-mcp/ai-notes", this.config.noteflixInternalAudience);
    const identityClient = await this.getServiceIdentityClient();

    let response: { status: number; data: unknown };
    try {
      response = await identityClient.request({
        url: endpoint.href,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": input.request_id,
          "x-request-id": input.request_id,
          "x-noteflix-integration": "claude-mcp",
        },
        data: {
          ...buildPrivateNotePayload(input),
          // The user binding is supplied by the verified OAuth grant, never by
          // tool input. Keep it last so future payload fields cannot override it.
          noteflixUserId: uid,
        },
        timeout: this.config.noteflixRequestTimeoutMs,
        validateStatus: () => true,
      });
    } catch {
      throw new NoteflixApiError(
        "noteflix_unreachable",
        "Noteflix did not confirm whether the note was created. Check your library before retrying with a new request ID.",
        false,
      );
    }

    if (response.status < 200 || response.status >= 300) {
      const backendCode = backendErrorCode(response.data);
      if (backendCode === "RESTRICTED_DATA_NOT_ALLOWED") {
        throw new NoteflixApiError(
          "restricted_data_not_allowed",
          "This app cannot accept restricted payment, identifiable health, government-ID, or authentication data. No note was created. Replace restricted values with non-identifying placeholders and use a fresh request_id.",
          false,
          response.status,
        );
      }
      if (backendCode && RESTRICTED_DATA_CHECK_UNAVAILABLE_CODES.has(backendCode)) {
        throw new NoteflixApiError(
          "restricted_data_check_unavailable",
          "Noteflix could not complete the required privacy check, so no note was created.",
          true,
          response.status,
        );
      }
      if (backendCode && SUBSCRIPTION_REQUIRED_CODES.has(backendCode)) {
        throw new NoteflixApiError(
          "subscription_required",
          "This action requires an existing eligible Noteflix subscription. No note was created.",
          true,
          response.status,
        );
      }
      if (backendCode && SUBSCRIPTION_UNAVAILABLE_CODES.has(backendCode)) {
        throw new NoteflixApiError(
          "subscription_check_unavailable",
          "Noteflix could not verify subscription eligibility, so no note was created. Try again later with the same request_id.",
          true,
          response.status,
        );
      }
      const retryable = response.status === 429 || response.status === 401 || response.status === 403;
      const code = response.status === 429
        ? "note_limit_reached"
        : response.status === 401 || response.status === 403
          ? "service_identity_unauthorized"
          : `noteflix_http_${response.status}`;
      const message =
        response.status === 429
          ? "Your Noteflix account has reached its current note creation limit."
          : response.status === 401 || response.status === 403
            ? "Noteflix service authorization is temporarily unavailable. No note was created."
            : response.status >= 500
              ? "Noteflix could not create the note right now."
              : "Noteflix rejected the note creation request.";
      throw new NoteflixApiError(code, message, retryable, response.status);
    }

    const parsed = createResponseSchema.safeParse(response.data);
    if (!parsed.success) {
      throw new NoteflixApiError("invalid_noteflix_response", "Noteflix created the request but returned an invalid response. Check your library.", false);
    }
    const segment = parsed.data.slug || parsed.data.id;
    const url = new URL(`/ai-notetaker/notes/${encodeURIComponent(segment)}`, this.config.noteflixAppBaseUrl);
    return {
      id: parsed.data.id,
      title: parsed.data.title || input.title,
      slug: parsed.data.slug || null,
      url: url.href,
      visibility: "private",
    };
  }

  async getVideoAllowance(uid: string): Promise<VideoAllowance> {
    const endpoint = new URL(
      "/internal/claude-media/v2/video-allowance",
      this.config.noteflixInternalAudience,
    );
    const response = await this.mediaRequest(endpoint, uid, "GET");
    if (response.status < 200 || response.status >= 300) {
      this.throwVideoReadError(response.status, response.data, "video_allowance_unavailable");
    }

    const parsed = videoAllowanceResponseSchema.safeParse(response.data);
    if (!parsed.success || parsed.data.userId !== uid) {
      throw new NoteflixApiError(
        parsed.success ? "subscription_identity_mismatch" : "invalid_video_allowance_response",
        "Noteflix could not bind the video allowance to the connected account.",
        false,
        response.status,
      );
    }
    const value = parsed.data;
    return {
      eligible: true,
      can_generate: value.canGenerate,
      reason: value.reason,
      used: value.used,
      in_flight: value.reserved,
      completed: value.consumed,
      limit: value.limit,
      remaining: value.remaining,
      period_start: value.periodStart,
      resets_at: value.periodEnd,
      message: value.remaining > 0
        ? `${value.remaining} of ${value.limit} public-video credits remain this month.`
        : `The monthly public-video allowance is used. It resets ${value.periodEnd}.`,
    };
  }

  async createPublicNoteVideo(
    uid: string,
    input: CreatePublicNoteVideoInput,
  ): Promise<RequestedPublicVideo> {
    const endpoint = new URL(
      `/internal/claude-media/v2/ai-notes/${encodeURIComponent(input.note_id)}/public-notebook-video`,
      this.config.noteflixInternalAudience,
    );
    const identityClient = await this.getServiceIdentityClient();
    let response: { status: number; data: unknown };
    try {
      response = await identityClient.request({
        url: endpoint.href,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": input.request_id,
          "x-request-id": input.request_id,
          "x-noteflix-integration": "claude-media-mcp",
        },
        data: {
          noteflixUserId: uid,
          style: input.style,
          mode: input.mode,
          user_confirmed_publication: input.user_confirmed_publication,
        },
        timeout: this.config.noteflixRequestTimeoutMs,
        validateStatus: () => true,
      });
    } catch {
      throw new NoteflixApiError(
        "video_creation_outcome_unknown",
        "Noteflix did not confirm whether the video was queued. Check the note before using a new request ID.",
        false,
      );
    }

    if (response.status < 200 || response.status >= 300) {
      this.throwVideoCreateError(response.status, response.data);
    }
    const parsed = publicVideoCreateResponseSchema.safeParse(response.data);
    if (
      !parsed.success ||
      parsed.data.noteId !== input.note_id ||
      parsed.data.style !== input.style ||
      parsed.data.mode !== input.mode
    ) {
      throw new NoteflixApiError(
        "invalid_noteflix_response",
        "Noteflix accepted the request but did not return a valid privacy-safe video receipt.",
        false,
        response.status,
      );
    }
    return {
      video_id: parsed.data.id,
      note_id: parsed.data.noteId,
      slug: parsed.data.slug,
      status: "queued",
      style: parsed.data.style,
      mode: parsed.data.mode,
      privacy: "public",
      url: this.publicVideoUrl(parsed.data.slug),
      ai_generated: true,
    };
  }

  async getVideoStatus(uid: string, videoId: string): Promise<PublicVideoStatus> {
    const endpoint = new URL(
      `/internal/claude-media/v2/notebook-videos/${encodeURIComponent(videoId)}/status`,
      this.config.noteflixInternalAudience,
    );
    const response = await this.mediaRequest(endpoint, uid, "GET");
    if (response.status < 200 || response.status >= 300) {
      this.throwVideoReadError(response.status, response.data, "video_status_unavailable");
    }
    const parsed = publicVideoStatusResponseSchema.safeParse(response.data);
    if (!parsed.success || parsed.data.id !== videoId) {
      throw new NoteflixApiError(
        "invalid_video_status_response",
        "Noteflix returned an invalid public-video status response.",
        true,
        response.status,
      );
    }
    const status = this.mapVideoStatus(parsed.data.status);
    const progress = status === "ready"
      ? 100
      : Math.max(0, Math.min(100, Math.round(parsed.data.progress)));
    return {
      video_id: parsed.data.id,
      note_id: parsed.data.noteId,
      slug: parsed.data.slug,
      status,
      progress,
      privacy: "public",
      url: this.publicVideoUrl(parsed.data.slug),
      ai_generated: true,
      message: status === "ready"
        ? "The public AI-generated video is ready in Noteflix."
        : status === "failed"
          ? "Public video generation failed in Noteflix."
          : status === "processing"
            ? "Noteflix is generating the public video."
            : "The public video is queued in Noteflix.",
      next_action: status === "ready"
        ? "open_video"
        : status === "failed"
          ? "review_failure"
          : "check_again",
      recommended_check_after_seconds:
        status === "queued" || status === "processing" ? 20 : null,
    };
  }

  private async mediaRequest(
    endpoint: URL,
    uid: string,
    method: "GET",
  ): Promise<{ status: number; data: unknown }> {
    const identityClient = await this.getServiceIdentityClient();
    try {
      return await identityClient.request({
        url: endpoint.href,
        method,
        headers: {
          "x-noteflix-integration": "claude-media-mcp",
          "x-noteflix-user-id": uid,
        },
        timeout: this.config.noteflixRequestTimeoutMs,
        validateStatus: () => true,
      });
    } catch {
      throw new NoteflixApiError(
        "video_service_unavailable",
        "Noteflix could not complete the video request right now.",
        true,
      );
    }
  }

  private throwVideoReadError(
    status: number,
    data: unknown,
    unavailableCode: string,
  ): never {
    const parsed = backendErrorSchema.safeParse(data);
    const error = parsed.success ? parsed.data : {};
    if (
      status === 403 &&
      (error.code === "UPGRADE_REQUIRED" || error.code === "SUBSCRIPTION_REQUIRED")
    ) {
      throw new NoteflixApiError(
        "active_subscription_required",
        "This feature requires an existing eligible Noteflix subscription.",
        false,
        status,
      );
    }
    if (status === 401 || (status === 403 && error.error === "Forbidden")) {
      throw new NoteflixApiError(
        "internal_service_authorization_failed",
        "Noteflix service authorization is temporarily unavailable.",
        true,
        status,
      );
    }
    if (status === 403 || status === 404) {
      throw new NoteflixApiError(
        "video_not_found",
        "The public Noteflix video was not found for the connected account.",
        false,
        404,
      );
    }
    throw new NoteflixApiError(
      unavailableCode,
      "Noteflix could not complete this video request right now.",
      true,
      status,
    );
  }

  private throwVideoCreateError(status: number, data: unknown): never {
    const parsed = backendErrorSchema.safeParse(data);
    const error = parsed.success ? parsed.data : {};
    if (error.code === "RESTRICTED_DATA_NOT_ALLOWED") {
      throw new NoteflixApiError(
        "restricted_data_not_allowed",
        "The source note contains data this app cannot process. No video was queued and no credit was reserved. Replace restricted values in the source note, then use a fresh request_id.",
        false,
        status,
      );
    }
    if (error.code && RESTRICTED_DATA_CHECK_UNAVAILABLE_CODES.has(error.code)) {
      throw new NoteflixApiError(
        "restricted_data_check_unavailable",
        "Noteflix could not complete the required source privacy check. No video was queued and no credit was reserved.",
        true,
        status,
      );
    }
    if (status === 400 && error.code === "CONTENT_MODERATION_REJECTED") {
      throw new NoteflixApiError(
        "content_moderation_rejected",
        "The source note could not be approved for public video generation.",
        false,
        status,
      );
    }
    if (status === 503 && error.code === "CONTENT_MODERATION_UNAVAILABLE") {
      throw new NoteflixApiError(
        "content_moderation_unavailable",
        "Noteflix could not complete the required public-content safety review. No video was queued.",
        true,
        status,
      );
    }
    if (
      status === 403 &&
      (error.code === "UPGRADE_REQUIRED" || error.code === "SUBSCRIPTION_REQUIRED")
    ) {
      throw new NoteflixApiError(
        "active_subscription_required",
        "Public video generation requires an existing eligible Noteflix subscription.",
        false,
        status,
      );
    }
    if (status === 503 && error.code === "SUBSCRIPTION_VERIFICATION_UNAVAILABLE") {
      throw new NoteflixApiError(
        "subscription_verification_unavailable",
        "Noteflix could not verify subscription eligibility right now.",
        true,
        status,
      );
    }
    if (status === 409 && error.code === "IDEMPOTENCY_CONFLICT") {
      throw new NoteflixApiError(
        "idempotency_conflict",
        "This request ID was already used for a different video request. Use a fresh UUID.",
        false,
        status,
      );
    }
    if (
      status === 429 ||
      error.code === "LIMIT_REACHED" ||
      error.code === "CLAUDE_MEDIA_VIDEO_ALLOWANCE_EXHAUSTED"
    ) {
      throw new NoteflixApiError(
        "video_limit_reached",
        "The connected Noteflix account has no public-video allowance available for this request.",
        error.code === "CLAUDE_MEDIA_VIDEO_ALLOWANCE_EXHAUSTED",
        status,
        {
          ...(error.currentUsage !== undefined ? { current_usage: error.currentUsage } : {}),
          ...(error.limit !== undefined ? { limit: error.limit } : {}),
          ...(error.remaining !== undefined ? { remaining: error.remaining } : {}),
          ...(error.resetsAt !== undefined ? { resets_at: error.resetsAt } : {}),
        },
      );
    }
    if (status === 401 || (status === 403 && error.error === "Forbidden")) {
      throw new NoteflixApiError(
        "internal_service_authorization_failed",
        "Noteflix service authorization is temporarily unavailable.",
        true,
        status,
      );
    }
    if (status === 403 || status === 404) {
      throw new NoteflixApiError(
        "note_not_owned",
        "Public video generation is allowed only for a Noteflix note owned by the connected account.",
        false,
        403,
      );
    }
    if (status === 400) {
      throw new NoteflixApiError(
        "video_request_rejected",
        "Noteflix rejected the public-video request.",
        false,
        status,
      );
    }
    throw new NoteflixApiError(
      status >= 500 ? "video_creation_outcome_unknown" : `noteflix_http_${status}`,
      status >= 500
        ? "Noteflix returned an error without proving that no video was queued. Check the note before using a new request ID."
        : "Noteflix could not queue the public video.",
      false,
      status,
    );
  }

  private mapVideoStatus(raw: string): "queued" | "processing" | "ready" | "failed" {
    const normalized = raw.toLowerCase().trim();
    if (["ready", "complete", "completed", "published"].includes(normalized)) return "ready";
    if (["failed", "error", "cancelled", "canceled"].includes(normalized)) return "failed";
    if (["processing", "rendering", "generating", "in_progress"].includes(normalized)) {
      return "processing";
    }
    return "queued";
  }

  private publicVideoUrl(slug: string): string {
    return new URL(`/watch/${encodeURIComponent(slug)}`, this.config.noteflixAppBaseUrl).href;
  }

  private async getServiceIdentityClient(): Promise<Pick<IdTokenClient, "request">> {
    try {
      return await this.serviceIdentity.getIdTokenClient(
        this.config.noteflixInternalAudience.origin,
      );
    } catch {
      throw new NoteflixApiError(
        "service_identity_unavailable",
        "Noteflix service authorization is temporarily unavailable.",
        true,
      );
    }
  }
}
