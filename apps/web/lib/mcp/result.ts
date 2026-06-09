import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Wrap tool output as a JSON text content block. */
export function ok(data: unknown): CallToolResult {
  const text =
    typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }] };
}

/** Wrap an error as an `isError` tool result (visible to the model). */
export function err(message: string): CallToolResult {
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}
