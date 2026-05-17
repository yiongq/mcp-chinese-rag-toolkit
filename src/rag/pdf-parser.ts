import { readFile } from 'node:fs/promises';
import { extractText, getDocumentProxy } from 'unpdf';
import type { ParsePdfResult } from './types.js';

/**
 * Parse a PDF into per-page text, preserving 1-indexed page numbers.
 *
 * The function is a thin IO + adapter layer over unpdf — by design it does
 * NOT swallow errors. Corrupted / encrypted / missing-file inputs surface the
 * native exception so callers (e.g. mcp-hr `scripts/build-index.ts`) decide
 * how to wrap them into MCP envelopes via `errors.create()`. The toolkit
 * envelope helper is for tool handlers, not utility functions.
 *
 * @param input File path (`string`), in-memory bytes (`Uint8Array`), or
 *              `ArrayBuffer` (e.g. from `Blob.arrayBuffer()`).
 */
export async function parsePdf(input: string | Uint8Array | ArrayBuffer): Promise<ParsePdfResult> {
  const bytes = await toUint8Array(input);
  const pdf = await getDocumentProxy(bytes);
  const { totalPages, text: pages } = await extractText(pdf, { mergePages: false });
  return {
    totalPages,
    pages: pages.map((text, i) => ({ pageNumber: i + 1, text })),
  };
}

async function toUint8Array(input: string | Uint8Array | ArrayBuffer): Promise<Uint8Array> {
  if (typeof input === 'string') {
    const buf = await readFile(input);
    return toPlainUint8Array(buf);
  }
  if (input instanceof Uint8Array) {
    return toPlainUint8Array(input);
  }
  return new Uint8Array(input);
}

/**
 * unpdf 1.x rejects Node `Buffer` instances with an explicit error, even
 * though `Buffer` is a `Uint8Array` subclass. Strip the subclass identity
 * by constructing a plain `Uint8Array` view over the same memory.
 */
function toPlainUint8Array(input: Uint8Array): Uint8Array {
  if (input.constructor === Uint8Array) return input;
  return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
}
