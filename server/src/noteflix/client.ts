import type { GoogleAuth, IdTokenClient } from "google-auth-library";
import { z } from "zod";

import type { AppConfig } from "../config.js";
import type { CreatePrivateNoteInput } from "./input.js";
import { buildPrivateNotePayload } from "./input.js";

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

const backendErrorSchema = z.object({ code: z.string() }).passthrough();
const SUBSCRIPTION_REQUIRED_CODES = new Set([
  "UPGRADE_REQUIRED",
  "SUBSCRIPTION_REQUIRED",
]);
const SUBSCRIPTION_UNAVAILABLE_CODES = new Set([
  "SUBSCRIPTION_VERIFICATION_UNAVAILABLE",
  "SUBSCRIPTION_CHECK_FAILED",
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

export class NoteflixApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
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
        "An active eligible Noteflix subscription is required to create notes through Claude. Subscribe or restore purchases in Noteflix, then retry with the same request_id.",
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
      if (backendCode && SUBSCRIPTION_REQUIRED_CODES.has(backendCode)) {
        throw new NoteflixApiError(
          "subscription_required",
          "An active eligible Noteflix subscription is required to create notes through Claude. No note was created.",
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
