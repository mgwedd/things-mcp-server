#!/usr/bin/env node
/**
 * things-mcp-server — MCP server entry point.
 *
 * Transports: stdio (for Cowork / Claude Desktop registration).
 *
 * Tools are registered from src/tools/. Every call passes through executeTool()
 * which applies policy and writes an audit row.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";

import { closeAuditDb } from "./audit.js";
import { clearSecretCache } from "./keychain.js";
import { reloadPolicy } from "./policy.js";
import { executeTool, TOOLS } from "./tools/index.js";

const server = new Server(
  {
    name: "things-mcp-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools: Tool[] = TOOLS.map((t) => ({
    name: t.name,
    description:
      t.description +
      (t.requiresToken
        ? " [Reorganize tool: requires Things URL auth-token from Keychain.]"
        : ""),
    inputSchema: zodToJsonSchema(t.inputSchema, { $refStrategy: "none" }) as Tool["inputSchema"],
  }));
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const result = await executeTool(name, args ?? {});

  if (!result.ok) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error: ${result.error ?? "unknown error"} (policy: ${result.policyDecision})`,
        },
      ],
    };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result.data, null, 2),
      },
    ],
  };
});

// ----------------------------- lifecycle -----------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // SIGHUP → reload policy without restart.
  process.on("SIGHUP", () => {
    try {
      reloadPolicy();
      process.stderr.write("things-mcp: policy reloaded\n");
    } catch (err) {
      process.stderr.write(`things-mcp: policy reload failed: ${err instanceof Error ? err.message : err}\n`);
    }
  });

  // Graceful shutdown: zero all cached secrets, close the audit DB.
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      clearSecretCache();
      closeAuditDb();
      process.exit(0);
    });
  }
}

main().catch((err) => {
  process.stderr.write(`things-mcp: fatal: ${err instanceof Error ? err.stack : err}\n`);
  process.exit(1);
});
