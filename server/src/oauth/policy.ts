import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { InvalidClientMetadataError, InvalidScopeError, InvalidTargetError } from "@modelcontextprotocol/sdk/server/auth/errors.js";

export const NOTES_CREATE_SCOPE = "notes:create";
export const OFFLINE_ACCESS_SCOPE = "offline_access";
export const SUPPORTED_SCOPES = [NOTES_CREATE_SCOPE, OFFLINE_ACCESS_SCOPE] as const;
const CLAUDE_HOSTED_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const CLAUDE_CODE_LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

export function normalizeScopes(requested: string[] | undefined): string[] {
  const scopes = requested && requested.length > 0 ? [...new Set(requested)] : [NOTES_CREATE_SCOPE];
  if (!scopes.includes(NOTES_CREATE_SCOPE)) {
    throw new InvalidScopeError(`The ${NOTES_CREATE_SCOPE} scope is required`);
  }
  const invalid = scopes.filter((scope) => !SUPPORTED_SCOPES.includes(scope as (typeof SUPPORTED_SCOPES)[number]));
  if (invalid.length > 0) {
    throw new InvalidScopeError(`Unsupported scope: ${invalid[0]}`);
  }
  return SUPPORTED_SCOPES.filter((scope) => scopes.includes(scope));
}

export function requireExactResource(requested: URL | undefined, configured: URL): URL {
  if (!requested || requested.hash || requested.href !== configured.href) {
    throw new InvalidTargetError("The resource audience does not match this MCP server");
  }
  return new URL(configured.href);
}

export function validateRegisteredClient(client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">): void {
  if (client.redirect_uris.length === 0 || client.redirect_uris.length > 10) {
    throw new InvalidClientMetadataError("One to ten redirect_uris are required");
  }
  for (const raw of client.redirect_uris) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new InvalidClientMetadataError("Redirect URIs must be valid absolute URLs");
    }
    if (url.username || url.password || url.hash || url.search) {
      throw new InvalidClientMetadataError("Redirect URIs must not contain credentials, query strings, or fragments");
    }
    const hostedClaudeCallback = url.href === CLAUDE_HOSTED_CALLBACK;
    const loopbackCallback =
      url.protocol === "http:" &&
      CLAUDE_CODE_LOOPBACK_HOSTS.has(url.hostname) &&
      url.pathname === "/callback";
    if (!hostedClaudeCallback && !loopbackCallback) {
      throw new InvalidClientMetadataError(
        "Redirect URIs must be an exact Claude hosted callback or an HTTP loopback /callback URL",
      );
    }
  }
  const method = client.token_endpoint_auth_method ?? "client_secret_post";
  if (!new Set(["none", "client_secret_post"]).has(method)) {
    throw new InvalidClientMetadataError("Only none and client_secret_post token authentication are supported");
  }
  if (client.grant_types?.some((grant) => !["authorization_code", "refresh_token"].includes(grant))) {
    throw new InvalidClientMetadataError("Only authorization_code and refresh_token grants are supported");
  }
  if (client.response_types?.some((type) => type !== "code")) {
    throw new InvalidClientMetadataError("Only the code response type is supported");
  }
}
