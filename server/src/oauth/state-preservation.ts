import type { RequestHandler } from "express";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requestParameter(
  method: string,
  body: unknown,
  query: Record<string, unknown>,
  name: string,
): string | undefined {
  const source = method === "POST" && isRecord(body) ? body : query;
  const value = source[name];
  return typeof value === "string" ? value : undefined;
}

function isErrorRedirectFor(location: URL, requestedRedirect: URL): boolean {
  if (!location.searchParams.has("error")) return false;
  const callback = new URL(location.href);
  for (const parameter of ["error", "error_description", "error_uri", "state"]) {
    callback.searchParams.delete(parameter);
  }
  return callback.href === requestedRedirect.href;
}

/**
 * The upstream OAuth router validates PKCE before retaining `state`, so its
 * missing/plain-PKCE redirects omit a caller-supplied state value. Add it only
 * to an OAuth error redirect whose destination still exactly matches the
 * requested callback; pre-redirect client/callback failures remain direct 400s.
 */
export function preserveOAuthStateOnErrorRedirect(): RequestHandler {
  return (req, res, next) => {
    const originalLocation = res.location.bind(res);
    res.location = ((value: string) => {
      const state = requestParameter(req.method, req.body, req.query, "state");
      const redirectUri = requestParameter(
        req.method,
        req.body,
        req.query,
        "redirect_uri",
      );
      if (state === undefined || redirectUri === undefined) {
        return originalLocation(value);
      }

      try {
        const location = new URL(value, "http://localhost");
        const requestedRedirect = new URL(redirectUri);
        if (
          !location.searchParams.has("state") &&
          isErrorRedirectFor(location, requestedRedirect)
        ) {
          location.searchParams.set("state", state);
          return originalLocation(location.href);
        }
      } catch {
        // Let Express preserve the SDK's original behavior for malformed URLs.
      }
      return originalLocation(value);
    }) as typeof res.location;
    next();
  };
}
