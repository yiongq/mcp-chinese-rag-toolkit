import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const scaffoldMock = {
  scaffoldProject: vi.fn(async () => {}),
};

vi.mock('../../../bin/scaffold.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../bin/scaffold.js')>();
  return {
    ...actual,
    scaffoldProject: (...args: Parameters<typeof actual.scaffoldProject>) =>
      scaffoldMock.scaffoldProject(...args),
  };
});

const cli = await import('../../../bin/create-mcp-rag.js');

let workspace: string;
let originalCwd: string;

beforeEach(() => {
  workspace = mkdtempSync(path.join(tmpdir(), 'cli-test-'));
  originalCwd = process.cwd();
  process.chdir(workspace);
  scaffoldMock.scaffoldProject.mockReset();
  scaffoldMock.scaffoldProject.mockResolvedValue(undefined);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(workspace, { recursive: true, force: true });
});

describe('create-mcp-rag CLI', () => {
  it('does not auto-run main() when imported as a module (isEntrypoint=false)', () => {
    // The test runner imported this module; if the import had triggered
    // `main()`, scaffoldProject would have been called by now. It must NOT have been.
    expect(scaffoldMock.scaffoldProject).not.toHaveBeenCalled();
    expect(cli.isEntrypoint).toBe(false);
  });

  it('main([--help]) prints help to stdout and returns 0', async () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const code = await cli.main(['--help']);
    expect(code).toBe(0);
    const text = out.mock.calls.map((c) => String(c[0])).join('');
    expect(text).toMatch(/create-mcp-rag/);
    out.mockRestore();
  });

  it('main([--version]) returns 0 and prints toolkit version', async () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const code = await cli.main(['--version']);
    expect(code).toBe(0);
    const text = out.mock.calls.map((c) => String(c[0])).join('');
    expect(text).toMatch(/create-mcp-rag\s+\d/);
    out.mockRestore();
  });

  it('main([]) returns 1 (missing project name) and writes to stderr', async () => {
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const code = await cli.main([]);
    expect(code).toBe(1);
    expect(err.mock.calls.map((c) => String(c[0])).join('')).toMatch(/missing <project-name>/);
    err.mockRestore();
  });

  it('main([projectName]) succeeds (mocked scaffoldProject) and returns 0', async () => {
    const code = await cli.main(['my-mcp-oa']);
    expect(code).toBe(0);
    expect(scaffoldMock.scaffoldProject).toHaveBeenCalledWith(
      expect.objectContaining({ projectName: 'my-mcp-oa' }),
    );
  });

  it('main returns InstallFailedError exit code (2) when scaffold throws it', async () => {
    const { InstallFailedError } = await import('../../../bin/scaffold.js');
    scaffoldMock.scaffoldProject.mockRejectedValueOnce(
      new InstallFailedError('boom: pnpm install failed'),
    );
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const code = await cli.main(['my-mcp-oa']);
    expect(code).toBe(2);
    err.mockRestore();
  });

  it('main returns 2 for unexpected non-ScaffoldError throws', async () => {
    scaffoldMock.scaffoldProject.mockRejectedValueOnce(new Error('unexpected fs glitch'));
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const code = await cli.main(['my-mcp-oa']);
    expect(code).toBe(2);
    err.mockRestore();
  });
});
