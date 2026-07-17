import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

type RawRequestHandler = (
  request: unknown,
  extra: unknown,
) => unknown | Promise<unknown>;

type ProtocolWithRequestHandlers = {
  _requestHandlers?: Map<string, RawRequestHandler>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function copySecuritySchemes(meta: unknown): Record<string, unknown>[] | undefined {
  if (!isRecord(meta) || !Array.isArray(meta.securitySchemes)) return undefined;

  const copied: Record<string, unknown>[] = [];
  for (const candidate of meta.securitySchemes) {
    if (!isRecord(candidate) || typeof candidate.type !== "string") return undefined;
    if (
      candidate.type === "oauth2" &&
      (!Array.isArray(candidate.scopes) ||
        !candidate.scopes.every((scope) => typeof scope === "string"))
    ) {
      return undefined;
    }
    copied.push({
      ...candidate,
      ...(Array.isArray(candidate.scopes)
        ? { scopes: [...candidate.scopes] }
        : {}),
    });
  }
  return copied;
}

/**
 * MCP SDK 1.29 serializes the legacy `_meta.securitySchemes` mirror but drops
 * the current top-level field from tools/list. Wrap its already-installed list
 * handler so the wire response contains both without duplicating the SDK's
 * schema conversion or tool-enable logic.
 */
export function installToolSecuritySchemeCompatibility(server: McpServer): void {
  const protocol = server.server as unknown as ProtocolWithRequestHandlers;
  const original = protocol._requestHandlers?.get("tools/list");
  if (!original) {
    throw new Error("The MCP tools/list handler was not installed before its compatibility wrapper");
  }

  server.server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
    const result = await original(request, extra);
    if (!isRecord(result) || !Array.isArray(result.tools)) return result as never;

    return {
      ...result,
      tools: result.tools.map((tool) => {
        if (!isRecord(tool) || Array.isArray(tool.securitySchemes)) return tool;
        const securitySchemes = copySecuritySchemes(tool._meta);
        return securitySchemes ? { ...tool, securitySchemes } : tool;
      }),
    } as never;
  });
}
