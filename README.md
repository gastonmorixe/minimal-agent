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

## How it fits together

Three facts explain the rest of this page.

1. **There are six git repositories.** This one (the umbrella) and the five
   submodules. The umbrella does not hold their files. For each submodule it
   records one commit SHA, called a **gitlink**.
   `git clone --recurse-submodules` checks out those five commits.
2. **There is one Bun install.** The root `package.json` is a Bun workspace
   over the five submodules. One `bun install` at the root links the local
   `minimal-agent-core/` folder into plugins, cli and web. An edit in core is
   live in all three at once.
3. **A pin is a record, not a dev step.** A pin says "this commit goes with
   that commit". The gitlinks are pins. Plugins, cli and web also name one
   core commit in their own `package.json`, for when they are installed alone.
   You do not touch a pin to write code. You move pins when you land a change,
   and `bun run pins` prints the command to run.

```
minimal-agent/                 # the umbrella: one gitlink per submodule
├── minimal-agent-core/        # SDK and conversation engine (a library, no bin)
├── minimal-agent-plugins/     # first-party plugins
├── minimal-agent-cli/         # terminal client and the `minimal-agent` bin
├── minimal-agent-web/         # Bun server + Vite/React frontend over core
├── minimal-agent-config/      # shared Biome, oxlint and tsconfig bases
├── package.json               # workspace root, tool catalog, scripts
└── scripts/                   # pin, catalog, worktree and version scripts
```

## Clone

```bash
git clone --recurse-submodules https://github.com/gastonmorixe/minimal-agent.git
cd minimal-agent
bun install
bun run hooks
```

If you cloned without submodules:

```bash
git submodule update --init --recursive
```

What to expect on a first clone:

1. `bun install` at the root is the only install. It links the local core
   checkout into plugins, cli and web.
2. It writes a root `bun.lock`. That file is gitignored: do not commit it.
3. `bun run hooks` sets up the commit hooks in the umbrella and in each
   submodule. The hooks check the commit message format. `bun install` does
   this too, through each `prepare` script, but not when lifecycle scripts are
   off on your machine (`ignore-scripts` in `~/.npmrc`, which Bun reads). So
   run it once after a clone. It is safe to run again.
