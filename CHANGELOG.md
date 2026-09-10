---
project: "minimal-agent"
title: "Changelog"
type: changelog
status: living
scope: monorepo
working-dir: "."
created-at: "2026-07-12T20:53:58-0400"
updated-at: "2026-09-02T19:20:00-0400"
format: "Keep a Changelog (pragmatic, date-stamped) + YAML frontmatter audit trail"
latest-unreleased:
  - id: "2026-09-02-write-contents-alias-pin"
    type: chore
    status: landed
    detail: "Bump core pin for Write contents Cursor alias"
latest-release:
  version: "0.1.0"
  tag: "v0.1.0"
  id: "2026-07-12-v0.1.0"
related:
  - "README.md"
  - "AGENTS.md"
  - "docs/versioning-and-releases.md"
  - "minimal-agent-core/docs/CHANGELOG.md"
  - "minimal-agent-plugins/CHANGELOG.md"
  - "minimal-agent-cli/CHANGELOG.md"
remotes:
  monorepo: "https://github.com/gastonmorixe/minimal-agent"
  core: "https://github.com/gastonmorixe/minimal-agent-core"
  plugins: "https://github.com/gastonmorixe/minimal-agent-plugins"
  cli: "https://github.com/gastonmorixe/minimal-agent-cli"
---

# Changelog

All notable changes to the **minimal-agent monorepo** (umbrella pins +
orchestration) are documented here.

## [Unreleased]

### Fixed

- 2026-09-10: Core pin advanced to `f8a7ad0` — multi-mode /compact landing
  (remote|tail|local|fork modes, blocking local summary, structured 7-heading
  template). Plugins pin advanced to `2e0c318` — format fix on top of
  generic json mock type fix in opencode test (`bc7beab`) plus lint fix
  (`9425151`).

- 2026-09-02: Core pin advanced to `7544071` — Write accepts Cursor-shaped
  `contents` alias for `content` and returns a field error instead of
  `Bun.write(...): expects a Blob-y thing to write`. Plugins pin unchanged.

- 2026-08-17: Umbrella pins advanced after submodule landings that closed
  Cursor chat and CLI flag gates: core `c1b7946` (`--effort` no longer
  swallows `--fast`) and plugins `ef50dd4` (Cursor AgentService/Run CLI
  headers, exploded SKU encode, bidi KV acks + heartbeats so the TUI idles
  after a turn).

- 2026-08-14: Plugins pin advanced to `a88f4d7` — full offline Cursor
  AvailableModels catalog (236 host ids, `cursor-auto` default, non-fast Grok
  SKUs) plus Grok 4.6 dual-surface registration. Core remains at `71ee4fd`.

- 2026-08-13: Umbrella pins advanced after submodule landings that closed the
  dirty check gates: core `71ee4fd` (editor history / session write
  capabilities + picker marker coverage) and plugins `1f55da0` (quota-status
  bare model label when effort is unset). Gates green under those SHAs.

### Added

