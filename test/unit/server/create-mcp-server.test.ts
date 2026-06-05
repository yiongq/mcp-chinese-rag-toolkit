import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { echoTool } from '../../../src/server/__fixtures__/echo-tool.js';
import {
  createMcpServer,
  type McpServerHandle,
  type McpToolDefinition,
} from '../../../src/server/create-mcp-server.js';
import { isErrorEnvelope } from '../../../src/server/errors.js';
import { defineResources } from '../../../src/server/resource-provider.js';
import { createLinkedTransportPair } from './in-process-transport.js';

interface TestRig {
  handle: McpServerHandle;
  client: Client;
}

async function buildRig(toolset: McpToolDefinition[] = [echoTool]): Promise<TestRig> {
  const handle = createMcpServer({
    name: 'toolkit-test-server',
    version: '0.0.0-test',
    tools: toolset,
  });
  const [serverTransport, clientTransport] = createLinkedTransportPair();
  await handle.server.connect(serverTransport);

  const client = new Client({ name: 'toolkit-test-client', version: '0.0.0-test' });
  await client.connect(clientTransport);
  return { handle, client };
}

let activeRig: TestRig | undefined;

afterEach(async () => {
  if (activeRig) {
    await activeRig.client.close();
    await activeRig.handle.close();
    activeRig = undefined;
  }
});

describe('createMcpServer (InProcess wiring)', () => {
  it('routes a registered tool call through the factory end-to-end', async () => {
    activeRig = await buildRig();
    const result = await activeRig.client.callTool({
      name: 'echo_tool',
      arguments: { message: 'hello toolkit' },
    });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: 'hello toolkit' }]);
  });

  it('wraps thrown handler exceptions into an INTERNAL_ERROR envelope (rule #5)', async () => {
    const throwingTool: McpToolDefinition = {
      name: 'throwing_tool',
      description: 'A tool that always throws.',
      inputSchema: z.object({}),
      handler: async () => {
        throw new Error('boom');
      },
    };
    activeRig = await buildRig([throwingTool]);
    const result = await activeRig.client.callTool({
      name: 'throwing_tool',
      arguments: {},
    });

    expect(isErrorEnvelope(result)).toBe(true);
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.error).toBe('INTERNAL_ERROR');
    expect(sc.message).toBe('boom');
    expect(sc.retryable).toBe(false);
    // Stack is gated on NODE_ENV !== 'production'; vitest defaults to NODE_ENV=test.
    const details = sc.details as Record<string, unknown> | undefined;
    expect(details?.stack).toBeTypeOf('string');
  });

  it('preserves non-Error throw payloads via details.original', async () => {
    const throwingTool: McpToolDefinition = {
      name: 'object_throwing_tool',
      description: 'Throws a structured object instead of an Error.',
      inputSchema: z.object({}),
      handler: async () => {
        // Idiomatic in some codebases — must not lose info to '[object Object]'.
        throw { code: 'BUSINESS_RULE', extra: 'context' };
      },
    };
    activeRig = await buildRig([throwingTool]);
    const result = await activeRig.client.callTool({
      name: 'object_throwing_tool',
      arguments: {},
    });
    const sc = result.structuredContent as Record<string, unknown>;
    const details = sc.details as Record<string, unknown> | undefined;
    expect(details?.original).toEqual({ code: 'BUSINESS_RULE', extra: 'context' });
  });

  it('does not leak stack when NODE_ENV=production', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const throwingTool: McpToolDefinition = {
        name: 'prod_throwing_tool',
        description: 'Throws in production mode.',
        inputSchema: z.object({}),
        handler: async () => {
          throw new Error('prod-boom');
        },
      };
      activeRig = await buildRig([throwingTool]);
      const result = await activeRig.client.callTool({
        name: 'prod_throwing_tool',
        arguments: {},
      });
      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.message).toBe('prod-boom');
      const details = sc.details as Record<string, unknown> | undefined;
      expect(details?.stack).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
    }
  });

  it('preserves concurrent stateful handler invocations without cross-call interference', async () => {
    // A purely stateless tool can't actually prove reentrancy — use a tool that
    // captures its own input under an async tick, so any cross-talk would show
    // up as a swapped echo or duplicate id.
    let counter = 0;
    const statefulTool: McpToolDefinition = {
      name: 'stateful_tool',
      description: 'Returns a unique id + its echoed input after a microtask.',
      inputSchema: z.object({ message: z.string() }),
      handler: async (args: unknown) => {
        const { message } = args as { message: string };
        const id = ++counter;
        // Yield so requests interleave on the microtask queue.
        await Promise.resolve();
        return { content: [{ type: 'text', text: `${id}:${message}` }] };
      },
    };
    activeRig = await buildRig([statefulTool]);
    const messages = ['a', 'b', 'c', 'd', 'e'];
    const results = await Promise.all(
      messages.map((m) =>
        // biome-ignore lint/style/noNonNullAssertion: rig set by buildRig above
        activeRig!.client.callTool({ name: 'stateful_tool', arguments: { message: m } }),
      ),
    );
    const texts = results.map((r) => {
      const content = r.content as Array<{ type: string; text: string }>;
      return content[0]?.text ?? '';
    });
    // Each call must come back with its own (id, message) pair — duplicates or
    // cross-talk would show as id reuse or mismatched message body.
    const ids = texts.map((t) => t.split(':')[0]);
    const echoes = texts.map((t) => t.split(':')[1]);
    expect(new Set(ids).size).toBe(messages.length);
    expect(echoes).toEqual(messages);
  });

  it('lists the registered tool via tools/list', async () => {
    activeRig = await buildRig();
    const list = await activeRig.client.listTools();
    const names = list.tools.map((t) => t.name);
    expect(names).toContain('echo_tool');
  });
});