4. Each submodule is on a **detached HEAD**, at the commit the umbrella
   records. Make a branch there before you commit (see "Commit and land a
   change").
5. `bun run pins` prints the state of every pin and the next command to run.
   On a clean clone it reports nothing to do.

## Daily work

Run these from the monorepo root.

```bash
bun install        # once, and again after a pull that changes a package.json
bun run start      # the CLI, running your local core and plugins
bun run check      # everything: pin report, tool versions, then the four gates
bun run pins       # the state of every pin, and the next command to run
```

Edit a file in any submodule and run `bun run start` again. The change is
already live. There is no commit, no push, and no pin to move.

The gate of one repo (typecheck, lint, format, tests):

```bash
bun run --cwd minimal-agent-core check
bun run --cwd minimal-agent-plugins check
bun run --cwd minimal-agent-cli check
bun run --cwd minimal-agent-web check
bun run test:plugins          # plugins only: each package's tests in parallel
```

Two rules:

- **One install, at the root.** `bun install` inside a submodule works, but it
  is the same root install: Bun finds the root workspace above it. It uses the
  root lockfile and never reads or writes that submodule's own `bun.lock`.
- **After a dependency change in core, cli or web, run `bun run pins:lock`.**
  Those three repos commit a `bun.lock` for their standalone install, and the
  root install does not update it. `pins:lock` does, from a clone outside the
  umbrella. Commit the new `bun.lock` in that repo.

## Commit and land a change

The order is always: **the submodule first, the umbrella second.** The
umbrella records a commit SHA, so that commit must be on the submodule's
remote before the umbrella points at it.

| You changed | What to do |
| --- | --- |
| plugins, cli or web | Steps 1 to 3 below. |
| core | Steps 1 and 2 for core, then "A change in core". |
| a dependency of core, cli or web | Also `bun run pins:lock` before the commit. |
| config | Steps 1 to 3, then "A change in config". |

### 1. Commit in the submodule

```bash
cd minimal-agent-plugins
git switch -c my-fix            # the submodule is on a detached HEAD: make a branch first
# edit
bun run check                   # the gate of this repo
git commit -am "fix: <what changed>"
```

### 2. Push it to that repo

```bash
git push origin HEAD:main
```

### 3. Record it in the umbrella

```bash
cd ..
git add minimal-agent-plugins       # stage the new gitlink
bun run pins:check                  # 0 stale: core did not move
git commit -m "chore: bump plugins for <what changed>"
git push
bun run pins                        # "Next: Nothing"
```

### A change in core

Plugins, cli and web each name one core commit (the **core pin**). After a
core change is on core `main`, those pins must move to it. This is the **core
pin refresh**, and one command does it:

```bash
bun run pins:core --dry-run          # print what moves, write nothing
bun run check                        # gate the consumers on the new core (the workspace already uses it)
bun run pins:core --commit --push    # pin, commit and push plugins, cli and web, then the umbrella
```

`pins:core --commit` makes one pin commit in each consumer and one umbrella
commit, and nothing else. So it needs:

- the umbrella on `main`, with nothing staged but submodule gitlinks;
- plugins, cli and web on their `main`, level with `origin/main`, with no
  tracked changes.

A clone leaves the submodules on a detached HEAD, so put them on `main` first:

```bash
git submodule foreach 'git switch main && git pull --ff-only'
```

A worktree is never on the umbrella `main`. There, or when you want to review
each step, run it without `--commit`:

```bash
bun run pins:core <core sha>         # rewrite the pins, check out core at it, stage the core gitlink
# in plugins, cli and web: review the diff, commit it, push it
git add minimal-agent-plugins minimal-agent-cli minimal-agent-web
bun run pins:check                   # 0 stale, no lockfile difference
git commit -m "chore: bump core, plugins, cli and web for <what changed>"
git push
```

Before it writes anything, `pins:core` stops when a committed `bun.lock` and
its `package.json` name different commits for a git dependency. Run
`bun run pins:lock`, commit and push that `bun.lock`, then run it again. It
also refuses a core SHA that is not on the core remote. If a run stops after
the consumer pushes, run the same command again: it skips the consumers that
are already on the SHA, and stages their gitlinks for the umbrella commit.

### A change in config

Core, plugins and cli each name one config commit (the **config pin**). Config
is not linked the way core is, so a repo sees a config change only after its
pin moves. After the config commit is on config `main` and recorded in the
umbrella (steps 1 to 3):

```bash
bun run pins:config --dry-run    # print what moves, write nothing
bun run pins:config              # rewrite the pin in core, plugins and cli, and update the bun.lock of core and cli
# in core, plugins and cli: run the gate, commit "chore: pin config to <short sha>", push
```

Then record plugins and cli in the umbrella (step 3). The core commit needs
the core pin refresh ("A change in core"). `bun run pins` prints a "Next" line
while a config pin is behind.

### Get the latest

```bash
git pull                  # the umbrella
git submodule update      # each submodule to the commit the umbrella records
bun install               # when a package.json changed
```

`git submodule update` detaches HEAD in each submodule. It keeps uncommitted
edits, and stops when they are in the way. It does not keep a commit that you
made on a detached HEAD: that commit is then on no branch. So commit on a
branch (step 1) before you update. Do not add `--force`: that discards
uncommitted edits.

## Worktrees

To work on a second branch at the same time, make a full worktree:

```bash
bun run worktree:new my-fix     # ../<this checkout>_WT-my-fix, umbrella branch my-fix, from origin/main
bun run worktree:rm my-fix      # remove it; stops when it holds work that is nowhere else
```

`worktree:new` makes the umbrella worktree, checks out every submodule in it
(from the local objects, so it downloads little or nothing, but each remote
must be reachable), runs the one root install, and sets up the commit hooks. Each submodule is on a detached HEAD at the commit
the umbrella records: run `git -C minimal-agent-core switch -c my-fix` before
you commit there. `--branch <b>` and `--from <ref>` change the umbrella branch
name and the start commit.

Use a full worktree, not a folder with only the repos you need. A folder with
core and plugins side by side and no umbrella root above them is two
standalone installs: plugins there uses the pinned core, so an edit in the
core folder does not reach the plugins tests.

`git worktree remove` refuses a worktree that has submodules, and its
`--force` deletes the submodule repos of that worktree with everything that is
only there. `worktree:rm` looks first, in the umbrella and in each submodule
repo of that worktree, and stops when it finds one of these:

- an uncommitted or untracked file;
- an ignored file that no tool makes again, such as a note under `research/`
  (`node_modules`, `dist`, `tmp` and `bun.lock` do not count);
- a stash;
- a commit that is on no remote: on any branch, under a local tag, or left
  behind on a detached HEAD. The old copy of a commit that was rebased and
  then pushed does not count.

It fetches each submodule first, and a remote that is not reachable is a stop.
It keeps the umbrella branch. `--force` skips every check.

## Pins (reference)

**Short version:** run `bun run pins`. It prints the state of every pin and
the exact command to run next. It fetches first, and changes none of your
files or branches. When your checkout is behind the umbrella `main`, it says
so first: update, then run it again.

### What is pinned, and where

| Pin | Where it lives | What reads it |
| --- | --- | --- |
| **Gitlink** | this repo, one commit SHA per submodule (`git ls-tree HEAD minimal-agent-core`) | `git clone --recurse-submodules`, `git submodule update`, monorepo CI |
| **Core pin** | `package.json` of plugins, cli and web, and the `bun.lock` of cli and web: `"@minimal-agent/core": "git+ssh://…/minimal-agent-core.git#<sha>"` | a standalone clone of plugins, cli or web, and `cli:compile:release` |
| **Config pin** | `package.json` of core, plugins and cli, the same form for `@minimal-agent/config` | every install of those repos, also inside the umbrella (see "Shared config") |

The plugins repo has one core pin in its root `package.json` and one per
plugin package that declares core (21 in total). The cli and web each have 3:
one in `package.json` and two in `bun.lock`.

**The rule:** every core pin must equal the core gitlink. `bun run pins:check`
enforces it. It has two more checks:

- In one repo, `package.json` and the committed `bun.lock` must name the same
  commit for each git dependency. A difference fails, because a frozen install
  stops on it in a standalone clone.
- A config pin that differs from the config gitlink is printed as a note. It
  does not fail. `bun run pins:config` moves the config pins.

### Commands

| Command | What it does | Changes |
| --- | --- | --- |
| `bun run pins` | One report: each checkout against what the umbrella records and against `origin/main`, the two checks below, and a numbered "Next" list of commands. It fetches `origin main` in the umbrella and in each submodule first, so the advice is about the remotes as they are now; `--no-fetch` skips that. Exit 1 when a check fails. | no file, branch or index (it updates the remote-tracking refs) |
| `bun run pins:check` | Compare every core pin with the core gitlink, and each committed `bun.lock` with its `package.json`. Exit 1 on a stale pin or a lockfile difference. | nothing |
| `bun run catalogs:check` | Compare the tool versions of every repo with the root catalog (see "Tool versions"). | nothing |
| `bun run pins:core [<sha>]` | Rewrite the core pin in every consumer to `<sha>` (default: core `origin/main`), check out core at it, stage the core gitlink. | consumer working trees, core checkout, umbrella index |
| `bun run pins:core --dry-run` | Print the files and pins that would change. | nothing |
| `bun run pins:core --commit` | As above, then commit in each changed consumer and in the umbrella (only if `pins:check` passes). | + commits |
| `bun run pins:core --commit --push` | As above, then push each commit to `origin main`. | + pushes |
| `bun run pins:config [<sha>]` | Rewrite the config pin in core, plugins and cli to `<sha>` (default: the config gitlink), then update the `bun.lock` of core and cli with `pins:lock`. It fetches first, and skips a repo whose `main` has the pin already. `--dry-run` prints only. It commits nothing. | consumer working trees |
| `bun run pins:lock [<repo>…]` | Update the committed `bun.lock` of core, cli and web to match their `package.json`, in a clone outside the umbrella, and copy it back. | `bun.lock` in the submodule working trees |
| `bun run pins:verify [<repo>…]` | Clone core, plugins, cli and web at their gitlinks into a temp directory outside the umbrella, and install each one alone (`--frozen-lockfile` where the lockfile is committed). `--check` also runs `bun run check` there. `--head` uses the checked-out commit. | nothing here |
| `bun run pins:mains` | Set **every** gitlink to its submodule's `origin/main`, stage them, and update the approval lines in `CHANGELOG.md`. | **detaches HEAD in every submodule**, umbrella index |
| `bun run link:status` | Show per consumer whether `node_modules/@minimal-agent/core` is the local link or the pinned copy. | nothing |

`pins:mains` runs `git checkout --detach <origin/main>` in every submodule,
with no prompt. Commit your work on a branch in each of them first.

### Things that go wrong

- **`not our ref` / `upload-pack` in CI or in a clone.** The umbrella points
  at a submodule commit that is not on that submodule's remote yet. Push the
  submodule first, then the umbrella.
- **`pins:check` still reports stale after you edited the pins.** It reads
  `git show <gitlink>:<file>`, not your working tree. The consumer pin commits
  must exist and the umbrella gitlinks must be staged or committed at them.
- **A commit in a submodule is gone after `git submodule update`.** You made
  it on a detached HEAD. It is still in that repo: find it with
  `git -C <submodule> reflog`, then `git -C <submodule> branch <name> <sha>`.
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

## The Bun workspace (reference)

The root `package.json` is a Bun workspace root. Three keys do the work:

```jsonc
"workspaces": ["minimal-agent-{core,plugins,cli,web,config}", "minimal-agent-plugins/ma-*", ...],
"overrides": { "@minimal-agent/core": "workspace:*", "@types/node": "^26", "brace-expansion": "^5.0.6" },
"catalog": { "@biomejs/biome": "2.6.6", "oxlint": "1.92.0", ... }
```

- `workspaces` lists the five submodules by name, and globs their members.
- `overrides` replaces every `@minimal-agent/core` declaration with the local
  directory. That is why edits show without a re-pin. Bun reads `overrides`
  only from the root of an install, so the root also repeats the version
  guards that the submodules carry for their own installs (`@types/node`,
  `brace-expansion`).
- `catalog` holds the tool versions for the root install (see "Tool versions").

### Two install contexts

Each submodule can be installed in two ways. The committed pins and lockfiles
are for the second column:

| | Inside the umbrella | A standalone clone of one repo |
| --- | --- | --- |
| Install that runs | the root install, from any directory | that repo's own install |
| Lockfile | the root `bun.lock` (gitignored) | the repo's `bun.lock` (committed in core, cli and web; ignored in plugins) |
| `overrides` and `catalog` | the root ones only | the repo's own |
| `@minimal-agent/core` | the local checkout | the core pin |
| `@minimal-agent/config` | the config pin (no override) | the config pin |

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

### The `workspaces` list

- Every entry must be a glob, never a plain directory name. A plain entry for
  a missing directory fails the install with `error: Workspace not found`, and
  the `commitlint` CI job installs at the root with no submodules present. A
  brace list such as `minimal-agent-{core,cli}` is a glob.
- List nested members too. `minimal-agent-plugins/ma-*` must appear, or the
  plugin packages keep the pinned core.
- A glob that matches nothing is fine.
- The list names the repos on purpose. Bun does not read `.gitignore` for
  workspace globs, so a wide pattern such as `minimal-agent-*` also takes
  local projects next to the submodules (`minimal-agent-studio/`,
  `minimal-agent-inspector/`) and adds their dependencies to the root install.
- To add a submodule, add its name to the first entry. `bun run catalogs:check`
  fails while a submodule is not matched by any pattern.

### Tool versions

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

### Shared config

`minimal-agent-config` publishes `@minimal-agent/config`. Core, cli and plugins
extend it for Biome, oxlint and TypeScript:

| Tool | Consumer line |
| --- | --- |
| Biome | `"extends": ["@minimal-agent/config/biome"]` |
| oxlint | `"extends": ["./node_modules/@minimal-agent/config/oxlintrc.json"]` |
| TypeScript | `"extends": "@minimal-agent/config/tsconfig.json"` |

Each repo keeps only what is genuinely local: `files.includes`, the oxlint
`categories`/`settings`/`jsPlugins`/`overrides` block, and `include`/`exclude`.
Plugin discovery and jsdoc rules stay per repo on purpose.

Config is not linked the way core is. The root `overrides` has no entry for
it, so each repo installs the config commit that it pins, also inside the
umbrella. An edit in `minimal-agent-config/` reaches a repo only after a config
commit and a new config pin in that repo. See
[`minimal-agent-config/README.md`](./minimal-agent-config/README.md).

## Run and build

`bun run start` runs the CLI from source:

```bash
bun run start -- --help
# or
cd minimal-agent-cli && bun run start
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

### Standalone binary

Build a standalone `minimal-agent` binary (Bun runtime included, no
`bun` or `node_modules` needed to run it) into `minimal-agent-cli/dist/`:

```bash
bun run cli:compile:dev      # core = ./minimal-agent-core working tree, uncommitted edits included
bun run cli:compile:release  # core = the commit pinned in minimal-agent-cli/package.json
```

Neither one runs `bun install` or touches `node_modules`. Each build checks
the new binary the way a user runs it, before it replaces
`dist/minimal-agent`: copied out of the repo, a fresh `HOME`, a project dir
with a hostile `bunfig.toml` and `.env`, then `--help`, `plugins` with a test
plugin on disk, a `-p` prompt, and the interactive REPL in tmux
(`minimal-agent-cli/scripts/compile-e2e.sh`). A build that fails a check exits
1 and leaves the previous binary in place. Run the checks on any binary with
`minimal-agent-cli/scripts/compile-e2e.sh PATH`.

The binary holds the CLI, core and every first-party plugin (the embedded
plugin root). A plugin in the project root or in `~/.minimal-agent/plugins`
still takes precedence, the same as a run from source.

## Why submodules

- Core, plugins, cli and web ship as independent repositories with their own
  release surfaces and standalone clones.
- The monorepo needs one checkout that knows a compatible set of commits
  without merging the release trains.
- The root workspace gives the dev-time linking. Submodules keep the
  release-time separation.
- The cost is the pins. `bun run pins` and the commands in "Pins" keep them
  consistent.

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
