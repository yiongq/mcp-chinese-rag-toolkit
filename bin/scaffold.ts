/**
 * Story 2.9 scaffold library — called by `bin/create-mcp-rag.ts`.
 *
 * Separated from the CLI shell so unit tests can drive `scaffoldProject` /
 * `parseArgs` directly without spawning a subprocess. Exports follow the
 * same lib-vs-CLI split used by `bin/latency-harness.ts` (Story 2.5) and
 * `bin/run-vision-caption-demo.ts` (Story 2.8).
 *
 * IMPORTANT — none of these symbols are re-exported from `src/index.ts`.
 * Scaffolding is a CLI-only concern; consumers reach it via `package.json#bin`.
 */
import { spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolved scaffold options. Produced by `parseArgs`, consumed by `scaffoldProject`.
 */
export interface ScaffoldOptions {
  projectName: string;
  template: string;
  packageManager: 'pnpm' | 'npm' | 'yarn';
  skipInstall: boolean;
  skipGitInit: boolean;
  help?: boolean;
  version?: boolean;
}

export const SUPPORTED_TEMPLATES = ['rag-basic'] as const;
export const DEFAULT_TEMPLATE = 'rag-basic';
export const DEFAULT_PACKAGE_MANAGER: 'pnpm' = 'pnpm';

const SUPPORTED_PACKAGE_MANAGERS = ['pnpm', 'npm', 'yarn'] as const;
type PackageManager = (typeof SUPPORTED_PACKAGE_MANAGERS)[number];

/**
 * Base error for any scaffold failure that should surface as a clean CLI
 * exit (no stack noise). Defaults to exit code 1.
 */
export class ScaffoldError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'ScaffoldError';
    this.exitCode = exitCode;
  }
}

/**
 * Thrown when the package-manager install subprocess exits non-zero.
 * Distinct subclass so callers can branch on install failures specifically
 * (Story 2.6 M1 + Story 2.7 lesson 6 fail-fast).
 */
export class InstallFailedError extends ScaffoldError {
  constructor(message: string) {
    super(message, 2);
    this.name = 'InstallFailedError';
  }
}

const NPM_NAME_REGEX = /^(?:@[a-z0-9-_*~][a-z0-9-_.*~]*\/)?[a-z0-9][a-z0-9-_.]*$/i;

/**
 * Parse `argv` (everything after `node bin/create-mcp-rag.ts`) into a
 * resolved `ScaffoldOptions`. Fail-fast on unknown flags, missing values,
 * invalid project names, or duplicate positional arguments — mirrors
 * `bin/run-eval.ts#parseArgs` semantics.
 */
export function parseArgs(argv: readonly string[]): ScaffoldOptions {
  const opts: ScaffoldOptions = {
    projectName: '',
    template: DEFAULT_TEMPLATE,
    packageManager: DEFAULT_PACKAGE_MANAGER,
    skipInstall: false,
    skipGitInit: false,
  };
  let positionalSet = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
      continue;
    }
    if (arg === '--version' || arg === '-v') {
      opts.version = true;
      continue;
    }
    if (arg === '--skip-install') {
      opts.skipInstall = true;
      continue;
    }
    if (arg === '--no-git-init') {
      opts.skipGitInit = true;
      continue;
    }
    if (arg === '--template' || arg === '--package-manager') {
      const value = argv[i + 1];
      if (value === undefined || value === '' || value.startsWith('-')) {
        throw new ScaffoldError(`create-mcp-rag: ${arg} requires a value`);
      }
      if (arg === '--template') {
        if (!SUPPORTED_TEMPLATES.includes(value as (typeof SUPPORTED_TEMPLATES)[number])) {
          throw new ScaffoldError(
            `create-mcp-rag: unknown template "${value}" (supported: ${SUPPORTED_TEMPLATES.join(', ')})`,
          );
        }
        opts.template = value;
      } else {
        if (!SUPPORTED_PACKAGE_MANAGERS.includes(value as PackageManager)) {
          throw new ScaffoldError(
            `create-mcp-rag: invalid --package-manager "${value}" (supported: ${SUPPORTED_PACKAGE_MANAGERS.join(', ')})`,
          );
        }
        opts.packageManager = value as PackageManager;
      }
      i += 1;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new ScaffoldError(`create-mcp-rag: unknown flag ${arg}`);
    }
    if (positionalSet) {
      throw new ScaffoldError(`create-mcp-rag: unexpected extra positional argument "${arg}"`);
    }
    if (!NPM_NAME_REGEX.test(arg)) {
      throw new ScaffoldError(
        `create-mcp-rag: invalid project name "${arg}" — must match npm package name rules`,
      );
    }
    opts.projectName = arg;
    positionalSet = true;
  }

  if (!opts.help && !opts.version && !opts.projectName) {
    throw new ScaffoldError('create-mcp-rag: missing <project-name>');
  }

  return opts;
}

