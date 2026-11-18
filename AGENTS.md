Orientation for agents working in this **umbrella** repository. User-facing
overview lives in [`README.md`](README.md); the audit trail of monorepo-level
changes lives in [`CHANGELOG.md`](CHANGELOG.md).

This tree is **not** the agent harness source. It records one commit of each of
five first-party submodules (core, plugins, cli, web, config), runs one Bun
workspace over them, and holds thin orchestration scripts. Almost all product
code, tests, and gates live **inside** the submodules.

## Working directory (read this first)

- Your session **cwd is this monorepo root** (the directory that contains
  `minimal-agent-core/`, `minimal-agent-plugins/`, `minimal-agent-cli/`, and
  `minimal-agent-web/`).
  Prefer **relative** paths from that cwd: `minimal-agent-core/...`,
  `minimal-agent-plugins/...`, `minimal-agent-cli/...`, `minimal-agent-web/...`.
- Product code is **not** at a sibling `src/` under the monorepo root. Do not
  search or edit `src/...` at the monorepo root.
- Do **not** invent absolute paths like `~/Projects/minimal-agent` or
  `/Users/.../Projects/minimal-agent`. On some machines that name is only a
  convenience symlink into `minimal-agent-core` and will mislead Grep/Read
  into the wrong tree. Trust `SessionInfo` / env snapshot `cwd=` when you
  need an absolute path.
- GitHub remote name for this umbrella may still be `minimal-agent`; that is
  the **remote**, not the on-disk monorepo folder name and not a path prefix
  for tools.

## The workflow in ten rules

Read these before you change anything. "Git and Bun workflow" below has the
commands, and "Pins" in `README.md` has the reference tables.

1. **Six git repos, one Bun install.** The umbrella records one commit SHA per
   submodule (a gitlink). One `bun install` at the root links the local core
   checkout into plugins, cli and web.
2. **You do not touch pins to write code.** Edit, then run. An edit in core is
   live in plugins, cli and web with no commit and no pin.
3. **`bun run pins` is the first command for any pin question.** It prints the
   state and a numbered list of the commands to run next. It fetches first and
   changes none of your files. Run it again just before you act on its advice:
   another session can push in between.
4. **Do not work in the shared checkout when other sessions use it.** Make a
   full worktree with `bun run worktree:new <name>`. A folder with only some
   repos and no umbrella root is a set of standalone installs: plugins there
   uses the pinned core, and your core edit is not tested.
5. **A submodule is on a detached HEAD.** Run `git switch -c <branch>` in it
   before you commit. `git submodule update` leaves a commit that is on no
   branch behind.
6. **Land the submodule first, the umbrella second.** The umbrella must not
   point at a commit that is not on the submodule's remote.
7. **A core commit needs a core pin refresh** (`bun run pins:core`). It pushes
   to plugins, cli and web. Tell the other active sessions before you run it,
   and do not run it while another session lands a change.
8. **After a dependency change in core, cli or web, run `bun run pins:lock`.**
   The root install never writes a submodule's own `bun.lock`.
9. **Inside the umbrella you cannot test a standalone install.** Use
   `bun run pins:verify`. A frozen install in a submodule here tests the root
   lockfile.
10. **Report the exit code of a gate, not the last line of its output.**
    `bun run check | tail` exits with the code of `tail`.

## Layout

```
.                                   # monorepo root (session cwd)
├── minimal-agent-core/             # submodule → gastonmorixe/minimal-agent-core
├── minimal-agent-plugins/          # submodule → gastonmorixe/minimal-agent-plugins
├── minimal-agent-cli/              # submodule → gastonmorixe/minimal-agent-cli
├── minimal-agent-web/              # submodule → gastonmorixe/minimal-agent-web
├── minimal-agent-config/           # submodule → gastonmorixe/minimal-agent-config
├── package.json                    # workspace root, tool catalog, orchestration scripts
├── scripts/                        # pin, catalog, worktree and version scripts
├── AGENTS.md                       # you are here
├── CHANGELOG.md
├── LICENSE                         # proprietary, all rights reserved
└── README.md
```

