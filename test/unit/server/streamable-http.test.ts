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

describe('connectStreamableHttp — CORS (Story 4.6)', () => {
  const VALID_JSONRPC = JSON.stringify({
    jsonrpc: '2.0',
    method: 'initialize',
    id: 1,
    params: {
      protocolVersion: '2025-03-26',
      clientInfo: { name: 'cors-test', version: '0.0.0' },
      capabilities: {},
    },
  });

  it('echoes Access-Control-Allow-Origin for an exact-match whitelisted origin', async () => {
    const handle = await start({ port: 38781, cors: { origins: ['https://app.example.com'] } });
    const res = await fetch(`http://${handle.host}:${handle.port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Origin: 'https://app.example.com',
      },
      body: VALID_JSONRPC,
    });
    await res.text();
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
    // Never a bare '*' — credentialed-request-safe + strict whitelist semantics.
    expect(res.headers.get('access-control-allow-origin')).not.toBe('*');
    expect(res.headers.get('vary')).toBe('Origin');
  });

  it('matches chrome-extension://* wildcard against any extension id (scheme-anchored)', async () => {
    const handle = await start({ port: 38782, cors: { origins: ['chrome-extension://*'] } });
    for (const id of ['abc123', 'pqrstuvwxyz0123456789']) {
      const origin = `chrome-extension://${id}`;
      const res = await fetch(`http://${handle.host}:${handle.port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: VALID_JSONRPC,
      });
      await res.text();
      expect(res.headers.get('access-control-allow-origin')).toBe(origin);
    }
  });

  it('does NOT echo ACAO for a non-whitelisted origin (server still responds, no 500)', async () => {
    const handle = await start({ port: 38783, cors: { origins: ['chrome-extension://*'] } });
    const res = await fetch(`http://${handle.host}:${handle.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.com', Accept: 'application/json, text/event-stream' },
      body: VALID_JSONRPC,
    });
    await res.text();
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    // Vary: Origin rides on EVERY CORS-eligible response (even non-matches) so a
    // shared cache can't replay this no-ACAO body to a whitelisted origin (review).
    expect(res.headers.get('vary')).toBe('Origin');
    // The request itself still succeeds at the HTTP layer (browser, not server, enforces CORS).
    expect(res.status).toBe(200);
  });

  it('wildcard does NOT match a different scheme (no substring leak)', async () => {
    const handle = await start({ port: 38784, cors: { origins: ['chrome-extension://*'] } });
    // 'https://chrome-extension.evil.com' contains the literal substring but is a different scheme.
    const res = await fetch(`http://${handle.host}:${handle.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://chrome-extension.evil.com' },
      body: VALID_JSONRPC,
    });
    await res.text();
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers OPTIONS preflight from a whitelisted origin with 204 + CORS headers', async () => {
    const handle = await start({ port: 38785, cors: { origins: ['chrome-extension://*'] } });
    const res = await fetch(`http://${handle.host}:${handle.port}/mcp`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'chrome-extension://abc123',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type, mcp-session-id',
      },
    });
    await res.text();
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('chrome-extension://abc123');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(res.headers.get('access-control-allow-methods')).toContain('OPTIONS');
    // Echoes the requested headers verbatim so we never under-allow a future SDK header.
    expect(res.headers.get('access-control-allow-headers')).toBe('content-type, mcp-session-id');
    expect(res.headers.get('access-control-max-age')).toBe('86400');
  });

  it('OPTIONS from a non-whitelisted origin → 204 without ACAO (browser blocks)', async () => {
    const handle = await start({ port: 38786, cors: { origins: ['chrome-extension://*'] } });
    const res = await fetch(`http://${handle.host}:${handle.port}/mcp`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.com', 'Access-Control-Request-Method': 'POST' },
    });
    await res.text();
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('carries ACAO on error responses too (browser must read the error body)', async () => {
    const handle = await start({ port: 38787, cors: { origins: ['chrome-extension://*'] } });
    const res = await fetch(`http://${handle.host}:${handle.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'chrome-extension://abc123' },
      body: '{not valid json',
    });
    await res.text();
    expect(res.status).toBe(400);
    expect(res.headers.get('access-control-allow-origin')).toBe('chrome-extension://abc123');
  });

  it('without cors config: no ACAO header and OPTIONS still 405 (backward compat)', async () => {
    const handle = await start({ port: 38788 });
    const post = await fetch(`http://${handle.host}:${handle.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'chrome-extension://abc123' },
      body: VALID_JSONRPC,
    });
    await post.text();
    expect(post.headers.get('access-control-allow-origin')).toBeNull();

    const options = await fetch(`http://${handle.host}:${handle.port}/mcp`, {
      method: 'OPTIONS',
      headers: { Origin: 'chrome-extension://abc123' },
    });
    await options.text();
    expect(options.status).toBe(405);
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
