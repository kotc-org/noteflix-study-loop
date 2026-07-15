import { describe, expect, it } from "vitest";

import { buildPrivateNotePayload, createPrivateNoteInputSchema } from "../src/noteflix/input.js";

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
