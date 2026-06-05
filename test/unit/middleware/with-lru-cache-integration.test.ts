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
import { createLinkedTransportPair } from '../server/in-process-transport.js';

interface TestRig {
  handle: McpServerHandle;
  client: Client;
}

async function buildRig(tools: McpToolDefinition[], cache: McpServerCacheConfig): Promise<TestRig> {
  const config: McpServerConfig = {
    name: 'integration-cache-server',
    version: '0.0.0-test',
    tools,
    cache,
  };
  const handle = createMcpServer(config);
  const [serverTransport, clientTransport] = createLinkedTransportPair();
  await handle.server.connect(serverTransport);
  const client = new Client({ name: 'integration-cache-client', version: '0.0.0-test' });
  await client.connect(clientTransport);
  return { handle, client };
}

function makeStubSearchTool(latencyMs: number = 20): {
  tool: McpToolDefinition;
  handler: ReturnType<typeof vi.fn>;
} {
  const handler = vi.fn(async (args: unknown) => {
    const { query } = args as { query: string };
    // Simulate ~hybrid + rerank baseline cold path
    await new Promise((resolve) => setTimeout(resolve, latencyMs));
    return {
      content: [{ type: 'text', text: `result for ${query}` }],
      structuredContent: { hits: [{ id: 1, text: query }] },
    };
  });
  const tool: McpToolDefinition = {
    name: 'stub-search',
    description: 'In-process stub search tool with simulated latency.',
    inputSchema: z.object({
      query: z.string(),
      env: z.string().optional(),
    }),
    handler,
  };
  return { tool, handler };
}

const rigs: TestRig[] = [];

afterEach(async () => {
  while (rigs.length > 0) {
    const r = rigs.pop();
    if (!r) continue;
    await r.client.close();
    await r.handle.close();
  }
});

describe('withLruCache integration (in-process MCP server)', () => {
  it('second call (same args) returns < 5ms with _meta.cache === "hit"', async () => {
    const { tool, handler } = makeStubSearchTool(30);
    const rig = await buildRig([tool], { indexVersion: 'v1' });
    rigs.push(rig);

    await rig.client.callTool({ name: 'stub-search', arguments: { query: '试用期' } });
    const t0 = performance.now();
    const r2 = await rig.client.callTool({ name: 'stub-search', arguments: { query: '试用期' } });
    const elapsed = performance.now() - t0;

    expect(handler).toHaveBeenCalledTimes(1);
    const sc = r2.structuredContent as { _meta: { cache: string } };
    expect(sc._meta.cache).toBe('hit');
    expect(elapsed).toBeLessThan(5);
  });

  it('args canonicalize: trimmed query hits the same cache slot', async () => {
    const { tool, handler } = makeStubSearchTool(1);
    const rig = await buildRig([tool], { indexVersion: 'v1' });
    rigs.push(rig);

    await rig.client.callTool({ name: 'stub-search', arguments: { query: '试用期 ' } });
    const r2 = await rig.client.callTool({
      name: 'stub-search',
      arguments: { query: '试用期' },
    });
    expect(handler).toHaveBeenCalledTimes(1);
    const sc = r2.structuredContent as { _meta: { cache: string } };
    expect(sc._meta.cache).toBe('hit');
  });

  it('env=prod is never cached (double miss across calls)', async () => {
    const { tool, handler } = makeStubSearchTool(1);
    const rig = await buildRig([tool], { indexVersion: 'v1' });
    rigs.push(rig);

    await rig.client.callTool({
      name: 'stub-search',
      arguments: { query: '试用期', env: 'prod' },
    });
    await rig.client.callTool({
      name: 'stub-search',
      arguments: { query: '试用期', env: 'prod' },
    });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('different indexVersion across server instances → no cache cross-bleed', async () => {
    const a = makeStubSearchTool(1);
    const b = makeStubSearchTool(1);
    const rigA = await buildRig([a.tool], { indexVersion: 'v1' });
    const rigB = await buildRig([b.tool], { indexVersion: 'v2' });
    rigs.push(rigA, rigB);

    await rigA.client.callTool({ name: 'stub-search', arguments: { query: 'q' } });
    const rB = await rigB.client.callTool({ name: 'stub-search', arguments: { query: 'q' } });

    expect(a.handler).toHaveBeenCalledTimes(1);
    expect(b.handler).toHaveBeenCalledTimes(1);
    const sc = rB.structuredContent as { _meta: { cache: string } };
    expect(sc._meta.cache).toBe('miss');
  });
});