| Path                     | What it is                               | Where to work                         |
| ------------------------ | ---------------------------------------- | ------------------------------------- |
| `minimal-agent-core/`    | Harness, plugin-api, agent loop, TUI     | Core PRs / `bun run check` **here**   |
| `minimal-agent-plugins/` | First-party plugins (`ma-*-plugin`)      | Plugin PRs / `bun run check` **here** |
| `minimal-agent-cli/`     | Terminal host; TUI moves here at cutover | CLI PRs / `bun run check` **here**    |
| `minimal-agent-web/`     | Bun server + Vite/React frontend over core | Web PRs / `bun run check` **here**  |
| `minimal-agent-config/`  | Shared Biome, oxlint and tsconfig bases  | Config changes, then each consumer's `bun run check` |
| monorepo root (`.`)      | Workspace root, tool catalog, submodule pins | Catalog bumps, pin bumps, scripts |

Each submodule keeps its own git history, `bun.lock` (or local install), CI, and
`AGENTS.md`. Read those before changing product code:

- [`minimal-agent-core/AGENTS.md`](minimal-agent-core/AGENTS.md)
- [`minimal-agent-plugins/AGENTS.md`](minimal-agent-plugins/AGENTS.md)
- [`minimal-agent-cli/AGENTS.md`](minimal-agent-cli/AGENTS.md)
- [`minimal-agent-web/AGENTS.md`](minimal-agent-web/AGENTS.md)
- [`minimal-agent-config/README.md`](minimal-agent-config/README.md)

## Build, test, lint (monorepo)

The root is a Bun **workspace root**, so one install links every consumer to the
local core. Root scripts `cd` into each tree for the gates.

Every day:

```bash
bun install              # the one install: links local core into plugins, cli and web
bun run hooks            # once after a clone: commit hooks in the umbrella and in each submodule
bun run start            # CLI entrypoint (core is a library, no bin)
bun run check            # pin report, tool versions, then core, plugins, cli and web check
bun run test             # core test && plugins test && cli test && web test
bun run test:plugins     # plugins only: parallel per-package via --filter
bun run pins             # START HERE for pins: state of every pin and the next command (changes nothing)
```

Worktrees:

```bash
bun run worktree:new <name>   # a full worktree: umbrella + every submodule + one root install
bun run worktree:rm <name>    # remove it; stops on uncommitted files, stashes, and commits that are on no remote
```

When you land a change:

```bash
bun run pins:check       # fail if a core pin differs from the core gitlink, or a committed bun.lock from its package.json
bun run catalogs:check   # fail if a repo declares a tool version that differs from the root catalog
bun run pins:lock        # update the committed bun.lock of core, cli and web after a dependency change
bun run pins:config      # move the config pin of core, plugins and cli to the config gitlink (or <sha>); commits nothing
bun run pins:core        # move every core pin to core origin/main (or <sha>); --dry-run prints; --commit --push does the whole refresh
bun run pins:verify      # install each submodule alone, in a clone outside the umbrella (--check also runs its gate)
bun run pins:mains       # set every gitlink to origin/main, print old -> new (DETACHES each submodule)
```

Other:

```bash
bun run cli:compile:dev      # standalone binary, working-tree core -> minimal-agent-cli/dist/
bun run cli:compile:release  # standalone binary, the core commit the CLI pins
bun run link:status      # linked or pinned, per consumer
bun run link:dev         # DEPRECATED: the workspace already links core for dev
bun run submodules:status
bun run submodules:init  # git submodule update --init --recursive
```

`bun run install:all` is an alias of `bun install`. Inside the umbrella, an
install in any submodule is the root install, so there is nothing more to run.
`bun run link:reset` is removed: it prints a pointer to `pins:verify`.

### Gates that must stay green

- **Core:** `bun run --cwd minimal-agent-core check`  
  (typecheck, oxlint, format, biome, docs, arch tests, full suite)
- **Plugins:** `bun run --cwd minimal-agent-plugins check`  
  (typecheck, oxlint, format, biome, STE audit, tests)
- **CLI:** `bun run --cwd minimal-agent-cli check`  
  (typecheck, oxlint, format, biome, architecture preflight, tests)
