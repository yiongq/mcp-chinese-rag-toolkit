import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runAnswerEval } from '../../../src/eval/answer-eval.js';
import { loadEvalSet, runEval } from '../../../src/eval/eval-runner.js';
import type {
  AnswerEvalOptions,
  EvalSearchFn,
  EvalSearchResult,
  EvalSet,
  GenerateFn,
  JudgeFn,
} from '../../../src/eval/types.js';
import type { ConversationTurn } from '../../../src/query/rewrite.js';

// ---------------------------------------------------------------------------
// — Multi-turn eval-set history: loadEvalSet validation + pass-through to the
//   injected searchFn / generateFn. Offline, deterministic — no network, no
//   API key, no model loading.
// ---------------------------------------------------------------------------

const HISTORY_YAML = `version: v1-multiturn
queries:
  - query: 那它最长可以多久？
    history:
      - role: user
        content: 试用期政策是什么？
      - role: assistant
        content: 试用期根据合同期限确定。
    expected:
      - source: doc-a.md
  - query: 年假怎么算？
    expected:
      - source: doc-b.md
`;

describe('loadEvalSet history parsing', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'multiturn-history-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeYaml(name: string, body: string): string {
    const p = path.join(tmpDir, name);
    writeFileSync(p, body, 'utf8');
    return p;
  }

  it('attaches a valid history and leaves history-less queries untouched (mixed set)', () => {
    const set = loadEvalSet(writeYaml('ok.yml', HISTORY_YAML));
    expect(set.queries[0]?.history).toEqual([
      { role: 'user', content: '试用期政策是什么？' },
      { role: 'assistant', content: '试用期根据合同期限确定。' },
    ]);
    const second = set.queries[1];
    expect(second && 'history' in second).toBe(false);
  });

  // Table-driven invalid shapes; every error message carries the queries[i]
  // (and where applicable history[j]) location for fast authoring fixes.
  const invalidCases: Array<{ name: string; yaml: string; error: RegExp }> = [
    {
      name: 'history is not an array',
      yaml: `version: v1\nqueries:\n  - query: a\n    history: 不是数组\n    expected:\n      - source: x\n`,
      error: /queries\[0\]\.history must be an array when present/,
    },
    {
      name: 'turn is not a mapping',
      yaml: `version: v1\nqueries:\n  - query: a\n    history:\n      - 只是字符串\n    expected:\n      - source: x\n`,
      error: /queries\[0\]\.history\[0\] must be a mapping \{ role, content \}/,
    },
    {
      name: 'bad role',
      yaml: `version: v1\nqueries:\n  - query: a\n    history:\n      - role: system\n        content: 你是助手\n    expected:\n      - source: x\n`,
      error: /queries\[0\]\.history\[0\]\.role must be 'user' or 'assistant'/,
    },
    {
      name: 'missing role',
      yaml: `version: v1\nqueries:\n  - query: a\n    history:\n      - content: 缺角色\n    expected:\n      - source: x\n`,
      error: /queries\[0\]\.history\[0\]\.role must be 'user' or 'assistant'/,
    },
    {
      name: 'blank content',
      yaml: `version: v1\nqueries:\n  - query: a\n    history:\n      - role: user\n        content: '   '\n    expected:\n      - source: x\n`,
      error: /queries\[0\]\.history\[0\]\.content must be a non-empty string/,
    },
    {
      name: 'non-string content',
      yaml: `version: v1\nqueries:\n  - query: a\n    history:\n      - role: user\n        content: 42\n    expected:\n      - source: x\n`,
      error: /queries\[0\]\.history\[0\]\.content must be a non-empty string/,
    },
    {
      name: 'second turn invalid (index in message)',
      yaml: `version: v1\nqueries:\n  - query: a\n    history:\n      - role: user\n        content: 合法的\n      - role: assistant\n        content: ''\n    expected:\n      - source: x\n`,
      error: /queries\[0\]\.history\[1\]\.content must be a non-empty string/,
    },
  ];

  for (const c of invalidCases) {
    it(`throws on invalid history: ${c.name}`, () => {
      expect(() => loadEvalSet(writeYaml('bad.yml', c.yaml))).toThrow(c.error);
    });
  }

  it('an empty history array is preserved as-is (shape-valid, semantically single-turn)', () => {
    const set = loadEvalSet(
      writeYaml(
        'empty.yml',
        `version: v1\nqueries:\n  - query: a\n    history: []\n    expected:\n      - source: x\n`,
      ),
    );
    expect(set.queries[0]?.history).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// — Pass-through threading: the harness hands query.history verbatim to the
//   injected functions and never invents a `history` key for single-turn rows.
// ---------------------------------------------------------------------------

const TURNS: ConversationTurn[] = [
  { role: 'user', content: '试用期政策是什么？' },
  { role: 'assistant', content: '试用期根据合同期限确定。' },
];

const RESULTS: EvalSearchResult[] = [{ source: 'doc-a.md', content: '试用期最长不超过六个月。' }];

function makeMultiTurnSet(): EvalSet {
  return {
    version: 'test-multiturn-v1',
    queries: [
      { query: '那它最长可以多久？', expected: [{ source: 'doc-a.md' }], history: TURNS },
      { query: '年假怎么算？', expected: [{ source: 'doc-a.md' }] },
    ],
  };
}

// Judge mock keyed on unique prompt substrings, mirroring answer-eval.test.ts.
const emptyJudgeFn: JudgeFn = () => Promise.resolve('[]');

describe('history pass-through', () => {
  it('runEval hands history to searchFn for multi-turn rows and omits the key otherwise', async () => {
    const seenOpts: Array<Record<string, unknown> | undefined> = [];
    const searchFn: EvalSearchFn = (_query, opts) => {
      seenOpts.push(opts as Record<string, unknown> | undefined);
      return Promise.resolve(RESULTS);
    };

    await runEval(makeMultiTurnSet(), { searchFn });

    expect(seenOpts).toHaveLength(2);
    expect(seenOpts[0]?.history).toBe(TURNS); // verbatim reference, not a copy
    expect(seenOpts[1] && 'history' in seenOpts[1]).toBe(false);
  });

  it('runAnswerEval hands history to both searchFn and generateFn', async () => {
    const searchHistories: Array<readonly ConversationTurn[] | undefined> = [];
    const generateInputs: Array<Parameters<GenerateFn>[0]> = [];

    const searchFn: EvalSearchFn = (_query, opts) => {
      searchHistories.push(opts?.history);
      return Promise.resolve(RESULTS);
    };
    const generateFn: GenerateFn = (input) => {
      generateInputs.push(input);
      return Promise.resolve('试用期最长六个月。');
    };
    const opts: AnswerEvalOptions = {
      searchFn,
      generateFn,
      judgeFn: emptyJudgeFn,
      generateModel: 'mock-generate-model',
      judgeModel: 'mock-judge-model',
    };

    await runAnswerEval(makeMultiTurnSet(), opts);

    expect(searchHistories).toEqual([TURNS, undefined]);
    expect(generateInputs).toHaveLength(2);
    expect(generateInputs[0]?.history).toBe(TURNS);
    const singleTurnInput = generateInputs[1];
    expect(singleTurnInput && 'history' in singleTurnInput).toBe(false);
  });
});
