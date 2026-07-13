---
project: "minimal-agent"
title: "Versioning and releases"
type: docs
status: living
scope: monorepo
working-dir: "."
created-at: "2026-07-12T21:36:13-0400"
updated-at: "2026-07-12T21:36:13-0400"
version-synced: "0.1.0"
tags:
  monorepo: "v0.1.0"
  core: "v0.1.0"
  plugins: "v0.1.0"
tooling: "scripts/version.ts"
related:
  - "AGENTS.md"
  - "CHANGELOG.md"
  - "README.md"
  - "scripts/version.ts"
  - ".github/workflows/ci.yml"
  - ".github/workflows/release.yml"
  - "minimal-agent-core/.github/workflows/ci.yml"
  - "minimal-agent-core/.github/workflows/release.yml"
  - "minimal-agent-plugins/.github/workflows/ci.yml"
  - "minimal-agent-plugins/.github/workflows/release.yml"
remotes:
  monorepo: "https://github.com/gastonmorixe/minimal-agent"
  core: "https://github.com/gastonmorixe/minimal-agent-core"
  plugins: "https://github.com/gastonmorixe/minimal-agent-plugins"
---

# Versioning and releases

How the **minimal-agent monorepo**, **minimal-agent-core**, and
**minimal-agent-plugins** share a coordinated stable version, how to bump it,
and how CI/release workflows enforce the scheme.

Product changelogs for harness/plugin features still live in the submodules.
This document is monorepo-level process only.

## Scheme

| Kind | Where | Form |
|------|--------|------|
| `package.json` `version` | monorepo root; core root + `plugin-api` + `tools/docs`; plugins root + every `ma-*-plugin` | Semver, e.g. `0.1.0` |
| Stable git tag | each of the three remotes | `v0.1.0` — must match that repo’s root `package.json` version |
| Core nightlies | core only (`release.yml` on push to `main`) | `v0.1.0-nightly.<UTC-stamp>` derived from package.json + timestamp |

**Rules**

1. Coordinated stable releases keep monorepo, core, and plugins on the **same**
   version and tag (`v0.1.0` everywhere).
2. Nightlies advance only core’s pre-release stream. They do **not** bump
   `package.json` and do **not** require plugins/monorepo tags.
3. Stable tag label (without the leading `v`) must equal `package.json`
   `version` exactly. Core and plugins release workflows fail the job if not.
4. Plugins and monorepo do **not** publish nightlies.

Current coordinated release: **0.1.0** / **`v0.1.0`** (2026-07-12).

## Tooling: `scripts/version.ts`

From the monorepo root:

```bash
bun run version:status
# alias
bun run version -- status

bun run version -- set 0.2.0
bun run version -- set 0.2.0 --tag
bun run version -- set 0.2.0 --tag --push
bun run version -- set 0.2.0 --targets core --tag --push
bun run version -- set 0.2.0 --targets plugins,monorepo --tag --push
bun run version -- tag 0.2.0 --push          # tag only; package.json already set
bun run version -- set 0.2.0 --allow-dirty   # if unrelated WIP exists
```

| Command | Effect |
|---------|--------|
| `status` | Per-target package.json versions, drift, HEAD, stable tags |
| `set <semver>` | Rewrite all package.json under selected targets; optional commit/tag/push |
| `tag <semver>` | Annotated tags only (fails if package.json ≠ version) |

**Targets:** `all` (default) · `monorepo` · `core` · `plugins` · comma lists.

**Commit behavior**

- Stages only the package.json files it rewrites.
- Unrelated dirty files block the commit unless `--allow-dirty`.
- After core/plugins version commits, commits monorepo submodule **pin** bumps
  (`chore: bump submodule pins for vX.Y.Z`).
- If a pin bump lands after the monorepo `v*` tag was created, re-point the
  monorepo tag to HEAD before push so the release commit includes pins:
  ```bash
  git tag -d v0.1.0
  git tag -a v0.1.0 -m "chore: release v0.1.0"
  ```

## What gets versioned

### Monorepo (`gastonmorixe/minimal-agent`)

- `./package.json`
- Tag `v*` = “these submodule pins are the coordinated release”
- Release notes list core + plugins gitlink SHAs

### Core (`gastonmorixe/minimal-agent-core`)

