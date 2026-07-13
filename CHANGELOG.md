---
project: "minimal-agent"
title: "Changelog"
type: changelog
status: living
scope: monorepo
working-dir: "."
created-at: "2026-07-12T20:53:58-0400"
updated-at: "2026-07-12T21:29:45-0400"
format: "Keep a Changelog (pragmatic, date-stamped) + YAML frontmatter audit trail"
latest-unreleased:
  - id: "2026-07-12-monorepo-scaffold-and-rewire"
    type: feat
    status: shipped
    commits: ["98d04b8", "6c1ab09", "0f46485", "4e5c203", "2e2937c", "92b8d2e", "733c5e4", "14600e9", "abf86c5", "44af6fb"]
  - id: "2026-07-12-bun-catalogs-and-filter"
    type: chore
    status: shipped
    commits: ["44af6fb"]
    core: ["c192c02"]
    plugins: ["06c6421"]
related:
  - "README.md"
  - "AGENTS.md"
  - "minimal-agent-core/docs/CHANGELOG.md"
  - "minimal-agent-plugins/CHANGELOG.md"
remotes:
  monorepo: "https://github.com/gastonmorixe/minimal-agent"
  core: "https://github.com/gastonmorixe/minimal-agent-core"
  plugins: "https://github.com/gastonmorixe/minimal-agent-plugins"
---

# Changelog

All notable changes to the **minimal-agent monorepo** (umbrella pins +
orchestration) are documented here.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/).
Product-level changes to the harness or plugins belong in the submodule
changelogs:

- [`minimal-agent-core/docs/CHANGELOG.md`](minimal-agent-core/docs/CHANGELOG.md)
- [`minimal-agent-plugins/CHANGELOG.md`](minimal-agent-plugins/CHANGELOG.md)

Longer monorepo write-ups, if needed later, can live under `docs/changes/`.

## [Unreleased]

### Feat: monorepo scaffold, one-tree rewire, remote renames, public docs

---
id: "2026-07-12-monorepo-scaffold-and-rewire"
type: feat
status: shipped
created-at: "2026-07-12T20:53:58-0400"
updated-at: "2026-07-12T21:21:29-0400"
commits:
  - id: "98d04b8"
    summary: "scaffold monorepo with core + plugins submodules"
  - id: "6c1ab09"
    summary: "document one-tree rewire (nested .git, sibling symlinks)"
  - id: "0f46485"
    summary: "track core submodule branch main (was dev-private)"
  - id: "4e5c203"
    summary: "fix README remote name after branch rename"
  - id: "2e2937c"
    summary: "rename core submodule path to minimal-agent-core"
  - id: "92b8d2e"
    summary: "point core submodule URL at gastonmorixe/minimal-agent-core"
  - id: "733c5e4"
    summary: "public monorepo README + proprietary LICENSE"
  - id: "14600e9"
    summary: "bump plugins pin (README monorepo link fix)"
  - id: "abf86c5"
    summary: "bump plugins pin (portable README paths)"
remotes:
  - action: "create"
    name: "gastonmorixe/minimal-agent"
    role: "monorepo (this repo)"
    private: true
  - action: "rename"
    from: "gastonmorixe/minimal-agent-dev-private"
    to: "gastonmorixe/minimal-agent-core"
    role: "core harness (same GitHub repo id)"
    note: "historically also named minimal-agent before dev-private"
  - action: "unchanged"
    name: "gastonmorixe/minimal-agent-plugins"
    role: "first-party plugins"
local:
  - "Submodule checkouts are the day-to-day working trees (rich trees with private/)."
  - "Sibling path Projects/minimal-agent → symlink → monorepo/minimal-agent-core (name kept for tools/cwd)."
  - "Nested submodule .git dirs (not absorbgitdirs) preserve existing git worktree gitdir paths."
  - "Do not casually run git submodule update on a machine that develops inside the submodules."
---

Stood up `gastonmorixe/minimal-agent` as a private umbrella that pins
`minimal-agent-core` and `minimal-agent-plugins` via git submodules.

**Scaffold** (`98d04b8`):

- Root `package.json` convenience scripts (`install:all`, `check`, `start`, …).
- `scripts/link-plugins.ts` to symlink `ma-*-plugin` packages into
  `~/.agents/plugins`.
- Initial pins at then-current tips of core and plugins.

**Local one-tree rewire** (`6c1ab09` and machine state):

- Replaced thin monorepo clones with the existing rich working trees so
  gitignored local content (`private/`, installs, logs) is not lost.
- Sibling paths remain stable names via symlinks into the monorepo.
- Nested `.git` (no `absorbgitdirs`) so existing `git worktree` absolute
  gitdir pointers keep working.

**Branch + remote rename**:

- Core default branch: `dev-private` → **`main`** (local rename, push, GitHub
  default, delete remote `dev-private`). Monorepo `.gitmodules` branch pin
  follows (`0f46485`).
- Core GitHub repo: `minimal-agent-dev-private` → **`minimal-agent-core`**.
- Submodule path: `minimal-agent/` → **`minimal-agent-core/`** (`2e2937c`).
- `.gitmodules` URL updated (`92b8d2e`).
- New private monorepo remote: **`gastonmorixe/minimal-agent`** (reclaims the
  short name; core history remains the renamed repo).

**Docs + license** (`733c5e4` and related submodule docs commits):

- Monorepo README rewritten for a general audience (no machine-local layout
  section).
- Proprietary `LICENSE` (all rights reserved) on monorepo, core, and plugins;
  `package.json` → `"license": "UNLICENSED"`.
- Core README badges/clone URLs → `minimal-agent-core`; plugins README and
  product links cleaned of MIT claims and `~/Projects/...` paths.

### Chore: Bun catalogs + filter orchestration

---
id: "2026-07-12-bun-catalogs-and-filter"
type: chore
status: shipped
created-at: "2026-07-12T21:27:00-0400"
updated-at: "2026-07-12T21:29:45-0400"
commits:
  - id: "44af6fb"
    summary: "monorepo: catalog docs, drop postinstall submodule update, test:plugins + submodules:init"
submodule-commits:
  core:
    - id: "c192c02"
      summary: "workspaces.catalog for toolchain; tools/docs keeps TS6 for typedoc"
  plugins:
    - id: "06c6421"
      summary: "catalog + test:plugins (--filter parallel) + pass-with-no-tests"
decision:
  - "No monorepo-root Bun workspaces merging core+plugins (dual remotes, self-contained plugins)."
  - "Catalogs and --filter improve each submodule; root stays pin + orchestration."
---

Per-submodule Bun improvements without a mega-root install graph:

- **Catalogs** in core and plugins: single place to bump biome / oxlint /
  typescript / bun-types / etc., referenced as `"catalog:"`.
- **Plugins** `test:plugins`: parallel `bun --filter 'ma-*' test`; empty
  packages use `--pass-with-no-tests`.
- **Monorepo root**: removed surprising `postinstall` `git submodule update`;
  added `test:plugins` and `submodules:init`; README documents the model.

Verified: `bun run test:plugins` in plugins exits 0 after the filter hardening.

## [0.0.0] — 2026-07-12

---
id: "2026-07-12-initial"
type: feat
status: shipped
created-at: "2026-07-12T20:53:58-0400"
updated-at: "2026-07-12T20:53:58-0400"
commits: ["98d04b8"]
---

Initial monorepo commit: submodule pins + root orchestration only. No product
versioning scheme yet; pins move independently of this label.
