import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export interface ToolHookContext {
  toolName: string;
  args: unknown;
}

export interface ToolHooks {
  before?: (ctx: ToolHookContext) => void | Promise<void>;
  after?: (
    ctx: ToolHookContext & { result: CallToolResult; durationMs: number },
  ) => void | Promise<void>;
  error?: (ctx: ToolHookContext & { err: unknown; durationMs: number }) => void | Promise<void>;
}

// Hook failures must never affect business results — Phase 2 OTel injection is observability,
// not a business dependency. Per architecture.md L608 we surface via console.warn.
async function runHookSafe(
  phase: 'before' | 'after' | 'error',
  hook: ((ctx: never) => void | Promise<void>) | undefined,
  ctx: unknown,
): Promise<void> {
  if (!hook) return;
  try {
    await Promise.resolve((hook as (ctx: unknown) => void | Promise<void>)(ctx));
  } catch (err) {
    console.warn(`[withHooks] ${phase} hook threw:`, err);
  }
}

export function withHooks(
  handler: (args: unknown) => Promise<CallToolResult> | CallToolResult,
  hooks: ToolHooks,
  opts?: { toolName?: string },
): (args: unknown) => Promise<CallToolResult> {
  const toolName = opts?.toolName ?? '<unknown>';
  return async (args: unknown): Promise<CallToolResult> => {
    const baseCtx: ToolHookContext = { toolName, args };
    // performance.now() over Date.now(): higher precision and immune to wall-clock jumps.
    const startedAt = performance.now();
    await runHookSafe('before', hooks.before, baseCtx);
    try {
      const result = await handler(args);
      const durationMs = performance.now() - startedAt;
      await runHookSafe('after', hooks.after, { ...baseCtx, result, durationMs });
      return result;
    } catch (err) {
      const durationMs = performance.now() - startedAt;
      await runHookSafe('error', hooks.error, { ...baseCtx, err, durationMs });
      // Re-throw the original error so Story 1.3 wrapHandler owns envelope conversion;
      // double-wrapping would lose stack trace and break the INTERNAL_ERROR contract.
      throw err;
    }
  };
}
