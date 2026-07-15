import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { AppConfig } from "./config.js";
import type { NoteflixClient } from "./noteflix/client.js";
import { createPrivateNoteInputSchema } from "./noteflix/input.js";
import type { IdempotencyCoordinator } from "./persistence/idempotency.js";
import { IdempotencyError, privateNoteInputHash } from "./persistence/idempotency.js";

const outputSchema = z.object({
  status: z.literal("created"),
  request_id: z.string().uuid(),
  cached: z.boolean(),
  note: z.object({
    id: z.string(),
    title: z.string(),
    slug: z.string().nullable(),
    url: z.string().url(),
    visibility: z.literal("private"),
  }),
});

export function createNoteflixMcpServer(dependencies: {
  uid: string;
  config: AppConfig;
  noteflixClient: Pick<NoteflixClient, "createPrivateNote">;
  idempotency: IdempotencyCoordinator;
}): McpServer {
  const server = new McpServer({
    name: "noteflix-study-loop",
    version: "0.2.0",
  });
  const inputSchema = createPrivateNoteInputSchema(dependencies.config.maxNoteContentChars);

  server.registerTool(
    "create_private_note",
    {
      title: "Create a private Noteflix note",
      description:
        "Creates one private note in the connected user's real Noteflix library from content_markdown. Use only after the user asks to save or create the note. Requires a fresh UUID request_id, and safe retries must reuse the same UUID with identical content. The tool cannot publish notes, add collaborators, or request arbitrary derived assets.",
      inputSchema,
      outputSchema,
      annotations: {
        title: "Create a private Noteflix note",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (untrustedInput) => {
      const parsed = inputSchema.safeParse(untrustedInput);
      if (!parsed.success) {
        const invalidFields = [...new Set(
          parsed.error.issues
            .map((issue) => issue.path[0])
            .filter((field): field is string | number => typeof field === "string" || typeof field === "number")
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
            }. Review the tool schema and try again with the same request_id only if the intended content is unchanged.`,
          }],
        };
      }

      try {
        const completed = await dependencies.idempotency.run({
          uid: dependencies.uid,
          requestId: parsed.data.request_id,
          inputHash: privateNoteInputHash(parsed.data),
          operation: () => dependencies.noteflixClient.createPrivateNote(dependencies.uid, parsed.data),
        });
        const structuredContent = {
          status: "created" as const,
          request_id: parsed.data.request_id,
          cached: completed.cached,
          note: completed.result,
        };
        return {
          structuredContent,
          content: [
            {
              type: "text" as const,
              text: `${completed.cached ? "Found the existing" : "Created a"} private Noteflix note: ${completed.result.title} (${completed.result.url})`,
            },
          ],
        };
      } catch (cause) {
        const error =
          cause instanceof IdempotencyError
            ? cause
            : new IdempotencyError("note_creation_failed", "Noteflix could not create the note.", false);
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `${error.message} Error code: ${error.code}.${error.retryable ? " The same request_id may be checked again later." : ""}`,
            },
          ],
        };
      }
    },
  );

  return server;
}
