#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'node:url';
import { createBiliService } from './service.mjs';

// This transport is launched privately by the DSH host. Identity is attached
// in protocol metadata by that host, not present in model-facing tool schemas.
// Do not expose this process as an unauthenticated network MCP endpoint.
export function createServer(service: any = createBiliService()) {
  const server = new Server({name:'chopsticks-bili',version:'1.0.0'},{capabilities:{tools:{}}});
  server.setRequestHandler(ListToolsRequestSchema, async () => ({tools:service.listTools()}));
  server.setRequestHandler(CallToolRequestSchema, async (request?: any,extra?: any) => {
    const caller = request.params._meta?.chopsticksCaller || {};
    return service.call(request.params.name,request.params.arguments || {},{...caller,signal:extra.signal});
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
