import { z } from "zod";

const positiveInt = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  PUBLIC_BASE_URL: z.string().url(),
  MCP_RESOURCE_URL: z.string().url(),
  MCP_ALLOWED_ORIGINS: z
    .string()
    .default("https://chatgpt.com,https://claude.ai"),
  SERVICE_DOCUMENTATION_URL: z.string().url().default("https://noteflix.com"),
  NOTEFLIX_INTERNAL_AUDIENCE: z.string().url(),
  NOTEFLIX_APP_BASE_URL: z.string().url().default("https://noteflix.com"),
  FIREBASE_PROJECT_ID: z.string().min(1),
  FIREBASE_WEB_API_KEY: z.string().min(1),
  FIREBASE_WEB_AUTH_DOMAIN: z.string().regex(/^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/),
  FIREBASE_WEB_APP_ID: z.string().min(1),
  OAUTH_CLIENT_SECRET_ENCRYPTION_KEY: z.string().min(1),
  OPENAI_APPS_CHALLENGE_TOKEN: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .regex(/^\S+$/)
    .optional(),
  FIRESTORE_DATABASE_ID: z
    .string()
    .regex(/^(?:\(default\)|[a-z0-9](?:[a-z0-9-]{2,61}[a-z0-9])?)$/)
    .default("noteflix-mcp"),
  FIRESTORE_COLLECTION_PREFIX: z
    .string()
    .regex(/^[a-z][a-z0-9_]{2,40}$/)
    .default("noteflix_openai_mcp"),
  OAUTH_CLIENT_REGISTRATION_TTL_SECONDS: positiveInt(2_592_000),
  OAUTH_AUTHORIZATION_REQUEST_TTL_SECONDS: positiveInt(600),
  OAUTH_AUTHORIZATION_CODE_TTL_SECONDS: positiveInt(300),
  OAUTH_ACCESS_TOKEN_TTL_SECONDS: positiveInt(3600),
  OAUTH_REFRESH_TOKEN_TTL_SECONDS: positiveInt(2_592_000),
  MCP_RATE_LIMIT_PER_MINUTE: positiveInt(30),
  VIDEO_CREATE_RATE_LIMIT_PER_HOUR: positiveInt(3),
  CONSENT_RATE_LIMIT_PER_15_MINUTES: positiveInt(60),
  NOTEFLIX_REQUEST_TIMEOUT_MS: positiveInt(45_000),
  MAX_NOTE_CONTENT_CHARS: positiveInt(50_000),
});

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  publicBaseUrl: URL;
  mcpResourceUrl: URL;
  mcpAllowedOrigins: ReadonlySet<string>;
  serviceDocumentationUrl: URL;
  noteflixInternalAudience: URL;
  noteflixAppBaseUrl: URL;
  firebaseProjectId: string;
  firebaseWebConfig: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    appId: string;
  };
  oauthClientSecretEncryptionKey: Buffer;
  openaiAppsChallengeToken?: string;
  firestoreDatabaseId: string;
  collectionPrefix: string;
  clientRegistrationTtlSeconds: number;
  authorizationRequestTtlSeconds: number;
  authorizationCodeTtlSeconds: number;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  mcpRateLimitPerMinute: number;
  videoCreateRateLimitPerHour: number;
  consentRateLimitPer15Minutes: number;
  noteflixRequestTimeoutMs: number;
  maxNoteContentChars: number;
};

