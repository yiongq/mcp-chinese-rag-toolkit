export type TransportKind = 'stdio' | 'http';

export interface TransportSelectInput {
  transport?: TransportKind;
}

const VALID_TRANSPORTS: readonly TransportKind[] = ['stdio', 'http'];

function isTransportKind(value: unknown): value is TransportKind {
  return typeof value === 'string' && (VALID_TRANSPORTS as readonly string[]).includes(value);
}

export function selectTransport(
  config: TransportSelectInput,
  env: NodeJS.ProcessEnv = process.env,
): TransportKind {
  if (config.transport !== undefined) {
    if (!isTransportKind(config.transport)) {
      throw new Error(
        `createMcpServer: config.transport must be "stdio" or "http" (got ${JSON.stringify(config.transport)})`,
      );
    }
    return config.transport;
  }

  // Trim to tolerate `.env` / heredoc whitespace and trailing newlines.
  const rawEnv = env.MCP_TRANSPORT;
  const fromEnv = typeof rawEnv === 'string' ? rawEnv.trim() : rawEnv;
  if (fromEnv === undefined || fromEnv === '') {
    return 'stdio';
  }
  if (!isTransportKind(fromEnv)) {
    throw new Error(`MCP_TRANSPORT must be "stdio" or "http" (got ${JSON.stringify(fromEnv)})`);
  }
  return fromEnv;
}
