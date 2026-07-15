import { z } from "zod";

import type { AppConfig } from "../config.js";

const tokenClaimsSchema = z.object({
  aud: z.string().min(1),
  iss: z.string().min(1),
  sub: z.string().min(1).max(128),
  auth_time: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
});

const lookupResponseSchema = z
  .object({
    users: z
      .array(
        z
          .object({
            localId: z.string().min(1).max(128),
            validSince: z.coerce.number().int().nonnegative().default(0),
            disabled: z.boolean().optional(),
          })
          .passthrough(),
      )
      .min(1)
      .max(1),
  })
  .passthrough();

export type VerifiedNoteflixIdentity = { uid: string };

export interface NoteflixIdentityVerifier {
  verify(idToken: string): Promise<VerifiedNoteflixIdentity>;
}

function decodeClaims(idToken: string): z.infer<typeof tokenClaimsSchema> {
  const parts = idToken.split(".");
  if (parts.length !== 3 || !parts[1]) throw new Error("The Noteflix identity token is invalid");
  try {
    return tokenClaimsSchema.parse(
      JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")),
    );
  } catch {
    throw new Error("The Noteflix identity token is invalid");
  }
}

export class IdentityToolkitVerifier implements NoteflixIdentityVerifier {
  constructor(
    private readonly config: AppConfig,
    private readonly fetchImpl: typeof globalThis.fetch = globalThis.fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async verify(idToken: string): Promise<VerifiedNoteflixIdentity> {
    const claims = decodeClaims(idToken);
    if (
      claims.aud !== this.config.firebaseProjectId ||
      claims.iss !== `https://securetoken.google.com/${this.config.firebaseProjectId}` ||
      claims.exp <= Math.floor(this.now() / 1000)
    ) {
      throw new Error("The Noteflix identity token is invalid or expired");
    }

    const endpoint = new URL("https://identitytoolkit.googleapis.com/v1/accounts:lookup");
    endpoint.searchParams.set("key", this.config.firebaseWebConfig.apiKey);

    let response: Response;
    try {
      response = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new Error("Noteflix identity verification is temporarily unavailable");
    }
    if (!response.ok) {
      throw new Error("The Noteflix identity token is invalid or expired");
    }

    let decoded: unknown;
    try {
      decoded = await response.json();
    } catch {
      throw new Error("Noteflix identity verification returned an invalid response");
    }
    const parsed = lookupResponseSchema.safeParse(decoded);
    const user = parsed.success ? parsed.data.users[0] : undefined;
    if (
      !user ||
      user.disabled ||
      user.localId !== claims.sub ||
      claims.auth_time < user.validSince
    ) {
      throw new Error("The Noteflix identity is invalid, revoked, or disabled");
    }
    return { uid: user.localId };
  }
}
