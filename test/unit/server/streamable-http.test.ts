import { request as httpRequest } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  connectStreamableHttp,
  type StreamableHttpHandle,
} from '../../../src/server/streamable-http.js';

let activeHandle: StreamableHttpHandle | undefined;

afterEach(async () => {
  if (activeHandle) {
    await activeHandle.close();
    activeHandle = undefined;
  }
});

function buildFactory(): () => McpServer {
  return () => new McpServer({ name: 'http-test', version: '0.0.0-test' });
}

async function start(opts: Partial<Parameters<typeof connectStreamableHttp>[1]> = {}) {
  const handle = await connectStreamableHttp(buildFactory(), {
    port: 0,
    host: '127.0.0.1',
    requestTimeoutMs: 2_000,
    ...opts,
  });
  activeHandle = handle;
  return handle;
}

interface PostResult {
  status: number;
  body: unknown;
  raw: string;
}

async function postRaw(
  handle: StreamableHttpHandle,
  path: string,
  body: string,
  extraHeaders: Record<string, string> = {},
): Promise<PostResult> {
  const url = `http://${handle.host}:${handle.port}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body,
  });
  const raw = await res.text();
  let parsed: unknown;
  try {
    parsed = raw.length === 0 ? null : JSON.parse(raw);
  } catch {
    parsed = raw;
  }
  return { status: res.status, body: parsed, raw };
}

describe('connectStreamableHttp — request validation', () => {
  it('rejects non-/mcp paths (strict equality, not prefix)', async () => {
    const handle = await start({ port: 38771 });
    const a = await postRaw(handle, '/mcpadmin', '{}');
    expect(a.status).toBe(404);
    const b = await postRaw(handle, '/mcp/anything', '{}');
    expect(b.status).toBe(404);
    const c = await postRaw(handle, '/', '{}');
    expect(c.status).toBe(404);
  });

  it('rejects non-POST methods with 405', async () => {
    const handle = await start({ port: 38772 });
    const url = `http://${handle.host}:${handle.port}/mcp`;
    const res = await fetch(url, { method: 'GET' });
    expect(res.status).toBe(405);
  });

  it('returns 400 with JSON-RPC -32700 on malformed JSON', async () => {
    const handle = await start({ port: 38773 });
    const res = await postRaw(handle, '/mcp', '{not valid json');
    expect(res.status).toBe(400);
    const body = res.body as { error?: { code?: number } };
    expect(body.error?.code).toBe(-32700);
  });

  it('returns 400 on empty body', async () => {
    const handle = await start({ port: 38774 });
    const res = await postRaw(handle, '/mcp', '');
    expect(res.status).toBe(400);
    const body = res.body as { error?: { code?: number } };
    expect(body.error?.code).toBe(-32700);
  });

  it('enforces maxBodyBytes', async () => {
    const handle = await start({ port: 38775, maxBodyBytes: 256 });
    const oversized = JSON.stringify({ data: 'x'.repeat(1024) });
    const res = await postRaw(handle, '/mcp', oversized);
    expect(res.status).toBe(413);
  });

  it('rejects disallowed Host header (DNS-rebinding protection)', async () => {
    // The Host header is restricted in browsers / undici fetch — drop down to
    // raw node:http to forge it.
    const handle = await start({ port: 38776, allowedHosts: ['127.0.0.1'] });
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          host: handle.host,
          port: handle.port,
          path: '/mcp',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Host: 'attacker.example' },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end('{}');
    });
    expect(status).toBe(403);
  });
});

describe('connectStreamableHttp — concurrent requests', () => {
  it('handles concurrent requests without cross-talk (per-request server factory)', async () => {
    // Each request gets a fresh McpServer; the factory's responses should not
    // be jumbled even when many requests arrive in parallel.
    const handle = await start({ port: 38777 });

    // Send 5 parallel `initialize` requests; each should get back an SSE response
    // whose `id` matches the request's id (per JSON-RPC).
    const url = `http://${handle.host}:${handle.port}/mcp`;
    const ids = [1, 2, 3, 4, 5];
    const responses = await Promise.all(
      ids.map((id) =>
        fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'initialize',
            id,
            params: {
              protocolVersion: '2025-03-26',
              clientInfo: { name: 'concurrent-test', version: '0.0.0' },
              capabilities: {},
            },
          }),
        }).then(async (r) => ({ status: r.status, body: await r.text() })),
      ),
    );

    for (const [i, r] of responses.entries()) {
      expect(r.status, `request ${ids[i]} status`).toBe(200);
      // SSE body includes the JSON-RPC id we sent.
      expect(r.body, `request ${ids[i]} body`).toContain(`"id":${ids[i]}`);
    }
  });
});
