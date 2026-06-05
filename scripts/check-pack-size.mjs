#!/usr/bin/env node
// NFR36 size guard — fails CI when a package's unpacked publish size (the
// on-disk size of the published file tree) would exceed the limit. This is the
// stricter, registry-relevant dimension; the gzipped tarball is only reported.
// Run inside a package dir, or pass the dir as argv[2].
//
//   node scripts/check-pack-size.mjs            # current package
//   node scripts/check-pack-size.mjs path/to/pkg
//
// Measures `unpackedSize` (on-disk size of the published tree). `npm pack
// --dry-run` does NOT write a tarball; it only computes the manifest from the
// package's `files` field, so this is a pure, non-publishing measurement.
import { execFileSync } from 'node:child_process';

const LIMIT_MB = 100;
const LIMIT = LIMIT_MB * 1024 * 1024;
const cwd = process.argv[2] ?? process.cwd();

const stdout = execFileSync('npm', ['pack', '--dry-run', '--json'], {
  cwd,
  encoding: 'utf8',
  maxBuffer: 128 * 1024 * 1024,
});

const entries = JSON.parse(stdout);
let failed = false;
for (const e of entries) {
  // Fail loud if npm ever drops/renames the field — coercing to 0 would make
  // the NFR36 gate pass vacuously (silent false-negative).
  if (typeof e.unpackedSize !== 'number') {
    console.error(
      `::error::${e.name}: npm pack --json reported no numeric unpackedSize (got ${JSON.stringify(e.unpackedSize)}) — cannot enforce the NFR36 size guard`,
    );
    process.exit(1);
  }
  const unpacked = e.unpackedSize;
  const tarball = e.size ?? 0;
  const mb = (unpacked / 1024 / 1024).toFixed(2);
  const tmb = (tarball / 1024 / 1024).toFixed(2);
  const files = e.entryCount ?? e.files?.length ?? '?';
  console.log(`${e.name}@${e.version}: unpacked ${mb} MB / tarball ${tmb} MB / ${files} files`);
  if (unpacked > LIMIT) {
    console.error(`::error::${e.name} unpacked size ${mb} MB exceeds ${LIMIT_MB} MB limit (NFR36)`);
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