- `package.json`, `plugin-api/package.json`, `tools/docs/package.json`
- Stable `v*` → full gate + source tarball + GitHub release (existing
  `scripts/build-tarball.sh`)
- Branch push to `main` → nightly pre-release tag + tarball

### Plugins (`gastonmorixe/minimal-agent-plugins`)

- Root `package.json` + every `ma-*-plugin/package.json` (kept in lockstep)
- Stable `v*` → GitHub release notes only (no tarball; consumed as git/symlink)
- First coordinated sync reset ask-mode from `0.3.0` → `0.1.0` so the tree is
  uniform; future per-plugin version drift is discouraged unless intentional

## CI and release workflows

| Repo | Workflow | Trigger | Job |
|------|----------|---------|-----|
| core | `ci.yml` | push/PR `main` (not tags) | `bun install --frozen-lockfile` + `bun run check` |
| core | `release.yml` | push `main` (nightly) or tag `v*` (stable) | check → tarball → `gh release`; stable requires tag ≡ package.json |
| plugins | `ci.yml` | push/PR `main` | `bun install` + `bun run check` (lockfile gitignored) |
| plugins | `release.yml` | tag `v*` | tag ≡ package.json → GitHub release |
| monorepo | `ci.yml` | push/PR `main` | checkout recursive submodules → install both → both checks → `version status` |
| monorepo | `release.yml` | tag `v*` | tag ≡ package.json → release body with pin SHAs |

**CI details**

- Bun **1.4.0** in all workflows; package `engines.bun` is `>=1.4.0`.
- Core dropped obsolete `dev-private` branch triggers (default branch is `main`).
- Monorepo private submodule fetch uses `actions/checkout` with
  `submodules: recursive` and `token: ${{ secrets.GITHUB_TOKEN }}` (same-owner
  private remotes).

## Day-to-day recipes

### Coordinated stable release (all three)

```bash
# clean trees preferred; diagnostics WIP → --allow-dirty
bun run version -- set 0.1.1 --tag --push
```

Or stepwise:

```bash
bun run version -- set 0.1.1 --targets all
# review diffs, then
bun run version -- tag 0.1.1 --targets all --push
# and push any remaining branch commits / pins if set did not --push
```

### Core-only hotfix (still bump monorepo pin when ready)

```bash
bun run version -- set 0.1.1 --targets core --tag --push
# later, when monorepo should advertise the pin:
cd minimal-agent-core && git pull
cd .. && git add minimal-agent-core && git commit -m "chore: bump core pin" && git push
# optional: monorepo tag if this is also a monorepo release
bun run version -- set 0.1.1 --targets monorepo --tag --push
```

### Plugins-only

```bash
bun run version -- set 0.1.1 --targets plugins --tag --push
```

### Inspect drift

```bash
bun run version:status
```

## First coordinated release (audit)

---
id: "2026-07-12-v0.1.0-cut"
type: release
status: shipped
version: "0.1.0"
---

| Remote | package.json | Tag | Notes |
|--------|--------------|-----|--------|
| monorepo | `0.1.0` | `v0.1.0` | pin commit includes core + plugins |
| core | `0.1.0` (already) | `v0.1.0` | first **stable** tag; nightlies existed earlier |
| plugins | `0.1.0` (was `0.0.0` / mixed) | `v0.1.0` | all plugins aligned |

Also landed with the cut:

- `scripts/version.ts` + `bun run version` / `version:status`
- CI/release workflows on monorepo and plugins; core workflow cleanup
- Docs: this file, AGENTS versioning section, CHANGELOG `[0.1.0]`

## What not to do

- Don’t push a stable `vX.Y.Z` tag without matching package.json (CI will fail).
- Don’t invent monorepo/plugins nightlies.
- Don’t bump only some `ma-*-plugin` versions for a coordinated release.
- Don’t run `git submodule update` casually on a machine that develops inside
  the submodule working trees (see root `AGENTS.md`).

## Related

- Agent orientation: [`AGENTS.md`](../AGENTS.md)
- Monorepo changelog: [`CHANGELOG.md`](../CHANGELOG.md)
- Core product changelog: [`minimal-agent-core/docs/CHANGELOG.md`](../minimal-agent-core/docs/CHANGELOG.md)
- Plugins changelog: [`minimal-agent-plugins/CHANGELOG.md`](../minimal-agent-plugins/CHANGELOG.md)
