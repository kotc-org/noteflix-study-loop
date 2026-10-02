import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { InvalidClientMetadataError, InvalidScopeError, InvalidTargetError } from "@modelcontextprotocol/sdk/server/auth/errors.js";

export const NOTES_CREATE_SCOPE = "notes:create";
export const VIDEOS_CREATE_SCOPE = "videos:create";
export const VIDEOS_READ_SCOPE = "videos:read";
export const VIDEOS_PUBLISH_SCOPE = "videos:publish";
export const OFFLINE_ACCESS_SCOPE = "offline_access";
export const ACTION_SCOPES = [
  NOTES_CREATE_SCOPE,
  VIDEOS_CREATE_SCOPE,
  VIDEOS_READ_SCOPE,
  VIDEOS_PUBLISH_SCOPE,
] as const;
export const SUPPORTED_SCOPES = [...ACTION_SCOPES, OFFLINE_ACCESS_SCOPE] as const;
const NOTE_ONLY_ACTION_SCOPES = [NOTES_CREATE_SCOPE] as const;
const CLAUDE_HOSTED_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const CHATGPT_CALLBACK_ORIGIN = "https://chatgpt.com";
const CHATGPT_CALLBACK_PATH = /^\/connector\/oauth\/[A-Za-z0-9_-]{1,200}$/;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

type TrustedCallback = "chatgpt" | "claude" | "loopback";

function classifyTrustedCallback(url: URL): TrustedCallback | undefined {
  if (url.username || url.password || url.hash || url.search) return undefined;
  if (url.href === CLAUDE_HOSTED_CALLBACK) return "claude";
  if (
    url.origin === CHATGPT_CALLBACK_ORIGIN &&
    CHATGPT_CALLBACK_PATH.test(url.pathname)
  ) {
    return "chatgpt";
  }
  if (
    url.protocol === "http:" &&
    LOOPBACK_HOSTS.has(url.hostname) &&
    url.pathname === "/callback"
  ) {
    return "loopback";
  }
  return undefined;
}

export function actionScopes(enableVideoTools = false): string[] {
  return enableVideoTools ? [...ACTION_SCOPES] : [...NOTE_ONLY_ACTION_SCOPES];
}

export function isDurableChatGptPublicClient(
  client: Pick<
    OAuthClientInformationFull,
    "redirect_uris" | "token_endpoint_auth_method" | "client_secret" | "software_id"
  >,
): boolean {
  if (
    client.token_endpoint_auth_method !== "none"
    || client.client_secret !== undefined
    || client.software_id === "noteflix-production-readonly-verifier"
    || client.redirect_uris.length !== 1
  ) {
    return false;
  }
  try {
    return classifyTrustedCallback(new URL(client.redirect_uris[0]!)) === "chatgpt";
  } catch {
    return false;
  }
}

export function supportedScopes(enableVideoTools = false): string[] {
  return [...actionScopes(enableVideoTools), OFFLINE_ACCESS_SCOPE];
}

export function normalizeScopes(
  requested: string[] | undefined,
  enableVideoTools = false,
): string[] {
  const actions = actionScopes(enableVideoTools);
  const supported = supportedScopes(enableVideoTools);
  const scopes = requested && requested.length > 0 ? [...new Set(requested)] : actions;
  const invalid = scopes.filter((scope) => !supported.includes(scope));
  if (invalid.length > 0) {
    throw new InvalidScopeError(`Unsupported scope: ${invalid[0]}`);
  }
  if (!scopes.some((scope) => actions.includes(scope))) {
    throw new InvalidScopeError("At least one Noteflix action scope is required");
  }
  return supported.filter((scope) => scopes.includes(scope));
}

export function trustedClientDisplayName(redirectUri: string): string {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    throw new InvalidClientMetadataError("Redirect URIs must be valid absolute URLs");
  }
  switch (classifyTrustedCallback(url)) {
    case "chatgpt": return "ChatGPT";
    case "claude": return "Claude";
    case "loopback": return "Local MCP client";
    default:
      throw new InvalidClientMetadataError("Redirect URI is not a trusted ChatGPT, Claude, or loopback callback");
  }
}

export function defaultScopesForRedirectUri(
  redirectUri: string,
  enableVideoTools = false,
): string[] {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    throw new InvalidClientMetadataError("Redirect URIs must be valid absolute URLs");
  }
  const callback = classifyTrustedCallback(url);
  if (!callback) {
    throw new InvalidClientMetadataError("Redirect URI is not a trusted ChatGPT, Claude, or loopback callback");
  }
  return callback === "chatgpt" ? actionScopes(enableVideoTools) : [NOTES_CREATE_SCOPE];
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
    if (!classifyTrustedCallback(url)) {
      throw new InvalidClientMetadataError(
        "Redirect URIs must be an exact ChatGPT or Claude callback, or an HTTP loopback /callback URL",
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
