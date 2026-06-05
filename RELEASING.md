# Releasing `@yiong/mcp-chinese-rag-toolkit`

This package publishes to npm via **Changesets** + **npm Trusted Publishing
(OIDC, tokenless)** with a **provenance attestation**. The pipeline lives in
[`.github/workflows/release.yml`](.github/workflows/release.yml) and runs in
**this standalone public repo** (`github.com/yiongq/mcp-chinese-rag-toolkit`).

> Why here and not the parent monorepo: npm does **not** generate provenance for
> packages published from a **private** repository, even with Trusted Publishing.
> The parent monorepo is private, so all release infrastructure for the only
> public package must live in this repo. See ADR-0009 (Strategy A).

---

## 1. One-time maintainer setup (human-only — CI cannot do this)

Configure the **Trusted Publisher** on npmjs.com **once**. This binds the npm
package to this repo's GitHub Actions workflow so publishes need no token.

1. Sign in at <https://www.npmjs.com/> as the `@yiong` org maintainer.
2. Go to **`@yiong/mcp-chinese-rag-toolkit` → Settings → Trusted Publisher**.
3. Add a GitHub Actions publisher with **exactly** these values (must match
   `package.json` `repository.url` and the workflow filename):
   - **Organization or user**: `yiongq`
   - **Repository**: `mcp-chinese-rag-toolkit`
   - **Workflow filename**: `release.yml`
   - **Environment**: *(leave empty)*
4. **Tick at least one allowed action — select `npm publish`.** npm changed the
   Trusted Publisher form on **2026-05-20**: any configuration created on or
   after that date **must** explicitly grant at least one action, or its
   publishes are **rejected**. (Configs created before 2026-05-20 were
   auto-granted publish-only.) This repo's `release.yml` only publishes, so
   ticking `npm publish` is sufficient. This is a first-time setup gotcha — easy
   to miss because older guides predate the rule.
5. Save.

The package **already exists on npm at `0.1.0`** (first published manually via
webauthn, no provenance). There is therefore **no first-publish bootstrap
problem** — Trusted Publishing attaches to the existing package.

> The old personal/automation npm token was **revoked at end-2025**. Do **not**
> add an `NPM_TOKEN` secret for the normal path — OIDC is tokenless.

---

## 2. Day-to-day release flow

1. Make your code change on a branch.
2. Add a changeset describing the user-facing impact:
   ```bash
   pnpm changeset        # pick bump level (patch/minor/major) + write summary
   ```
   This writes a `.changeset/*.md` file — commit it with your change.
3. Open a PR and merge it to `main`.
4. `release.yml` runs on `main` and (via `changesets/action`) opens or updates a
   **"Version Packages"** PR that consumes the changesets, bumps the version, and
   updates `CHANGELOG.md`.
5. Merge the **Version Packages** PR. `release.yml` runs again and this time
   **publishes** (`pnpm release` = `changeset publish`) with provenance.
6. Verify on the npm package page that the new version shows a **"Provenance"**
   section linking back to the GitHub Actions run.

Required npm/Node for the publish step (already encoded in `release.yml`):
**npm ≥ 11.5.1** (Node 22 ships npm 10.x, so the workflow runs
`npm i -g npm@latest` before publishing) and `id-token: write` permission.

> **DoD decision — npm is intentionally NOT pinned (deferred-work.md D6).** The
> workflow runs `npm i -g npm@latest` rather than pinning a specific npm version.
> Rationale: (1) OIDC Trusted Publishing requires npm ≥ 11.5.1 while Node 22 ships
> 10.x; (2) `npm@latest` is npm's own documented Trusted-Publishing setup; (3) a
> pin would go stale and miss future OIDC / supply-chain fixes. The supply-chain
> surface of "trust whatever `@latest` is at run time" is accepted here because
> the publish runs on an ephemeral GitHub-hosted runner. Re-evaluate only if a
> future npm release regresses the publish path.

---

## 3. Verifying without publishing

```bash
pnpm changeset status      # release plan; exits 0, no ValidationError
pnpm build                 # tsdown + publint gates
npm publish --dry-run      # packs + validates metadata; does NOT publish/sign
node scripts/check-pack-size.mjs   # NFR36: fails if unpacked tarball > 100 MB
```

> **Honest boundary (sandbox cannot verify):** `--dry-run` does **not** contact
> the registry and does **not** mint the OIDC token, so it **cannot** produce a
> real provenance attestation. End-to-end OIDC + provenance is only observable
> in a **real GitHub Actions run on this repo** after the Trusted Publisher is
> configured (§1). This is the same "real run = human/post-merge step" boundary
> used for Demo 4's real CORS / screen-capture checks in Epic 5.

---

## 4. Emergency fallback — scoped-package OIDC E404

Scoped packages (`@yiong/*`) + OIDC + `changesets/action` have an intermittent
upstream `E404` bug ([npm/cli#8976](https://github.com/npm/cli/issues/8976),
recurring as #8730 / #8678). The package already existing at `0.1.0` plus the
dry-run gate mitigate it, but if a real publish fails with `E404`:

1. Create a **granular automation token** on npmjs.com scoped to this package.
2. Add it as the repo secret `NPM_TOKEN`.
3. Temporarily set `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` on the publish
   step and keep `NPM_CONFIG_PROVENANCE: 'true'` + `id-token: write` so
   provenance is still attempted.
4. Once #8976 is resolved upstream, remove the token and return to the pure
   tokenless OIDC path.

> **Alternative before reaching for a token — bump the runner to Node 24.** The
> scoped-package E404 has also been reported as resolved under **Node.js 24**.
> `release.yml` currently pins `node-version: 22.x`; if a real publish hits E404,
> try bumping `actions/setup-node` to `24.x` first (Node 24 still needs
> `npm i -g npm@latest` to reach npm ≥ 11.5.1 for OIDC). Prefer this tokenless
> path over reintroducing `NPM_TOKEN`.

---

## 5. Known exception (DoD) — `attw` still disabled

`tsdown.config.ts` keeps `attw: false`. **Final DoD re-check for Story 7.5
(2026-06-04)** — the first-publish gate: flipping to `attw: 'ci-only'` and
running `CI=true pnpm build` on `@arethetypeswrong/cli@0.17.4` + `fflate@0.8.3`
+ Node 22.22.0 **still throws** `ATTW check failed: TypeError: Cannot read
properties of undefined (reading 'filename')` — the upstream gunzip/fflate bug
is unfixed. `publint` passes in the same run.

This is a **documented known exception**, not a silent skip (verified live, not
inherited from the prior note). Re-evaluate and flip back to `attw: 'ci-only'`
once upstream `fflate` / `attw` ships a fix. In the meantime the published
`.d.ts` / `.d.cts` are still gated by `publint` (CI) and exercised by the
package's own type tests, so type-resolution regressions are still caught.
