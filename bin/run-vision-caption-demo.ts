#!/usr/bin/env node
/**
 * Story 2.8 dev-only demo CLI — runs `withVisionCaption` against a sample
 * PDF using Anthropic Claude Haiku. Requires:
 *   - ANTHROPIC_API_KEY env var
 *   - @anthropic-ai/sdk installed (pnpm add -D @anthropic-ai/sdk)
 *   - @napi-rs/canvas installed (pnpm add @napi-rs/canvas)
 *   - sample PDF path passed as the first argument (any PDF with ≥1 image)
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... pnpm vision:demo path/to/sample.pdf
 *
 * Exit codes:
 *   0 — Demo succeeded; captions printed to stdout
 *   1 — Demo failed (missing env / missing peer / vision LLM error)
 *
 * NOT WIRED TO CI — vision LLM calls cost real money; Story 2.7 教训 8
 * "CI gate 是行为门槛不烧钱" is the binding constraint. Run locally
 * before opening PRs that touch vision-caption code.
 */
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parsePdf } from '../src/rag/index.js';
import type { VisionProvider } from '../src/rag/plugins/types.js';
import { withVisionCaption } from '../src/rag/plugins/with-vision-caption.js';

export interface CliArgs {
  pdfPath: string;
}

/**
 * Parse CLI flags. Exported for unit testing — fail-fast on missing
 * positional argument mirrors `bin/run-eval.ts#parseArgs`.
 */
export function parseArgs(argv: readonly string[]): CliArgs {
  if (argv.length < 1) {
    throw new Error('run-vision-caption-demo: expected sample PDF path as first argument');
  }
  const pdfPath = argv[0];
  // Reject any leading-dash form (`-x`, `--help`, …) so user typos
  // surface as a clear error instead of an `ENOENT` from `readFile`.
  if (typeof pdfPath !== 'string' || pdfPath === '' || pdfPath.startsWith('-')) {
    throw new Error('run-vision-caption-demo: pdfPath argument must be a non-empty path string');
  }
  return { pdfPath };
}

/**
 * Load the Anthropic vision provider via dynamic import (so missing SDK
 * yields an actionable error here, NOT at module evaluation time).
 *
 * The toolkit's `templates/anthropic-vision-provider.ts` is the canonical
 * adapter to copy — this CLI replicates the same shape so the demo path
 * is self-contained.
 */
async function loadAnthropicProvider(apiKey: string): Promise<VisionProvider> {
  let AnthropicCtor: new (opts: { apiKey: string }) => unknown;
  try {
    const dynamicImport = new Function('s', 'return import(s)') as (
      s: string,
    ) => Promise<{ default: new (opts: { apiKey: string }) => unknown }>;
    const mod = await dynamicImport('@anthropic-ai/sdk');
    AnthropicCtor = mod.default;
  } catch (importErr) {
    // Only the genuine "module is missing" case maps to the install
    // hint. Any other error (SDK initialization throw, syntax error in
    // a corrupted install, ESM/CJS interop bug) is rethrown with the
    // original error preserved as `cause` so users see the real
    // failure instead of a misleading "not installed" message.
    if (isModuleNotFound(importErr)) {
      throw new Error(
        'run-vision-caption-demo: @anthropic-ai/sdk is not installed. ' +
          'Install with: pnpm add -D @anthropic-ai/sdk',
      );
    }
    throw new Error(
      `run-vision-caption-demo: failed to load @anthropic-ai/sdk: ${
        importErr instanceof Error ? importErr.message : String(importErr)
      }`,
      { cause: importErr },
    );
  }
  const modelId = 'claude-haiku-4-5';
  const client = new AnthropicCtor({ apiKey }) as {
    messages: {
      create(
        body: unknown,
        opts: { signal: AbortSignal },
      ): Promise<{ content: Array<{ type: string; text?: string }> }>;
    };
  };
  return {
    providerId: 'anthropic',
    modelId,
    async caption({ imagePng, prompt, timeoutMs }) {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), timeoutMs);
      try {
        const response = await client.messages.create(
          {
            model: modelId,
            max_tokens: 500,
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'image',
                    source: {
                      type: 'base64',
                      media_type: 'image/png',
                      data: Buffer.from(imagePng).toString('base64'),
                    },
                  },
                  { type: 'text', text: prompt },
                ],
              },
            ],
          },
          { signal: abort.signal },
        );
        const block = response.content.find((b) => b.type === 'text');
        if (!block || typeof block.text !== 'string') {
          throw new Error('run-vision-caption-demo: Anthropic response had no text block');
        }
        return block.text;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function isModuleNotFound(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  if (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') return true;
  const msg = (err as { message?: unknown }).message;
  return typeof msg === 'string' && /Cannot find (?:package|module)/i.test(msg);
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  // Single top-level try/catch — without it, any throw past the env-key
  // check rejects the returned Promise (instead of returning 1 per the
  // documented "Exit codes: 1 — Demo failed" contract).
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (typeof apiKey !== 'string' || apiKey === '') {
      process.stderr.write(
        'run-vision-caption-demo: ANTHROPIC_API_KEY is required. Set it before invoking.\n',
      );
      return 1;
    }

    const args = parseArgs(argv);
    const pdfAbs = path.isAbsolute(args.pdfPath) ? args.pdfPath : path.resolve(args.pdfPath);
    process.stdout.write(`run-vision-caption-demo: loading PDF ${pdfAbs}\n`);
    const pdfBytes = await readFile(pdfAbs);
    const parsed = await parsePdf(pdfBytes);
    process.stdout.write(`run-vision-caption-demo: ${parsed.totalPages} pages parsed\n`);

    const provider = await loadAnthropicProvider(apiKey);
    const plugin = withVisionCaption({ provider, maxConcurrency: 3 });
    const chunks =
      (await plugin.enrichPdf?.(parsed.pages, {
        source: path.basename(pdfAbs),
        pdfBytes,
      })) ?? [];
    process.stdout.write(`run-vision-caption-demo: produced ${chunks.length} caption chunks\n\n`);
    for (const c of chunks) {
      process.stdout.write(`[page ${c.page} ${c.section ?? ''}]\n${c.content}\n\n`);
    }
    return 0;
  } catch (err) {
    process.stderr.write(
      `run-vision-caption-demo: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    return 1;
  }
}

// Gate auto-execution so unit tests can import `parseArgs` / `main`
// without triggering a real Anthropic API call. Mirrors
// `bin/run-eval.ts#isEntrypoint` but normalizes both sides through
// `pathToFileURL(realpathSync(...))` so we still detect entrypoint
// invocations when the file is loaded via `tsx` (the `pnpm vision:demo`
// script's runner), via symlinks, or through pnpm's package manager
// shims. A bare `===` between `import.meta.url` and `path.resolve(argv[1])`
// silently fails in all three cases.
const isEntrypoint = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const moduleUrl = pathToFileURL(realpathSync(fileURLToPath(import.meta.url))).href;
    const entryUrl = pathToFileURL(realpathSync(entry)).href;
    return moduleUrl === entryUrl;
  } catch {
    return false;
  }
})();

if (isEntrypoint) {
  // `main()` itself returns 1 instead of rejecting now, but keep the
  // outer .catch as a belt-and-suspenders for catastrophic top-level
  // failures (e.g. an exception thrown synchronously by main()).
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      process.stderr.write(
        `run-vision-caption-demo: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
      );
      process.exit(1);
    });
}
