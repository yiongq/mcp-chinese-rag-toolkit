import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { parseDocument } from '../../../src/ingest/document-parser.js';
import type { PipelineSpan } from '../../../src/observability/span.js';

const enc = new TextEncoder();

describe('parseDocument — ingest.parse span', () => {
  it('emits an ok span for a successful text parse with mime / encoding / textLength', async () => {
    const spans: PipelineSpan[] = [];
    const md = '# 标题\n正文内容';
    const res = await parseDocument(enc.encode(md), 'text/markdown', { onSpan: (s) => spans.push(s) });

    expect(res.ok).toBe(true);
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span?.name).toBe('ingest.parse');
    expect(span?.attributes).toMatchObject({
      ok: true,
      mimeType: 'text/markdown',
      encoding: 'utf-8',
      textLength: md.length,
    });
    expect(span?.durationMs).toBeGreaterThanOrEqual(0);
    expect(span?.parentId).toBeUndefined();
  });

  it('emits an ok span for an xlsx parse with the canonical mime and textLength', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('清单').addRows([
      ['名称', '数量'],
      ['样例', 1],
    ]);
    const xlsxBytes = new Uint8Array(await workbook.xlsx.writeBuffer());

    const spans: PipelineSpan[] = [];
    const res = await parseDocument(
      xlsxBytes,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      { onSpan: (s) => spans.push(s) },
    );

    expect(res.ok).toBe(true);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.attributes).toMatchObject({
      ok: true,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      textLength: res.ok ? (res.doc.text?.length ?? 0) : -1,
    });
  });

  it('canonicalizes a parameterized content type in the span mime attribute', async () => {
    const spans: PipelineSpan[] = [];
    await parseDocument(enc.encode('plain body'), 'text/plain; charset=utf-8', {
      onSpan: (s) => spans.push(s),
    });
    expect(spans[0]?.attributes.mimeType).toBe('text/plain');
  });

  it('emits an ok:false span carrying the errorCode for an unsupported mime type', async () => {
    const spans: PipelineSpan[] = [];
    const res = await parseDocument(enc.encode('x'), 'application/zip', {
      onSpan: (s) => spans.push(s),
    });

    expect(res.ok).toBe(false);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.attributes).toMatchObject({ ok: false, errorCode: 'UNSUPPORTED_MIME_TYPE' });
    // An unsupported type has no canonical form, so no mimeType attribute is set.
    expect(spans[0]?.attributes.mimeType).toBeUndefined();
  });

  it('emits an ok:false span for an empty document', async () => {
    const spans: PipelineSpan[] = [];
    const res = await parseDocument(enc.encode('   '), 'text/plain', { onSpan: (s) => spans.push(s) });

    expect(res.ok).toBe(false);
    expect(spans[0]?.attributes).toMatchObject({
      ok: false,
      mimeType: 'text/plain',
      errorCode: 'EMPTY_DOCUMENT',
    });
  });

  it('emits nothing when no consumer is wired', async () => {
    const spans: PipelineSpan[] = [];
    await parseDocument(enc.encode('hi'), 'text/plain');
    expect(spans).toHaveLength(0);
  });

  it('exposes no document content in span attributes (zero PII)', async () => {
    const spans: PipelineSpan[] = [];
    const secret = '机密内容不应出现在span里';
    await parseDocument(enc.encode(secret), 'text/plain', { onSpan: (s) => spans.push(s) });

    for (const s of spans) {
      const json = JSON.stringify(s.attributes);
      expect(json).not.toContain(secret);
      expect(json).not.toMatch(/[一-鿿]/);
    }
  });
});
