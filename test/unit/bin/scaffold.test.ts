import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScaffoldOptions } from '../../../bin/scaffold.js';
import {
  copyDirectoryRecursive,
  DEFAULT_PACKAGE_MANAGER,
  DEFAULT_TEMPLATE,
  detectPackageManager,
  InstallFailedError,
  parseArgs,
  replaceTokens,
  ScaffoldError,
  SUPPORTED_TEMPLATES,
  scaffoldProject,
} from '../../../bin/scaffold.js';

void spawn; // ensure the module is held — vi.mock factory lazily resolves the import

const TEMPLATE_FILES = [
  'package.json',
  'tsconfig.json',
  'README.md',
  '.gitignore',
  'src/server.ts',
  'scripts/build-index.ts',
  'data/sample-doc.md',
  'eval/eval-set.yml',
];

let workspace: string;
let originalCwd: string;

beforeEach(() => {
  workspace = mkdtempSync(path.join(tmpdir(), 'scaffold-test-'));
  originalCwd = process.cwd();
  process.chdir(workspace);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(workspace, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('throws when no project name is supplied and no help/version flag is present', () => {
    expect(() => parseArgs([])).toThrow(ScaffoldError);
    expect(() => parseArgs([])).toThrow(/missing <project-name>/);
  });

  it('returns {help: true} for --help (suppresses missing-name error)', () => {
    const opts = parseArgs(['--help']);
    expect(opts.help).toBe(true);
  });

  it('returns {help: true} for -h shorthand', () => {
    expect(parseArgs(['-h']).help).toBe(true);
  });

  it('returns {version: true} for --version (suppresses missing-name error)', () => {
    expect(parseArgs(['--version']).version).toBe(true);
  });

  it('returns {version: true} for -v shorthand', () => {
    expect(parseArgs(['-v']).version).toBe(true);
  });

  it('parses a single positional argument with default flags', () => {
    expect(parseArgs(['my-mcp-oa'])).toEqual({
      projectName: 'my-mcp-oa',
      template: DEFAULT_TEMPLATE,
      packageManager: DEFAULT_PACKAGE_MANAGER,
      skipInstall: false,
      skipGitInit: false,
    });
  });

  it('honors --template / --package-manager / --skip-install / --no-git-init together', () => {
    expect(
      parseArgs([
        'demo',
        '--template',
        'rag-basic',
        '--package-manager',
        'npm',
        '--skip-install',
        '--no-git-init',
      ]),
    ).toMatchObject({
      projectName: 'demo',
      template: 'rag-basic',
      packageManager: 'npm',
      skipInstall: true,
      skipGitInit: true,
    });
  });

  it('throws on unknown flag', () => {
    expect(() => parseArgs(['my', '--foo'])).toThrow(/unknown flag --foo/);
  });

  it('throws when --template lacks a value', () => {
    expect(() => parseArgs(['my', '--template'])).toThrow(/--template requires a value/);
  });

  it('throws when --template is followed by another flag (treated as missing value)', () => {
    expect(() => parseArgs(['my', '--template', '--skip-install'])).toThrow(
      /--template requires a value/,
    );
  });

  it('throws on unsupported --template value', () => {
    expect(() => parseArgs(['my', '--template', 'rag-vision'])).toThrow(/unknown template/);
  });

  it('throws on invalid --package-manager value', () => {
    expect(() => parseArgs(['my', '--package-manager', 'bun'])).toThrow(
      /invalid --package-manager/,
    );
  });

  it('throws on invalid project name (slash)', () => {
    expect(() => parseArgs(['my/proj'])).toThrow(/invalid project name/);
  });

  it('throws on invalid project name (leading dot)', () => {
    expect(() => parseArgs(['.proj'])).toThrow(/invalid project name/);
  });

  it('throws on extra positional argument', () => {
    expect(() => parseArgs(['a', 'b'])).toThrow(/unexpected extra positional argument/);
  });

  it('rejects scoped npm-style project name (cannot be a single directory)', () => {
    expect(() => parseArgs(['@scope/my-proj'])).toThrow(/scoped names .* are not supported/);
  });

  it('rejects uppercase project names (npm forbids uppercase)', () => {
    expect(() => parseArgs(['My-Cool-App'])).toThrow(/invalid project name/);
  });

  it('rejects Windows-reserved names (con, aux, nul, com1, lpt1)', () => {
    for (const name of ['con', 'aux', 'nul', 'com1', 'lpt1']) {
      expect(() => parseArgs([name])).toThrow(/Windows-reserved name/);
    }
  });

  it('rejects "--" by itself as missing project name', () => {
    expect(() => parseArgs(['--'])).toThrow(/missing <project-name>/);
  });

  it('treats "--" as end-of-flags, allowing dash-leading positional after it', () => {
    // Even after `--`, a positional starting with `-` is still rejected by
    // NPM_NAME_REGEX — the `--` separator only suppresses flag parsing.
    expect(() => parseArgs(['--', '-weird'])).toThrow(/invalid project name/);
  });

  it('warns on duplicate --template flag (last value wins)', () => {
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const opts = parseArgs(['my', '--template', 'rag-basic', '--template', 'rag-basic']);
    expect(opts.template).toBe('rag-basic');
    expect(warnSpy.mock.calls.map((c) => String(c[0])).join('')).toMatch(/duplicate --template/);
    warnSpy.mockRestore();
  });

  it('exposes SUPPORTED_TEMPLATES as a non-empty readonly tuple including rag-basic', () => {
    expect(SUPPORTED_TEMPLATES).toContain('rag-basic');
    expect(SUPPORTED_TEMPLATES.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// replaceTokens
// ---------------------------------------------------------------------------

describe('replaceTokens', () => {
  it('replaces a single token globally', () => {
    expect(replaceTokens('hello __NAME__ and __NAME__ again', { __NAME__: 'world' })).toBe(
      'hello world and world again',
    );
  });

  it('returns the input unchanged when no tokens match', () => {
    expect(replaceTokens('nothing to replace', { __NAME__: 'x' })).toBe('nothing to replace');
  });

  it('replaces multiple distinct tokens in one pass', () => {
    expect(replaceTokens('__A__ + __B__ = __C__', { __A__: '1', __B__: '2', __C__: '3' })).toBe(
      '1 + 2 = 3',
    );
  });
});

// ---------------------------------------------------------------------------
// copyDirectoryRecursive
// ---------------------------------------------------------------------------

describe('copyDirectoryRecursive', () => {
  it('copies a nested directory tree', () => {
    const src = path.join(workspace, 'src');
    const dst = path.join(workspace, 'dst');
    mkdirSync(path.join(src, 'sub'), { recursive: true });
    writeFileSync(path.join(src, 'top.txt'), 'top');
    writeFileSync(path.join(src, 'sub', 'nested.txt'), 'nested');

    copyDirectoryRecursive(src, dst);

    expect(readFileSync(path.join(dst, 'top.txt'), 'utf-8')).toBe('top');
    expect(readFileSync(path.join(dst, 'sub', 'nested.txt'), 'utf-8')).toBe('nested');
  });

  it('copies binary files byte-for-byte', () => {
    const src = path.join(workspace, 'src');
    const dst = path.join(workspace, 'dst');
    mkdirSync(src);
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe]);
    writeFileSync(path.join(src, 'image.bin'), bytes);

    copyDirectoryRecursive(src, dst);

    const copied = readFileSync(path.join(dst, 'image.bin'));
    expect(copied.equals(bytes)).toBe(true);
  });

  it('creates the destination directory when missing', () => {
    const src = path.join(workspace, 'src');
    const dst = path.join(workspace, 'deep', 'nested', 'dst');
    mkdirSync(src);
    writeFileSync(path.join(src, 'a.txt'), 'a');

    copyDirectoryRecursive(src, dst);

    expect(statSync(dst).isDirectory()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// detectPackageManager
// ---------------------------------------------------------------------------

describe('detectPackageManager', () => {
  const original = process.env.npm_config_user_agent;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.npm_config_user_agent;
    } else {
      process.env.npm_config_user_agent = original;
    }
  });

  it('detects pnpm from npm_config_user_agent', () => {
    process.env.npm_config_user_agent = 'pnpm/9.1.0 node/v20.0.0';
    expect(detectPackageManager()).toBe('pnpm');
  });

  it('detects yarn', () => {
    process.env.npm_config_user_agent = 'yarn/4.0.0 npm/? node/v20.0.0';
    expect(detectPackageManager()).toBe('yarn');
  });

  it('detects npm', () => {
    process.env.npm_config_user_agent = 'npm/10.0.0 node/v20.0.0';
    expect(detectPackageManager()).toBe('npm');
  });

  it('falls back to pnpm when user-agent is missing', () => {
    delete process.env.npm_config_user_agent;
    expect(detectPackageManager()).toBe('pnpm');
  });

  it('falls back to pnpm for unknown user-agent prefix', () => {
    process.env.npm_config_user_agent = 'bun/1.0.0';
    expect(detectPackageManager()).toBe('pnpm');
  });
});

// ---------------------------------------------------------------------------
// scaffoldProject
// ---------------------------------------------------------------------------

function makeOpts(overrides: Partial<ScaffoldOptions> = {}): ScaffoldOptions {
  return {
    projectName: 'demo-app',
    template: 'rag-basic',
    packageManager: 'pnpm',
    skipInstall: true,
    skipGitInit: true,
    ...overrides,
  };
}

describe('scaffoldProject', () => {
  it('rejects when the target directory already exists', async () => {
    mkdirSync(path.join(workspace, 'existing'));
    await expect(
      scaffoldProject(makeOpts({ projectName: 'existing' }), {
        spawnImpl: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(ScaffoldError);
  });

  it('rejects when the requested template is unknown', async () => {
    await expect(
      scaffoldProject(makeOpts({ template: 'rag-vision' as never }), {
        spawnImpl: vi.fn(),
      }),
    ).rejects.toThrow(/unknown template/);
  });

  it('copies the template tree end-to-end (skip install, skip git)', async () => {
    const spawnImpl = vi.fn();
    await scaffoldProject(makeOpts(), { spawnImpl });

    const target = path.join(workspace, 'demo-app');
    for (const rel of TEMPLATE_FILES) {
      expect(statSync(path.join(target, rel)).isFile()).toBe(true);
    }
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it('substitutes __PROJECT_NAME__ into package.json#name', async () => {
    const spawnImpl = vi.fn();
    await scaffoldProject(makeOpts({ projectName: 'token-test' }), { spawnImpl });

    const pkg = JSON.parse(
      readFileSync(path.join(workspace, 'token-test', 'package.json'), 'utf-8'),
    ) as { name: string; dependencies: Record<string, string> };
    expect(pkg.name).toBe('token-test');
    // Accept either `^x.y.z` (real published version) or `latest` (placeholder
    // 0.0.0 fallback) — code-review fix H2.
    expect(pkg.dependencies['@yiong/mcp-chinese-rag-toolkit']).toMatch(/^(\^\d|latest$)/);
  });

  it('substitutes __PACKAGE_MANAGER__ into scaffolded README per --package-manager choice', async () => {
    const spawnImpl = vi.fn(async () => 0);
    await scaffoldProject(makeOpts({ projectName: 'pm-token-test', packageManager: 'npm' }), {
      spawnImpl,
    });
    const readme = readFileSync(path.join(workspace, 'pm-token-test', 'README.md'), 'utf-8');
    expect(readme).toContain('npm install');
    expect(readme).toContain('npm build-index');
    expect(readme).not.toContain('__PACKAGE_MANAGER__');
  });

  it('substitutes __SCAFFOLD_DATE__ deterministically from the injected `now` clock', async () => {
    const fixed = new Date('2026-05-18T12:00:00Z');
    await scaffoldProject(makeOpts({ projectName: 'date-test' }), {
      spawnImpl: vi.fn(),
      now: () => fixed,
    });
    const readme = readFileSync(path.join(workspace, 'date-test', 'README.md'), 'utf-8');
    expect(readme).toContain('2026-05-18');
  });

  it('skips spawn when skipInstall=true', async () => {
    const spawnImpl = vi.fn();
    await scaffoldProject(makeOpts({ skipInstall: true }), { spawnImpl });
    const installCalls = spawnImpl.mock.calls.filter((args) => args[1]?.[0] === 'install');
    expect(installCalls).toHaveLength(0);
  });

  it('spawns the configured package manager when skipInstall=false', async () => {
    const spawnImpl = vi.fn(async () => 0);
    await scaffoldProject(makeOpts({ skipInstall: false, packageManager: 'npm' }), { spawnImpl });
    const installCall = spawnImpl.mock.calls.find((args) => args[1]?.[0] === 'install');
    expect(installCall?.[0]).toBe('npm');
  });

  it('throws InstallFailedError when install spawn exits non-zero', async () => {
    const spawnImpl = vi.fn(async () => 1);
    await expect(
      scaffoldProject(makeOpts({ skipInstall: false, projectName: 'fail-app' }), { spawnImpl }),
    ).rejects.toBeInstanceOf(InstallFailedError);
  });

  it('wraps spawn errors into InstallFailedError', async () => {
    const spawnImpl = vi.fn(async () => {
      throw new Error('spawn ENOENT pnpm');
    });
    await expect(
      scaffoldProject(makeOpts({ skipInstall: false, projectName: 'wrap-app' }), { spawnImpl }),
    ).rejects.toBeInstanceOf(InstallFailedError);
  });

  it('does NOT spawn git when skipGitInit=true', async () => {
    const spawnImpl = vi.fn();
    await scaffoldProject(makeOpts({ skipGitInit: true }), { spawnImpl });
    const gitCalls = spawnImpl.mock.calls.filter((args) => args[0] === 'git');
    expect(gitCalls).toHaveLength(0);
  });

  it('does NOT throw when git init spawn fails — warns to stderr instead', async () => {
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const spawnImpl = vi.fn(async (cmd: string) => {
      if (cmd === 'git') throw new Error('git not found');
      return 0;
    });
    await scaffoldProject(makeOpts({ skipGitInit: false, projectName: 'git-warn' }), {
      spawnImpl,
    });
    const warnings = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(warnings.some((w) => /git init failed/.test(w))).toBe(true);
    warnSpy.mockRestore();
  });

  it('does NOT throw when git init exits non-zero (warns + skips commit)', async () => {
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const spawnImpl = vi.fn(async (cmd: string, args: readonly string[]) => {
      if (cmd === 'git' && args[0] === 'init') return 1;
      return 0;
    });
    await scaffoldProject(makeOpts({ skipGitInit: false, projectName: 'git-fail' }), {
      spawnImpl,
    });
    const warnings = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(warnings.some((w) => /git init exited with code 1/.test(w))).toBe(true);
    warnSpy.mockRestore();
  });

  it('warns (does not throw) when git commit exits non-zero (e.g. missing user.email)', async () => {
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const spawnImpl = vi.fn(async (cmd: string, args: readonly string[]) => {
      if (cmd === 'git' && args[0] === 'commit') return 128;
      return 0;
    });
    await scaffoldProject(makeOpts({ skipGitInit: false, projectName: 'commit-fail' }), {
      spawnImpl,
    });
    const warnings = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(warnings.some((w) => /git commit exited with code 128/.test(w))).toBe(true);
    warnSpy.mockRestore();
  });

  it('cleans up the partial target directory when install fails (so re-run works)', async () => {
    const spawnImpl = vi.fn(async () => 1);
    await expect(
      scaffoldProject(makeOpts({ skipInstall: false, projectName: 'cleanup-test' }), {
        spawnImpl,
      }),
    ).rejects.toBeInstanceOf(InstallFailedError);
    // Partial dir must be gone — re-run should not hit "target dir exists".
    expect(() => statSync(path.join(workspace, 'cleanup-test'))).toThrow(/ENOENT/);
  });

  it('cleans up the partial target directory when spawn rejects', async () => {
    const spawnImpl = vi.fn(async () => {
      throw new Error('spawn EACCES git');
    });
    await expect(
      scaffoldProject(makeOpts({ skipInstall: false, projectName: 'cleanup-spawn' }), {
        spawnImpl,
      }),
    ).rejects.toBeInstanceOf(InstallFailedError);
    expect(() => statSync(path.join(workspace, 'cleanup-spawn'))).toThrow(/ENOENT/);
  });
});
