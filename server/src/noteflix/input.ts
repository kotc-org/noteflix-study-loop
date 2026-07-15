import { z } from "zod";

export function createPrivateNoteInputSchema(maxContentChars = 50_000) {
  return z
    .object({
      request_id: z.string().uuid().describe("A fresh UUID for safe retries of this exact creation request."),
      title: z.string().min(1).max(160).regex(/\S/, "Title must contain non-whitespace text.").describe("The exact title shown in the user's Noteflix library."),
      content_markdown: z.string().min(1).max(maxContentChars).regex(/\S/, "Content must contain non-whitespace text.").describe("The exact complete Markdown note content to save."),
      summary: z.string().min(1).max(1_000).regex(/\S/, "Summary must contain non-whitespace text.").optional().describe("Optional exact concise summary."),
      key_points: z
        .array(z.string().min(1).max(500).regex(/\S/, "Key points must contain non-whitespace text."))
        .max(20)
        .optional()
        .describe("Optional key points derived from the note content."),
    })
    .strict();
}

export type CreatePrivateNoteInput = z.infer<ReturnType<typeof createPrivateNoteInputSchema>>;

export type NoteflixCreatePayload = {
  title: string;
  notes: string[];
  summary: string;
  keyPoints: string[];
  sourceText: string;
  sourceType: "text";
  sourceUrl: null;
  accessType: "PRIVATE_INVITE";
  isVisible: false;
  isPublic: false;
  visibility: "private";
  integrationSource: "claude-mcp";
  derivedAssets: [];
};

export function buildPrivateNotePayload(input: CreatePrivateNoteInput): NoteflixCreatePayload {
  return {
    title: input.title,
    notes: [input.content_markdown],
    summary: input.summary ?? "",
    keyPoints: input.key_points ?? [],
    sourceText: input.content_markdown,
    sourceType: "text",
    sourceUrl: null,
    accessType: "PRIVATE_INVITE",
    isVisible: false,
    isPublic: false,
    visibility: "private",
    integrationSource: "claude-mcp",
    derivedAssets: [],
  };
}
