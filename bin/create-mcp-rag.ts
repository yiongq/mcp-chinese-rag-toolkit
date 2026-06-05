#!/usr/bin/env node
/**
 * CLI — scaffolds a new MCP RAG server project.  final landing.
 *
 * Usage:
 *   npx @yiong/mcp-chinese-rag-toolkit create-mcp-rag <project-name> [options]
 *
 * Options:
 *   --template <id>            Template to use (default: rag-basic)
 *   --package-manager <pm>     pnpm | npm | yarn (default: auto-detect → pnpm)
 *   --skip-install             Skip dependency installation
 *   --no-git-init              Skip `git init` + initial commit
 *   -h, --help                 Print this help
 *   -v, --version              Print CLI version
 *
 * Exit codes:
 *   0 — Project scaffolded successfully (or `--help` / `--version`)
 *   1 — Argument parse error / target dir exists / template not found
 *   2 — Runtime error (install failed / fs error)
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  InstallFailedError,
  parseArgs,
  printHelp,
  printVersion,
  ScaffoldError,
  scaffoldProject,
} from './scaffold.js';

/**
 * Detect whether this module was invoked directly (vs imported by a test).
 * Mirrors `bin/run-vision-caption-demo.ts` — both sides normalise through
 * `pathToFileURL(realpathSync(...))` so the check survives `tsx` shims,
 * symlinks, and pnpm's package shims.
 */
export const isEntrypoint: boolean = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const moduleUrl = pathToFileURL(realpathSync(fileURLToPath(import.meta.url))).href;
    const entryUrl = pathToFileURL(realpathSync(entry)).href;
    return moduleUrl === entryUrl;
  } catch (err) {
    // Surface the failure so a misconfigured launcher does not silently
    // turn the CLI into a no-op. Fall back to a string-compare so the CLI
    // still runs in the common case (no symlink involved).
    process.stderr.write(
      `create-mcp-rag: warning — could not resolve entrypoint via realpath (${err instanceof Error ? err.message : String(err)}); falling back to literal path compare\n`,
    );
    try {
      const moduleUrl = import.meta.url;
      const entryUrl = pathToFileURL(entry).href;
      return moduleUrl === entryUrl;
    } catch {
      return false;
    }
  }
})();

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  try {
    const opts = parseArgs(argv);
    if (opts.help) {
      printHelp();
      return 0;
    }
    if (opts.version) {
      await printVersion();
      return 0;
    }
    await scaffoldProject(opts);
    return 0;
  } catch (err) {
    process.stderr.write(`create-mcp-rag: ${err instanceof Error ? err.message : String(err)}\n`);
    if (err instanceof InstallFailedError) return err.exitCode;
    if (err instanceof ScaffoldError) return err.exitCode;
    return 2;
  }
}

if (isEntrypoint) {
  main()
    .then((code) => {
      // Use exitCode so the event loop drains buffered stderr writes before
      // the process actually exits (matters for piped stderr, e.g. `2> err.log`).
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      process.stderr.write(
        `create-mcp-rag: fatal ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
      );
      process.exitCode = 2;
    });
}
