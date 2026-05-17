import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createMcpServer,
  type McpServerHandle,
  type McpToolDefinition,
} from '../../../src/server/create-mcp-server.js';
import { isErrorEnvelope } from '../../../src/server/errors.js';
import { withHooks } from '../../../src/server/instrumentation-hooks.js';
import { createLinkedTransportPair } from './in-process-transport.js';

interface TestRig {
  handle: McpServerHandle;
  client: Client;
}

let activeRig: TestRig | undefined;

afterEach(async () => {
  if (activeRig) {
    await activeRig.client.close();
    await activeRig.handle.close();
    activeRig = undefined;
  }
});

describe('withHooks — happy-path invariants (AC3.a)', () => {
  it('invokes before → handler → after in order, with non-negative duration', async () => {
    const order: string[] = [];
    const before = vi.fn(() => {
      order.push('before');
    });
    const after = vi.fn((ctx: { durationMs: number }) => {
      order.push('after');
      expect(ctx.durationMs).toBeGreaterThanOrEqual(0);
      expect(ctx.durationMs).toBeLessThan(100);
    });
    const error = vi.fn();

    const wrapped = withHooks(
      async () => {
        order.push('handler');
        return { content: [{ type: 'text' as const, text: 'ok' }] };
      },
      { before, after, error },
      { toolName: 'happy_tool' },
    );

    const result = await wrapped({ message: 'x' });
    expect(order).toEqual(['before', 'handler', 'after']);
    expect(after).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
    expect(result.content).toEqual([{ type: 'text', text: 'ok' }]);
  });
});

describe('withHooks — error path (AC3.b, AC3.c)', () => {
  it('invokes error hook and re-throws the original error', async () => {
    const after = vi.fn();
    const error = vi.fn();
    const wrapped = withHooks(
      async () => {
        throw new Error('boom');
      },
      { after, error },
      { toolName: 'throwing_tool' },
    );

    await expect(wrapped({})).rejects.toThrow('boom');
    expect(error).toHaveBeenCalledOnce();
    expect(after).not.toHaveBeenCalled();
    const ctx = error.mock.calls[0]?.[0] as { err: unknown; durationMs: number };
    expect((ctx.err as Error).message).toBe('boom');
    expect(ctx.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('withHooks — hook self-faults must not pollute business result (AC3.d)', () => {
  it('swallows before-hook throws into console.warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const wrapped = withHooks(
        async () => ({ content: [{ type: 'text' as const, text: 'still ok' }] }),
        {
          before: () => {
            throw new Error('hook bad');
          },
        },
        { toolName: 'self_fault_tool' },
      );
      const result = await wrapped({});
      expect(result.content).toEqual([{ type: 'text', text: 'still ok' }]);
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]?.[0]).toMatch(/before hook threw/);
    } finally {
      warn.mockRestore();
    }
  });

  it('swallows after-hook rejections without affecting result', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const wrapped = withHooks(
        async () => ({ content: [{ type: 'text' as const, text: 'still ok' }] }),
        {
          after: async () => {
            throw new Error('after bad');
          },
        },
      );
      const result = await wrapped({});
      expect(result.content).toEqual([{ type: 'text', text: 'still ok' }]);
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]?.[0]).toMatch(/after hook threw/);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('withHooks — async hooks awaited (AC3.e)', () => {
  it('waits for async before-hook before invoking handler', async () => {
    const order: string[] = [];
    const wrapped = withHooks(
      async () => {
        order.push('handler');
        return { content: [{ type: 'text' as const, text: 'ok' }] };
      },
      {
        before: async () => {
          await new Promise((r) => setTimeout(r, 5));
          order.push('before-done');
        },
      },
    );
    await wrapped({});
    expect(order).toEqual(['before-done', 'handler']);
  });
});

describe('withHooks — toolName propagation (AC3.f)', () => {
  it('propagates explicit toolName into all hook contexts', async () => {
    const before = vi.fn();
    const after = vi.fn();
    const wrapped = withHooks(
      async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
      { before, after },
      { toolName: 'named_tool' },
    );
    await wrapped({ a: 1 });
    expect(before.mock.calls[0]?.[0]).toMatchObject({ toolName: 'named_tool', args: { a: 1 } });
    expect(after.mock.calls[0]?.[0]).toMatchObject({ toolName: 'named_tool' });
  });

  it("defaults toolName to '<unknown>' when opts omitted", async () => {
    const before = vi.fn();
    const wrapped = withHooks(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }), {
      before,
    });
    await wrapped({});
    expect(before.mock.calls[0]?.[0]).toMatchObject({ toolName: '<unknown>' });
  });
});

describe('withHooks — coordinates with Story 1.3 wrapHandler (AC3.g)', () => {
  it('lets factory wrapHandler convert errors into INTERNAL_ERROR envelope while still firing error hook', async () => {
    const error = vi.fn();
    const throwingTool: McpToolDefinition = {
      name: 'wrapped_throwing_tool',
      description: 'Throws but is wrapped with hooks.',
      inputSchema: z.object({}),
      handler: withHooks(
        async () => {
          throw new Error('boom-via-hooks');
        },
        { error },
        { toolName: 'wrapped_throwing_tool' },
      ),
    };
    const handle = createMcpServer({
      name: 'hooks-integration',
      version: '0.0.0-test',
      tools: [throwingTool],
    });
    const [serverTransport, clientTransport] = createLinkedTransportPair();
    await handle.server.connect(serverTransport);
    const client = new Client({ name: 'hooks-client', version: '0.0.0-test' });
    await client.connect(clientTransport);
    activeRig = { handle, client };

    const result = await client.callTool({ name: 'wrapped_throwing_tool', arguments: {} });
    expect(isErrorEnvelope(result)).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.error).toBe('INTERNAL_ERROR');
    expect(sc.message).toBe('boom-via-hooks');
    expect(error).toHaveBeenCalledOnce();
  });
});