/**
 * Print CLI usage to stdout. Kept terse — `docs/SCAFFOLD_GUIDE.md` is the
 * long-form reference.
 */
export function printHelp(): void {
  const lines = [
    'create-mcp-rag — scaffold a new MCP RAG server project',
    '',
    'Usage:',
    '  npx @yiong/mcp-chinese-rag-toolkit create-mcp-rag <project-name> [options]',
    '',
    'Options:',
    '  --template <id>            Template to use (default: rag-basic)',
    '  --package-manager <pm>     pnpm | npm | yarn (default: auto-detect → pnpm)',
    '  --skip-install             Skip dependency installation',
    '  --no-git-init              Skip `git init` + initial commit',
    '  -h, --help                 Print this help',
    '  -v, --version              Print CLI version',
    '',
    `Supported templates: ${SUPPORTED_TEMPLATES.join(', ')}`,
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

/**
 * Resolve the toolkit `package.json` so we can stamp the scaffold output
 * with the matching version + print `--version` consistently. Walks up from
 * this file (works under both `bin/scaffold.ts` source and `dist/cli/...`).
 */
function readToolkitPackageJson(): { version: string; name: string } {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '..', 'package.json'),
    path.resolve(here, '..', '..', 'package.json'),
    path.resolve(here, '..', '..', '..', 'package.json'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const raw = readFileSync(candidate, 'utf-8');
      const parsed = JSON.parse(raw) as { name?: string; version?: string };
      if (parsed.name === '@yiong/mcp-chinese-rag-toolkit') {
        return {
          name: parsed.name,
          version: typeof parsed.version === 'string' ? parsed.version : '0.0.0',
        };
      }
    }
  }
  throw new ScaffoldError('create-mcp-rag: cannot locate toolkit package.json from CLI bundle');
}

export async function printVersion(): Promise<void> {
  const pkg = readToolkitPackageJson();
  process.stdout.write(`${pkg.name} create-mcp-rag ${pkg.version}\n`);
}

/**
 * Locate the bundled `templates/create-mcp-rag/files/<template>/` directory.
 * Returns an absolute path. Source and compiled CLI both reach the same
 * `templates/` folder thanks to `package.json#files` including it.
 */
function resolveTemplateDir(template: string): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '..', 'templates', 'create-mcp-rag', 'files', template),
    path.resolve(here, '..', '..', 'templates', 'create-mcp-rag', 'files', template),
    path.resolve(here, '..', '..', '..', 'templates', 'create-mcp-rag', 'files', template),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new ScaffoldError(
    `create-mcp-rag: template "${template}" files not found (looked in: ${candidates.join(', ')})`,
  );
}

/**
 * Detect the user's package manager from npm's user-agent env var. Falls
 * back to `pnpm` when no signal is present — matches the toolkit's own
 * dev workflow.
 */
