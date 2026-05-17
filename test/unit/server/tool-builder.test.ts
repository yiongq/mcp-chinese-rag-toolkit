import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createMcpServer, type McpServerHandle } from '../../../src/server/create-mcp-server.js';
import { defineTool } from '../../../src/server/tool-builder.js';
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

function validDef() {
  return {
    name: 'echo_tool',
    description: 'Echoes the input message back.',
    whenToUse: 'For toolkit smoke testing only.',
    inputSchema: z.object({ message: z.string() }),
    handler: async (args: { message: string }) => ({
      content: [{ type: 'text' as const, text: args.message }],
    }),
  };
}

describe('defineTool — name validation (AC1.a)', () => {
  it('accepts a valid snake_case name', () => {
    expect(() => defineTool(validDef())).not.toThrow();
  });

  it('accepts a multi-segment snake_case name', () => {
    const def = { ...validDef(), name: 'search_hr_docs' };
    expect(() => defineTool(def)).not.toThrow();
  });

  it("rejects CamelCase name 'EchoTool'", () => {
    const def = { ...validDef(), name: 'EchoTool' };
    expect(() => defineTool(def)).toThrow(/snake_case/);
  });

  it("rejects kebab-case name 'echo-tool'", () => {
    const def = { ...validDef(), name: 'echo-tool' };
    expect(() => defineTool(def)).toThrow(/snake_case/);
  });

  it("rejects leading-underscore name '_echo'", () => {
    const def = { ...validDef(), name: '_echo' };
    expect(() => defineTool(def)).toThrow(/snake_case/);
  });

  it("rejects name with space 'echo tool'", () => {
    const def = { ...validDef(), name: 'echo tool' };
    expect(() => defineTool(def)).toThrow(/snake_case/);
  });

  it('rejects empty name', () => {
    const def = { ...validDef(), name: '' };
    expect(() => defineTool(def)).toThrow(/snake_case/);
  });
});

describe('defineTool — inputSchema keys validation (AC1.b)', () => {
  it('accepts camelCase keys', () => {
    const def = {
      ...validDef(),
      inputSchema: z.object({ typeName: z.string(), env: z.string() }),
      handler: async (_args: { typeName: string; env: string }) => ({
        content: [{ type: 'text' as const, text: 'ok' }],
      }),
    };
    expect(() => defineTool(def)).not.toThrow();
  });

  it('rejects snake_case key', () => {
    const def = {
      ...validDef(),
      inputSchema: z.object({ type_name: z.string() }),
      handler: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
    };
    expect(() => defineTool(def)).toThrow(/camelCase/);
  });

  it('rejects kebab-case key', () => {
    const def = {
      ...validDef(),
      inputSchema: z.object({ 'Type-Name': z.string() }),
      handler: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
    };
    expect(() => defineTool(def)).toThrow(/camelCase/);
  });

  it('rejects PascalCase key', () => {
    const def = {
      ...validDef(),
      inputSchema: z.object({ TypeName: z.string() }),
      handler: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
    };
    expect(() => defineTool(def)).toThrow(/camelCase/);
  });
});

describe('defineTool — non-ZodObject schema fallback (AC1.c)', () => {
  it('warns instead of throwing when inputSchema is z.unknown()', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const def = {
        ...validDef(),
        // biome-ignore lint/suspicious/noExplicitAny: schema fallback path requires bypassing generic
        inputSchema: z.unknown() as any,
        handler: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
      };
      expect(() => defineTool(def)).not.toThrow();
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('defineTool — composeDescription / whenToUse / length cap (AC1.d, AC1.e)', () => {
  it('renders description without examples', () => {
    const tool = defineTool(validDef());
    expect(tool.description).toMatch(/Echoes the input message back\./);
    expect(tool.description).toMatch(/\*\*When to use\*\*: For toolkit smoke testing only\./);
    expect(tool.description).not.toMatch(/\*\*Examples\*\*/);
  });

  it('renders description with multiple examples in numbered order', () => {
    const def = {
      ...validDef(),
      examples: [
        { description: 'short echo', input: { message: 'hi' } },
        { description: 'long echo', input: { message: 'hello world' } },
      ],
    };
    const tool = defineTool(def);
    expect(tool.description).toMatch(/\*\*Examples\*\*:/);
    expect(tool.description).toMatch(/1\. short echo/);
    expect(tool.description).toMatch(/Input: \{"message":"hi"\}/);
    expect(tool.description).toMatch(/2\. long echo/);
  });

  it('omits Examples section when examples is empty array', () => {
    const def = { ...validDef(), examples: [] };
    const tool = defineTool(def);
    expect(tool.description).not.toMatch(/\*\*Examples\*\*/);
  });

  it('throws when whenToUse is empty string', () => {
    const def = { ...validDef(), whenToUse: '' };
    expect(() => defineTool(def)).toThrow(/whenToUse/);
  });

  it('throws when whenToUse is whitespace only', () => {
    const def = { ...validDef(), whenToUse: '   ' };
    expect(() => defineTool(def)).toThrow(/whenToUse/);
  });

  it('throws when composed description exceeds MAX_TOOL_DESCRIPTION_CHARS (2048)', () => {
    const huge = 'x'.repeat(3000);
    const def = { ...validDef(), whenToUse: huge };
    expect(() => defineTool(def)).toThrow(/MAX_TOOL_DESCRIPTION_CHARS/);
  });

  it('throws when description is empty string', () => {
    const def = { ...validDef(), description: '' };
    expect(() => defineTool(def)).toThrow(/description.*required.*non-empty/);
  });

  it('throws when description is whitespace only', () => {
    const def = { ...validDef(), description: '   ' };
    expect(() => defineTool(def)).toThrow(/description.*required.*non-empty/);
  });

  it('throws a friendly error when an example.input contains BigInt', () => {
    const def = {
      ...validDef(),
      examples: [
        // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid BigInt payload
        { description: 'bigint case', input: { v: 1n as any } },
      ],
    };
    expect(() => defineTool(def)).toThrow(/examples\[0\]\.input is not JSON-serializable/);
  });

  it('throws a friendly error when an example.input is circular', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const def = {
      ...validDef(),
      examples: [{ description: 'cycle', input: circular }],
    };
    expect(() => defineTool(def)).toThrow(/examples\[0\]\.input is not JSON-serializable/);
  });
});

describe('defineTool — array-shape fallback (defense-in-depth)', () => {
  it('warns instead of throwing when inputSchema.shape is an array', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const fakeArrayShapeSchema = {
        shape: ['a', 'b'],
      };
      const def = {
        ...validDef(),
        // biome-ignore lint/suspicious/noExplicitAny: forcing the array-shape edge case past TS
        inputSchema: fakeArrayShapeSchema as any,
        handler: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
      };
      expect(() => defineTool(def)).not.toThrow();
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('defineTool — createMcpServer integration (AC4)', () => {
  it('routes a defineTool result through the factory end-to-end', async () => {
    const tool = defineTool(validDef());
    const handle = createMcpServer({
      name: 'tool-builder-test',
      version: '0.0.0-test',
      tools: [tool],
    });
    const [serverTransport, clientTransport] = createLinkedTransportPair();
    await handle.server.connect(serverTransport);
    const client = new Client({ name: 'tb-test-client', version: '0.0.0-test' });
    await client.connect(clientTransport);
    activeRig = { handle, client };

    const result = await client.callTool({
      name: 'echo_tool',
      arguments: { message: 'integration ok' },
    });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: 'integration ok' }]);
  });
});
