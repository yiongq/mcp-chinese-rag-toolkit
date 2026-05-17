import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createMcpServer,
  type McpServerCacheConfig,
  type McpServerConfig,
  type McpServerHandle,
  type McpToolDefinition,
} from '../../../src/server/create-mcp-server.js';
import { createLinkedTransportPair } from './in-process-transport.js';

interface TestRig {
  handle: McpServerHandle;
  client: Client;
}

async function buildRig(
  tools: McpToolDefinition[],
  cache?: McpServerCacheConfig,
): Promise<TestRig> {
  const config: McpServerConfig = {
    name: 'cache-test-server',
    version: '0.0.0-test',
    tools,
    ...(cache !== undefined && { cache }),
  };
  const handle = createMcpServer(config);
  const [serverTransport, clientTransport] = createLinkedTransportPair();
  await handle.server.connect(serverTransport);

  const client = new Client({ name: 'cache-test-client', version: '0.0.0-test' });
  await client.connect(clientTransport);
  return { handle, client };
}

function stubSearchTool(name: string = 'search_hr_docs'): {
  tool: McpToolDefinition;
  handler: ReturnType<typeof vi.fn>;
} {
  const handler = vi.fn(async (args: unknown) => {
    const { query } = args as { query: string };
    return {
      content: [{ type: 'text', text: `result for ${query}` }],
      structuredContent: { hits: [{ id: 1, text: query }] },
    };
  });
  const tool: McpToolDefinition = {
    name,
    description: 'Stub search tool for cache integration tests.',
    inputSchema: z.object({ query: z.string() }),
    handler,
  };
  return { tool, handler };
}

let activeRig: TestRig | undefined;

afterEach(async () => {
  if (activeRig) {
    await activeRig.client.close();
    await activeRig.handle.close();
    activeRig = undefined;
  }
});

describe('createMcpServer with Story 2.6 cache', () => {
  it('cache: undefined → backward-compatible, handler invoked every time', async () => {
    const { tool, handler } = stubSearchTool();
    activeRig = await buildRig([tool]);

    await activeRig.client.callTool({ name: tool.name, arguments: { query: 'q' } });
    await activeRig.client.callTool({ name: tool.name, arguments: { query: 'q' } });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('cache: {} (no indexVersion) → warns once + cache disabled', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { tool, handler } = stubSearchTool();
    activeRig = await buildRig([tool], {});

    expect(warn).toHaveBeenCalledWith(
      'createMcpServer: cache.indexVersion not provided, cache disabled',
    );
    await activeRig.client.callTool({ name: tool.name, arguments: { query: 'q' } });
    await activeRig.client.callTool({ name: tool.name, arguments: { query: 'q' } });
    expect(handler).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('cache: { indexVersion: "v1" } → second identical call is a hit (handler called once)', async () => {
    const { tool, handler } = stubSearchTool();
    activeRig = await buildRig([tool], { indexVersion: 'v1' });

    const r1 = await activeRig.client.callTool({ name: tool.name, arguments: { query: 'q' } });
    const r2 = await activeRig.client.callTool({ name: tool.name, arguments: { query: 'q' } });

    expect(handler).toHaveBeenCalledTimes(1);
    const sc1 = r1.structuredContent as { _meta: { cache: string } };
    const sc2 = r2.structuredContent as { _meta: { cache: string } };
    expect(sc1._meta.cache).toBe('miss');
    expect(sc2._meta.cache).toBe('hit');
  });

  it('cache: { enabled: false, indexVersion: "v1" } → bypasses wrap (double miss)', async () => {
    const { tool, handler } = stubSearchTool();
    activeRig = await buildRig([tool], { enabled: false, indexVersion: 'v1' });

    await activeRig.client.callTool({ name: tool.name, arguments: { query: 'q' } });
    await activeRig.client.callTool({ name: tool.name, arguments: { query: 'q' } });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('multi-tool: each tool gets its own cache namespace', async () => {
    const a = stubSearchTool('tool_a');
    const b = stubSearchTool('tool_b');
    activeRig = await buildRig([a.tool, b.tool], { indexVersion: 'v1' });

    await activeRig.client.callTool({ name: 'tool_a', arguments: { query: 'q' } });
    await activeRig.client.callTool({ name: 'tool_a', arguments: { query: 'q' } });
    await activeRig.client.callTool({ name: 'tool_b', arguments: { query: 'q' } });
    await activeRig.client.callTool({ name: 'tool_b', arguments: { query: 'q' } });

    expect(a.handler).toHaveBeenCalledTimes(1);
    expect(b.handler).toHaveBeenCalledTimes(1);
  });

  it('throwing handler → INTERNAL_ERROR envelope is NOT cached (double miss)', async () => {
    let throws = 2;
    const handler = vi.fn(async () => {
      if (throws-- > 0) throw new Error('boom');
      return {
        content: [{ type: 'text', text: 'ok-now' }],
        structuredContent: { value: 'ok' },
      };
    });
    const tool: McpToolDefinition = {
      name: 'throwing_then_ok',
      description: 'Throws twice then succeeds — used to verify isError is never cached.',
      inputSchema: z.object({ q: z.string() }),
      handler,
    };
    activeRig = await buildRig([tool], { indexVersion: 'v1' });

    const r1 = await activeRig.client.callTool({ name: tool.name, arguments: { q: 'x' } });
    expect(r1.isError).toBe(true);
    const r2 = await activeRig.client.callTool({ name: tool.name, arguments: { q: 'x' } });
    expect(r2.isError).toBe(true);
    // Both calls hit the inner handler because the previous isError result was not cached.
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
