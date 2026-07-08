import { describe, expect, it } from 'vitest';

import { extractGraph } from '../../../src/graph/extract-graph.js';
import type { PipelineSpan } from '../../../src/observability/span.js';
import type { ExtractFn, RawExtraction } from '../../../src/graph/types.js';

function stubExtractFn(byChunk: Record<number, RawExtraction>): ExtractFn {
  return ({ chunkId }) => Promise.resolve(byChunk[chunkId] ?? { entities: [], relations: [] });
}

describe('extractGraph — ingest.graph span', () => {
  it('emits one ingest.graph span with scalar counts only', async () => {
    const spans: PipelineSpan[] = [];
    await extractGraph({
      chunks: [
        { chunkId: 1, content: '北京公司雇佣了员工' },
        { chunkId: 2, content: '员工在上海分部工作' },
      ],
      extractFn: stubExtractFn({
        1: {
          entities: [{ name: '北京公司', type: 'org' }],
          relations: [{ source: '北京公司', target: '员工', type: 'employs' }],
        },
        2: { entities: [{ name: '上海分部' }], relations: [] },
      }),
      onSpan: (s) => spans.push(s),
    });

    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span?.name).toBe('ingest.graph');
    expect(span?.attributes).toMatchObject({
      chunkCount: 2,
      entityCount: 3, // 北京公司 + 员工 (relation endpoint) + 上海分部
      relationCount: 1,
      failedChunks: 0,
      ok: true,
    });
    expect(span?.durationMs).toBeGreaterThanOrEqual(0);
    expect(span?.parentId).toBeUndefined();
  });

  it('never leaks entity / relation names or chunk content into span attributes (zero-PII)', async () => {
    const spans: PipelineSpan[] = [];
    await extractGraph({
      chunks: [{ chunkId: 1, content: '机密项目由张三负责' }],
      extractFn: stubExtractFn({
        1: {
          entities: [{ name: '张三', type: 'person' }],
          relations: [{ source: '张三', target: '机密项目', type: 'owns' }],
        },
      }),
      onSpan: (s) => spans.push(s),
    });

    const serialized = JSON.stringify(spans[0]?.attributes);
    // No entity / relation names, no chunk content.
    for (const leak of ['张三', '机密项目', '机密项目由张三负责', 'person', 'owns']) {
      expect(serialized).not.toContain(leak);
    }
    // Defensively: no CJK at all in the attribute payload.
    expect(serialized).not.toMatch(/[一-鿿]/);
  });

  it('records failedChunks in the span when a chunk extraction throws', async () => {
    const spans: PipelineSpan[] = [];
    const extractFn: ExtractFn = ({ chunkId }) =>
      chunkId === 2
        ? Promise.reject(new Error('boom'))
        : Promise.resolve({ entities: [{ name: `E${chunkId}` }], relations: [] });

    await extractGraph({
      chunks: [
        { chunkId: 1, content: 'a' },
        { chunkId: 2, content: 'b' },
      ],
      extractFn,
      onSpan: (s) => spans.push(s),
    });

    expect(spans[0]?.attributes).toMatchObject({ failedChunks: 1, entityCount: 1, ok: false });
  });

  it('reads no clock and allocates no span when onSpan is absent', async () => {
    // No consumer → the call still returns a graph and emits nothing observable.
    const graph = await extractGraph({
      chunks: [{ chunkId: 1, content: 'x' }],
      extractFn: stubExtractFn({ 1: { entities: [{ name: 'E1' }], relations: [] } }),
    });
    expect(graph.entities).toHaveLength(1);
  });
});
