import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import type { Firestore } from "firebase-admin/firestore";
import { GoogleAuth } from "google-auth-library";
import {
  createOAuthMetadata,
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthRouter,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import type { AppConfig } from "./config.js";
import { createConsentRouter } from "./consent/router.js";
import { createNoteflixMcpServer } from "./mcp.js";
import { NoteflixClient, type ServiceIdentityProvider } from "./noteflix/client.js";
import { FirestoreOAuthStore } from "./oauth/firestore-store.js";
import { IdentityToolkitVerifier, type NoteflixIdentityVerifier } from "./oauth/identity.js";
import { NoteflixOAuthProvider, uidFromAuthInfo } from "./oauth/provider.js";
import { SUPPORTED_SCOPES } from "./oauth/policy.js";
import { preserveOAuthStateOnErrorRedirect } from "./oauth/state-preservation.js";
import { FirestoreIdempotencyStore, IdempotencyCoordinator } from "./persistence/idempotency.js";
import { FirestoreFixedWindowRateLimiter, persistentMcpRateLimit } from "./persistence/rate-limit.js";

export function validateMcpOrigin(config: AppConfig): RequestHandler {
  return (req, res, next) => {
    const origin = req.get("origin");
    if (!origin) return next();
    let normalized: string;
    try {
      normalized = new URL(origin).origin;
    } catch {
      return res.status(403).json({ error: "invalid_origin" });
    }
    if (normalized !== origin.replace(/\/$/, "") || !config.mcpAllowedOrigins.has(normalized)) {
      return res.status(403).json({ error: "invalid_origin" });
    }
    res.set("Access-Control-Allow-Origin", normalized);
    res.vary("Origin");
    return next();
  };
}

export type RuntimeDependencies = {
  db: Firestore;
  identityVerifier?: NoteflixIdentityVerifier;
  serviceIdentity?: ServiceIdentityProvider;
  fetchImpl?: typeof globalThis.fetch;
};

export function createApp(config: AppConfig, runtime: RuntimeDependencies) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  const oauthStore = new FirestoreOAuthStore(runtime.db, config);
  const identityVerifier = runtime.identityVerifier ?? new IdentityToolkitVerifier(config, runtime.fetchImpl);
  const provider = new NoteflixOAuthProvider(oauthStore, identityVerifier, config);
  const serviceIdentity = runtime.serviceIdentity ?? new GoogleAuth();
  const noteflixClient = new NoteflixClient(config, serviceIdentity);
  const idempotency = new IdempotencyCoordinator(new FirestoreIdempotencyStore(runtime.db, config));
  const persistentLimiter = new FirestoreFixedWindowRateLimiter(runtime.db, config);

  app.use((_req, res, next) => {
    res.set({
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
    next();
  });

  app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));
  app.get("/.well-known/openai-apps-challenge", (_req, res) => {
    if (!config.openaiAppsChallengeToken) {
      return res.status(404).type("text/plain").send("not_configured");
    }
    return res
      .set("Cache-Control", "no-store")
      .type("text/plain")
      .status(200)
      .send(config.openaiAppsChallengeToken);
  });
  app.get("/", (_req, res) =>
    res.status(200).json({
      name: "Noteflix Study & Video MCP",
      resource: config.mcpResourceUrl.href,
      documentation: config.serviceDocumentationUrl.href,
    }),
  );

  // The SDK's default metadata currently advertises only confidential-client
  // revocation even though its revocation handler accepts DCR public clients.
  // Publish the accurate methods before mounting the SDK router.
  const oauthMetadata = createOAuthMetadata({
    provider,
    issuerUrl: config.publicBaseUrl,
    baseUrl: config.publicBaseUrl,
    serviceDocumentationUrl: config.serviceDocumentationUrl,
    scopesSupported: [...SUPPORTED_SCOPES],
  });
  oauthMetadata.revocation_endpoint_auth_methods_supported = ["client_secret_post", "none"];
  app.get("/.well-known/oauth-authorization-server", (_req, res) =>
    res.set("Cache-Control", "public, max-age=300").status(200).json(oauthMetadata),
  );

  app.use("/authorize", preserveOAuthStateOnErrorRedirect());
  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: config.publicBaseUrl,
      baseUrl: config.publicBaseUrl,
      resourceServerUrl: config.mcpResourceUrl,
      serviceDocumentationUrl: config.serviceDocumentationUrl,
      scopesSupported: [...SUPPORTED_SCOPES],
      resourceName: "Noteflix Study & Video",
      authorizationOptions: {
        rateLimit: {
          windowMs: 15 * 60 * 1000,
          limit: config.consentRateLimitPer15Minutes,
          standardHeaders: "draft-8",
          legacyHeaders: false,
        },
      },
      tokenOptions: {
        rateLimit: {
          windowMs: 15 * 60 * 1000,
          limit: 60,
          standardHeaders: "draft-8",
          legacyHeaders: false,
        },
      },
      clientRegistrationOptions: {
        clientSecretExpirySeconds: 30 * 24 * 60 * 60,
        rateLimit: {
          windowMs: 60 * 60 * 1000,
          limit: 20,
          standardHeaders: "draft-8",
          legacyHeaders: false,
        },
      },
    }),
  );
  app.use(createConsentRouter(config, provider));

  const protectedResourceMetadata = {
    resource: config.mcpResourceUrl.href,
    authorization_servers: [config.publicBaseUrl.href],
    scopes_supported: [...SUPPORTED_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Noteflix Study & Video",
    resource_documentation: config.serviceDocumentationUrl.href,
  };
  app.get("/.well-known/oauth-protected-resource", (_req, res) =>
    res.set("Cache-Control", "public, max-age=300").status(200).json(protectedResourceMetadata),
  );

  const bearer = requireBearerAuth({
    verifier: provider,
    requiredScopes: [],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(config.mcpResourceUrl),
  });

  app.options("/mcp", validateMcpOrigin(config), (_req, res) =>
    res
      .set({
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version",
        "Access-Control-Max-Age": "600",
      })
      .status(204)
      .end(),
  );

  app.post(
    "/mcp",
    validateMcpOrigin(config),
    express.json({ limit: "1mb", type: ["application/json", "application/*+json"] }),
    bearer,
    persistentMcpRateLimit(persistentLimiter, config),
    async (req, res) => {
      const uid = uidFromAuthInfo(req.auth);
      const server = createNoteflixMcpServer({
        uid,
        scopes: req.auth?.scopes ?? [],
        config,
        noteflixClient,
        idempotency,
        generationRateLimit: () =>
          persistentLimiter.consume(
            `video-create:${uid}`,
            config.videoCreateRateLimitPerHour,
            60 * 60 * 1000,
          ),
      });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch {
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          });
        }
      }
    },
  );
  app.all("/mcp", (_req, res) => res.set("Allow", "POST").status(405).json({ error: "method_not_allowed" }));

  app.use((_req, res) => res.status(404).json({ error: "not_found" }));
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    const syntaxError = error instanceof SyntaxError && "body" in error;
    res.status(syntaxError ? 400 : 500).json({
      error: syntaxError ? "invalid_json" : "server_error",
    });
  };
  app.use(errorHandler);
  return app;
}
