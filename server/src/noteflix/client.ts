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

  async createPrivateNote(
    uid: string,
    input: CreatePrivateNoteInput,
  ): Promise<CreatedPrivateNote> {
    const endpoint = new URL("/internal/claude-mcp/ai-notes", this.config.noteflixInternalAudience);
    let identityClient: Pick<IdTokenClient, "request">;
    try {
      identityClient = await this.serviceIdentity.getIdTokenClient(
        this.config.noteflixInternalAudience.origin,
      );
    } catch {
      throw new NoteflixApiError(
        "service_identity_unavailable",
        "Noteflix service authorization is temporarily unavailable.",
        true,
      );
    }

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
          noteflixUserId: uid,
          ...buildPrivateNotePayload(input),
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
      const retryable = response.status === 429 || response.status === 401 || response.status === 403;
      const code = response.status === 429 ? "note_limit_reached" : `noteflix_http_${response.status}`;
      const message =
        response.status === 429
          ? "Your Noteflix account has reached its current note creation limit."
          : response.status === 401 || response.status === 403
            ? "Noteflix did not authorize this note creation. Reconnect the integration."
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
}