function normalizedEndpoint(raw: string, label: string): URL {
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must not contain credentials, a query string, or a fragment`);
  }
  url.pathname = url.pathname.replace(/\/$/, "") || "/";
  return url;
}

function decodeEncryptionKey(raw: string): Buffer {
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("OAUTH_CLIENT_SECRET_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }
  return key;
}

function parseAllowedOrigins(raw: string, ownOrigin: string): ReadonlySet<string> {
  const origins = new Set<string>([ownOrigin]);
  for (const candidate of raw.split(",").map((value) => value.trim()).filter(Boolean)) {
    const url = new URL(candidate);
    if (url.origin !== candidate.replace(/\/$/, "") || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("MCP_ALLOWED_ORIGINS must contain comma-separated origins without paths");
    }
    origins.add(url.origin);
  }
  return origins;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  const publicBaseUrl = normalizedEndpoint(parsed.PUBLIC_BASE_URL, "PUBLIC_BASE_URL");
  const mcpResourceUrl = normalizedEndpoint(parsed.MCP_RESOURCE_URL, "MCP_RESOURCE_URL");
  const noteflixInternalAudience = normalizedEndpoint(parsed.NOTEFLIX_INTERNAL_AUDIENCE, "NOTEFLIX_INTERNAL_AUDIENCE");
  const noteflixAppBaseUrl = normalizedEndpoint(parsed.NOTEFLIX_APP_BASE_URL, "NOTEFLIX_APP_BASE_URL");

  if (publicBaseUrl.pathname !== "/") {
    throw new Error("PUBLIC_BASE_URL must be an origin URL with no path");
  }
  if (mcpResourceUrl.pathname !== "/mcp") {
    throw new Error("MCP_RESOURCE_URL must use the exact /mcp path");
  }
  if (mcpResourceUrl.origin !== publicBaseUrl.origin) {
    throw new Error("MCP_RESOURCE_URL and PUBLIC_BASE_URL must have the same origin");
  }
  if (noteflixInternalAudience.pathname !== "/") {
    throw new Error("NOTEFLIX_INTERNAL_AUDIENCE must be an origin URL with no path");
  }
  if (parsed.NODE_ENV === "production" && parsed.FIRESTORE_DATABASE_ID === "(default)") {
    throw new Error("FIRESTORE_DATABASE_ID must select a named database in production");
  }
  if (parsed.NODE_ENV === "production") {
    for (const [label, url] of [
      ["PUBLIC_BASE_URL", publicBaseUrl],
      ["MCP_RESOURCE_URL", mcpResourceUrl],
      ["NOTEFLIX_INTERNAL_AUDIENCE", noteflixInternalAudience],
      ["NOTEFLIX_APP_BASE_URL", noteflixAppBaseUrl],
      ["SERVICE_DOCUMENTATION_URL", new URL(parsed.SERVICE_DOCUMENTATION_URL)],
    ] as const) {
      if (url.protocol !== "https:") {
        throw new Error(`${label} must use HTTPS in production`);
      }
    }
    for (const origin of parseAllowedOrigins(parsed.MCP_ALLOWED_ORIGINS, publicBaseUrl.origin)) {
      if (new URL(origin).protocol !== "https:") {
        throw new Error("MCP_ALLOWED_ORIGINS must use HTTPS in production");
      }
    }
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    publicBaseUrl,
    mcpResourceUrl,
    mcpAllowedOrigins: parseAllowedOrigins(parsed.MCP_ALLOWED_ORIGINS, publicBaseUrl.origin),
    serviceDocumentationUrl: new URL(parsed.SERVICE_DOCUMENTATION_URL),
    noteflixInternalAudience,
    noteflixAppBaseUrl,
    firebaseProjectId: parsed.FIREBASE_PROJECT_ID,
    firebaseWebConfig: {
      apiKey: parsed.FIREBASE_WEB_API_KEY,
      authDomain: parsed.FIREBASE_WEB_AUTH_DOMAIN,
      projectId: parsed.FIREBASE_PROJECT_ID,
      appId: parsed.FIREBASE_WEB_APP_ID,
    },
    oauthClientSecretEncryptionKey: decodeEncryptionKey(parsed.OAUTH_CLIENT_SECRET_ENCRYPTION_KEY),
    ...(parsed.OPENAI_APPS_CHALLENGE_TOKEN
      ? { openaiAppsChallengeToken: parsed.OPENAI_APPS_CHALLENGE_TOKEN }
      : {}),
    firestoreDatabaseId: parsed.FIRESTORE_DATABASE_ID,
    collectionPrefix: parsed.FIRESTORE_COLLECTION_PREFIX,
    clientRegistrationTtlSeconds: parsed.OAUTH_CLIENT_REGISTRATION_TTL_SECONDS,
    authorizationRequestTtlSeconds: parsed.OAUTH_AUTHORIZATION_REQUEST_TTL_SECONDS,
    authorizationCodeTtlSeconds: parsed.OAUTH_AUTHORIZATION_CODE_TTL_SECONDS,
    accessTokenTtlSeconds: parsed.OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlSeconds: parsed.OAUTH_REFRESH_TOKEN_TTL_SECONDS,
    mcpRateLimitPerMinute: parsed.MCP_RATE_LIMIT_PER_MINUTE,
    videoCreateRateLimitPerHour: parsed.VIDEO_CREATE_RATE_LIMIT_PER_HOUR,
    consentRateLimitPer15Minutes: parsed.CONSENT_RATE_LIMIT_PER_15_MINUTES,
    noteflixRequestTimeoutMs: parsed.NOTEFLIX_REQUEST_TIMEOUT_MS,
    maxNoteContentChars: parsed.MAX_NOTE_CONTENT_CHARS,
  };
}
