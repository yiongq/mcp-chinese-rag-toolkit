#!/usr/bin/env node
// Generates test/fixtures/sample.pdf — a minimal, valid, multi-page text PDF.
// Run once, commit the output. No runtime deps.
//
// Used by test/unit/rag/pdf-parser.test.ts as a self-contained fixture so the
// toolkit's tests are runnable from a standalone clone (no parent-monorepo
// PDF reachable via ../../../../../docs/...).

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HEADER = '%PDF-1.4\n';
const PAGE_TEXTS = [
  'Sample fixture page 1 - parsePdf unit test',
  'Sample fixture page 2 - multi-page sanity check',
  'Sample fixture page 3 - final-page sentinel',
];

const objects = []; // index → string body (without "N 0 obj\n...endobj\n")

function addObject(body) {
  objects.push(body);
  return objects.length; // 1-indexed object number
}

const catalogId = addObject('placeholder');
const pagesId = addObject('placeholder');
const fontId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

const pageIds = [];
for (const text of PAGE_TEXTS) {
  const escaped = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const stream = `BT /F1 14 Tf 72 720 Td (${escaped}) Tj ET\n`;
  const streamLen = Buffer.byteLength(stream, 'binary');
  const contentId = addObject(`<< /Length ${streamLen} >>\nstream\n${stream}endstream`);
  const pageId = addObject(
    `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
  );
  pageIds.push(pageId);
}

objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

let body = HEADER;
const offsets = [0]; // object 0 is the free-list head, offset is unused
for (let i = 0; i < objects.length; i++) {
  offsets.push(Buffer.byteLength(body, 'binary'));
  body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
}

const xrefOffset = Buffer.byteLength(body, 'binary');
let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (let i = 1; i <= objects.length; i++) {
  xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
}

const trailer = `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

const out = Buffer.from(body + xref + trailer, 'binary');
const outPath = fileURLToPath(new URL('./sample.pdf', import.meta.url));
writeFileSync(outPath, out);
console.log(`wrote ${out.length} bytes -> ${outPath}`);
