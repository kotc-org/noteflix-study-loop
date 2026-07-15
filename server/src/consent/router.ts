import { randomBytes } from "node:crypto";
import express, { type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";

import type { AppConfig } from "../config.js";
import type { NoteflixOAuthProvider } from "../oauth/provider.js";
import { buildConsentHtml } from "./html.js";

const requestTokenSchema = z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/);
const completionSchema = z
  .object({
    request_id: requestTokenSchema,
    decision: z.enum(["allow", "deny"]),
    firebase_id_token: z.string().min(100).max(10_000).optional(),
  })
  .strict();

function requireExactOwnOrigin(publicOrigin: string): RequestHandler {
  return (req, res, next) => {
    if (req.get("origin") !== publicOrigin) {
      return res.status(403).json({ error: "invalid_origin" });
    }
    return next();
  };
}

export function createConsentRouter(config: AppConfig, provider: NoteflixOAuthProvider) {
  const router = express.Router();
  const requireOwnOrigin = requireExactOwnOrigin(config.publicBaseUrl.origin);
  router.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: config.consentRateLimitPer15Minutes,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );

  router.get("/consent", async (req, res) => {
    const parsed = requestTokenSchema.safeParse(req.query.request_id);
    if (!parsed.success) return res.status(400).type("text/plain").send("Invalid authorization request.");
    const view = await provider.getConsentView(parsed.data);
    if (!view) return res.status(410).type("text/plain").send("This authorization request expired or was already used.");

    const nonce = randomBytes(18).toString("base64");
    res.set({
      "Cache-Control": "no-store",
      "Content-Security-Policy": [
        "default-src 'none'",
        `script-src 'nonce-${nonce}' https://www.gstatic.com`,
        `style-src 'nonce-${nonce}'`,
        "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://*.googleapis.com",
        `frame-src https://accounts.google.com https://*.firebaseapp.com https://${config.firebaseWebConfig.authDomain}`,
        "img-src data: https:",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join("; "),
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
    return res.status(200).type("html").send(buildConsentHtml(view, parsed.data, config, nonce));
  });

  router.post(
    "/consent/complete",
    requireOwnOrigin,
    express.json({ limit: "32kb" }),
    async (req, res) => {
      const parsed = completionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid consent response." });
      }
      try {
        const result = await provider.completeConsent({
          requestToken: parsed.data.request_id,
          decision: parsed.data.decision,
          ...(parsed.data.firebase_id_token
            ? { firebaseIdToken: parsed.data.firebase_id_token }
            : {}),
        });
        res.set("Cache-Control", "no-store");
        return res.status(200).json({ redirect_url: result.redirectUrl });
      } catch {
        return res.status(401).json({
          error: "Authorization could not be completed. Sign in again and retry.",
        });
      }
    },
  );

  return router;
}
