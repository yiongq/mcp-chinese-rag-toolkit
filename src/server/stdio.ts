import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

export interface StdioServerHandle {
  close(): Promise<void>;
}

export interface ConnectStdioOptions {
  /**
   * Install SIGINT/SIGTERM/SIGHUP listeners that close the transport then exit
   * the process. Defaults to true — appropriate for the canonical "stdio MCP
   * server is the process" use case. Set to false when embedding the toolkit
   * inside a host process that manages its own signal handling.
   */
  handleSignals?: boolean;
}

const HANDLED_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

export async function connectStdio(
  server: McpServer,
  options: ConnectStdioOptions = {},
): Promise<StdioServerHandle> {
  const handleSignals = options.handleSignals ?? true;
  const transport = new StdioServerTransport();
  await server.connect(transport);

  let closed = false;

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    if (handleSignals) {
      for (const sig of HANDLED_SIGNALS) {
        process.off(sig, signalHandler);
      }
    }
    await transport.close();
  };

  const signalHandler = (): void => {
    close().then(
      () => process.exit(0),
      (err) => {
        // Surface the close error before exiting; previous `.finally` swallowed it.
        process.stderr.write(
          `[mcp-chinese-rag-toolkit] stdio transport close failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exit(1);
      },
    );
  };

  if (handleSignals) {
    for (const sig of HANDLED_SIGNALS) {
      process.once(sig, signalHandler);
    }
  }

  return { close };
}
