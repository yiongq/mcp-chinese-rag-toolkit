/**
 * scaffold library — called by `bin/create-mcp-rag.ts`.
 *
 * Separated from the CLI shell so unit tests can drive `scaffoldProject` /
 * `parseArgs` directly without spawning a subprocess. Exports follow the
 * same lib-vs-CLI split used by `bin/latency-harness.ts` and
 * `bin/run-vision-caption-demo.ts`.
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
  rmSync,
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
 *.
 */
export class InstallFailedError extends ScaffoldError {
  constructor(message: string) {
    super(message, 2);
    this.name = 'InstallFailedError';
  }
}

// Case-sensitive — npm registry forbids uppercase. Scoped (@scope/name) is
// rejected at parse time because the slash makes it ambiguous as a directory.
const NPM_NAME_REGEX = /^[a-z0-9][a-z0-9-_.]*$/;
const WINDOWS_RESERVED_NAME_REGEX = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const SEMVER_REGEX = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9a-z.-]+)?(?:\+[0-9a-z.-]+)?$/i;

/**
 * Parse `argv` (everything after `node bin/create-mcp-rag.ts`) into a
 * resolved `ScaffoldOptions`. Fail-fast on unknown flags, missing values,
 * invalid project names, or duplicate positional arguments — mirrors
 * `bin/run-eval.ts#parseArgs` semantics.
 *
 * Auto-detects package manager from `npm_config_user_agent` when `--package-manager`
 * is not supplied; explicit flag always wins.
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
  let packageManagerExplicit = false;
  const seenFlags = new Set<string>();
  let endOfFlags = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (!endOfFlags && arg === '--') {
      endOfFlags = true;
      continue;
    }
    if (!endOfFlags && (arg === '--help' || arg === '-h')) {
      opts.help = true;
      continue;
    }
    if (!endOfFlags && (arg === '--version' || arg === '-v')) {
      opts.version = true;
      continue;
    }
    if (!endOfFlags && arg === '--skip-install') {
      if (seenFlags.has('--skip-install')) {
        process.stderr.write('create-mcp-rag: warning — duplicate --skip-install ignored\n');
      }
      seenFlags.add('--skip-install');
      opts.skipInstall = true;
      continue;
    }
    if (!endOfFlags && arg === '--no-git-init') {
      if (seenFlags.has('--no-git-init')) {
        process.stderr.write('create-mcp-rag: warning — duplicate --no-git-init ignored\n');
      }
      seenFlags.add('--no-git-init');
      opts.skipGitInit = true;
      continue;
    }
    if (!endOfFlags && (arg === '--template' || arg === '--package-manager')) {
      const value = argv[i + 1];
      if (value === undefined || value === '' || value.startsWith('-')) {
        throw new ScaffoldError(
          `create-mcp-rag: ${arg} requires a value (got ${value ?? 'nothing'})`,
        );
      }
      if (seenFlags.has(arg)) {
        process.stderr.write(`create-mcp-rag: warning — duplicate ${arg} flag, last value wins\n`);
      }
      seenFlags.add(arg);
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
        packageManagerExplicit = true;
      }
      i += 1;
      continue;
    }
    if (!endOfFlags && arg.startsWith('-')) {
      throw new ScaffoldError(`create-mcp-rag: unknown flag ${arg}`);
    }
    if (positionalSet) {
      throw new ScaffoldError(`create-mcp-rag: unexpected extra positional argument "${arg}"`);
    }
    if (arg.startsWith('@')) {
      throw new ScaffoldError(
        `create-mcp-rag: scoped names like "${arg}" are not supported as directory targets — pass a plain name (the scaffolded package.json#name can be edited afterwards)`,
      );
    }
    if (!NPM_NAME_REGEX.test(arg)) {
      throw new ScaffoldError(
        `create-mcp-rag: invalid project name "${arg}" — must be lowercase and match npm package-name rules`,
      );
    }
    if (WINDOWS_RESERVED_NAME_REGEX.test(arg)) {
      throw new ScaffoldError(
        `create-mcp-rag: project name "${arg}" is a Windows-reserved name (con, prn, aux, nul, com1-9, lpt1-9)`,
      );
    }
    opts.projectName = arg;
    positionalSet = true;
  }

  if (!opts.help && !opts.version && !opts.projectName) {
    throw new ScaffoldError('create-mcp-rag: missing <project-name>');
  }

  if (!packageManagerExplicit) {
    opts.packageManager = detectPackageManager();
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
    '  npx -p @yiong/mcp-chinese-rag-toolkit create-mcp-rag <project-name> [options]',
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
 * this file to the filesystem root (works under `bin/scaffold.ts` source,
 * `dist/cli/...` build output, and arbitrarily-nested npx caches).
 */