- **Web:** `bun run --cwd minimal-agent-web check`  
  (typecheck, oxlint, format, biome, tests, build, Playwright e2e)

Root `bun run check` runs the pin report and `catalogs:check`, then the four
gates in that order. It is the same set of gates as the `check` job of the
umbrella CI. These gates run on the root install, so they use the local core
checkout. `bun run pins:verify --check` runs each gate in a standalone clone,
on the pinned core. It runs fewer tests: the tests that need a sibling checkout
skip themselves.

### Plugin roots (dev mode)

- The CLI reads 3 plugin roots. Precedence: project, then user, then embedded.
- Project: `<cwd>/.agents/minimal-agent/plugins`. User: `~/.minimal-agent/plugins`.
  Embedded: `<cli>/plugins`, plus the `../minimal-agent-plugins` checkout next
  to the CLI, or the dirs in `MINIMAL_AGENT_PLUGIN_SIBLINGS` (colon separated).
- Dev mode: a checkout dir holds at least one plugin package (a subdir with
  `manifest.json` or `provider.json`). Then the user tier is empty and the CLI
  does not clone the plugins repo. Edit `minimal-agent-plugins/` and run
  `bun run start` again. No symlink is necessary.
- Install mode (no checkout, for example the compiled binary): the CLI clones
  `minimal-agent-plugins` into `~/.minimal-agent/plugins` on the first
  interactive start when that dir is empty. `MINIMAL_AGENT_NO_PLUGIN_SYNC=1`
  stops the clone. The web server never clones.
- The CLI does not read `~/.agents/plugins` or `<cwd>/.agents/plugins`. If one
  holds plugin packages, the CLI prints an "ignored legacy plugin root"
  warning. It moves nothing. Move the packages to
  `<cwd>/.agents/minimal-agent/plugins` yourself.

## Git and Bun workflow

### Start work

```bash
bun run worktree:new my-fix                      # ../<this checkout>_WT-my-fix, umbrella branch my-fix
cd ../<this checkout>_WT-my-fix
git -C minimal-agent-plugins switch -c my-fix    # in each submodule that you will change
```

`worktree:new` checks out every submodule at the commit the umbrella records,
runs the root install, and sets up the commit hooks. It ends with a check that
the cli uses the core of that worktree. When you are done and the work is on
the remotes: `bun run worktree:rm my-fix`, from another checkout.

### Change, test, commit

1. Edit in the submodule. Run that repo's gate: `bun run check` in it.
2. If you changed a dependency of core, cli or web, run `bun run pins:lock`
   at the umbrella root and add the new `bun.lock` to the commit.
3. Commit in the submodule, on your branch. The commit hooks check the commit
   format and the agent trailer (see "Git commits" below).

### Land a change in plugins, cli, web or config

```bash
git -C minimal-agent-plugins push origin HEAD:main   # 1. the submodule first
git add minimal-agent-plugins                        # 2. stage the new gitlink
bun run pins:check                                   # 3. 0 stale: core did not move
git commit -m "chore: bump plugins for <what changed>"
git push origin HEAD:main                            # 4. the umbrella
bun run pins                                         # 5. "Next: Nothing"
```

Before step 1, fetch and rebase when `origin/main` of that repo moved. Push
only a fast-forward. Never force-push a `main`.

For config, the consumers (core, plugins, cli) then need a new config pin:
`bun run pins:config` rewrites it in the three repos and updates the
`bun.lock` of core and cli. Run each gate, commit and push. The core commit
then needs the core pin refresh below. `bun run pins` prints a "Next" line
while a config pin is behind the config gitlink. It does not fail the check.

### Land a change in core (the core pin refresh)

Plugins, cli and web each name one core commit. After the core commit is on
core `main`, move those pins to it.

In a worktree (the umbrella is not on `main` there), step by step:

