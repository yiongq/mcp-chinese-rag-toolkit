#!/usr/bin/env node
// Public-hygiene gate — fails when a user-facing file in this public package
// leaks internal development-process jargon (planning-tracker references,
// internal project names, private roadmap items). This package is open
// source; its README, source comments, generated API docs, templates and
// tests are all read by external users, so they must read as user-facing
// documentation, not as an internal planning tracker.
//
// The banned-pattern list is intentionally NOT committed — listing the
// internal names in a tracked file would itself leak them. Patterns live in
// a gitignored sibling file:
//
//   scripts/hygiene-patterns.local.json
//   [{ "label": "internal brand", "pattern": "\\bsome-name\\b", "flags": "i" }, …]
//
// When that file is absent (fresh clone / CI), the check prints a notice and
// exits 0 so it never blocks builds that have nothing to load.
//
//   node scripts/check-public-hygiene.mjs
//
// Exits 1 (with file:line locations) on any violation; 0 when clean or skipped.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const PATTERNS_FILE = join(import.meta.dirname, 'hygiene-patterns.local.json');

// Roots to scan — the public/published + source surface. `scripts/` is
// excluded (the gate and its local patterns file live there).
const TARGETS = ['README.md', 'package.json', 'src', 'bin', 'templates', 'docs', 'eval', 'test'];
const SCAN_EXT = new Set(['.md', '.ts', '.tsx', '.mjs', '.cjs', '.js', '.yml', '.yaml']);

if (!existsSync(PATTERNS_FILE)) {
  console.log(
    'public-hygiene: scripts/hygiene-patterns.local.json not found — skipping (no patterns to check).',
  );
  process.exit(0);
}

/** Load `[{ label, pattern, flags? }, …]` and compile to `[label, RegExp]` pairs. */
function loadRules(file) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(
      `::error::public-hygiene: could not parse ${relative(ROOT, file)}: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some((r) => typeof r?.label !== 'string' || typeof r?.pattern !== 'string')
  ) {
    console.error(
      '::error::public-hygiene: patterns file must be an array of { label, pattern, flags? } objects',
    );
    process.exit(1);
  }
  return parsed.map((r) => [r.label, new RegExp(r.pattern, r.flags ?? '')]);
}

const RULES = loadRules(PATTERNS_FILE);

function* walk(abs) {
  let st;
  try {
    st = statSync(abs);
  } catch {
    return; // a TARGET that does not exist (e.g. no templates/) is simply skipped
  }
  if (st.isDirectory()) {
    for (const name of readdirSync(abs)) {
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
      yield* walk(join(abs, name));
    }
  } else if (SCAN_EXT.has(abs.slice(abs.lastIndexOf('.')))) {
    yield abs;
  }
}

const violations = [];

function scanFile(abs) {
  const lines = readFileSync(abs, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const [label, re] of RULES) {
      if (re.test(line)) {
        violations.push({ file: relative(ROOT, abs), line: i + 1, label, text: line.trim() });
      }
    }
  });
}

for (const target of TARGETS) {
  const absTarget = join(ROOT, target);
  let st;
  try {
    st = statSync(absTarget);
  } catch {
    continue; // a TARGET that does not exist (e.g. no templates/) is simply skipped
  }
  // An explicitly-listed file (e.g. package.json — published metadata, but not a
  // SCAN_EXT extension) is scanned unconditionally; directories are walked with
  // the SCAN_EXT filter.
  if (st.isFile()) {
    scanFile(absTarget);
  } else {
    for (const file of walk(absTarget)) scanFile(file);
  }
}

if (violations.length === 0) {
  console.log('✓ public-hygiene: no internal jargon found in user-facing files');
  process.exit(0);
}

console.error(`::error::public-hygiene: ${violations.length} internal-jargon leak(s) in user-facing files\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  [${v.label}]  ${v.text.slice(0, 120)}`);
}
console.error(
  '\nThis is a public open-source package. Rephrase the flagged lines to neutral, user-facing\n' +
    'wording — internal project names, planning references, and private roadmap details belong\n' +
    'in the private parent monorepo, not this repo.',
);
process.exit(1);
