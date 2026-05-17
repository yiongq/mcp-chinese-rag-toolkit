import type {
  Transport,
  TransportSendOptions,
} from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage, MessageExtraInfo } from '@modelcontextprotocol/sdk/types.js';

/**
 * Per prior-art reference §2.12: two transports linked via `_setPeer`,
 * `send()` dispatches via `queueMicrotask(() => peer.onmessage?.(msg))`
 * so requests/responses interleave like a real wire without setImmediate latency.
 * Re-implemented from the description (no source copy) to keep the IP boundary clean.
 */
class InProcessTransport implements Transport {
  private peer: InProcessTransport | undefined;
  private started = false;
  private closed = false;

  public onclose: (() => void) | undefined;
  public onerror: ((error: Error) => void) | undefined;
  public onmessage:
    | (<T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void)
    | undefined;
  public sessionId: string | undefined;
  public setProtocolVersion: ((version: string) => void) | undefined;

  _setPeer(peer: InProcessTransport): void {
    this.peer = peer;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
  }

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    if (this.closed) throw new Error('InProcessTransport: send after close');
    const peer = this.peer;
    if (!peer) throw new Error('InProcessTransport: no peer connected');
    queueMicrotask(() => {
      if (peer.closed) return;
      try {
        peer.onmessage?.(message);
      } catch (err) {
        // Sync exceptions in onmessage would otherwise escape the microtask as
        // an unhandled exception. Route to peer.onerror per Transport contract.
        peer.onerror?.(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const peer = this.peer;
    this.peer = undefined;
    this.onclose?.();
    if (peer && !peer.closed) {
      await peer.close();
    }
  }
}

export function createLinkedTransportPair(): [Transport, Transport] {
  const a = new InProcessTransport();
  const b = new InProcessTransport();
  a._setPeer(b);
  b._setPeer(a);
  return [a, b];
}
