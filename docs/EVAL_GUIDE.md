# Eval Guide — Writing Eval Sets for Your Domain

Story 2.7 introduced a YAML-driven eval framework that any toolkit consumer
can drive against their own corpus. This guide walks from **why eval
matters** to a **5-step process** for writing your domain eval set, plus how
to interpret the headline metrics and wire the gate into CI.

For the API surface (`loadEvalSet`, `runEval`, `passesGate`,
`renderMarkdownReport`, `writeArtifacts`), see the package README's
§Eval Framework section.

---

## Why eval matters

RAG quality regresses silently. A new chunker, a different embedder, a
tightened rerank cutoff — any of those can quietly knock the right answer
out of top-K without producing a visible error. Eval gives you a number
that surfaces the regression before it lands in production.

The toolkit takes a **lightweight** stance: a small YAML file of
representative queries, a per-PR `pnpm test:eval` run that produces
`summary.json` + `report.md` + `per-query.json`, and a CI gate that fails
the build when `Hit Rate@5` falls below a threshold (default 0.9).

---

## YAML eval-set schema (Story 2.7+)

```yaml
version: v1-hello-world
description: Demo eval set for my-mcp-oa. Replace with real domain queries.
queries:
  # reason: 直接命中"试用期工资"主关键词，验证 BM25 基础召回
  - query: 试用期工资标准是多少
    category: probation
    expected:
      - source: sample-doc.md

  # reason: 数值类问题（提前几天）— 验证 jieba 分词对数字 + 单位
  - query: 试用期解除合同要提前几天通知
    category: probation
    expected:
      - source: sample-doc.md
        page: 1
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `version` | string | yes | Stable label written into `summary.json`; bump when the eval set itself changes |
| `description` | string | no | Free-form context for human reviewers |
| `queries[].query` | string | yes | The query text sent through your search function |
| `queries[].category` | string | no | Free-form bucket (e.g. `probation`, `vacation`) — surfaces in the per-query breakdown |
| `queries[].expected` | array | yes | At least one `{source, page?}` mapping. `page` is optional and must be a positive integer |
| `queries[].reason` | string | no | Inline override of the leading `# reason:` comment — both make `report.md` self-explanatory on regressions |

The schema is validated by `loadEvalSet` at parse time — a malformed file
fails fast with an actionable error (path + line + cause). Duplicate keys
across a query also fail-fast (jieba/yaml will silently last-win otherwise).

---

## Query category design

A useful eval set covers more than the happy path. Three categories,
roughly even split:

### 1. Factual — single-hop lookup

Single-document, single-fact answers. The bar: the right chunk should land
in top-5. Examples:

```yaml
version: v1-factual
queries:
  - query: 试用期工资标准是多少
    category: probation
    expected:
      - source: hr-policy.md
  - query: 年假天数和工龄如何挂钩
    category: vacation
    expected:
      - source: vacation-policy.md
```

### 2. Multi-hop — answer requires multiple chunks

Same domain, multiple documents (or multiple sections of the same doc).
Each `expected` entry counts as a separate "useful" source — Hit Rate@K
credits coverage of any one of them.

```yaml
version: v1-multihop
queries:
  - query: 试用期员工的年假和加班工资怎么算
    category: probation
    expected:
      - source: hr-policy.md
      - source: vacation-policy.md
      - source: overtime-policy.md
```

### 3. Negation / disambiguation

Queries that look like the corpus but should NOT match well. Used to
detect over-broad retrieval (a recall problem disguised as a precision
problem). Negative tests are intentionally listed with the *true* relevant
docs so a perfect retriever still scores well — over-fitting to the
negation phrase produces low scores.

```yaml
version: v1-negation
queries:
  - query: 解除合同时是否需要支付双倍工资
    category: termination
    expected:
      - source: contract-termination.md
```

A good first batch: 12 queries × 3 categories ≈ 36 entries. The toolkit's
own `eval/eval-set.yml` is the canonical 12-query example (see
`packages/mcp-chinese-rag-toolkit/eval/eval-set.yml`).

---

## Reading Hit Rate@K and MRR

Two headline metrics show up in `summary.json` / `report.md`:

- **Hit Rate@K** — fraction of queries where at least one
  `expected` source appeared in the top-K results. The default gate is
  `Hit Rate@5 ≥ 0.9`. Tune `K` to match what your downstream caller
  reads: an agent that reads only top-3 should gate on `Hit Rate@3`.

- **MRR (Mean Reciprocal Rank)** — `1/rank` of the first matching chunk,
  averaged across queries. Sensitive to whether your rerank stage actually
  helps. A high Hit Rate@5 with a low MRR means the right chunk is in the
  list but buried — usually a rerank problem, not a retrieval problem.

Use them together: Hit Rate gates "do we have the answer at all", MRR
diagnoses "is it ranked well".

---

## Per-query metric breakdown for debugging

`per-query.json` is the regression-debugging artifact. Diff two runs to
isolate which queries changed:

```sh
diff <(jq -S . old/per-query.json) <(jq -S . new/per-query.json)
```

Each entry shows the matched / unmatched sources and the rank of the first
hit. When `Hit Rate@5` drops by 5%, the diff usually points to 1-2
specific queries (e.g. tokenization changed and a colloquial phrasing no
longer matches) rather than a global regression.

---

## 5-step process to write your domain eval set

1. **Skim 20-30 real user questions** (Slack, helpdesk tickets, customer
   emails). Pull out 12 that span the categories above.
2. **For each query, list the source files a human would cite.** This
   becomes `expected`. Don't list every loosely related doc — be strict;
   over-broad `expected` masks real regressions.
3. **Encode them in `eval/eval-set.yml`.** Use stable `category` buckets
   and leading `# reason:` comments — both surface in `report.md` so
   reviewers don't have to context-switch back to the YAML when a CI run
   fails.
4. **Run `pnpm test:eval`.** Check `summary.json` Hit Rate@5. If it's
   below 70%, your eval set is probably testing the corpus rather than
   the retriever — review the `expected` choices.
5. **Wire the gate** — set `RAG_EVAL_HIT_RATE_MIN=0.85` (or your chosen
   threshold) in your CI environment. The default is 0.9 if unset.

---

## CI integration via `RAG_EVAL_HIT_RATE_MIN`

The toolkit's `rag-eval` CI job (Story 2.7) is the reference wiring. In
your own project's CI (GitHub Actions snippet — not an eval-set YAML):

```yml
- name: RAG eval
  run: pnpm test:eval
  env:
    RAG_EVAL_HIT_RATE_MIN: "0.85"   # match your chosen threshold
```

A failure exits non-zero and writes `eval-results/report.md` —
GitHub Actions can render the report inline via
`emitGitHubActionsAnnotation()`.

---

## Anti-patterns

- **Padding `expected` until the gate passes.** This masks regressions.
  Be strict.
- **Letting the LLM write the eval set from the corpus.** Synthetic
  queries don't capture real phrasing. Always start with real user
  questions.
- **Gating on a single number (Hit Rate@5).** Look at MRR and the
  category-wise breakdown too. A regression that only hurts negation
  queries is a real bug.
- **Renaming `version` on every change.** `version` is intended to be a
  stable, human-meaningful label; bump it only when the eval set's
  *semantics* change (new categories, removed queries).
- **Running eval against a tiny in-memory fixture only.** The toolkit's
  own `bench/baseline.json` (Story 2.5) does this for latency; eval
  should run against a representative subset of the real corpus so
  retrieval characteristics match production.
