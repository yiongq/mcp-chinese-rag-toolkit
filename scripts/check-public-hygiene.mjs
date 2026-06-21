#!/usr/bin/env node
// Public-hygiene gate — fails CI when a user-facing file in this public package
// leaks internal development-process jargon. This package is open source; its
// README, source comments, generated API docs, templates and tests are all read
// by external users, so they must read as user-facing documentation, not as an
// internal BMad story/epic/requirement tracker.
//
// Banned: Story/Epic numbers, FR/NFR/AR-Ext requirement IDs, "AI Agent Rule",
// internal brand names, private downstream package names (the public package
// must not advertise an unreleased private roadmap), and private planning-doc
// paths. The private parent monorepo keeps these freely — this gate guards ONLY
// this standalone public repo.
//
//   node scripts/check-public-hygiene.mjs
//
// Exits 1 (with file:line locations) on any violation; 0 when clean.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

// Roots to scan — the public/published + source surface. `scripts/` is excluded
// (this gate lives there and necessarily names the patterns it bans).
const TARGETS = ['README.md', 'package.json', 'src', 'bin', 'templates', 'docs', 'eval', 'test'];
const SCAN_EXT = new Set(['.md', '.ts', '.tsx', '.mjs', '.cjs', '.js', '.yml', '.yaml']);

// Each rule: a human label + a RegExp. Word boundaries keep false positives out
// (e.g. "history" must not trip "Story"; "frame" must not trip "FR1").
const RULES = [
  ['Story/Epic reference', /\b(?:stor(?:y|ies)|epics?)\b/i],
  ['FR/NFR requirement id', /\bN?FR\d/],
  ['AR-Ext requirement id', /\bAR-Ext-\d/i],
  ['AI Agent Rule', /\bAI Agent Rule\b/i],
  ['architecture rule', /\barchitecture rule\b/i],
  ['internal brand', /glorysoft/i],
  ['private package mcp-hr', /\bmcp-hr\b/],
  ['private package mcp-modeling', /\bmcp-modeling\b/],
  ['private package ai-edge-pack', /\bai-edge-pack\b/],
  ['BMad tooling', /\b_?bmad\b/i],
  ['private planning doc', /\b(?:architecture|prd|epics)(?:\.md\b|\s+L\d{2,})/],
];

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
  '\nThis is a public open-source package. Rephrase to user-facing wording — strip Story/Epic/FR/NFR\n' +
    'scaffolding, generalize private package names to "a downstream consumer package", and drop private\n' +
    'planning-doc references. The private parent monorepo is the place for internal naming, not this repo.',
);
process.exit(1);
