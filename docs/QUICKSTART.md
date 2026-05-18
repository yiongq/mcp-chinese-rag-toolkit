# @yiong/mcp-chinese-rag-toolkit — Quickstart (5-min hello-world)

This walkthrough scaffolds a new MCP RAG server from scratch — clone-free,
≤5 minutes on a fresh machine with Node 20+ and pnpm installed.

For the toolkit API surface (factories, RAG primitives, eval framework),
see the package [README](../README.md). This file is the **scaffold-CLI
quickstart**.

## 1. Scaffold

```sh
npx -p @yiong/mcp-chinese-rag-toolkit create-mcp-rag my-mcp-oa
cd my-mcp-oa
```

> The CLI is exposed via the toolkit's `bin` field, so the `-p` flag tells
> `npx` which package to fetch. After install, `create-mcp-rag` is also on
> `$PATH` via `node_modules/.bin/`.

## 2. Install dependencies

If the scaffolder skipped install (e.g. `--skip-install`), do it now:

```sh
pnpm install
```

The default scaffold runs `pnpm install` for you.

## 3. Build the hello-world index

```sh
pnpm build-index
# → Indexed 3 chunks → data/index.db (took ~50 ms)
```

The hello-world template uses **mock zero-vector embeddings** + jieba FTS5
so cold-start is instant. See `scripts/build-index.ts` (and the next section
below) to switch to the real `bge-large-zh-v1.5` embedder.

## 4. Start the MCP server (stdio transport)

```sh
pnpm start:stdio
# MCP server listening on stdio
```

## 5. Verify with MCP Inspector

In a second terminal:

```sh
npx @modelcontextprotocol/inspector pnpm start:stdio
```

Open the printed URL in your browser, then call the `search_docs` tool with:

```json
{ "query": "试用期工资" }
```

You should see one chunk returned from `sample-doc.md`.

## 6. Wire it into Claude Code / Cursor / VS Code

Add to your client's `mcpServers` config:

```json
{
  "mcpServers": {
    "my-mcp-oa": {
      "command": "pnpm",
      "args": ["-C", "/abs/path/to/my-mcp-oa", "start:stdio"]
    }
  }
}
```

## Next steps

- **Switch to a real Chinese embedder** — edit `scripts/build-index.ts` to
  call `loadEmbedder()` from the toolkit (downloads ~400 MB
  `bge-large-zh-v1.5` model on first run). See the toolkit README §Embedder.
- **Add your own docs** — drop PDFs / Markdown into `data/` and extend
  `scripts/build-index.ts` to call `parsePdf` + `chunkPdfPages`.
- **Add hybrid + rerank** — replace `index.ftsSearch(...)` in `src/server.ts`
  with `createHybridSearch(...) + createReranker(...)` (toolkit README
  §Hybrid Search / §Reranker).
- **Write your own eval set** — see [EVAL_GUIDE.md](./EVAL_GUIDE.md).
- **Contribute a new scaffold template** — see [SCAFFOLD_GUIDE.md](./SCAFFOLD_GUIDE.md).