function readToolkitPackageJson(): { version: string; name: string } {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  let lastDir = '';
  while (dir !== lastDir) {
    const candidate = path.join(dir, 'package.json');
    if (existsSync(candidate)) {
      const raw = readFileSync(candidate, 'utf-8');
      const parsed = JSON.parse(raw) as { name?: string; version?: string };
      if (parsed.name === '@yiong/mcp-chinese-rag-toolkit') {
        const version =
          typeof parsed.version === 'string' && SEMVER_REGEX.test(parsed.version)
            ? parsed.version
            : null;
        if (version === null) {
          throw new ScaffoldError(
            `create-mcp-rag: toolkit package.json version "${parsed.version ?? ''}" is not a valid semver`,
          );
        }
        return { name: parsed.name, version };
      }
    }
    lastDir = dir;
    dir = path.dirname(dir);
  }
  throw new ScaffoldError('create-mcp-rag: cannot locate toolkit package.json from CLI bundle');
}

export async function printVersion(): Promise<void> {
  const pkg = readToolkitPackageJson();
  process.stdout.write(`${pkg.name} create-mcp-rag ${pkg.version}\n`);
}

/**
 * Locate the bundled `templates/create-mcp-rag/files/<template>/` directory.
 * Walks up from this file to the filesystem root, mirroring `readToolkitPackageJson`.
 */
function resolveTemplateDir(template: string): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  let lastDir = '';
  while (dir !== lastDir) {
    const candidate = path.join(dir, 'templates', 'create-mcp-rag', 'files', template);
    if (existsSync(candidate)) return candidate;
    lastDir = dir;
    dir = path.dirname(dir);
  }
  throw new ScaffoldError(`create-mcp-rag: template "${template}" files not found`);
}

interface TemplateManifest {
  id: string;
  minToolkitVersion?: string;
  minNodeVersion?: string;
}

/**
 * Parse `templates/create-mcp-rag/template.json` (if present) and return the
 * matching entry. Used to enforce minimum Node + toolkit versions before any
 * file is copied. Returns null when the manifest is missing/unreadable —
 * legacy behaviour for templates that predate the manifest.
 */
function readTemplateManifest(template: string): TemplateManifest | null {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  let lastDir = '';
  while (dir !== lastDir) {
    const candidate = path.join(dir, 'templates', 'create-mcp-rag', 'template.json');
    if (existsSync(candidate)) {
      try {
        const raw = readFileSync(candidate, 'utf-8');
        const parsed = JSON.parse(raw) as { templates?: TemplateManifest[] };
        return parsed.templates?.find((t) => t.id === template) ?? null;
      } catch {
        return null;
      }
    }
    lastDir = dir;
    dir = path.dirname(dir);
  }
  return null;
}

function compareSemver(a: string, b: string): number {
  const parse = (v: string): [number, number, number] => {
    const m = SEMVER_REGEX.exec(v);
    if (!m) return [0, 0, 0];
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  };
  const [a0, a1, a2] = parse(a);
  const [b0, b1, b2] = parse(b);
  if (a0 !== b0) return a0 - b0;
  if (a1 !== b1) return a1 - b1;
  return a2 - b2;
}

