Orientation for agents working in this **umbrella** repository. User-facing
overview lives in [`README.md`](README.md); the audit trail of monorepo-level
changes lives in [`CHANGELOG.md`](CHANGELOG.md).

This tree is **not** the agent harness source. It pins two first-party
submodules and provides thin orchestration scripts. Almost all product code,
tests, and gates live **inside** the submodules.

## Layout

```
minimal-agent/                      # this repo (gastonmorixe/minimal-agent)
├── minimal-agent-core/             # submodule → gastonmorixe/minimal-agent-core
├── minimal-agent-plugins/          # submodule → gastonmorixe/minimal-agent-plugins
├── package.json                    # install/check/start orchestration only
├── scripts/link-plugins.ts         # symlink ma-*-plugin → ~/.agents/plugins
├── AGENTS.md                       # you are here
├── CHANGELOG.md
├── LICENSE                         # proprietary, all rights reserved
└── README.md
```

| Path | What it is | Where to work |
|------|------------|----------------|
| `minimal-agent-core/` | Harness, plugin-api, agent loop, TUI | Core PRs / `bun run check` **here** |
| `minimal-agent-plugins/` | First-party plugins (`ma-*-plugin`) | Plugin PRs / `bun run check` **here** |
| monorepo root | Submodule **pins** + convenience scripts | Pin bumps only |

Each submodule keeps its own git history, `bun.lock` (or local install), CI, and
`AGENTS.md`. Read those before changing product code:

- [`minimal-agent-core/AGENTS.md`](minimal-agent-core/AGENTS.md)
- [`minimal-agent-plugins/README.md`](minimal-agent-plugins/README.md) (plugins
  orientation; no separate AGENTS.md yet)

## Build, test, lint (monorepo)

There is **no** root Bun workspace that merges core + plugins. Root scripts only
`cd` into each tree:

```bash
bun run install:all      # bun install in core, then plugins
bun run check            # core check && plugins check
bun run test             # core test && plugins test
bun run test:plugins     # plugins only: parallel per-package via --filter
bun run start            # core entrypoint
bun run link:plugins     # symlink plugins into ~/.agents/plugins
bun run submodules:status
bun run submodules:init  # git submodule update --init --recursive
```

**Do not** treat root `bun install` as installing the product. Always install
inside each submodule (or use `install:all`).

### Gates that must stay green

- **Core:** `cd minimal-agent-core && bun run check`  
  (typecheck, oxlint, format, biome, docs, arch tests, full suite)
- **Plugins:** `cd minimal-agent-plugins && bun run check`  
  (typecheck, oxlint, format, biome, tests)

Root `bun run check` is a convenience wrapper; CI for each remote should still
run in that remote’s tree.

## Submodules (read this before `git submodule update`)

- The monorepo records a **gitlink** (mode `160000`) commit SHA for each child.
- Develop **inside** the submodule: commit and push to that repo’s remote first,
  then from the monorepo root:
  ```bash
  git add minimal-agent-core   # and/or minimal-agent-plugins
  git commit -m "chore: bump … pin"
  git push
  ```
- **`git submodule update` is dangerous** on a day-to-day machine that uses the
  submodule working trees as the real checkouts: it can reset working trees to
  the pin and thrash local WIP / `private/` is gitignored but a hard reset of
  tracked files still hurts. Prefer explicit pin bumps after intentional pulls.
- Nested `.git/` directories inside submodules (not absorbed into
  `.git/modules/`) are intentional when local `git worktree` layouts need a
  stable absolute gitdir path through a sibling symlink.

## Bun workspaces (per submodule, not root)

- **Core** workspaces: `plugin-api`, `tools/docs`.  
  Toolchain versions live under `workspaces.catalog` and are referenced as
  `"catalog:"` from root `devDependencies`. `tools/docs` keeps TypeScript 6 for
  typedoc; only `bun-types` is catalogued there.
- **Plugins** workspaces: `ma-*-plugin`. Same catalog pattern.  
  `bun run test:plugins` runs `bun --filter 'ma-*' test` in parallel. Per-package
  `test` scripts use `bun test --pass-with-no-tests` so empty packages do not
  fail the fan-out.
- **Do not** add a monorepo-root `workspaces` field that globs both submodules
  unless product policy explicitly merges the two remotes into one install
  graph. Plugins are designed to clone and run without a core workspace link
  (types often vendored from plugin-api).

## License and public docs

All three remotes (`minimal-agent`, `minimal-agent-core`,
`minimal-agent-plugins`) are **proprietary**: Copyright Gaston Morixe, all
rights reserved (`LICENSE`, `package.json` → `"license": "UNLICENSED"`). Do not
add MIT/Apache badges or “open source” language. READMEs are written as if the
repos may be public someday: no machine-local paths (`~/Projects/...`), no
personal worktree rewire notes.

## What not to do here

- Don’t implement harness features in the monorepo root.
- Don’t commit secrets, credentials, or `private/` research (those stay
  gitignored inside core).
- Don’t rewrite submodule history from the monorepo; work in the child repo.
- Don’t “fix” independent core/plugins CI by only running root scripts.

## Versioning and releases

Full process doc: [`docs/versioning-and-releases.md`](docs/versioning-and-releases.md).

**Scheme**

| Kind | Where | Form |
|------|--------|------|
| package.json | monorepo, core (+ plugin-api, tools/docs), plugins root + every `ma-*-plugin` | `0.1.0` (semver) |
| Stable git tag | each of the three remotes | `v0.1.0` (must match that repo’s package.json) |
| Core nightlies | core CI only (`release.yml` on push to `main`) | `v0.1.0-nightly.<UTC-stamp>` |

Keep the three remotes on the **same** stable version when cutting a coordinated
release. Nightlies only advance the core pre-release stream; they do not bump
package.json.

**Tooling** (from monorepo root):

```bash
bun run version:status                 # drift + tags at a glance
bun run version -- set 0.2.0           # write package.json everywhere
bun run version -- set 0.2.0 --tag     # + annotated tags
bun run version -- set 0.2.0 --tag --push
bun run version -- set 0.2.0 --targets core --tag --push
bun run version -- tag 0.2.0 --push    # tag only (package.json already set)
```

`scripts/version.ts` stages only the package.json files it rewrites. Unrelated
WIP blocks the commit unless you pass `--allow-dirty`. After core/plugins
commits, it also commits monorepo submodule pin bumps.

**CI (GitHub Actions)**

| Repo | Workflows |
|------|-----------|
| core | `ci.yml` (main/PR gate), `release.yml` (nightly on main + stable on `v*`, tag must match package.json) |
| plugins | `ci.yml` (main/PR gate), `release.yml` (stable `v*` only) |
| monorepo | `ci.yml` (submodules + both checks), `release.yml` (stable `v*` + pin notes) |

Private submodule clones in monorepo CI use `actions/checkout` with
`submodules: recursive` and `token: ${{ secrets.SUBMODULES_PAT }}` (a PAT
with `repo` that can read core + plugins). Default `GITHUB_TOKEN` cannot
clone other private repos. CI pins public Bun **1.3.14** (`engines.bun`
`>=1.3.14`); local canary/patched Bun is not what workflows download.

## Related remotes

| Role | GitHub |
|------|--------|
| This monorepo | https://github.com/gastonmorixe/minimal-agent |
| Core harness | https://github.com/gastonmorixe/minimal-agent-core |
| Plugins | https://github.com/gastonmorixe/minimal-agent-plugins |
