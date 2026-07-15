import type { AppConfig } from "../src/config.js";
import { loadConfig } from "../src/config.js";

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: "test",
    PUBLIC_BASE_URL: "http://localhost:8080",
    MCP_RESOURCE_URL: "http://localhost:8080/mcp",
    MCP_ALLOWED_ORIGINS: "https://claude.ai",
    SERVICE_DOCUMENTATION_URL: "https://noteflix.com/docs",
    NOTEFLIX_INTERNAL_AUDIENCE: "https://ainotes.noteflix.test",
    NOTEFLIX_APP_BASE_URL: "https://noteflix.test",
    FIREBASE_PROJECT_ID: "noteflix-test",
    FIREBASE_WEB_API_KEY: "test-web-api-key",
    FIREBASE_WEB_AUTH_DOMAIN: "noteflix-test.firebaseapp.com",
    FIREBASE_WEB_APP_ID: "1:123:web:test",
    OAUTH_CLIENT_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    FIRESTORE_DATABASE_ID: "noteflix-mcp-test",
    ...overrides,
  });
}