function enforceTemplateConstraints(
  manifest: TemplateManifest | null,
  toolkitVersion: string,
): void {
  if (manifest === null) return;
  if (manifest.minNodeVersion !== undefined) {
    const min = manifest.minNodeVersion.replace(/^[\^>=~]+/, '').trim();
    const current = process.version.replace(/^v/, '');
    if (SEMVER_REGEX.test(min) && compareSemver(current, min) < 0) {
      throw new ScaffoldError(
        `create-mcp-rag: template requires Node ${manifest.minNodeVersion} but running ${process.version}`,
      );
    }
  }
  if (manifest.minToolkitVersion !== undefined) {
    const min = manifest.minToolkitVersion.replace(/^[\^>=~]+/, '').trim();
    if (SEMVER_REGEX.test(min) && compareSemver(toolkitVersion, min) < 0) {
      throw new ScaffoldError(
        `create-mcp-rag: template requires toolkit ${manifest.minToolkitVersion} but bundled ${toolkitVersion}`,
      );
    }
  }
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
 * Recursively copy `src` → `dst`. Symlinks are refused outright — a malicious
 * or careless template must not be able to escape the destination tree, and
 * the current set of supported templates does not need link semantics.
 */
export function copyDirectoryRecursive(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isSymbolicLink()) {
      throw new ScaffoldError(
        `create-mcp-rag: template contains a symlink (${srcPath}); refusing to copy (path-traversal safety)`,
      );
    }
    if (entry.isDirectory()) {
      copyDirectoryRecursive(srcPath, dstPath);
      continue;
    }
    copyFileSync(srcPath, dstPath);
  }
}

/**
 * Replace `__TOKEN__` placeholders in one pass via a combined alternation
 * regex. Avoids the order-sensitive `split().join()` pattern (each input
 * character is consumed exactly once, so a token's substitution can never
 * be re-matched). Tokens with no value default to the literal `__KEY__`.
 */