export function detectPackageManager(): PackageManager {
  const ua = process.env.npm_config_user_agent;
  if (typeof ua === 'string') {
    if (ua.startsWith('pnpm')) return 'pnpm';
    if (ua.startsWith('yarn')) return 'yarn';
    if (ua.startsWith('npm')) return 'npm';
  }
  return DEFAULT_PACKAGE_MANAGER;
}

/**
 * Recursively copy `src` → `dst`. Symlinks are preserved (not followed) so
 * a malicious template can't escape the destination directory via dangling
 * link targets. Directories are created lazily.
 */
export function copyDirectoryRecursive(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isSymbolicLink()) {
      // Preserve the link target verbatim — do NOT follow. A template
      // shouldn't ship symlinks today, but copying them as-is avoids any
      // path-traversal surprise if one ever slips in.
      const linkTarget = readlinkSync(srcPath);
      symlinkSync(linkTarget, dstPath);
      continue;
    }
    if (entry.isDirectory()) {
      copyDirectoryRecursive(srcPath, dstPath);
      continue;
    }
    copyFileSync(srcPath, dstPath);
  }
}

/**
 * Replace `__TOKEN__` placeholders verbatim. Intentionally no templating
 * engine (handlebars / mustache) — three tokens fit a plain string.replaceAll
 * and satisfy the toolkit's minimal-deps philosophy (Story 2.6 lesson 5 /
 * Story 2.8 lesson 5).
 */
export function replaceTokens(content: string, tokens: Record<string, string>): string {
  let out = content;
  for (const [key, value] of Object.entries(tokens)) {
    out = out.split(key).join(value);
  }
  return out;
}

const TEXT_FILE_EXTENSIONS = new Set([
  '.json',
  '.md',
  '.ts',
  '.tsx',
  '.js',
  '.cjs',
  '.mjs',
  '.yml',
  '.yaml',
  '.txt',
  '.html',
  '.css',
  '.toml',
]);

const DOTFILE_TEXT_NAMES = new Set(['.gitignore', '.npmignore', '.env', '.env.example']);

function isTextFile(filePath: string): boolean {
  const base = path.basename(filePath);
  if (DOTFILE_TEXT_NAMES.has(base)) return true;
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_FILE_EXTENSIONS.has(ext);
}

function* walkFiles(root: string): Generator<string> {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full);
      continue;
    }
    if (entry.isFile()) {
      yield full;
    }
  }
}

function applyTokensInDir(dir: string, tokens: Record<string, string>): void {
  for (const file of walkFiles(dir)) {
    if (!isTextFile(file)) continue;
    const raw = readFileSync(file, 'utf-8');
    const next = replaceTokens(raw, tokens);
    if (next !== raw) writeFileSync(file, next);
  }
}

/**
 * Spawn a subprocess and resolve when it exits. Stdio inherits the parent
 * so the user sees real progress. Non-zero exit → reject with the captured
 * status so `scaffoldProject` can wrap in `InstallFailedError`.
 *
 * Exposed for the smoke script / unit tests; not part of the public API.
 */
export function runSpawn(command: string, args: readonly string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.on('error', (err) => reject(err));
    child.on('exit', (code) => resolve(code ?? 0));
  });
}

interface ScaffoldDeps {
  spawnImpl?: typeof runSpawn;
  /** Stamp for `__SCAFFOLD_DATE__` — injectable for deterministic tests. */
  now?: () => Date;
}

/**
 * Core scaffolding workflow:
 *   1. Validate target dir (must NOT exist — never silently overwrite,
 *      Story 2.7 lesson 7 / Story 2.8 lesson 11)
 *   2. Validate template id
 *   3. Recursively copy `templates/create-mcp-rag/files/<template>/` → target
 *   4. Token-replace `__PROJECT_NAME__` / `__TOOLKIT_VERSION__` / `__SCAFFOLD_DATE__`
 *   5. Optional: spawn `<pm> install` (stdio inherit, non-zero → throw)
 *   6. Optional: `git init` + initial commit (failure → stderr warn, do NOT throw)
 *   7. Print next-steps banner to stdout
 *
 * @param opts Resolved CLI options (see {@link parseArgs}).
 * @param deps Injectable hooks for testability (test code mocks `spawnImpl`).
 */
