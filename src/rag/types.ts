/**
 * A single page extracted from a PDF document.
 *
 * `pageNumber` is 1-indexed to match PDF industry convention and the toolkit
 * `Citation.page` contract (see `errors.ts`). The conversion from unpdf's
 * 0-indexed internal arrays happens at the `parsePdf()` boundary.
 */
export interface PdfPage {
  pageNumber: number;
  text: string;
}

/**
 * Result of parsing a PDF via `parsePdf()`.
 *
 * `totalPages` mirrors unpdf's metadata; `pages.length === totalPages` is an
 * enforced post-condition (see pdf-parser tests).
 */
export interface ParsePdfResult {
  totalPages: number;
  pages: PdfPage[];
}

/**
 * Options controlling the Markdown hierarchical splitter behaviour.
 *
 * `chunkSize` / `chunkOverlap` units are CHARACTERS, not tokens (consistent
 * with `@langchain/textsplitters` `RecursiveCharacterTextSplitter`). For
 * Chinese text 1 character ≈ 0.6 tokens under bge-large-zh-v1.5.
 */
export interface ChunkOptions {
  /** @default 1000 — range [100, 4000]; out-of-range throws */
  chunkSize?: number;
  /** @default 200 — range [0, chunkSize); out-of-range throws */
  chunkOverlap?: number;
  /** Propagated unchanged to every produced chunk. */
  source?: string;
  /** Propagated unchanged to every produced chunk. */
  page?: number;
}

/**
 * Output unit of the chunking pipeline.
 *
 * Field semantics intentionally align with `Citation` (errors.ts):
 * `content` matches `Citation.content`; `source` / `page` / `section` are
 * identical in meaning and casing. Downstream snake_case conversion (e.g.
 * SQLite `docs.text`) happens at the indexing layer, not here.
 */
export interface Chunk {
  content: string;
  source?: string;
  page?: number;
  /** Markdown heading path, levels joined by ` > ` (H1–H4 tracked). */
  section?: string;
}
