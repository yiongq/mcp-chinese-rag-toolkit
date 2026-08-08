---
"@yiong/mcp-chinese-rag-toolkit": minor
---

Three ingestion/retrieval capabilities: xlsx parsing with header-repeating markdown row groups (chunker-friendly tables, section = sheet name), image/png + image/jpeg support with an exported `captionImage` vision bridge (cached, jpeg re-encode, defensive downscale), and `graphRecall` — an opt-in entity-match third recall source fused into hybrid search via N-way RRF (absent hook keeps retrieval byte-identical). Benchmark gains graph on/off A/B configs.
