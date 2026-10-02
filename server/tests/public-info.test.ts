import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { testConfig } from "./fixtures.js";

describe("public Noteflix plugin information", () => {
  const app = createApp(testConfig(), { db: {} as never });

  it.each([
    ["/about", "Turn supplied study text into learning tools", "create_private_note"],
    ["/support", "Noteflix plugin support", "support@noteflix.com"],
    ["/privacy", "Privacy for the Noteflix ChatGPT plugin", "support@noteflix.com"],
    ["/terms", "Terms for the Noteflix ChatGPT plugin", "support@noteflix.com"],
  ])("serves %s without authentication or onboarding redirects", async (path, heading, marker) => {
    const response = await request(app).get(path);
    expect(response.status).toBe(200);
    expect(response.type).toBe("text/html");
    expect(response.headers.location).toBeUndefined();
    expect(response.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(response.text).toContain(`<h1>${heading}</h1>`);
    expect(response.text).toContain(marker);
    expect(response.text).not.toContain("#/onboarding");
  });

  it("serves first-party CSS without scripts or external resources", async () => {
    const response = await request(app).get("/noteflix-public.css");
    expect(response.status).toBe(200);
    expect(response.type).toBe("text/css");
    expect(response.text).toContain(".shell");
  });
});
