import { describe, expect, it } from "vitest";

import { testConfig } from "./fixtures.js";

describe("gateway configuration boundaries", () => {
  it("selects an explicit named Firestore database", () => {
    expect(testConfig().firestoreDatabaseId).toBe("noteflix-mcp-test");
    expect(() =>
      testConfig({
        NODE_ENV: "production",
        PUBLIC_BASE_URL: "https://gateway.noteflix.test",
        MCP_RESOURCE_URL: "https://gateway.noteflix.test/mcp",
        FIRESTORE_DATABASE_ID: "(default)",
      }),
    ).toThrow(/named database/);
  });

  it("requires the internal OIDC audience to be an origin without a path", () => {
    expect(() =>
      testConfig({ NOTEFLIX_INTERNAL_AUDIENCE: "https://ainotes.noteflix.test/internal" }),
    ).toThrow(/origin URL with no path/);
  });
});
