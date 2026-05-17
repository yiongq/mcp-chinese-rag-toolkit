import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import type { Chunk, ChunkOptions, PdfPage } from './types.js';

const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_CHUNK_OVERLAP = 200;
const MIN_CHUNK_SIZE = 100;
const MAX_CHUNK_SIZE = 4000;

interface SectionRegion {
  section: string | undefined;
  content: string;
}

/**
 * Split text into hierarchical chunks aware of Markdown heading structure.
 *
 * Algorithm:
 *  1. Validate `chunkSize` ∈ [100, 4000] and `chunkOverlap` ∈ [0, chunkSize).
 *  2. Walk the input line-by-line, maintaining a stack of H1–H4 headings;
 *     emit a `SectionRegion` per heading transition. Heading-only regions
 *     produce no output.
 *  3. Per region, defer to `RecursiveCharacterTextSplitter` for character-
 *     based splitting; each piece inherits the region's `section` plus the
 *     caller-supplied `source` / `page`.
 *
 * We hand-roll the section tracker because `@langchain/textsplitters` JS
 * has no `MarkdownHeaderTextSplitter` equivalent (Python-only). See the
 * Story 2.1 Dev Notes (§Markdown Hierarchical Chunking).
 */
export async function chunk(text: string, opts: ChunkOptions = {}): Promise<Chunk[]> {
  const chunkSize = opts.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const chunkOverlap = opts.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;

  if (chunkSize < MIN_CHUNK_SIZE || chunkSize > MAX_CHUNK_SIZE) {
    throw new Error(
      `chunkSize must be between ${MIN_CHUNK_SIZE} and ${MAX_CHUNK_SIZE} (got ${chunkSize})`,
    );
  }
  if (chunkOverlap < 0 || chunkOverlap >= chunkSize) {
    throw new Error(
      `chunkOverlap must satisfy 0 <= overlap < chunkSize (got overlap=${chunkOverlap}, size=${chunkSize})`,
    );
  }

  const regions = parseSections(text);
  if (regions.length === 0) return [];

  const splitter = new RecursiveCharacterTextSplitter({ chunkSize, chunkOverlap });
  const results: Chunk[] = [];

  for (const region of regions) {
    const pieces = await splitter.splitText(region.content);
    for (const piece of pieces) {
      results.push(buildChunk(piece, region.section, opts));
    }
  }

  return results;
}

/**
 * Chunk an array of `PdfPage` objects, attaching `page` metadata per page.
 * Blank pages (whitespace-only `text`) are skipped without emitting chunks.
 */
export async function chunkPdfPages(
  pages: PdfPage[],
  opts: Omit<ChunkOptions, 'page'> = {},
): Promise<Chunk[]> {
  const results: Chunk[] = [];
  for (const page of pages) {
    if (page.text.trim().length === 0) continue;
    const pageChunks = await chunk(page.text, { ...opts, page: page.pageNumber });
    results.push(...pageChunks);
  }
  return results;
}

function parseSections(text: string): SectionRegion[] {
  const lines = text.split('\n');
  const headingRe = /^(#{1,4})\s+(.+?)\s*$/;
  const stack: Array<{ level: number; title: string }> = [];
  const regions: SectionRegion[] = [];
  let buffer: string[] = [];

  const currentSection = (): string | undefined =>
    stack.length > 0 ? stack.map((h) => h.title).join(' > ') : undefined;

  const flush = (section: string | undefined): void => {
    if (buffer.length === 0) return;
    const content = buffer.join('\n').trim();
    buffer = [];
    if (content.length === 0) return;
    regions.push({ section, content });
  };

  for (const line of lines) {
    const m = headingRe.exec(line);
    if (m) {
      // Flush pending content under the section that was active BEFORE this
      // heading (so the previous region's `section` reflects its actual scope).
      flush(currentSection());
      const level = (m[1] as string).length;
      while (stack.length > 0) {
        const top = stack[stack.length - 1];
        if (top && top.level >= level) {
          stack.pop();
        } else {
          break;
        }
      }
      stack.push({ level, title: m[2] as string });
    } else {
      buffer.push(line);
    }
  }
  flush(currentSection());

  return regions;
}

function buildChunk(content: string, section: string | undefined, opts: ChunkOptions): Chunk {
  const chunk: Chunk = { content };
  if (opts.source !== undefined) chunk.source = opts.source;
  if (opts.page !== undefined) chunk.page = opts.page;
  if (section !== undefined) chunk.section = section;
  return chunk;
}