export async function scaffoldProject(
  opts: ScaffoldOptions,
  deps: ScaffoldDeps = {},
): Promise<void> {
  const targetDir = path.resolve(process.cwd(), opts.projectName);
  if (existsSync(targetDir)) {
    throw new ScaffoldError(`create-mcp-rag: target directory already exists: ${targetDir}`);
  }
  if (!SUPPORTED_TEMPLATES.includes(opts.template as (typeof SUPPORTED_TEMPLATES)[number])) {
    throw new ScaffoldError(
      `create-mcp-rag: unknown template "${opts.template}" (supported: ${SUPPORTED_TEMPLATES.join(', ')})`,
    );
  }
  const templateDir = resolveTemplateDir(opts.template);
  const toolkitPkg = readToolkitPackageJson();
  const now = (deps.now ?? (() => new Date()))();

  // Step 3 — copy
  copyDirectoryRecursive(templateDir, targetDir);

  // Step 4 — token replace
  const tokens: Record<string, string> = {
    __PROJECT_NAME__: opts.projectName,
    __TOOLKIT_VERSION__: `^${toolkitPkg.version}`,
    __SCAFFOLD_DATE__: now.toISOString().slice(0, 10),
  };
  applyTokensInDir(targetDir, tokens);

  const spawnImpl = deps.spawnImpl ?? runSpawn;

  // Step 5 — install
  if (!opts.skipInstall) {
    process.stdout.write(`create-mcp-rag: installing dependencies via ${opts.packageManager}…\n`);
    let exitCode: number;
    try {
      exitCode = await spawnImpl(opts.packageManager, ['install'], targetDir);
    } catch (err) {
      throw new InstallFailedError(
        `create-mcp-rag: ${opts.packageManager} install failed in ${targetDir}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    if (exitCode !== 0) {
      throw new InstallFailedError(
        `create-mcp-rag: ${opts.packageManager} install exited with code ${exitCode} in ${targetDir}`,
      );
    }
  }

  // Step 6 — git init (warn-not-throw)
  if (!opts.skipGitInit) {
    try {
      const initCode = await spawnImpl('git', ['init', '--quiet'], targetDir);
      if (initCode !== 0) {
        process.stderr.write(
          `create-mcp-rag: warning — git init exited with code ${initCode}; skipping initial commit\n`,
        );
      } else {
        const addCode = await spawnImpl('git', ['add', '.'], targetDir);
        if (addCode === 0) {
          await spawnImpl(
            'git',
            [
              'commit',
              '--quiet',
              '-m',
              `chore: initial commit from @yiong/mcp-chinese-rag-toolkit create-mcp-rag@${toolkitPkg.version}`,
            ],
            targetDir,
          );
        } else {
          process.stderr.write(
            `create-mcp-rag: warning — git add exited with code ${addCode}; skipping initial commit\n`,
          );
        }
      }
    } catch (err) {
      process.stderr.write(
        `create-mcp-rag: warning — git init failed (${err instanceof Error ? err.message : String(err)}); continuing without git\n`,
      );
    }
  }

  // Step 7 — next-steps banner
  const banner = [
    '',
    `✔ Scaffolded ${opts.projectName} (template: ${opts.template})`,
    '',
    'Next steps:',
    `  cd ${opts.projectName}`,
    opts.skipInstall ? `  ${opts.packageManager} install` : null,
    `  ${opts.packageManager} build-index`,
    `  ${opts.packageManager} start:stdio`,
    '',
    'Connect with MCP Inspector to call the search_docs tool:',
    `  npx @modelcontextprotocol/inspector ${opts.packageManager} start:stdio`,
    '',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
  process.stdout.write(`${banner}\n`);
}
