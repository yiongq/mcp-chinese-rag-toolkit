import { describe, expect, it } from 'vitest';
import { chunk, chunkPdfPages } from '../../../src/rag/chunking.js';
import type { PdfPage } from '../../../src/rag/types.js';

const FILLER_PARAGRAPH = '段落内容字符填充'.repeat(40); // ~320 chars; safely below 1000

const NESTED_MARKDOWN = [
  '# 第一章 入职流程',
  '',
  '## 1.1 试用期',
  '',
  '### 1.1.1 试用期长度',
  '',
  '新员工试用期为 3 个月。',
  FILLER_PARAGRAPH,
  '',
  '### 1.1.2 转正流程',
  '',
  '提交转正申请并完成评估。',
  FILLER_PARAGRAPH,
  '',
  '## 1.2 福利',
  '',
  '员工享有法定假日与年假。',
  FILLER_PARAGRAPH,
].join('\n');

describe('chunk()', () => {
  it('produces overlapping chunks at the default chunkOverlap of 200 characters', async () => {
    const text = 'A'.repeat(3000);
    const chunks = await chunk(text);

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const first = chunks[0]?.content ?? '';
    const second = chunks[1]?.content ?? '';
    // RecursiveCharacterTextSplitter is conservative: with a single-character input
    // and no natural separators, expect at least some non-zero overlap up to 200.
    let overlap = 0;
    for (let i = Math.min(200, first.length, second.length); i > 0; i -= 1) {
      if (first.slice(-i) === second.slice(0, i)) {
        overlap = i;
        break;
      }
    }
    expect(overlap).toBeGreaterThan(0);
    expect(overlap).toBeLessThanOrEqual(200);
  });

  it('produces at least 3 chunks when input length is 3× the default chunkSize of 1000', async () => {
    const text = 'B'.repeat(3000);
    const chunks = await chunk(text);

    expect(chunks.length).toBeGreaterThanOrEqual(3);
  });

  it('records a single-level H1 in chunk.section verbatim', async () => {
    const md = ['# 仅一级标题', '', '正文内容若干。'].join('\n');

    const chunks = await chunk(md);

    expect(chunks).not.toHaveLength(0);
    for (const c of chunks) {
      expect(c.section).toBe('仅一级标题');
    }
  });

  it('joins multi-level H1>H2>H3 with " > " in chunk.section', async () => {
    const md = ['# H1标题', '## H2标题', '### H3标题', '', '这里是 H3 下的正文。'].join('\n');

    const chunks = await chunk(md);

    expect(chunks).not.toHaveLength(0);
    for (const c of chunks) {
      expect(c.section).toBe('H1标题 > H2标题 > H3标题');
    }
  });

  it('never produces a chunk whose content spans across a heading boundary', async () => {
    const chunks = await chunk(NESTED_MARKDOWN);

    const sectionA = '第一章 入职流程 > 1.1 试用期 > 1.1.1 试用期长度';
    const sectionB = '第一章 入职流程 > 1.1 试用期 > 1.1.2 转正流程';

    for (const c of chunks) {
      const containsA = c.content.includes('新员工试用期为 3 个月');
      const containsB = c.content.includes('提交转正申请并完成评估');
      expect(containsA && containsB).toBe(false);
      if (containsA) expect(c.section).toBe(sectionA);
      if (containsB) expect(c.section).toBe(sectionB);
    }
  });

  it('leaves chunk.section undefined for input with no Markdown headings', async () => {
    const chunks = await chunk('纯正文，无任何标题。'.repeat(50));

    expect(chunks).not.toHaveLength(0);
    for (const c of chunks) {
      expect(c.section).toBeUndefined();
    }
  });

  it('returns an empty array when input contains only headings and no body', async () => {
    const md = ['# 仅标题一', '## 仅标题二', '### 仅标题三'].join('\n');

    const chunks = await chunk(md);

    expect(chunks).toEqual([]);
  });

  it('produces strictly non-overlapping chunks when chunkOverlap === 0', async () => {
    const text = 'C'.repeat(2500);
    const noOverlap = await chunk(text, { chunkSize: 500, chunkOverlap: 0 });
    const withOverlap = await chunk(text, { chunkSize: 500, chunkOverlap: 100 });

    expect(noOverlap.length).toBeGreaterThanOrEqual(2);
    const noOverlapLen = noOverlap.reduce((sum, c) => sum + c.content.length, 0);
    const withOverlapLen = withOverlap.reduce((sum, c) => sum + c.content.length, 0);

    // overlap=0 cannot duplicate characters → total never exceeds input length.
    expect(noOverlapLen).toBeLessThanOrEqual(text.length);
    // overlap=100 over the same input must duplicate at least one boundary char.
    expect(withOverlapLen).toBeGreaterThan(noOverlapLen);
  });

  it('throws when chunkSize is out of range', async () => {
    await expect(chunk('hi', { chunkSize: 50 })).rejects.toThrow(/chunkSize/);
    await expect(chunk('hi', { chunkSize: 4001 })).rejects.toThrow(/chunkSize/);
  });

  it('throws when chunkOverlap is out of range', async () => {
    await expect(chunk('hi', { chunkSize: 500, chunkOverlap: 500 })).rejects.toThrow(
      /chunkOverlap/,
    );
    await expect(chunk('hi', { chunkSize: 500, chunkOverlap: -1 })).rejects.toThrow(/chunkOverlap/);
  });

  it('propagates opts.source and opts.page to every produced chunk', async () => {
    const chunks = await chunk('# 标题\n\n正文内容。'.repeat(5), {
      source: 'hr.pdf',
      page: 7,
    });

    expect(chunks).not.toHaveLength(0);
    for (const c of chunks) {
      expect(c.source).toBe('hr.pdf');
      expect(c.page).toBe(7);
    }
  });
});

describe('chunkPdfPages()', () => {
  it('skips blank pages and labels output chunks with the source page number', async () => {
    const pages: PdfPage[] = [
      { pageNumber: 1, text: '   \n   ' },
      { pageNumber: 2, text: '有内容的一页：'.repeat(20) },
    ];

    const chunks = await chunkPdfPages(pages, { source: 'hr.pdf' });

    expect(chunks).not.toHaveLength(0);
    for (const c of chunks) {
      expect(c.page).toBe(2);
      expect(c.source).toBe('hr.pdf');
    }
  });

  it('returns an empty array when every page is blank', async () => {
    const pages: PdfPage[] = [
      { pageNumber: 1, text: '' },
      { pageNumber: 2, text: '\n  \t' },
    ];

    const chunks = await chunkPdfPages(pages);

    expect(chunks).toEqual([]);
  });
});