- 2026-08-07 (MA-394837 delivery): **`minimal-agent-cli`** first-party private
  repository added as a third umbrella submodule
  ([`gastonmorixe/minimal-agent-cli`](https://github.com/gastonmorixe/minimal-agent-cli)).
  Program 3A scaffold: standalone Bun package with package/tooling/CI/release
  workflows, commit hooks, injected I/O smoke tests, and AST-enforced core
  import ratchets backed by a genuine-Node preflight for the TypeScript 7
  `typescript/unstable/*` API (exact-pinned 7.0.2, `engines.node >=22.18.0`).
  The terminal client is being moved here; the executable remains transitional
  in core until the Program 3B cutover.

- 2026-08-05 (this session): Husky + Commitlint (Conventional Commits) at the
  monorepo root (`commitlint.config.js`, `.husky/commit-msg`, `prepare` →
  `husky`). CI gains a `commitlint` job; `bun run commitlint:last` for pushes.
  Agent-gated `scripts/check-agent-coauthor.sh` on `commit-msg` when
  `MINIMAL_AGENT_SESSION_ID` is set (humans unaffected).

### Changed

- 2026-08-07 (MA-394837 delivery): **core pin** bumped `8da7bc4` →
  `0bf68cc` (agent-loop SDK refactor enabling wave + README reframing).
  Umbrella README updated to three submodules and the future-state
  "terminal client being moved to minimal-agent-cli" framing. Plugins pin
  unchanged (`d4dab2b`).

- 2026-08-05 (this session): GitHub Actions bump — `actions/checkout@v7` (was
  v6); monorepo CI inits submodules with retries so pin bumps that briefly race
  a sibling push do not hard-fail on `not our ref`. Install steps set `HUSKY=0`.
  Root + plugins installs stay non-frozen (`bun.lock` gitignored); core keeps
  `--frozen-lockfile`. `install:all` runs root `bun install` first so umbrella
  hooks install too. Check job also installs root deps for orchestration scripts.

### Fixed

- 2026-07-24 (this session): Bump **plugins** pin through `39b5388` —
  `ma-env-info-plugin` host snapshot uses `placement: "afterInstructions"` so
  `cwd=` / env facts survive `--no-system-session-context`.

- 2026-07-24 (this session): Bump submodule pins for Cursor provider NetworkClient
  integration + live net-dbg proof:
  - **plugins** `751fd3f` — `ma-llm-cursor-plugin` AgentService/Run posts via host
    `NetworkClient` with `protocol: "h2"` (base64 req capture; raw http2/curl
    are explicit fallbacks only).
  - **core** includes `ff4a1ab` (always-register h2 transport when fetch is
    primary) and `7c91bc7` (status-line Sending request activity).
    Live proof: Julia session `6e61a7ae` wrote
    `net-dbg/*-minimal-agent-6e61a7ae-*` with Connect+proto to
    `agentn.api5.cursor.sh` over transport `http2`/`h2`.
    Research: `private/20260723-163123-cursor-provider-taskforce/PROGRESS.md`
  * `reports/14-networkclient-netdbg-live-proof.md` (gitignored private/).

- 2026-07-24 (this session): `AGENTS.md` no longer presents the monorepo layout
  under a top-level `minimal-agent/` folder name. That label matched the GitHub
  remote and a local convenience symlink (`~/Projects/minimal-agent` →
  `…/minimal-agent-core`) and caused agents (e.g. Leon) to Grep/Read absolute
  `…/Projects/minimal-agent/src/...` instead of `./minimal-agent-core/src/...`.
  Added a **Working directory** section: prefer relative `minimal-agent-core/`
  / `minimal-agent-plugins/` paths from monorepo cwd; do not invent sibling
  absolute project roots. Layout diagram now starts at `.` (session cwd).

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/).
Product-level changes to the harness or plugins belong in the submodule
changelogs:

- [`minimal-agent-core/docs/CHANGELOG.md`](minimal-agent-core/docs/CHANGELOG.md)
- [`minimal-agent-plugins/CHANGELOG.md`](minimal-agent-plugins/CHANGELOG.md)

Longer monorepo write-ups, if needed later, can live under `docs/changes/`.

## [Unreleased]

- **CI**: pin public Bun **1.3.14** (not unreleased local 1.4.x); monorepo
  submodule checkout uses `SUBMODULES_PAT` (GITHUB_TOKEN cannot clone sibling
  private remotes); monorepo release skips submodule init (gitlinks only);
  `engines.bun` → `>=1.3.14` on monorepo/core/plugins.

## [0.1.0] — 2026-07-12

---

id: "2026-07-12-v0.1.0"
type: release
status: shipped
created-at: "2026-07-12T21:40:00-0400"
updated-at: "2026-07-12T21:45:00-0400"
version: "0.1.0"
tags:
monorepo: "v0.1.0"
core: "v0.1.0"
plugins: "v0.1.0"
commits:
monorepo: ["b780883", "6a33ed3", "f3604b3", "aafae99"]
core: ["8342670"]
plugins: ["d5fb80f", "281f6d6"]
tooling: "scripts/version.ts"
ci:

- "core: main-only CI/release, Bun 1.4, stable tag==package.json guard"
- "plugins: new CI + stable release workflows"
- "monorepo: submodule CI gate + release with pin notes"

---

First coordinated stable release across monorepo, core, and plugins.

- **package.json** `0.1.0` everywhere (monorepo root, core + plugin-api +
  tools/docs, plugins root + all `ma-*-plugin`; ask-mode was `0.3.0` → aligned).
- **git tags** `v0.1.0` on all three remotes.
- **version tool** `bun run version` / `scripts/version.ts` for future bumps.
- **CI** on all three remotes; core keeps nightlies from `package.json` version.

Includes prior Unreleased monorepo work (scaffold, rewire, renames, catalogs).

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

## Scaffold history (pre-0.1.0)

Initial monorepo commit `98d04b8` and subsequent pin/docs/catalog work landed
before the coordinated `0.1.0` tag; see entries above under **0.1.0**.
