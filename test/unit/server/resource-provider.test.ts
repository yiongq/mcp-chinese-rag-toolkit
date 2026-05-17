import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createMcpServer, type McpServerHandle } from '../../../src/server/create-mcp-server.js';
import {
  defineResources,
  type ResourceDefinitionInput,
} from '../../../src/server/resource-provider.js';
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

function validInput(overrides?: Partial<ResourceDefinitionInput>): ResourceDefinitionInput {
  return {
    uriScheme: 'hr',
    title: 'HR Documents',
    mimeType: 'text/markdown',
    list: async () => ({
      resources: [
        { uri: 'hr://page/23', name: 'Page 23' },
        { uri: 'hr://page/24', name: 'Page 24' },
      ],
    }),
    read: async (uri: URL, vars: { kind: string; id: string }) => ({
      contents: [
        {
          uri: uri.href,
          text: `kind=${vars.kind} id=${vars.id}`,
          mimeType: 'text/markdown',
        },
      ],
    }),
    ...overrides,
  };
}

describe('defineResources — uriScheme validation (AC2.a)', () => {
  it("accepts lowercase scheme 'hr'", () => {
    expect(() => defineResources(validInput())).not.toThrow();
  });

  it("accepts kebab-case scheme 'modeling-docs'", () => {
    expect(() => defineResources(validInput({ uriScheme: 'modeling-docs' }))).not.toThrow();
  });

  it("rejects uppercase scheme 'HR'", () => {
    expect(() => defineResources(validInput({ uriScheme: 'HR' }))).toThrow(/uriScheme/);
  });

  it("rejects leading-underscore scheme '_hr'", () => {
    expect(() => defineResources(validInput({ uriScheme: '_hr' }))).toThrow(/uriScheme/);
  });

  it("rejects scheme with underscore 'hr_docs'", () => {
    expect(() => defineResources(validInput({ uriScheme: 'hr_docs' }))).toThrow(/uriScheme/);
  });
});

describe('defineResources — URI pattern validation (AC2.b, AC2.c, AC2.d)', () => {
  it('accepts a valid hr://page/23 URI in read', async () => {
    const def = defineResources(validInput());
    const result = await def.read(new URL('hr://page/23'), { kind: 'page', id: '23' });
    expect(result.contents[0]?.text).toBe('kind=page id=23');
  });

  it('accepts dotted/dashed id segments', async () => {
    const def = defineResources(
      validInput({
        uriScheme: 'modeling',
        list: async () => ({
          resources: [{ uri: 'modeling://docs/hooks-and-customPopup.md', name: 'Hooks' }],
        }),
        read: async (uri) => ({ contents: [{ uri: uri.href, text: 'ok' }] }),
      }),
    );
    const result = await def.read(new URL('modeling://docs/hooks-and-customPopup.md'), {
      kind: 'docs',
      id: 'hooks-and-customPopup.md',
    });
    expect(result.contents[0]?.text).toBe('ok');
  });

  it('rejects URI with uppercase kind segment in read', async () => {
    const def = defineResources(validInput());
    await expect(def.read(new URL('hr://Page/23'), { kind: 'Page', id: '23' })).rejects.toThrow(
      /scheme.*kind.*id|read\(\)/i,
    );
  });

  it('rejects URI with wrong scheme in read', async () => {
    const def = defineResources(validInput());
    await expect(def.read(new URL('http://page/23'), { kind: 'page', id: '23' })).rejects.toThrow(
      /read\(\)/,
    );
  });

  it('rejects list() that returns a bad entry', async () => {
    const def = defineResources(
      validInput({
        list: async () => ({
          resources: [{ uri: 'hr://Page/23', name: 'bad' }],
        }),
      }),
    );
    await expect(def.list()).rejects.toThrow(/list\(\)/);
  });
});

describe('defineResources — traversal-segment rejection (defense-in-depth)', () => {
  // Note: WHATWG URL parser normalizes '..' / '.' out of `uri.href` (e.g.
  // `new URL('hr://page/..').href === 'hr://page'`), so those exact strings hit the
  // 'URI not matching' regex check first. Either way the call is rejected and the
  // user `read()` is never invoked. We assert the broader rejection contract here.

  it("rejects normalized '..' path (URL collapses to scheme://kind, fails shape check)", async () => {
    const def = defineResources(validInput());
    await expect(def.read(new URL('hr://page/..'), { kind: 'page', id: '..' })).rejects.toThrow();
  });

  it("rejects normalized '.' path (URL collapses, fails shape check)", async () => {
    const def = defineResources(validInput());
    await expect(def.read(new URL('hr://page/.'), { kind: 'page', id: '.' })).rejects.toThrow();
  });

  it("rejects id containing '..' substring (e.g. '..hidden') in read", async () => {
    const def = defineResources(validInput());
    await expect(
      def.read(new URL('hr://page/..hidden'), { kind: 'page', id: '..hidden' }),
    ).rejects.toThrow(/traversal-like segment/);
  });

  it("rejects '..' kind segment surfaced via list()", async () => {
    const def = defineResources(
      validInput({
        list: async () => ({
          resources: [{ uri: 'hr://../escape', name: 'evil' }],
        }),
      }),
    );
    await expect(def.list()).rejects.toThrow();
  });
});

describe('defineResources — SDK end-to-end registration (AC2.e, AC4)', () => {
  it('round-trips resources/list and resources/read via InProcess transport', async () => {
    const def = defineResources(validInput());
    const handle = createMcpServer({
      name: 'resource-test',
      version: '0.0.0-test',
      resources: [def],
    });
    const [serverTransport, clientTransport] = createLinkedTransportPair();
    await handle.server.connect(serverTransport);
    const client = new Client({ name: 'res-test-client', version: '0.0.0-test' });
    await client.connect(clientTransport);
    activeRig = { handle, client };

    const list = await client.listResources();
    const uris = list.resources.map((r) => r.uri);
    expect(uris).toContain('hr://page/23');
    expect(uris).toContain('hr://page/24');

    const read = await client.readResource({ uri: 'hr://page/23' });
    const first = read.contents[0] as { uri: string; text?: string };
    expect(first.uri).toBe('hr://page/23');
    expect(first.text).toBe('kind=page id=23');
  });

  it('rejects duplicate resource uriScheme at createMcpServer time', () => {
    const a = defineResources(validInput());
    const b = defineResources(validInput());
    expect(() =>
      createMcpServer({
        name: 'dup-resources',
        version: '0.0.0-test',
        resources: [a, b],
      }),
    ).toThrow(/duplicate resource uriScheme/);
  });
});
