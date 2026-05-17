import { describe, expect, it } from 'vitest';
import { selectTransport } from '../../../src/server/transport-factory.js';

describe('selectTransport', () => {
  it('prefers explicit config.transport over env', () => {
    expect(selectTransport({ transport: 'http' }, { MCP_TRANSPORT: 'stdio' })).toBe('http');
    expect(selectTransport({ transport: 'stdio' }, { MCP_TRANSPORT: 'http' })).toBe('stdio');
  });

  it('falls back to MCP_TRANSPORT env when no explicit config', () => {
    expect(selectTransport({}, { MCP_TRANSPORT: 'stdio' })).toBe('stdio');
    expect(selectTransport({}, { MCP_TRANSPORT: 'http' })).toBe('http');
  });

  it('defaults to stdio when neither config nor env set', () => {
    expect(selectTransport({}, {})).toBe('stdio');
    expect(selectTransport({}, { MCP_TRANSPORT: '' })).toBe('stdio');
  });

  it('trims whitespace and newlines on env value', () => {
    expect(selectTransport({}, { MCP_TRANSPORT: ' stdio' })).toBe('stdio');
    expect(selectTransport({}, { MCP_TRANSPORT: 'http ' })).toBe('http');
    expect(selectTransport({}, { MCP_TRANSPORT: 'stdio\n' })).toBe('stdio');
    expect(selectTransport({}, { MCP_TRANSPORT: '   ' })).toBe('stdio');
  });

  it('throws fail-fast on illegal env value (lowercase only, no auto-coerce)', () => {
    expect(() => selectTransport({}, { MCP_TRANSPORT: 'HTTP' })).toThrow(/MCP_TRANSPORT/);
    expect(() => selectTransport({}, { MCP_TRANSPORT: 'STDIO' })).toThrow(/MCP_TRANSPORT/);
    expect(() => selectTransport({}, { MCP_TRANSPORT: 'websocket' })).toThrow(/MCP_TRANSPORT/);
  });

  it('throws fail-fast on illegal explicit config value with config-scoped message', () => {
    expect(() => selectTransport({ transport: 'tcp' as 'stdio' })).toThrow(/config\.transport/);
    // Non-string values should also be rejected (runtime callers e.g. YAML loaders).
    expect(() => selectTransport({ transport: 123 as unknown as 'stdio' })).toThrow(
      /config\.transport/,
    );
    expect(() => selectTransport({ transport: null as unknown as 'stdio' })).toThrow(
      /config\.transport/,
    );
  });
});
