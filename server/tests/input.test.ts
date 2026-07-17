import { describe, expect, it } from "vitest";

import {
  buildPrivateNotePayload,
  createPrivateNoteInputSchema,
  createPublicNoteVideoInputSchema,
  publicVideoSlugSchema,
} from "../src/noteflix/input.js";

describe("create_private_note contract", () => {
  const valid = {
    request_id: "550e8400-e29b-41d4-a716-446655440000",
    title: "Cell membranes",
    content_markdown: "# Membranes\n\nPhospholipids form a bilayer. Proteins support transport.",
    summary: "A quick membrane review.",
    key_points: ["Bilayer structure", "Protein transport"],
  };

  it("requires content_markdown and rejects arbitrary fields", () => {
    const schema = createPrivateNoteInputSchema();
    expect(schema.parse(valid).content_markdown).toContain("Membranes");
    expect(schema.safeParse({ ...valid, content_markdown: undefined, content: "legacy" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, isPublic: true }).success).toBe(false);
  });

  it("constructs only the allowlisted private integration payload", () => {
    const payload = buildPrivateNotePayload(createPrivateNoteInputSchema().parse(valid));
    expect(Object.keys(payload).sort()).toEqual(
      [
        "accessType",
        "derivedAssets",
        "integrationSource",
        "isPublic",
        "isVisible",
        "keyPoints",
        "notes",
        "sourceText",
        "sourceType",
        "sourceUrl",
        "summary",
        "title",
        "visibility",
      ].sort(),
    );
    expect(payload).toMatchObject({
      notes: [valid.content_markdown],
      summary: valid.summary,
      keyPoints: valid.key_points,
      accessType: "PRIVATE_INVITE",
      isVisible: false,
      isPublic: false,
      visibility: "private",
      integrationSource: "claude-mcp",
      derivedAssets: [],
    });
  });

  it("does not synthesize note segments, summaries, or key points", () => {
    const exactMarkdown = `  ${valid.content_markdown}\n\nTrailing spaces stay.  \n`;
    const input = createPrivateNoteInputSchema().parse({
      request_id: valid.request_id,
      title: valid.title,
      content_markdown: exactMarkdown,
    });
    expect(buildPrivateNotePayload(input)).toMatchObject({
      notes: [exactMarkdown],
      summary: "",
      keyPoints: [],
      sourceText: exactMarkdown,
    });
  });
});

describe("create_public_note_video contract", () => {
  const valid = {
    request_id: "550e8400-e29b-41d4-a716-446655440000",
    note_id: "note-123",
    style: "whiteboard",
    mode: "brief",
    user_confirmed_generation: true,
    user_confirmed_publication: true,
    user_confirmed_source_rights: true,
  };

  it("requires generation, publication, and source-rights confirmations", () => {
    expect(createPublicNoteVideoInputSchema.safeParse(valid).success).toBe(true);
    for (const field of [
      "user_confirmed_generation",
      "user_confirmed_publication",
      "user_confirmed_source_rights",
    ] as const) {
      expect(createPublicNoteVideoInputSchema.safeParse({
        ...valid,
        [field]: false,
      }).success).toBe(false);
      const { [field]: _missing, ...withoutField } = valid;
      expect(createPublicNoteVideoInputSchema.safeParse(withoutField).success).toBe(false);
    }
  });

  it("rejects URLs, arbitrary account IDs, unsupported modes, and extra fields", () => {
    expect(createPublicNoteVideoInputSchema.safeParse({
      ...valid,
      note_id: "https://noteflix.com/notes/note-123",
    }).success).toBe(false);
    expect(createPublicNoteVideoInputSchema.safeParse({
      ...valid,
      noteflix_user_id: "other-user",
    }).success).toBe(false);
    expect(createPublicNoteVideoInputSchema.safeParse({
      ...valid,
      mode: "cinematic",
    }).success).toBe(false);
  });

  it("accepts readable Unicode slugs and rejects IDs or reserved route words", () => {
    expect(publicVideoSlugSchema.safeParse("mitosis-explained").success).toBe(true);
    expect(publicVideoSlugSchema.safeParse("células-y-adn").success).toBe(true);
    expect(publicVideoSlugSchema.safeParse("watch").success).toBe(false);
    expect(publicVideoSlugSchema.safeParse("Not-Lowercase").success).toBe(false);
    expect(publicVideoSlugSchema.safeParse("random_id_value").success).toBe(false);
  });
});