```bash
git -C minimal-agent-core push origin HEAD:main      # 1. core first
bun run pins:core <core sha> --dry-run               # 2. print what moves; a WARNING means: fix that first
bun run pins:core <core sha>                         # 3. rewrite the 27 pins, stage the core gitlink
bun run pins:lock cli web                            # 4. must print "up to date"
# 5. in plugins, cli and web: review the diff, commit "chore: pin core to <short sha> (<what changed>)", push HEAD:main
git add minimal-agent-plugins minimal-agent-cli minimal-agent-web
bun run pins:check                                   # 6. 0 stale, no lockfile difference
git commit -m "chore: bump core, plugins, cli and web for <what changed>"
git push origin HEAD:main                            # 7. the umbrella
```

In a checkout where the umbrella and plugins, cli and web are all on `main`,
level with `origin/main` and with no tracked changes, one command does steps 3
to 7: `bun run pins:core --commit --push`. Run `bun run check` first.

`pins:core` stops before it writes anything when a committed `bun.lock` and
its `package.json` name different commits for a git dependency, in the target
core commit or in a consumer. Run `bun run pins:lock`, commit and push that
`bun.lock`, then run `pins:core` again.

### Check the result

```bash
bun run pins                    # exit 0 and "Next: Nothing"
bun run check                   # the gates, on the root install
bun run pins:verify --check     # the gates of each repo in a standalone clone (slow)
```

### Get the latest

```bash
git pull
git submodule update            # each submodule to the commit the umbrella records
bun install                     # when a package.json changed
```

### Git rules for submodules

- The monorepo records a **gitlink** (mode `160000`) commit SHA for each child.
- **Push the submodule commit before the umbrella commit that records it.** A
  clone and the monorepo CI fetch each submodule by SHA. An umbrella commit
  that lands first fails with `not our ref` / `upload-pack`.
- **`git submodule update` detaches HEAD in each submodule.** It keeps
  uncommitted edits, and stops when they are in the way. It does not keep a
  commit that you made on a detached HEAD: that commit is then on no branch
  (find it with `git reflog`). Commit on a branch. Never add `--force`: that
  discards uncommitted edits.
- **`bun run pins:mains` also detaches HEAD** (`git checkout --detach
  origin/main`) in every submodule, with no prompt. Commit on a branch first.
- **Do not use `git worktree remove --force`** on a worktree with submodules.
  It deletes the submodule repos of that worktree and everything that is only
  there. Use `bun run worktree:rm <name>`. It stops on an uncommitted or
  untracked file, on an ignored file that no tool makes again (a note under
  `research/`), on a stash, and on a commit that is on no remote. It fetches
  first, so it needs the remotes. `--force` skips every check: do not add it
  to get past a stop that you do not understand.
- **Do not run `git worktree prune`** while the folder of another worktree is
  absent (moved, or on a disk that is not mounted). It deletes the data of
  that worktree, with the repos of its submodules.
- **Before you move a checkout that is not yours** (the shared checkout, a
  worktree of another session), check that it has no tracked changes and no
  commit that is on no remote, in the umbrella and in each submodule.
- Nested `.git/` directories inside submodules (not absorbed into
  `.git/modules/`) are intentional when local `git worktree` layouts need a
  stable absolute gitdir path through a sibling symlink.

## Bun workspaces

The monorepo root `package.json` is a Bun workspace root. It runs one install
graph over all five submodules.

- **Root `workspaces` names the five submodules, and every entry is a glob.**
  The first entry is `minimal-agent-{core,plugins,cli,web,config}`. A plain
  directory name for a missing directory fails the install with
  `error: Workspace not found`, and the umbrella `commitlint` job runs
  `bun install` at the root with no submodule checkout. A brace list is a glob:
  it matches nothing and passes.
- **Do not widen the list to `minimal-agent-*`.** Bun does not read
  `.gitignore` for workspace globs. A wide pattern also takes local projects
  next to the submodules (`minimal-agent-studio/`, `minimal-agent-inspector/`)
  into the root install. To add a submodule, add its name to the first entry:
  `bun run catalogs:check` fails while a submodule matches no pattern.
- **Nested members must be listed too.** Listing `minimal-agent-plugins` is not
  enough: `minimal-agent-plugins/ma-*` must also appear, or the plugin packages
  keep the pinned core. The same holds for `minimal-agent-web/{app,server}` and
  `minimal-agent-core/tools/*`.
