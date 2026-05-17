/**
 * Dev tool — fetch SHA-256 + byte size for the pinned files of a HuggingFace
 * model repository, and emit a ready-to-paste TypeScript literal for
 * `src/rag/model-manifest.ts`.
 *
 * Usage:
 *   pnpm --filter @yiong/mcp-chinese-rag-toolkit manifest:fetch
 *   pnpm --filter @yiong/mcp-chinese-rag-toolkit manifest:fetch -- --dry-run
 *   pnpm --filter @yiong/mcp-chinese-rag-toolkit manifest:fetch -- --model Xenova/bge-reranker-v2-m3
 *   pnpm --filter @yiong/mcp-chinese-rag-toolkit manifest:fetch -- --dry-run --model Xenova/bge-reranker-v2-m3
 *
 * Output goes to stdout. The script never writes to disk — supply-chain
 * defence: a human reviewer must paste the values into the manifest and
 * inspect the diff before commit.
 *
 * Uses `curl` so the standard `http_proxy` / `https_proxy` env vars work
 * transparently (Node fetch does not honour them by default in v22).
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const DEFAULT_MODEL_ID = 'Xenova/bge-large-zh-v1.5';

/**
 * Registry of recognised model ids and their pinned file lists.
 *
 * Each entry mirrors the `files[]` order used in the corresponding
 * `*_MANIFEST` literal under `src/rag/model-manifest.ts`. Adding a new model
 * to this registry is the supported way to extend the dev tool without
 * touching the parsing / curl / hashing layers.
 */
const MODEL_REGISTRY: Readonly<Record<string, readonly string[]>> = {
  'Xenova/bge-large-zh-v1.5': [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'special_tokens_map.json',
    'onnx/model.onnx',
    'onnx/model_quantized.onnx',
  ],
  // NOTE — Story 2.5 §架构现实校正 #7:
  //   `Xenova/bge-reranker-v2-m3` does NOT exist on HF Hub (returns 401 for
  //   unauthenticated requests; the Xenova organisation never published this
  //   reranker). The canonical transformers.js-compatible ONNX repository is
  //   `onnx-community/bge-reranker-v2-m3-ONNX` (10k+ downloads, transformers.js
  //   library tag). Its tokenizer is fully baked into tokenizer.json (17MB),
  //   so there is NO separate sentencepiece.bpe.model file at root. fp32
  //   weights are split across `onnx/model.onnx` + `onnx/model.onnx_data`
  //   (2.27GB total external-data layout); to honour Story 2.5's "~568MB"
  //   size budget + ~2GB total CI cache target, we pin `onnx/model_quantized.onnx`
  //   (q8 dtype; 570MB single file) instead of fp32. Reranker accuracy
  //   degradation from q8 is documented (<1% NDCG drop on MIRACL-zh) and
  //   acceptable for FR25 / NFR17 `< 0.5` low-confidence threshold use.
  'onnx-community/bge-reranker-v2-m3-ONNX': [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'special_tokens_map.json',
    'onnx/model_quantized.onnx',
  ],
};

interface FetchedEntry {
  relativePath: string;
  sha256: string;
  bytes: number;
}

interface CliArgs {
  modelId: string;
  dryRun: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let modelId = DEFAULT_MODEL_ID;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--model') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        throw new Error(
          'fetch-model-manifest: --model requires a value (e.g. --model Xenova/bge-reranker-v2-m3)',
        );
      }
      modelId = next;
      i += 1;
      continue;
    }
    if (arg.startsWith('--model=')) {
      modelId = arg.slice('--model='.length);
    }
  }
  return { modelId, dryRun };
}

async function curlBuffer(url: string): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    const child = spawn('curl', ['-fsSL', url], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on('data', (b: Buffer) => chunks.push(b));
    child.stderr.on('data', (b: Buffer) => errChunks.push(b));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`curl exited ${code}: ${Buffer.concat(errChunks).toString().trim()}`));
    });
  });
}

async function curlHead(url: string): Promise<{ contentLength: number }> {
  return await new Promise((resolve, reject) => {
    const child = spawn('curl', ['-fsSLI', url], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on('data', (b: Buffer) => chunks.push(b));
    child.stderr.on('data', (b: Buffer) => errChunks.push(b));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(`curl HEAD exited ${code}: ${Buffer.concat(errChunks).toString().trim()}`),
        );
        return;
      }
      const headers = Buffer.concat(chunks).toString('utf8');
      const match = headers.match(/^content-length:\s*(\d+)/im);
      resolve({ contentLength: match ? Number(match[1]) : -1 });
    });
  });
}

async function hashFile(modelId: string, relativePath: string): Promise<FetchedEntry> {
  const url = `https://huggingface.co/${modelId}/resolve/main/${relativePath}`;
  const buf = await curlBuffer(url);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  return { relativePath, sha256, bytes: buf.byteLength };
}

async function headFile(
  modelId: string,
  relativePath: string,
): Promise<{ relativePath: string; bytes: number }> {
  const url = `https://huggingface.co/${modelId}/resolve/main/${relativePath}`;
  const { contentLength } = await curlHead(url);
  return { relativePath, bytes: contentLength };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const pinnedFiles = MODEL_REGISTRY[args.modelId];
  if (!pinnedFiles) {
    const known = Object.keys(MODEL_REGISTRY).join(', ');
    throw new Error(
      `fetch-model-manifest: unknown --model "${args.modelId}". Known models: ${known}. ` +
        'Add it to MODEL_REGISTRY before running.',
    );
  }

  process.stderr.write(
    `# fetching ${pinnedFiles.length} files from huggingface.co/${args.modelId}\n`,
  );

  const results: Array<FetchedEntry | { relativePath: string; bytes: number }> = [];
  for (const path of pinnedFiles) {
    const entry = args.dryRun
      ? await headFile(args.modelId, path)
      : await hashFile(args.modelId, path);
    process.stderr.write(
      `# ${path} ✓  (${'sha256' in entry ? entry.sha256 : '<dry-run>'}, ${entry.bytes} bytes)\n`,
    );
    results.push(entry);
  }

  process.stdout.write(
    `\n// --- paste into src/rag/model-manifest.ts (model: ${args.modelId}) ---\n`,
  );
  process.stdout.write('files: [\n');
  for (const entry of results) {
    const sha = 'sha256' in entry ? entry.sha256 : '<filled by hash run>';
    process.stdout.write(
      `  { relativePath: ${JSON.stringify(entry.relativePath).padEnd(36)}, ` +
        `sha256: '${sha}', bytes: ${entry.bytes} },\n`,
    );
  }
  process.stdout.write('],\n');
}

main().catch((err: unknown) => {
  process.stderr.write(
    `fetch-model-manifest: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
