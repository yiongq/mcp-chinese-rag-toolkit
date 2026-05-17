import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PREFIX_LENGTH,
  generateChunkContext,
  renderChunkContextPrompt,
  stitchPrefixedChunk,
} from '../../../src/rag/contextual-retrieval.js';
import type { Chunk, LlmProvider } from '../../../src/rag/types.js';

function makeChunk(overrides: Partial<Chunk> = {}): Chunk {
  return {
    content: '试用期为入职后 3 个月，期间薪资按合同约定的 80% 发放。',
    source: 'employee-handbook.pdf',
    page: 12,
    section: '第三章 > 3.2 试用期管理规定',
    ...overrides,
  };
}

function stubProvider(returnValue: string = '本节出自 §3.2 试用期管理规定'): LlmProvider {
  return { generateChunkPrefix: vi.fn(async () => returnValue) };
}

describe('renderChunkContextPrompt', () => {
  it('system block contains fullDocument and the configured prefixLength range', () => {
    const { system } = renderChunkContextPrompt({
      fullDocument: '完整文档内容 ABC',
      chunkContent: '片段 X',
      prefixLength: { min: 40, max: 80 },
    });
    expect(system).toContain('完整文档内容 ABC');
    expect(system).toContain('40-80 字');
  });

  it('user block contains chunkContent and the no-quote / no-prefix instruction', () => {
    const { user } = renderChunkContextPrompt({
      fullDocument: 'F',
      chunkContent: '请假流程如下…',
      prefixLength: DEFAULT_PREFIX_LENGTH,
    });
    expect(user).toContain('请假流程如下');
    expect(user).toContain('不要任何解释或前缀');
  });
});

describe('generateChunkContext', () => {
  it('invokes provider exactly once with the full forwarded payload', async () => {
    const provider = stubProvider('prefix-A');
    const chunk = makeChunk();
    const out = await generateChunkContext(
      chunk,
      { fullDocument: 'DOC', cacheKey: 'sha256:abc' },
      provider,
    );

    expect(provider.generateChunkPrefix).toHaveBeenCalledTimes(1);
    expect(provider.generateChunkPrefix).toHaveBeenCalledWith({
      fullDocument: 'DOC',
      chunkContent: chunk.content,
      cacheKey: 'sha256:abc',
      prefixLength: DEFAULT_PREFIX_LENGTH,
    });
    expect(out).toBe('prefix-A');
  });

  it('falls back to cacheKey === "default" when not provided', async () => {
    const provider = stubProvider();
    await generateChunkContext(makeChunk(), { fullDocument: 'DOC' }, provider);
    const call = (provider.generateChunkPrefix as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call.cacheKey).toBe('default');
  });

  it('trims trailing whitespace / newlines from provider output', async () => {
    const provider = stubProvider('  prefix\n\n');
    const out = await generateChunkContext(makeChunk(), { fullDocument: 'DOC' }, provider);
    expect(out).toBe('prefix');
  });

  it('throws when fullDocument is empty', async () => {
    const provider = stubProvider();
    await expect(generateChunkContext(makeChunk(), { fullDocument: '' }, provider)).rejects.toThrow(
      /fullDocument must be a non-empty string/,
    );
  });

  it('throws when chunk.content is empty', async () => {
    const provider = stubProvider();
    await expect(
      generateChunkContext(makeChunk({ content: '' }), { fullDocument: 'DOC' }, provider),
    ).rejects.toThrow(/chunk.content must be a non-empty string/);
  });

  it('throws when prefixLength bounds are out of range or inverted', async () => {
    const provider = stubProvider();
    await expect(
      generateChunkContext(
        makeChunk(),
        { fullDocument: 'DOC', prefixLength: { min: 5, max: 80 } },
        provider,
      ),
    ).rejects.toThrow(/10 ≤ min ≤ max ≤ 500/);
    await expect(
      generateChunkContext(
        makeChunk(),
        { fullDocument: 'DOC', prefixLength: { min: 50, max: 600 } },
        provider,
      ),
    ).rejects.toThrow(/10 ≤ min ≤ max ≤ 500/);
    await expect(
      generateChunkContext(
        makeChunk(),
        { fullDocument: 'DOC', prefixLength: { min: 80, max: 50 } },
        provider,
      ),
    ).rejects.toThrow(/10 ≤ min ≤ max ≤ 500/);
  });

  it('default DEFAULT_PREFIX_LENGTH === { min: 50, max: 100 }', () => {
    expect(DEFAULT_PREFIX_LENGTH).toEqual({ min: 50, max: 100 });
  });

  it('throws an actionable TypeError when provider returns a non-string (null / number / undefined)', async () => {
    const badProviders = [
      { generateChunkPrefix: vi.fn(async () => null as unknown as string) },
      { generateChunkPrefix: vi.fn(async () => 42 as unknown as string) },
      { generateChunkPrefix: vi.fn(async () => undefined as unknown as string) },
    ];
    for (const p of badProviders) {
      await expect(generateChunkContext(makeChunk(), { fullDocument: 'DOC' }, p)).rejects.toThrow(
        /LlmProvider.generateChunkPrefix must return a string/,
      );
    }
  });
});

describe('stitchPrefixedChunk', () => {
  it('returns chunk unchanged when prefix is empty', () => {
    const c = makeChunk();
    expect(stitchPrefixedChunk(c, '')).toBe(c);
  });

  it('prepends prefix + double newline + original content', () => {
    const c = makeChunk({ content: '原文' });
    const out = stitchPrefixedChunk(c, '前缀');
    expect(out.content).toBe('前缀\n\n原文');
  });

  it('preserves source / page / section metadata', () => {
    const c = makeChunk();
    const out = stitchPrefixedChunk(c, '前缀');
    expect(out.source).toBe(c.source);
    expect(out.page).toBe(c.page);
    expect(out.section).toBe(c.section);
  });
});
