<p>
   <h1 align="center">
      <img  height="200" alt="minimal-agent" src="https://github.com/user-attachments/assets/b3b96374-88d2-4a92-9a13-d21ebe127732" /> <br> minimal-agent <br> <br>
   </h1>
</p>

[![CI](https://github.com/gastonmorixe/minimal-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/gastonmorixe/minimal-agent/actions/workflows/ci.yml)
[![Release](https://github.com/gastonmorixe/minimal-agent/actions/workflows/release.yml/badge.svg)](https://github.com/gastonmorixe/minimal-agent/actions/workflows/release.yml)
[![License: Proprietary](https://img.shields.io/badge/License-Proprietary-red.svg)](LICENSE)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Linux-lightgrey)

<p align="center">
   <img width="1403" height="981" alt="image" src="https://github.com/user-attachments/assets/62ac5295-e18e-49bd-872c-04cf52b9b56f" />
</p>

---

Umbrella repository for five first-party trees: four product repos plus a shared config repo. They are pinned together with **git submodules**, and one Bun workspace runs over them.

| Path                                                  | Repository                                                                                    | Branch |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------ |
| [`minimal-agent-core/`](./minimal-agent-core)         | [`gastonmorixe/minimal-agent-core`](https://github.com/gastonmorixe/minimal-agent-core)       | `main` |
| [`minimal-agent-plugins/`](./minimal-agent-plugins)   | [`gastonmorixe/minimal-agent-plugins`](https://github.com/gastonmorixe/minimal-agent-plugins) | `main` |
| [`minimal-agent-cli/`](./minimal-agent-cli)           | [`gastonmorixe/minimal-agent-cli`](https://github.com/gastonmorixe/minimal-agent-cli)         | `main` |
| [`minimal-agent-web/`](./minimal-agent-web)           | [`gastonmorixe/minimal-agent-web`](https://github.com/gastonmorixe/minimal-agent-web)         | `main` |
| [`minimal-agent-config/`](./minimal-agent-config)     | [`gastonmorixe/minimal-agent-config`](https://github.com/gastonmorixe/minimal-agent-config)   | `main` |

Each submodule keeps its own history, CI, and release surface. This repository records which commits belong together, and links them for development.

## Clone

```bash
git clone --recurse-submodules https://github.com/gastonmorixe/minimal-agent.git
cd minimal-agent
bun install
```

If you cloned without submodules:

```bash
git submodule update --init --recursive
```

What to expect on a first clone:

1. `bun install` at the root is the only install. It links the local core
   checkout into plugins, cli and web.
2. It writes a root `bun.lock`. That file is gitignored: do not commit it.
3. `bun run pins` prints the state of every pin and the next command to run.
   On a clean clone it reports nothing to do.
4. `bun run check` runs the pin report, the tool version check, then the four
   gates (core, plugins, cli, web).
5. You do not touch pins to write code. See "Pins" for when they matter.

## Daily commands

Run these from the monorepo root. One `bun install` here is all you need.

```bash
bun install        # links every consumer to the local core checkout
bun run check      # gate: core, plugins, cli, web
bun run test       # all four test suites
bun run start      # the CLI, running the local core
```

After that, edit a file in `minimal-agent-core/` and run `bun run start` again. The change is already live. There is no commit, no push, and no pin bump.

**Do not run `bun install` inside a submodule** as part of your normal loop. It works and keeps the link, because Bun finds the root workspace and runs the root install. It uses the root lockfile and never reads that submodule's own `bun.lock`, so it does nothing a root install did not already do. It also does not test the repo as a standalone: use `bun run pins:verify` for that (see "Pins").

## Layout

```
minimal-agent/                   # this monorepo
├── minimal-agent-core/          # presentation-free SDK + conversation engine (submodule)
├── minimal-agent-plugins/       # first-party plugins (submodule)
├── minimal-agent-cli/           # terminal client and `minimal-agent` bin (submodule)
├── minimal-agent-web/           # Bun server + Vite/React frontend over core (submodule)
├── minimal-agent-config/        # shared Biome, oxlint and tsconfig bases (submodule)
├── package.json                 # workspace root, tool catalog, convenience scripts
└── README.md
```

> **Core is a library.** It has no bin. The terminal client and the
> `minimal-agent` executable live in `minimal-agent-cli`.

## How the workspace works

The root `package.json` is a Bun workspace root. Three keys do the work:

```jsonc
"workspaces": ["minimal-agent-*", "minimal-agent-*/ma-*-plugin", ..., "!minimal-agent-studio/**"],
"overrides": { "@minimal-agent/core": "workspace:*", "@types/node": "^26", "brace-expansion": "^5.0.6" },
"catalog": { "@biomejs/biome": "2.6.6", "oxlint": "1.92.0", ... }
```

- `workspaces` globs the submodules and their members.
- `overrides` replaces every `@minimal-agent/core` declaration with the local
  directory. That is why edits show without a re-pin. Bun reads `overrides`
  only from the root of an install, so the root also repeats the version
  guards that the submodules carry for their own installs (`@types/node`,
  `brace-expansion`).
- `catalog` holds the tool versions for the root install (see "Tool versions").

### Two install contexts

The committed git pins stay. They are for the second column:

| | Inside the umbrella | A standalone clone of one repo |
| --- | --- | --- |
| Install that runs | the root install, from any directory | that repo's own install |
| Lockfile | the root `bun.lock` (gitignored) | the repo's `bun.lock` (committed in core, cli and web; ignored in plugins) |
| `overrides` and `catalog` | the root ones only | the repo's own |
| `@minimal-agent/core` | the local checkout | the git pin |
| `@minimal-agent/config` | the git pin (no override) | the git pin |

The umbrella CI `check` job is the first context. It installs at the root, so
it does not read the committed lockfiles of the submodules. No command inside
the umbrella tests the second context. `bun run pins:verify` does: it clones
each submodule outside the umbrella and installs there.

A compiled binary (`bun run cli:compile:dev` or `cli:compile:release`) is a
third case, and it uses neither install. The build does not read
`node_modules`: it bundles core from the working tree (dev) or from a
`git archive` of the commit the cli pins (release), and embeds the first-party
plugins the same way. So a `Cannot find package` error from a binary is a
build problem, not an install problem. See "Standalone binary" in
[`minimal-agent-cli/README.md`](./minimal-agent-cli/README.md).

Glob rules that matter, learned the hard way:

- Use globs, never literal directory names. A literal entry for a missing
  directory fails the install with `error: Workspace not found`, and the
  `commitlint` CI job installs at the root with no submodules present.
- List nested members too. `minimal-agent-plugins/ma-*-plugin` must appear, or
  the plugins keep the pinned core.
- A glob that matches nothing is fine.

`minimal-agent-studio/` and `minimal-agent-inspector/` are local projects that
match the `minimal-agent-*` glob. Bun does not read `.gitignore` for workspace
globs, so the two `!` patterns in `workspaces` keep them out. Without the
patterns, they join the root install and add their dependencies to its graph.

## Tool versions

The same tool versions are written in more than one place. Each submodule
must also install alone, and `catalog:` resolves only against the root of an
install:

- the root `catalog`, for the root install;
- the `workspaces.catalog` of core and of plugins, for their standalone installs;
- literal versions in the cli and web `devDependencies`;
- the `peerDependencies` of `@minimal-agent/config`.

`bun run catalogs:check` fails when one of them differs from the root catalog.
Root `bun run check` runs it. It also checks that a root `overrides` range,
such as `@types/node`, equals what each repo declares.

To upgrade a tool, change every place, run `bun install` at the root, then
`bun run catalogs:check`. Bump one tool per commit, and run `bun run check`
before the next.

One exception is intended: `minimal-agent-core/tools/docs` keeps TypeScript 6
for typedoc.

## Shared config

`minimal-agent-config` publishes `@minimal-agent/config`. Core, cli and plugins
extend it for Biome, oxlint and TypeScript:

| Tool | Consumer line |
| --- | --- |
| Biome | `"extends": ["@minimal-agent/config/biome"]` |
| oxlint | `"extends": ["./node_modules/@minimal-agent/config/oxlintrc.json"]` |
| TypeScript | `"extends": "@minimal-agent/config/tsconfig.json"` |

Each repo keeps only what is genuinely local: `files.includes`, the oxlint
`categories`/`settings`/`jsPlugins`/`overrides` block, and `include`/`exclude`.
Plugin discovery and jsdoc rules stay per repo on purpose. See
[`minimal-agent-config/README.md`](./minimal-agent-config/README.md).

## Develop inside one repo

You do not need this for daily work. Use it when you are running that repo's
own CI-equivalent gate, or when you want a standalone clone.

```bash
cd minimal-agent-core && bun run check
cd ../minimal-agent-plugins && bun run check
cd ../minimal-agent-cli && bun run check
cd ../minimal-agent-web && bun run check
```

Inside the plugins workspace, run each package's `test` script in parallel:

```bash
cd minimal-agent-plugins
bun run test:plugins          # bun --filter 'ma-*' test
```

### Plugin discovery

The agent loads plugins from these roots (the first root wins):

1. `<cwd>/.agents/minimal-agent/plugins/`: project
2. `~/.minimal-agent/plugins/`: user (first-run clone of the plugins repo,
   install mode only)
3. Embedded: `<cli>/plugins/`, plus the `minimal-agent-plugins/` checkout next
   to the CLI, or the dirs in `MINIMAL_AGENT_PLUGIN_SIBLINGS` (colon separated)

In this monorepo the `minimal-agent-plugins/` checkout is the dev mode root.
The CLI loads it with no symlink and does not clone the plugins repo. To add a
plugin for one project only, put or symlink the package into
`<cwd>/.agents/minimal-agent/plugins/`.

The CLI does not read `~/.agents/plugins/` or `<cwd>/.agents/plugins/`. If one
holds plugin packages, the CLI prints a warning. Move those packages to
`<cwd>/.agents/minimal-agent/plugins/`.

Run the agent from source. `bun run start` runs the CLI:

```bash
bun run start -- --help
# or
cd minimal-agent-cli && bun run start
```

Build a standalone `minimal-agent` binary (Bun runtime included, no
`bun` or `node_modules` needed to run it) into `minimal-agent-cli/dist/`:

```bash
bun run cli:compile:dev      # core = ./minimal-agent-core working tree, uncommitted edits included
bun run cli:compile:release  # core = the commit pinned in minimal-agent-cli/package.json
```

Neither one runs `bun install` or touches `node_modules`. Each build checks the new binary the way a user runs
it, before it replaces `dist/minimal-agent`: copied out of the repo, a
fresh `HOME`, a project dir with a hostile `bunfig.toml` and `.env`, then
`--help`, `plugins` with a test plugin on disk, a `-p` prompt, and the
interactive REPL in tmux (`minimal-agent-cli/scripts/compile-e2e.sh`). A
build that fails a check exits 1 and leaves the previous binary in place.
Run the checks on any binary with
`minimal-agent-cli/scripts/compile-e2e.sh PATH`.

The binary holds the CLI, core and every first-party plugin (the embedded
plugin root). A plugin in the project root or in `~/.minimal-agent/plugins`
still takes precedence, the same as a run from source.

## Pins

**Short version:** run `bun run pins`. It prints the state of every pin and
the exact command to run next. It changes nothing.

Pins are a release concern, not a dev concern. Daily work never touches them,
because the root workspace `overrides` already point every consumer at the
local `minimal-agent-core/` checkout. You move pins when a set of commits is
ready to be the new "these work together" record, for CI, for a standalone
clone, and for a release build.

### Two kinds of pin

| Pin | Where it lives | What reads it |
| --- | --- | --- |
| **Gitlink** | this repo, one commit SHA per submodule (`git ls-tree HEAD minimal-agent-core`) | `git clone --recurse-submodules`, monorepo CI |
| **Core pin** | each consumer's `package.json` and `bun.lock`: `"@minimal-agent/core": "git+ssh://…/minimal-agent-core.git#<sha>"` | a standalone clone of plugins, cli or web, their own CI, `cli:compile:release` |

Plugins, cli and web are the consumers. The plugins repo has one core pin in
its root `package.json` and one per plugin package (21 in total). The cli and
web each pin core in `package.json` and twice in `bun.lock`.

**The rule:** every core pin must equal the core gitlink. `bun run pins:check`
enforces it, and root `bun run check` prints the same report.

`pins:check` has two more checks:

- In one repo, `package.json` and the committed `bun.lock` must name the same
  SHA for each git dependency. A difference fails, because a frozen install
  stops on it in a standalone clone.
- Core, plugins and cli also pin `@minimal-agent/config` by git SHA. The
  workspace does not override config, so each repo moves that pin on its own.
  A config pin that differs from the config gitlink is printed as a note.

### Commands

| Command | What it does | Changes |
| --- | --- | --- |
| `bun run pins` | One report: each checkout against what the umbrella records and against `origin/main`, the two checks below, and a numbered "Next" list of commands. `--fetch` fetches first. Exit 1 when a check fails. | nothing |
| `bun run pins:lock [<repo>…]` | Update the committed `bun.lock` of core, cli and web to match their `package.json`, in a clone outside the umbrella, and copy it back. | `bun.lock` in the submodule working trees |
| `bun run pins:check` | Compare every consumer core pin with the core gitlink, and each committed `bun.lock` with its `package.json`. Exit 1 on a stale pin or a lockfile difference. | nothing |
| `bun run pins:verify [<repo>…]` | Clone core, plugins, cli and web at their gitlinks into a temp directory outside the umbrella, and install each one alone (`--frozen-lockfile` where the lockfile is committed). `--check` also runs `bun run check` there. `--head` uses the checked-out commit. | nothing here |
| `bun run catalogs:check` | Compare the tool versions of every repo with the root catalog (see "Tool versions"). | nothing |
| `bun run pins:core [<sha>]` | Rewrite the core pin in every consumer to `<sha>` (default: core `origin/main`), check out core at it, stage the core gitlink. | consumer working trees, core checkout, umbrella index |
| `bun run pins:core --dry-run` | Print the files and pins that would change. | nothing |
| `bun run pins:core --commit` | As above, then commit in each changed consumer and in the umbrella (only if `pins:check` passes). | + commits |
| `bun run pins:core --commit --push` | As above, then push each commit to `origin main`. | + pushes |
| `bun run pins:mains` | Set **every** gitlink to its submodule's `origin/main`, stage them, and update the approval lines in `CHANGELOG.md`. | **detaches HEAD in every submodule**, umbrella index |
| `bun run link:status` | Show per consumer whether `node_modules/@minimal-agent/core` is the local link or the pinned copy. | nothing |

### Recipes

**You pushed a change to one repo (not core) and want the umbrella to record it.**
For example, a plugins fix:

```bash
git -C minimal-agent-plugins push origin HEAD:main   # 1. the commit must be on the remote first
git add minimal-agent-plugins                         # 2. stage the new gitlink
bun run pins:check                                    # 3. still 0 stale: core did not move
git commit -m "chore: bump plugins for <what changed>"
git push
```

**You pushed a core change and want everything on it** (the core pin refresh):

```bash
bun run pins:core --dry-run          # see what moves
bun run check                        # gate the consumers on the new core (the workspace already uses it)
bun run pins:core --commit --push    # pin, commit and push plugins, cli, web, then the umbrella
```

With `--commit`, each consumer must be on `main`, level with `origin/main`, and
have no tracked changes, so the pin commit is the only new commit. The script
refuses a core SHA that is not on the core remote. If a run stops after the
consumer pushes (for example, a commit-msg hook rejects the umbrella commit),
run the same command again. It skips the consumers that are already on the SHA
and commits only what is left.

Without `--commit`, it edits and stages only. Review each consumer diff, commit
and push it, `git add` the consumer gitlinks, run `bun run pins:check`, and
commit the umbrella.

**You want every gitlink on its `origin/main`:**

```bash
bun run pins:mains
bun run pins:check    # stale? then the consumers pin an older core: run pins:core
```

`pins:mains` runs `git checkout --detach <origin/main>` in every submodule, with
no prompt. Commit or stash your work in all of them first, and run
`git -C <submodule> checkout main` afterwards to get back on a branch.

### Things that go wrong

- **`not our ref` / `upload-pack` in CI.** The umbrella points at a submodule
  commit that is not on that submodule's remote yet. Always push the submodule
  first, then the umbrella.
- **`pins:check` still reports stale after you edited the pins.** It reads
  `git show <gitlink>:<file>`, not your working tree. The consumer pin commits
  must exist and the umbrella gitlinks must point at them.
- **`git submodule update` resets your work.** On a machine where the
  submodule checkouts are the real working trees, it moves them to the pinned
  commit. Prefer explicit pin bumps after an intentional pull.
- **Do not edit pins by hand with `bun install`.** A consumer `bun install`
  inside the workspace does not rewrite that consumer's own `bun.lock`.
  `pins:core` edits both files directly.
- **A lockfile is out of date and nothing in the umbrella fails.** The root
  install never reads a submodule's `bun.lock`, and `--frozen-lockfile` inside
  the umbrella tests the root lockfile. `bun run pins:check` reports a git
  pin that differs between the two files. Run `bun run pins:lock` after any
  dependency change in core, cli or web, commit the new `bun.lock` in that
  repo, then run `bun run pins:verify --head <repo>`.
- **`pins:verify --check` runs fewer tests than the umbrella gate.** A
  standalone clone has no sibling checkouts, so the tests that need one skip
  themselves (498 in core, 55 in the cli, 39 in plugins). The umbrella gate
  stays the full gate.
- **A test needs a core module that has no public subpath.** Import it
  through the installed package directory
  (`../node_modules/@minimal-agent/core/src/x.ts`), not from the sibling
  checkout (`../../minimal-agent-core/src/x.ts`). The two are the same
  directory in the umbrella. In a standalone clone only the first one is the
  core that the repo installs: the second is missing, or it is a second copy
  that core refuses to load. A plugins guard test rejects the second form.
- **`link:reset` is removed.** It ran the consumer's frozen install, which is
  the root install, so the workspace link came back and the pin was not
  tested. Use `bun run pins:verify`.
- **The plugins `core pin` test fails only on your machine.** That test
  (`minimal-agent-plugins/scripts/core-pin.test.ts`) also scans ignored dirs
  such as `minimal-agent-plugins/tmp/`. A stale copy of the plugins there fails
  it locally but not in CI. Delete the copy.
- **The approval lines in `CHANGELOG.md`** (between `pin-approvals:start` and
  `pin-approvals:end`) are a record that only `pins:mains` rewrites. Nothing
  checks them.

## Why submodules

- Core, plugins, cli and web ship as independent repositories with their own
  CI, release surfaces and standalone clones.
- The monorepo needs one checkout that knows a compatible set of commits
  without merging the release trains.
- The root workspace gives the dev-time linking. Submodules keep the
  release-time separation.

## Related

- Core harness: [minimal-agent-core](https://github.com/gastonmorixe/minimal-agent-core)
- Plugins: [minimal-agent-plugins](https://github.com/gastonmorixe/minimal-agent-plugins)
- Terminal host: [minimal-agent-cli](https://github.com/gastonmorixe/minimal-agent-cli)
- Web app: [minimal-agent-web](https://github.com/gastonmorixe/minimal-agent-web)
- Shared tool config: [minimal-agent-config](https://github.com/gastonmorixe/minimal-agent-config)

## Versioning

All four product remotes share a coordinated stable version (currently
**0.1.0**, tag `v0.1.0`). `minimal-agent-config` has its own `0.1.0` and is
consumed by git SHA, not by version. Bump with:

```bash
bun run version:status
bun run version -- set 0.2.0 --tag --push
```

See "Versioning and releases" in [`AGENTS.md`](./AGENTS.md) for the full scheme (nightlies, CI, targets).

## For agents

Orientation for automated assistants working in this tree:
[`AGENTS.md`](./AGENTS.md). Monorepo change history:
[`CHANGELOG.md`](./CHANGELOG.md).

## License

Copyright (c) 2025–2026 Gaston Morixe. All rights reserved.

This software is proprietary and confidential. No license is granted to use,
copy, modify, merge, publish, distribute, sublicense, or sell copies of the
software except as expressly authorized in writing by the copyright holder.
See [LICENSE](./LICENSE).
