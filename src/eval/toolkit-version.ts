// ---------------------------------------------------------------------------
// — Toolkit version probe (read this package's own version from package.json)
// ---------------------------------------------------------------------------
//
// Answer-eval runs stamp the toolkit's package version into their metadata for
// provenance, so scores stay auditable across releases. Hardcoding the version
// would silently go stale on the next release and corrupt that audit trail, so
// it is read from package.json at run time instead.
//
// The catch: this module is bundled into a single dist file, so a FIXED relative
// path from `import.meta.url` lands in a different place under each layout — the
// source tree under the test runner, the bundled dist file, and an installed
// dependency. Walking UP from this module to the first package.json whose `name`
// matches THIS package is robust across all three: each layout reaches this
// package's own root before any other, and the name check avoids mistaking a
// consumer's package.json for ours.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** This package's name, used to identify its own package.json while walking up. */
const PACKAGE_NAME = '@yiong/mcp-chinese-rag-toolkit';

/** Module-level memo: the version is immutable for the process, so read it once. */
let cachedVersion: string | undefined;

/**
 * Read this package's version from its own package.json, located by walking up
 * from this module to the first package.json whose `name` matches. Memoized after
 * the first successful read.
 *
 * Lazy on purpose — importing this module never touches the filesystem; the read
 * happens on first call. It fails loudly (throws) when the package.json cannot be
 * located, since that means a packaging or environment invariant is broken; it
 * never silently substitutes a placeholder version, which would corrupt the audit
 * trail in the same way a hardcoded version would.
 */
export function readToolkitVersion(): string {
  if (cachedVersion !== undefined) return cachedVersion;
  cachedVersion = locateVersion();
  return cachedVersion;
}

function locateVersion(): string {
  const start = fileURLToPath(import.meta.url);
  const searched: string[] = [];
  let dir = dirname(start);
  // Ascend until `dirname` stops climbing (the filesystem root returns itself).
  let prev = '';
  while (dir !== prev) {
    const candidate = join(dir, 'package.json');
    searched.push(candidate);
    if (existsSync(candidate)) {
      const version = readMatchingVersion(candidate);
      if (version !== undefined) return version;
    }
    prev = dir;
    dir = dirname(dir);
  }
  throw new Error(
    `readToolkitVersion: could not locate the '${PACKAGE_NAME}' package.json by walking up from ` +
      `${start}. Searched: ${searched.join(', ')}. This indicates a packaging or environment ` +
      'invariant is broken.',
  );
}

/** Return the `version` of a package.json iff its `name` is this package. */
function readMatchingVersion(packageJsonPath: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  } catch {
    return undefined; // unreadable or not JSON — keep walking up
  }
  if (parsed === null || typeof parsed !== 'object') return undefined;
  const pkg = parsed as { name?: unknown; version?: unknown };
  if (pkg.name === PACKAGE_NAME && typeof pkg.version === 'string') return pkg.version;
  return undefined;
}