export function replaceTokens(content: string, tokens: Record<string, string>): string {
  const keys = Object.keys(tokens);
  if (keys.length === 0) return content;
  const escaped = keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(?:${escaped.join('|')})`, 'g');
  return content.replace(pattern, (match) => tokens[match] ?? match);
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

// Never recurse into these — they are tool/build artifacts whose contents
// must not be mangled by token replacement (e.g. `.git/info/exclude` matches
// our dotfile rule but rewriting it would corrupt the repo).
const WALK_BLOCKLIST = new Set(['.git', 'node_modules', 'dist', '.turbo']);

function isTextFile(filePath: string): boolean {
  const base = path.basename(filePath);
  if (DOTFILE_TEXT_NAMES.has(base)) return true;
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_FILE_EXTENSIONS.has(ext);
}

function* walkFiles(root: string): Generator<string> {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (WALK_BLOCKLIST.has(entry.name)) continue;
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
 * so the user sees real progress. Listens on `close` (not `exit`) so stdio
 * buffers drain before the promise resolves.
 *
 * Exposed for the smoke script / unit tests; not part of the public API.
 */
export function runSpawn(command: string, args: readonly string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => resolve(code ?? 0));
  });
}

interface ScaffoldDeps {
  spawnImpl?: typeof runSpawn;
  /** Stamp for `__SCAFFOLD_DATE__` — injectable for deterministic tests. */
  now?: () => Date;
}

/**
 * Build the `__TOOLKIT_VERSION__` token value. When the toolkit is still on
 * the placeholder `0.0.0` (i.e. not yet npm-published), fall back to `latest`
 * so the scaffolded `package.json#dependencies` resolves once it ships. For
 * any real version, emit a caret range.
 */
function buildToolkitVersionToken(version: string): string {
  if (version === '0.0.0') return 'latest';
  return `^${version}`;
}

/**
 * Detect whether `dir` is inside an existing git working tree by walking up
 * looking for a `.git` directory or file (worktrees use a file pointer).
 * Used to warn the user that `git init` would create a nested repo.
 */
function isInsideGitWorktree(dir: string): boolean {
  let cur = path.resolve(dir);
  let last = '';
  while (cur !== last) {
    if (existsSync(path.join(cur, '.git'))) return true;
    last = cur;
    cur = path.dirname(cur);
  }
  return false;
}

/**
 * Core scaffolding workflow:
 *   1. Validate target dir (must NOT exist — never silently overwrite,
 *      lesson 7 / lesson 11). Created atomically.
 *   2. Validate template id + enforce template.json constraints
 *   3. Recursively copy `templates/create-mcp-rag/files/<template>/` → target
 *   4. Token-replace `__PROJECT_NAME__` / `__TOOLKIT_VERSION__` /
 *      `__PACKAGE_MANAGER__` / `__SCAFFOLD_DATE__`
 *   5. Optional: spawn `<pm> install` (stdio inherit, non-zero → throw)
 *   6. Optional: `git init` + initial commit (failure → stderr warn, do NOT throw)
 *   7. Print next-steps banner to stdout
 *
 * On any failure after the target directory was created, the partial tree is
 * removed so the user can re-run the command without manual cleanup.
 *
 * @param opts Resolved CLI options (see {@link parseArgs}).
 * @param deps Injectable hooks for testability (test code mocks `spawnImpl`).
 */
export async function scaffoldProject(
  opts: ScaffoldOptions,
  deps: ScaffoldDeps = {},
): Promise<void> {
  const targetDir = path.resolve(process.cwd(), opts.projectName);

  if (!SUPPORTED_TEMPLATES.includes(opts.template as (typeof SUPPORTED_TEMPLATES)[number])) {
    throw new ScaffoldError(
      `create-mcp-rag: unknown template "${opts.template}" (supported: ${SUPPORTED_TEMPLATES.join(', ')})`,
    );
  }
  const templateDir = resolveTemplateDir(opts.template);
  const toolkitPkg = readToolkitPackageJson();
  const manifest = readTemplateManifest(opts.template);
  enforceTemplateConstraints(manifest, toolkitPkg.version);
  const now = (deps.now ?? (() => new Date()))();

  // Step 1 — atomic mkdir doubles as the existence guard. If the directory
  // exists, EEXIST surfaces synchronously; no TOCTOU window between check
  // and create.
  try {
    mkdirSync(targetDir);
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new ScaffoldError(`create-mcp-rag: target directory already exists: ${targetDir}`);
    }
    throw err;
  }

  let targetCreated = true;
  try {
    // Step 3 — copy
    copyDirectoryRecursive(templateDir, targetDir);

    // Step 4 — token replace
    const tokens: Record<string, string> = {
      __PROJECT_NAME__: opts.projectName,
      __TOOLKIT_VERSION__: buildToolkitVersionToken(toolkitPkg.version),
      __PACKAGE_MANAGER__: opts.packageManager,
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
      if (isInsideGitWorktree(path.dirname(targetDir))) {
        process.stderr.write(
          `create-mcp-rag: warning — parent directory is already inside a git repo; nesting a new repo at ${targetDir}\n`,
        );
      }
      try {
        const initCode = await spawnImpl('git', ['init', '--quiet'], targetDir);
        if (initCode !== 0) {
          process.stderr.write(
            `create-mcp-rag: warning — git init exited with code ${initCode}; skipping initial commit\n`,
          );
        } else {
          const addCode = await spawnImpl('git', ['add', '.'], targetDir);
          if (addCode === 0) {
            const commitCode = await spawnImpl(
              'git',
              [
                'commit',
                '--quiet',
                '-m',
                `chore: initial commit from @yiong/mcp-chinese-rag-toolkit create-mcp-rag@${toolkitPkg.version}`,
              ],
              targetDir,
            );
            if (commitCode !== 0) {
              process.stderr.write(
                `create-mcp-rag: warning — git commit exited with code ${commitCode}; the repo is initialised but has no initial commit (often: missing user.name/user.email — set them and run \`git commit\` manually)\n`,
              );
            }
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

    // Reaching here means everything past the copy succeeded — don't roll back.
    targetCreated = false;

    // Step 7 — next-steps banner
    const quotedName = /[^a-z0-9._-]/i.test(opts.projectName)
      ? `"${opts.projectName}"`
      : opts.projectName;
    const banner = [
      '',
      `✔ Scaffolded ${opts.projectName} (template: ${opts.template})`,
      '',
      'Next steps:',
      `  cd ${quotedName}`,
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
  } catch (err) {
    if (targetCreated) {
      try {
        rmSync(targetDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup — surface the original error regardless.
      }
    }
    throw err;
  }
}
