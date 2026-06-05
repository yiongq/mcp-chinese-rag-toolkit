# Scaffold Guide — `create-mcp-rag` CLI

Reference for the `create-mcp-rag` CLI shipped by `@yiong/mcp-chinese-rag-toolkit`.
For the 5-minute hello-world walkthrough, see [QUICKSTART.md](./QUICKSTART.md).

## CLI options

```sh
npx -p @yiong/mcp-chinese-rag-toolkit create-mcp-rag <project-name> [options]
```

| Flag | Default | Description |
|---|---|---|
| `<project-name>` | — | npm-compatible name (kebab/camel/dot/underscore + optional scope). Required. |
| `--template <id>` | `rag-basic` | Template id from `templates/create-mcp-rag/template.json` |
| `--package-manager <pm>` | auto-detect → `pnpm` | `pnpm` / `npm` / `yarn` |
| `--skip-install` | false | Skip dependency installation (useful in CI / offline) |
| `--no-git-init` | false | Skip `git init` + initial commit |
| `-h`, `--help` | — | Print usage and exit |
| `-v`, `--version` | — | Print CLI version (= toolkit version) and exit |

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Project scaffolded (or help / version printed) |
| 1 | Argument parse error, target directory exists, template not found |
| 2 | Runtime error — install failed, fs error |

## Available templates

| Template id | Description |
|---|---|
| `rag-basic` | Minimal MCP RAG server: FTS5-only search + Chinese sample doc. Hello-world cold-start. Switch to bge-large-zh-v1.5 by editing `scripts/build-index.ts`. |

Future templates (e.g. `rag-vision` showcasing the plugin, or
`rag-modeling-db` for the a downstream consumer package pattern) will follow the same
shape — file an issue if a missing template is blocking you.

## Template anatomy

Templates live in `templates/create-mcp-rag/` inside the toolkit package:

```
templates/create-mcp-rag/
├── template.json                # Metadata (id + display name + description + version reqs)
└── files/
    └── <template-id>/
        ├── package.json         # __PROJECT_NAME__ + __TOOLKIT_VERSION__ tokens
        ├── tsconfig.json        # Standalone (must NOT extend a monorepo base)
        ├── README.md            # Quickstart specific to this template
        ├── .gitignore           # Standard ignore
        ├── src/
        ├── scripts/
        ├── data/
        └── eval/
```

The contents of each `files/<template-id>/` directory are copied
**verbatim** to the user's target directory; text files are then scanned
once for token substitution (see below).

## Token substitution rules

Three tokens are substituted across all text files (`.ts` / `.tsx` /
`.js` / `.mjs` / `.cjs` / `.json` / `.md` / `.yml` / `.yaml` / `.toml` /
`.txt` / `.html` / `.css` + dotfiles like `.gitignore` / `.env`):

| Token | Source | Example output |
|---|---|---|
| `__PROJECT_NAME__` | CLI positional argument | `my-mcp-oa` |
| `__TOOLKIT_VERSION__` | toolkit `package.json#version` → `^<version>` | `^0.1.0` |
| `__SCAFFOLD_DATE__` | ISO 8601 date (UTC) | `2026-05-18` |

Binary files (e.g. images shipped with a template) are copied unchanged
without scanning. Symlinks are preserved verbatim — they are never
followed, so a malicious template cannot escape the destination
directory.

## Contributing a new template

1. Add a directory under `templates/create-mcp-rag/files/<your-template-id>/`
   containing the template's files (use the three tokens where you'd
   normally hand-write the project name / toolkit dep / scaffold date).
2. Append a `templates[]` entry to
   `templates/create-mcp-rag/template.json`.
3. Append `<your-template-id>` to the `SUPPORTED_TEMPLATES` tuple in
   `bin/scaffold.ts`.
4. Add a smoke check in `scripts/scaffold-smoke.ts` (or extend the
   existing one) to verify the new template's key files post-scaffold.
5. Add a `pnpm test` case in `test/unit/bin/scaffold.test.ts` that
   exercises the new `--template <id>` path against tmpdir.
6. Add a changeset under `.changeset/` describing the new template.

Keep templates self-contained: import paths inside template source
**must** use `@yiong/mcp-chinese-rag-toolkit`, never relative paths
or `workspace:^` — the user's project will not be inside this monorepo.

## Versioning & changesets

The CLI's `--version` matches the toolkit package version. When you bump
the toolkit (minor / major), scaffolded projects automatically pick up
the new caret range via `__TOOLKIT_VERSION__`.

Releases are managed via [changesets](https://github.com/changesets/changesets).
A scaffold-only PR (no behavior change to runtime code) usually warrants
a `patch` bump; new templates or new CLI flags warrant `minor`. Avoid
making token names or template metadata structurally incompatible
without a `major` bump — third-party templates may depend on the layout.
