import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { AppConfig } from "./config.js";
import {
  NoteflixApiError,
  type NoteflixClient,
  type SafeNoteflixErrorDetails,
} from "./noteflix/client.js";
import {
  createPrivateNoteInputSchema,
  createPublicNoteVideoInputSchema,
  getVideoAllowanceInputSchema,
  getVideoStatusInputSchema,
  publicVideoSlugSchema,
} from "./noteflix/input.js";
import { installToolSecuritySchemeCompatibility } from "./mcp-compat.js";
import {
  NOTES_CREATE_SCOPE,
  VIDEOS_CREATE_SCOPE,
  VIDEOS_PUBLISH_SCOPE,
  VIDEOS_READ_SCOPE,
} from "./oauth/policy.js";
import type { IdempotencyCoordinator } from "./persistence/idempotency.js";
import { IdempotencyError, privateNoteInputHash } from "./persistence/idempotency.js";
import { containsRestrictedData } from "./security/restricted-data.js";

const createNoteOutputSchema = z.object({
  status: z.literal("created"),
  cached: z.boolean(),
  note: z.object({
    id: z.string(),
    title: z.string(),
    slug: z.string().nullable(),
    url: z.string().url(),
    visibility: z.literal("private"),
  }),
});

const allowanceOutputSchema = z.object({
  eligible: z.literal(true),
  can_generate: z.boolean(),
  reason: z.enum(["available", "limit_reached"]),
  used: z.number().int().nonnegative(),
  in_flight: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  remaining: z.number().int().nonnegative(),
  period_start: z.string().datetime(),
  resets_at: z.string().datetime(),
  message: z.string(),
});

const createVideoOutputSchema = z.object({
  status: z.literal("queued"),
  video: z.object({
    video_id: z.string(),
    note_id: z.string(),
    slug: publicVideoSlugSchema,
    status: z.literal("queued"),
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
    url: z.string().url(),
    ai_generated: z.literal(true),
  }),
});

const videoStatusOutputSchema = z.object({
  video_id: z.string(),
  note_id: z.string(),
  slug: publicVideoSlugSchema,
  status: z.enum(["queued", "processing", "ready", "failed"]),
  progress: z.number().int().min(0).max(100),
  privacy: z.literal("public"),
  url: z.string().url(),
  ai_generated: z.literal(true),
  message: z.string(),
  next_action: z.enum(["check_again", "open_video", "review_failure"]),
  recommended_check_after_seconds: z.number().int().positive().nullable(),
});

type OAuthSecurityScheme = { type: "oauth2"; scopes: string[] };

function oauthToolMeta(scopes: string[], invoking: string, invoked: string) {
  const securitySchemes: OAuthSecurityScheme[] = [{ type: "oauth2", scopes }];
  return {
    securitySchemes,
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": invoked,
  };
}

function missingScopes(granted: readonly string[], required: readonly string[]): string[] {
  return required.filter((scope) => !granted.includes(scope));
}

function oauthChallenge(config: AppConfig, scopes: readonly string[]): string {
  const metadata = new URL(
    "/.well-known/oauth-protected-resource/mcp",
    config.publicBaseUrl,
  );
  return `Bearer error="insufficient_scope", scope="${scopes.join(" ")}", resource_metadata="${metadata.href}"`;
}

function scopeError(config: AppConfig, granted: readonly string[], required: readonly string[]) {
  const missing = missingScopes(granted, required);
  if (missing.length === 0) return undefined;
  return {
    isError: true as const,
    content: [{
      type: "text" as const,
      text: `Reconnect Noteflix and grant the required permission${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`,
    }],
    _meta: {
      "mcp/www_authenticate": oauthChallenge(config, required),
    },
  };
}

function safeErrorText(error: {
  code: string;
  message: string;
  retryable: boolean;
  details?: SafeNoteflixErrorDetails;
}, retryUsesRequestId = false): string {
  const usage = error.details?.current_usage !== undefined && error.details.limit !== undefined
    ? ` Usage: ${error.details.current_usage} of ${error.details.limit}.`
    : "";
  const reset = error.details?.resets_at ? ` Resets: ${error.details.resets_at}.` : "";
  const wait = error.details?.retry_after_seconds !== undefined
    ? ` Try again in about ${error.details.retry_after_seconds} seconds.`
    : "";
  const retry = error.retryable && retryUsesRequestId
    ? " A safe retry must use the same request_id with identical inputs."
    : "";
  return `${error.message}${usage}${reset}${wait} Error code: ${error.code}.${retry}`;
}

