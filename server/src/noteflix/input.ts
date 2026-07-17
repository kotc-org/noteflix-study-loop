import { z } from "zod";

export function createPrivateNoteInputSchema(maxContentChars = 50_000) {
  return z
    .object({
      request_id: z.string().uuid().describe("A fresh UUID for safe retries of this exact creation request."),
      title: z.string().min(1).max(160).regex(/\S/, "Title must contain non-whitespace text.").describe("The exact title shown in the user's Noteflix library. Do not include restricted personal, payment, government-ID, or authentication data."),
      content_markdown: z.string().min(1).max(maxContentChars).regex(/\S/, "Content must contain non-whitespace text.").describe("The exact complete Markdown note content to save. It must not contain payment-card data, identifiable health information, government identifiers, passwords, API keys, authentication tokens, or verification codes."),
      summary: z.string().min(1).max(1_000).regex(/\S/, "Summary must contain non-whitespace text.").optional().describe("Optional exact concise summary without restricted personal, payment, government-ID, or authentication data."),
      key_points: z
        .array(z.string().min(1).max(500).regex(/\S/, "Key points must contain non-whitespace text."))
        .max(20)
        .optional()
        .describe("Optional key points derived from the note content, excluding restricted personal, payment, government-ID, or authentication data."),
    })
    .strict();
}

export type CreatePrivateNoteInput = z.infer<ReturnType<typeof createPrivateNoteInputSchema>>;

const RESERVED_VIDEO_SLUGS = new Set([
  "admin", "api", "assets", "auth", "connect", "feed", "hashtag",
  "login", "logout", "mcp", "new", "oauth", "public", "register",
  "settings", "signin", "signup", "static", "token", "video",
  "videos", "watch", "www",
]);

export const NOTEBOOK_VIDEO_STYLES = [
  "whiteboard",
  "watercolor",
  "papercraft",
  "anime",
  "retro",
  "heritage",
] as const;

export const NOTEBOOK_VIDEO_MODES = ["brief", "detailed"] as const;

export const noteflixIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "Must be a Noteflix identifier, not a URL or path");

export const requestIdSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    "Must be an RFC-variant UUID with a supported version",
  )
  .transform((value) => value.toLowerCase());

export const publicVideoSlugSchema = z
  .string()
  .min(1)
  .superRefine((slug, context) => {
    if (slug !== slug.trim() || slug !== slug.normalize("NFKC")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Must be trimmed and NFKC-normalized",
      });
    }
    if (slug !== slug.toLowerCase()) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Must be lowercase" });
    }
    if (Array.from(slug).length > 80) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Must contain at most 80 Unicode code points",
      });
    }
    if (RESERVED_VIDEO_SLUGS.has(slug)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Must not use a reserved Noteflix route word",
      });
    }
    if (!/^[\p{Letter}\p{Number}][\p{Letter}\p{Number}\p{Mark}]*(?:-[\p{Letter}\p{Number}][\p{Letter}\p{Number}\p{Mark}]*)*$/u.test(slug)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Must contain Unicode words and single hyphen separators",
      });
    }
  });

export const getVideoAllowanceInputSchema = z.object({}).strict();

export const getVideoStatusInputSchema = z
  .object({
    video_id: noteflixIdSchema.describe(
      "The Noteflix video ID returned by create_public_note_video.",
    ),
  })
  .strict();

export const createPublicNoteVideoInputSchema = z
  .object({
    request_id: requestIdSchema.describe(
      "A fresh UUID for this exact request; reuse it only for a safe retry with identical inputs.",
    ),
    note_id: noteflixIdSchema.describe(
      "The ID of a private Noteflix note owned by the connected user. Its source must not contain restricted payment, identifiable health, government-ID, or authentication data.",
    ),
    style: z
      .enum(NOTEBOOK_VIDEO_STYLES)
      .default("whiteboard")
      .describe("The requested public video art style."),
    mode: z
      .enum(NOTEBOOK_VIDEO_MODES)
      .default("brief")
      .describe("Brief makes a shorter explainer; detailed makes a longer explainer."),
    user_confirmed_generation: z
      .literal(true)
      .describe(
        "True only after the user explicitly accepts generation and the one-credit impact on their connected Noteflix allowance.",
      ),
    user_confirmed_publication: z
      .literal(true)
      .describe(
        "True only after the user explicitly accepts that the generated video will be public, shareable, and potentially discoverable.",
      ),
    user_confirmed_source_rights: z
      .literal(true)
      .describe(
        "True only after the user confirms they own or have permission to use the source note for public AI video generation.",
      ),
  })
  .strict();

export type CreatePublicNoteVideoInput = z.infer<typeof createPublicNoteVideoInputSchema>;
export type NotebookVideoStyle = (typeof NOTEBOOK_VIDEO_STYLES)[number];
export type NotebookVideoMode = (typeof NOTEBOOK_VIDEO_MODES)[number];

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
