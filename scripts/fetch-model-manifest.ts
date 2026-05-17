/**
 * Dev tool — fetch SHA-256 + byte size for the pinned files of
 * `Xenova/bge-large-zh-v1.5` from the HuggingFace Hub, and emit a ready-to-
 * paste TypeScript literal for `src/rag/model-manifest.ts`.
 *
 * Usage:
 *   pnpm --filter @yiong/mcp-chinese-rag-toolkit manifest:fetch
 *   pnpm --filter @yiong/mcp-chinese-rag-toolkit manifest:fetch -- --dry-run
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

const MODEL_ID = 'Xenova/bge-large-zh-v1.5';

const PINNED_FILES: readonly string[] = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'onnx/model.onnx',
  'onnx/model_quantized.onnx',
];

interface FetchedEntry {
  relativePath: string;
  sha256: string;
  bytes: number;
}

const DRY_RUN = process.argv.includes('--dry-run');

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

async function hashFile(relativePath: string): Promise<FetchedEntry> {
  const url = `https://huggingface.co/${MODEL_ID}/resolve/main/${relativePath}`;
  const buf = await curlBuffer(url);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  return { relativePath, sha256, bytes: buf.byteLength };
}

async function headFile(relativePath: string): Promise<{ relativePath: string; bytes: number }> {
  const url = `https://huggingface.co/${MODEL_ID}/resolve/main/${relativePath}`;
  const { contentLength } = await curlHead(url);
  return { relativePath, bytes: contentLength };
}

async function main(): Promise<void> {
  process.stderr.write(`# fetching ${PINNED_FILES.length} files from huggingface.co/${MODEL_ID}\n`);

  const results: Array<FetchedEntry | { relativePath: string; bytes: number }> = [];
  for (const path of PINNED_FILES) {
    const entry = DRY_RUN ? await headFile(path) : await hashFile(path);
    process.stderr.write(
      `# ${path} ✓  (${'sha256' in entry ? entry.sha256 : '<dry-run>'}, ${entry.bytes} bytes)\n`,
    );
    results.push(entry);
  }

  process.stdout.write('\n// --- paste into src/rag/model-manifest.ts ---\n');
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