export function createNoteflixMcpServer(dependencies: {
  uid: string;
  scopes: readonly string[];
  config: AppConfig;
  noteflixClient: Pick<
    NoteflixClient,
    | "createPrivateNote"
    | "requireEligibleSubscription"
    | "getVideoAllowance"
    | "createPublicNoteVideo"
    | "getVideoStatus"
  >;
  idempotency: Pick<IdempotencyCoordinator, "run">;
  generationRateLimit: () => Promise<{ allowed: boolean; retryAfterSeconds: number }>;
}): McpServer {
  const server = new McpServer({
    name: "noteflix-study-and-video",
    version: "1.0.0",
  });
  const createNoteInputSchema = createPrivateNoteInputSchema(
    dependencies.config.maxNoteContentChars,
  );

  server.registerTool(
    "create_private_note",
    {
      title: "Create a private Noteflix note",
      description:
        "Creates one private note in the exact OAuth-connected user's real Noteflix library. Call only after the user explicitly asks to save the exact title and Markdown content. Never send payment-card data, identifiable health information, government identifiers, passwords, API keys, authentication tokens, or verification codes. The note remains private and is not published, shared, or rendered into a video. Requires an existing eligible Noteflix account. Safe retries must reuse the same request_id with identical content.",
      inputSchema: createNoteInputSchema,
      outputSchema: createNoteOutputSchema,
      annotations: {
        title: "Create a private Noteflix note",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: oauthToolMeta(
        [NOTES_CREATE_SCOPE],
        "Saving private note…",
        "Private note saved",
      ),
    },
    async (untrustedInput) => {
      const authError = scopeError(
        dependencies.config,
        dependencies.scopes,
        [NOTES_CREATE_SCOPE],
      );
      if (authError) return authError;

      const parsed = createNoteInputSchema.safeParse(untrustedInput);
      if (!parsed.success) {
        const invalidFields = [...new Set(
          parsed.error.issues
            .map((issue) => issue.path[0])
            .filter((field): field is string | number =>
              typeof field === "string" || typeof field === "number")
            .map(String),
        )];
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `Noteflix did not create a note because ${
              invalidFields.length > 0
                ? `these fields were invalid: ${invalidFields.join(", ")}`
                : "the tool input was invalid"
            }.`,
          }],
        };
      }

      let restrictedDataDetected: boolean;
      try {
        restrictedDataDetected = containsRestrictedData([
          parsed.data.title,
          parsed.data.content_markdown,
          parsed.data.summary,
          ...(parsed.data.key_points ?? []),
        ]);
      } catch {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: "Noteflix could not complete the required privacy check, so no note was created. Try again later with the same request_id and identical inputs. Error code: restricted_data_check_unavailable.",
          }],
        };
      }
      if (restrictedDataDetected) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: "This app cannot accept payment-card data, identifiable health information, government identifiers, passwords, API keys, authentication tokens, or verification codes. No note was created. Replace restricted values with non-identifying placeholders and use a fresh request_id. Error code: restricted_data_not_allowed.",
          }],
        };
      }

      try {
        await dependencies.noteflixClient.requireEligibleSubscription(dependencies.uid);
        const completed = await dependencies.idempotency.run({
          uid: dependencies.uid,
          requestId: parsed.data.request_id,
          inputHash: privateNoteInputHash(parsed.data),
          operation: () => dependencies.noteflixClient.createPrivateNote(
            dependencies.uid,
            parsed.data,
          ),
        });
        const structuredContent = {
          status: "created" as const,
          cached: completed.cached,
          note: completed.result,
        };
        return {
          structuredContent,
          content: [{
            type: "text" as const,
            text: `${completed.cached ? "Found the existing" : "Created a"} private Noteflix note: ${completed.result.title} (${completed.result.url})`,
          }],
        };
      } catch (cause) {
        const error = cause instanceof IdempotencyError || cause instanceof NoteflixApiError
          ? cause
          : new IdempotencyError(
              "note_creation_failed",
              "Noteflix could not create the private note.",
              false,
            );
        return {
          isError: true,
          content: [{ type: "text" as const, text: safeErrorText(error, true) }],
        };
      }
    },
  );

  server.registerTool(
    "get_video_allowance",
    {
      title: "Check public-video allowance",
      description:
        "Reads the exact OAuth-connected Noteflix account's monthly public-video allowance. Call before proposing generation so the user can see the one-credit impact, remaining credits, in-flight renders, and UTC reset time. It never consumes a credit and never returns plan, product, billing-provider, email, purchase, or entitlement details.",
      inputSchema: getVideoAllowanceInputSchema,
      outputSchema: allowanceOutputSchema,
      annotations: {
        title: "Check public-video allowance",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: oauthToolMeta(
        [VIDEOS_READ_SCOPE],
        "Checking video allowance…",
        "Video allowance checked",
      ),
    },
    async (untrustedInput) => {
      const authError = scopeError(
        dependencies.config,
        dependencies.scopes,
        [VIDEOS_READ_SCOPE],
      );
      if (authError) return authError;
      if (!getVideoAllowanceInputSchema.safeParse(untrustedInput).success) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: "The allowance input was invalid." }],
        };
      }
      try {
        const result = await dependencies.noteflixClient.getVideoAllowance(dependencies.uid);
        return {
          structuredContent: result,
          content: [{
            type: "text" as const,
            text: `${result.message} ${result.in_flight} currently in flight. Resets ${result.resets_at}.`,
          }],
        };
      } catch (cause) {
        const error = cause instanceof NoteflixApiError
          ? cause
          : new NoteflixApiError(
              "video_allowance_unavailable",
              "Noteflix could not check the public-video allowance right now.",
              true,
            );
        return {
          isError: true,
          content: [{ type: "text" as const, text: safeErrorText(error) }],
        };
      }
    },
  );

  server.registerTool(
    "create_public_note_video",
    {
      title: "Create and publish a Noteflix note video",
      description:
        "Reserves one monthly public-video credit and queues one AI-generated public video from a private note owned by the exact OAuth-connected user. The source note must not contain payment-card data, identifiable health information, government identifiers, passwords, API keys, authentication tokens, or verification codes. First call get_video_allowance. Then show the note, style, mode, one-credit impact, that the source must be owned or permitted, and that the result will be public, shareable, and potentially discoverable. Call only after the user explicitly accepts all three facts in the current conversation; all confirmation fields must be true. Never call automatically after creating a note. Failed or abandoned renders refund the reserved credit. A retry must reuse the same request_id and identical inputs. Returns a readable Noteflix watch page, never a raw media URL.",
      inputSchema: createPublicNoteVideoInputSchema,
      outputSchema: createVideoOutputSchema,
      annotations: {
        title: "Create and publish a Noteflix note video",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: oauthToolMeta(
        [VIDEOS_CREATE_SCOPE, VIDEOS_PUBLISH_SCOPE],
        "Queuing public AI video…",
        "Public AI video queued",
      ),
    },
    async (untrustedInput) => {
      const authError = scopeError(
        dependencies.config,
        dependencies.scopes,
        [VIDEOS_CREATE_SCOPE, VIDEOS_PUBLISH_SCOPE],
      );
      if (authError) return authError;
      const parsed = createPublicNoteVideoInputSchema.safeParse(untrustedInput);
      if (!parsed.success) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: "Noteflix did not request a public video because the input or explicit confirmations were invalid.",
          }],
        };
      }

      try {
        await dependencies.noteflixClient.requireEligibleSubscription(dependencies.uid);
        const rate = await dependencies.generationRateLimit();
        if (!rate.allowed) {
          throw new NoteflixApiError(
            "video_generation_rate_limited",
            "The connected account reached the short-term public-video safety limit.",
            true,
            429,
            { retry_after_seconds: rate.retryAfterSeconds },
          );
        }
        const video = await dependencies.noteflixClient.createPublicNoteVideo(
          dependencies.uid,
          parsed.data,
        );
        return {
          structuredContent: { status: "queued" as const, video },
          content: [{
            type: "text" as const,
            text: `Queued one public AI-generated Noteflix video and reserved one credit. Follow it at ${video.url}.`,
          }],
        };
      } catch (cause) {
        const error = cause instanceof NoteflixApiError
          ? cause
          : new NoteflixApiError(
              "video_creation_failed",
              "Noteflix could not queue the public video.",
              false,
            );
        return {
          isError: true,
          content: [{ type: "text" as const, text: safeErrorText(error, true) }],
        };
      }
    },
  );

  server.registerTool(
    "get_video_status",
    {
      title: "Check a Noteflix public-video status",
      description:
        "Checks generation and publication status for a public AI-generated Noteflix video owned by the exact OAuth-connected user. Returns queued, processing, ready, or failed plus its readable public Noteflix watch page. It never returns storage, download-token, provider, prompt, or raw media URLs.",
      inputSchema: getVideoStatusInputSchema,
      outputSchema: videoStatusOutputSchema,
      annotations: {
        title: "Check a Noteflix public-video status",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: oauthToolMeta(
        [VIDEOS_READ_SCOPE],
        "Checking public video…",
        "Public video checked",
      ),
    },
    async (untrustedInput) => {
      const authError = scopeError(
        dependencies.config,
        dependencies.scopes,
        [VIDEOS_READ_SCOPE],
      );
      if (authError) return authError;
      const parsed = getVideoStatusInputSchema.safeParse(untrustedInput);
      if (!parsed.success) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: "The Noteflix video_id was invalid." }],
        };
      }
      try {
        const result = await dependencies.noteflixClient.getVideoStatus(
          dependencies.uid,
          parsed.data.video_id,
        );
        return {
          structuredContent: result,
          content: [{
            type: "text" as const,
            text: `${result.message} Progress: ${result.progress}%. Open Noteflix: ${result.url}`,
          }],
        };
      } catch (cause) {
        const error = cause instanceof NoteflixApiError
          ? cause
          : new NoteflixApiError(
              "video_status_unavailable",
              "Noteflix could not check the public video right now.",
              true,
            );
        return {
          isError: true,
          content: [{ type: "text" as const, text: safeErrorText(error) }],
        };
      }
    },
  );

  installToolSecuritySchemeCompatibility(server);
  return server;
}