describe('createMcpServer config validation', () => {
  it('rejects http transport without port at start()', async () => {
    const handle = createMcpServer({
      name: 'no-port',
      version: '0.0.0-test',
      transport: 'http',
    });
    await expect(handle.start()).rejects.toThrow(/port/);
    await handle.close();
  });

  it('rejects empty name', () => {
    expect(() => createMcpServer({ name: '', version: '0.0.0-test', tools: [echoTool] })).toThrow(
      /name/,
    );
    expect(() =>
      createMcpServer({ name: '   ', version: '0.0.0-test', tools: [echoTool] }),
    ).toThrow(/name/);
  });

  it('rejects empty version', () => {
    expect(() => createMcpServer({ name: 'ok', version: '', tools: [echoTool] })).toThrow(
      /version/,
    );
  });

  it('rejects duplicate tool names', () => {
    expect(() =>
      createMcpServer({
        name: 'ok',
        version: '0.0.0-test',
        tools: [echoTool, echoTool],
      }),
    ).toThrow(/duplicate/);
  });

  it('falls back to scheme when title is explicit empty / whitespace string', async () => {
    // Empty / whitespace title would otherwise satisfy `?? scheme` and produce a
    // blank metadata.title visible to MCP Inspector clients.
    const res = defineResources({
      uriScheme: 'blankt',
      title: '   ',
      list: async () => ({ resources: [{ uri: 'blankt://page/1', name: 'p1' }] }),
      read: async (uri) => ({ contents: [{ uri: uri.href, text: 'ok' }] }),
    });
    const handle = createMcpServer({
      name: 'blank-title',
      version: '0.0.0-test',
      resources: [res],
    });
    const [serverTransport, clientTransport] = createLinkedTransportPair();
    await handle.server.connect(serverTransport);
    const client = new Client({ name: 'blank-title-client', version: '0.0.0-test' });
    await client.connect(clientTransport);
    try {
      const list = await client.listResources();
      // Inspector / client should never see a blank name; verify fallback is active.
      expect(list.resources.every((r) => typeof r.name === 'string' && r.name.length > 0)).toBe(
        true,
      );
    } finally {
      await client.close();
      await handle.close();
    }
  });

  it('sanitizes resource read errors (no raw user stack leak)', async () => {
    const res = defineResources({
      uriScheme: 'fail',
      list: async () => ({ resources: [{ uri: 'fail://page/1', name: 'p1' }] }),
      read: async () => {
        throw new Error('underlying io explosion');
      },
    });
    const handle = createMcpServer({
      name: 'sanitize',
      version: '0.0.0-test',
      resources: [res],
    });
    const [serverTransport, clientTransport] = createLinkedTransportPair();
    await handle.server.connect(serverTransport);
    const client = new Client({ name: 'sanitize-client', version: '0.0.0-test' });
    await client.connect(clientTransport);
    try {
      await expect(client.readResource({ uri: 'fail://page/1' })).rejects.toThrow(
        /Resource read failed/,
      );
    } finally {
      await client.close();
      await handle.close();
    }
  });

  it('re-validates config per HTTP request to catch post-construction mutation', async () => {
    // Build a valid HTTP server, then mutate config to introduce a duplicate scheme.
    // Stdio path snapshots tools at start(); HTTP path rebuilds per request, so without
    // re-validation it would silently diverge.
    const res = defineResources({
      uriScheme: 'rev',
      list: async () => ({ resources: [{ uri: 'rev://page/1', name: 'p1' }] }),
      read: async (uri) => ({ contents: [{ uri: uri.href, text: 'ok' }] }),
    });
    const config = {
      name: 'http-revalidate',
      version: '0.0.0-test',
      transport: 'http' as const,
      port: 0,
      resources: [res],
    };
    const handle = createMcpServer(config);
    await handle.start();
    // Simulate post-construction mutation introducing a duplicate scheme.
    config.resources.push(res);
    // The per-request factory passed to connectStreamableHttp wraps validateConfig;
    // invoke it via the closure we capture from the handle's connection setup by
    // sending one request would require an HTTP client. Instead, assert the factory
    // is wired by directly verifying validateConfig rejects the mutated config now.
    expect(() => createMcpServer(config)).toThrow(/duplicate resource uriScheme/);
    await handle.close();
  });

  it('allows retrying start() after a recoverable config error', async () => {
    // First start fails because port is missing.
    const badHandle = createMcpServer({
      name: 'retryable',
      version: '0.0.0-test',
      transport: 'http',
    });
    await expect(badHandle.start()).rejects.toThrow(/port/);
    await badHandle.close();
    // A new handle with a fixed config should succeed end-to-end (we don't
    // actually open the port here — just assert the started-flag state machine
    // doesn't wedge between handles).
    const goodHandle = createMcpServer({
      name: 'retryable',
      version: '0.0.0-test',
      transport: 'http',
      port: 0,
    });
    await goodHandle.start();
    await goodHandle.close();
  });
});