- **`overrides` carries `"@minimal-agent/core": "workspace:*"`.** Every consumer
  that declares core then resolves it to the local checkout, with no commit and
  no re-pin. A plain `bun install` inside a submodule keeps working: it is the
  root install, with the root lockfile.
- **Bun reads `overrides` only from the root of an install.** The `overrides`
  in a submodule `package.json` apply to its standalone install and are ignored
  here. So a version guard must be in both places: `brace-expansion` is in the
  root and in core, plugins, cli and web. `@types/node` is forced to `^26` at
  the root (web's old `^24` broke the cli typecheck), and every repo that
  declares it must declare `^26`.
- **The root lockfile is gitignored.** A fresh resolve follows the catalog
  ranges, so pin a tool exactly in the catalog when an upgrade must be
  deliberate. The root `catalog` declares the tool versions for the root
  install. The catalogs of core and plugins, the literal versions in cli and
  web, and the `@minimal-agent/config` peers hold the same versions for the
  standalone installs. `bun run catalogs:check` fails when they differ.
- **`catalog:` resolves only against the root of an install.** A repo that
  writes `catalog:` needs its own `workspaces.catalog`, or its standalone
  install fails with `catalogs require a "workspaces" field`. Core and plugins
  have one. Cli and web write literal versions.
- **Inside the umbrella you cannot test a standalone install.** An install in
  any submodule is the root install: it never reads that submodule's
  `bun.lock`, and `--frozen-lockfile` there tests the root lockfile. The
  umbrella CI `check` job has the same limit. Use `bun run pins:verify`, which
  installs each submodule in a clone outside the umbrella. To update a
  submodule lockfile after a dependency change, run `bun run pins:lock` and
  commit the new `bun.lock` in that repo.

Per submodule:

- **Core** workspaces: `tools/docs`. `plugin-api/` is a folder inside the
  `@minimal-agent/core` package (exported as `@minimal-agent/core/plugin-api/*`),
  not a workspace package.  
  Toolchain versions live under its own `workspaces.catalog` and are referenced
  as `"catalog:"` from its `devDependencies`. `tools/docs` keeps TypeScript 6
  for typedoc; only `bun-types` is catalogued there.
- **Plugins** workspaces: `ma-*-plugin` and `ma-*-kit`. Same catalog pattern.
  Its `bun.lock` is gitignored, so its standalone install is not frozen.  
  `bun run test:plugins` runs `bun --filter 'ma-*' test` in parallel. Per-package
  `test` scripts use `bun test --pass-with-no-tests` so empty packages do not
  fail the fan-out.
- **CLI** has no workspaces of its own. It declares `@minimal-agent/core` by a
  git URL pin, which the root `overrides` replaces with the local workspace
  during a root install. It writes literal tool versions, and commits its
  `bun.lock`.
- **Web** workspaces: `server`, `app`. It declares `@minimal-agent/core` by a
  git URL the same way the CLI does, writes literal tool versions, and commits
  its `bun.lock`.

The committed pins stay. A standalone clone of one repo and the cli release
build resolve the pinned core, because they have no monorepo root above them.
The umbrella CI `check` job does have the root above it, so it runs the gates
on the core gitlink checkout, not on the pinned git copy.

A test that needs a core module with no public subpath imports it through the
installed package directory (`../node_modules/@minimal-agent/core/src/x.ts`),
never from the sibling checkout (`../../minimal-agent-core/src/x.ts`). The
second form exists only in the umbrella, and a plugins guard test rejects it.

## Shared tool config

`minimal-agent-config` publishes `@minimal-agent/config`. Core, cli and plugins
extend it for Biome, oxlint and TypeScript, and keep only what is repo-specific:

- **biome**: `$schema`, `files.includes`, and any local `assist` override in
  OBJECT form. The shorthand `"organizeImports": "on"` does not override the
  base groups.
- **oxlint**: `categories`, `settings`, `jsPlugins`, `ignorePatterns`,
  `overrides`, the jsdoc rules, `max-lines`, and every `tsdoc/*` rule. Only
  `plugins`, `options` and `rules` are inherited, and jsPlugin specifiers
  resolve from the repo root, not from the config package.
- **tsconfig**: `include`, `exclude`, and any extra compiler flags. The base
  holds `compilerOptions` only.

See `minimal-agent-config/README.md` for the exact lines.

Two facts about how config installs:

- The root `overrides` has no entry for `@minimal-agent/config`. Core, plugins
  and cli install the git copy at their own config pin, also inside the
  umbrella. An edit in `minimal-agent-config/` reaches them only after a
  config commit and a new pin in each repo. `bun run pins:config` moves the
  pins, and `bun run pins` says when one is behind the config gitlink.
- The `peerDependencies` of `@minimal-agent/config` are one of the places that
  hold the tool versions. `bun run catalogs:check` compares them with the root
  catalog.

## License and public docs

All remotes (`minimal-agent`, `minimal-agent-core`, `minimal-agent-plugins`,
`minimal-agent-cli`, `minimal-agent-web`) are **proprietary**: Copyright Gaston Morixe, all
rights reserved (`LICENSE`, `package.json` → `"license": "UNLICENSED"`). Do not
add MIT/Apache badges or “open source” language. READMEs are written as if the
repos may be public someday: no machine-local paths (`~/Projects/...`), no
personal worktree rewire notes.

## Git commits (Conventional Commits)

Commit subjects follow [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:`, `fix:`, `chore:`, …). Husky + Commitlint enforce this on `commit-msg`
in this repo and in core, plugins, cli and web (`commitlint.config.js`,
`.husky/commit-msg`). `minimal-agent-config` has no hook: follow the same
format there.

`bun run hooks` sets the hooks up in the umbrella and in each submodule. Run it
once after a clone. `bun install` also does it, through each `prepare` script,
but not on a machine where lifecycle scripts are off (`ignore-scripts` in
`~/.npmrc`, which Bun reads). `bun run worktree:new` sets them up for a new
worktree. To check: `git -C <repo> config --get core.hooksPath` prints
`.husky/_`. A repo with no hook accepts any commit message, so check before
you commit.
CI also runs a `commitlint` job (`bun run commitlint:last` on push; range lint
on PRs). Local check: `echo 'feat: ok' | bun run commitlint`.

## Git commits (agent Co-authored-by trailer)

Every commit made by an agent must include a `Co-authored-by` trailer for the
**current session** (name + short session id). This is a **local audit trail**
("which agent session authored this commit"). It is **not** a GitHub co-author,
not a second GitHub user, and not GitHub contributor attribution.

Format:

```
Co-authored-by: {Name} <{short-sid}@minimal-agent>
```

- `{Name}` — session name (`MINIMAL_AGENT_AGENT_NAME` / `SessionInfo` / TUI),
  e.g. `Veronica`
- `{short-sid}` — first 8 hex characters of `MINIMAL_AGENT_SESSION_ID`, e.g.
  `a26a1e75` from `a26a1e75-…`

Example:

```
Co-authored-by: Veronica <a26a1e75@minimal-agent>
```

Put the trailer on its own line at the end of the commit message with a blank
line before it. Prefer a HEREDOC so git keeps the trailer:

```bash
git commit -m "$(cat <<'EOF'
fix: explain the change briefly.

Co-authored-by: Veronica <a26a1e75@minimal-agent>
EOF
)"
```

Or append with Git's native flag:

```bash
git commit -m "fix: explain the change briefly." \
  --trailer "Co-authored-by: Veronica <a26a1e75@minimal-agent>"
```

**Enforcement:** when `MINIMAL_AGENT_SESSION_ID` is set, `.husky/commit-msg`
runs `scripts/check-agent-coauthor.sh` after Commitlint. Missing or wrong
trailers (sid / name) fail the commit. Human commits (env unset) are not gated.
Agents must not bypass with `--no-verify`.

## What not to do here

- Don’t implement harness features in the monorepo root.
- Don’t commit secrets, credentials, or `private/` research (those stay
  gitignored inside core).
- Don’t rewrite submodule history from the monorepo; work in the child repo.
- Don’t force-push any `main`.
- Don’t move pins by hand. `bun run pins` names the command.
- Don’t run `bun install --frozen-lockfile` in a submodule to test its
  lockfile: inside the umbrella that tests the root lockfile. Use
  `bun run pins:verify`.

## Versioning and releases

This section is the tracked process summary. The longer process doc moved to
the gitignored `research/` folder in `cc89102`.

**Scheme**

| Kind           | Where                                                                         | Form                                           |
| -------------- | ----------------------------------------------------------------------------- | ---------------------------------------------- |
| package.json   | monorepo, core (+ tools/docs), plugins root + every `ma-*-plugin`, cli        | `0.1.0` (semver)                               |
| Stable git tag | each of the four remotes                                                      | `v0.1.0` (must match that repo’s package.json) |
| Core nightlies | core CI only (`release.yml` on push to `main`)                                | `v0.1.0-nightly.<UTC-stamp>`                   |

Keep the four remotes on the **same** stable version when cutting a coordinated
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

| Repo     | Workflows                                                                                                              |
| -------- | ---------------------------------------------------------------------------------------------------------------------- |
| core     | `ci.yml` (commitlint only), `release.yml` (nightly on main + stable on `v*`, tag must match package.json, no gate)     |
| plugins  | `ci.yml` (commitlint only), `release.yml` (stable `v*` only)                                                           |
| cli      | `ci.yml` (commitlint only), `release.yml` (stable `v*`, no gate)                                                       |
| web      | `ci.yml` (commitlint only)                                                                                             |
| monorepo | `ci.yml` (commitlint + submodule retry + core, plugins, cli, web checks), `release.yml` (stable `v*` + pin notes)     |

**The monorepo CI is the only full gate.** Core, cli, plugins and web depend on
private git repos (`@minimal-agent/core`, `@minimal-agent/config`), and each
repo's own `GITHUB_TOKEN` cannot read another private repo. So their standalone
workflows install only the pinned `@commitlint/*` packages (a `jq` filter of
package.json) and lint the commit message. No deploy keys and no per-repo
secrets. To gate a submodule change, push it, then bump its gitlink here: the
monorepo `ci.yml` runs all four `bun run check` gates on that commit. The job
installs at the root, so it uses the core gitlink checkout and does not read
the committed lockfiles of the submodules. `bun run pins:verify` tests those.

Private submodule clones in monorepo CI use the `minimal-agent-ci` GitHub App
(contents:read + metadata:read, installed on all six repos). The `check` job
runs `actions/create-github-app-token@v3` with `vars.MA_APP_ID` and
`secrets.MA_APP_PRIVATE_KEY` to mint an installation token (1h lifetime)
scoped to core, config, plugins, cli and web. `actions/checkout@v7` takes
`token: ${{ steps.app-token.outputs.token }}`, then
`git submodule update --init --recursive` runs with retries; the same token
(as `https://x-access-token:<token>@github.com/`) also rewrites the `git+ssh`
URLs the cli, plugins, and web use to install `@minimal-agent/core` and
`@minimal-agent/config`. Default `GITHUB_TOKEN` cannot clone
other private repos, which is why only the monorepo runs the full gate. CI pins public Bun **1.4.4**
(`engines.bun` `>=1.4.4`); local canary/patched Bun is not what workflows
download. Action majors: `actions/checkout@v7`, `oven-sh/setup-bun@v2`,
`actions/upload-artifact@v7` (core release), `softprops/action-gh-release@v3`.

## Related remotes

| Role          | GitHub                                                |
| ------------- | ----------------------------------------------------- |
| This monorepo | https://github.com/gastonmorixe/minimal-agent         |
| Core harness  | https://github.com/gastonmorixe/minimal-agent-core    |
| Plugins       | https://github.com/gastonmorixe/minimal-agent-plugins |
| CLI           | https://github.com/gastonmorixe/minimal-agent-cli     |
| Web           | https://github.com/gastonmorixe/minimal-agent-web     |
| Shared config | https://github.com/gastonmorixe/minimal-agent-config  |
