import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiGet, apiPost } from './api-client';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE }
  from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';

function makeTextResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

export async function startMcpServer(): Promise<void> {
  const server = new McpServer(
    { name: 'scopai', version: '1.3.29' },
  );

  // === Tools will be registered below ===

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
