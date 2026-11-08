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

## Daily commands

Run these from the monorepo root. One `bun install` here is all you need.

```bash
bun install        # links every consumer to the local core checkout
bun run check      # gate: core, plugins, cli, web
bun run test       # all four test suites
bun run start      # the CLI, running the local core
```

After that, edit a file in `minimal-agent-core/` and run `bun run start` again. The change is already live. There is no commit, no push, and no pin bump.

**Do not run `bun install` inside a submodule** as part of your normal loop. It works and keeps the link, because Bun finds the root workspace, but it resolves against the root lockfile and does nothing a root install did not already do. Use it only when you are testing that repo as a standalone.

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
"workspaces": ["minimal-agent-*", "minimal-agent-*/ma-*-plugin", ...],
"overrides": { "@minimal-agent/core": "workspace:*", "@types/node": "^26" },
"catalog": { "@biomejs/biome": "2.6.6", "oxlint": "1.92.0", ... }
```

- `workspaces` globs the submodules and their members.
- `overrides` replaces every `@minimal-agent/core` declaration with the local
  directory. That is why edits show without a re-pin.
- `catalog` is the single place where tool versions are declared.

The committed git pins stay. A clean clone of one submodule, on its own, still
resolves the pinned core, because it has no workspace root above it. CI behaves
the same way.

Glob rules that matter, learned the hard way:

- Use globs, never literal directory names. A literal entry for a missing
  directory fails the install with `error: Workspace not found`, and the
  `commitlint` CI job installs at the root with no submodules present.
- List nested members too. `minimal-agent-plugins/ma-*-plugin` must appear, or
  the plugins keep the pinned core.
- A glob that matches nothing is fine.

`minimal-agent-studio/` and `minimal-agent-inspector/` are gitignored so the
`minimal-agent-*` glob does not pull them in.

## Tool versions

Versions live in the root `catalog` and in `@minimal-agent/config`. To upgrade
one, change the catalog entry, then run `bun install` at the root.

The affected repos are listed per tool in `AGENTS.md`. Bump one tool per
commit, and run `bun run check` before the next.

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

The agent loads plugins from these roots (closer-to-user wins):

1. `<cwd>/.agents/plugins/`
2. `~/.agents/plugins/`
3. `~/.minimal-agent/plugins/` (first-run clone of the plugins repo)
4. A sibling `minimal-agent-plugins/` directory next to a source checkout (dev)

To wire a plugins checkout into the home root while developing:

```bash
mkdir -p ~/.agents/plugins
ln -sfn "$PWD/minimal-agent-plugins/ma-fetch-plugin" ~/.agents/plugins/ma-fetch-plugin
# or:
bun run link:plugins
```

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

The binary holds the CLI and core only. Plugins, including every LLM
provider, load from `~/.minimal-agent/plugins` at run time, the same as a
run from source.

## Updating submodule pins

Pins are a release concern, not a dev concern. Daily work never touches them,
because the workspace `overrides` already point every consumer at the local
core.

When you do cut a pin, the order matters. Push the sibling commits first, or
the monorepo clone fails with `not our ref`:

```bash
git -C minimal-agent-core push origin HEAD
git -C minimal-agent-plugins push origin HEAD
git -C minimal-agent-cli push origin HEAD
git -C minimal-agent-web push origin HEAD
git add minimal-agent-core minimal-agent-plugins minimal-agent-cli minimal-agent-web
git commit -m "chore: bump submodule pins"
```

To move every gitlink to its `origin/main` in one command, and update the pin
approval lines in `CHANGELOG.md`:

```bash
bun run pins:mains   # fetch, detach each submodule at origin/main, stage the gitlinks
bun run pins:check   # fail if a consumer core pin differs from the core gitlink
```

**`pins:mains` runs `git checkout --detach <origin/main>` in every submodule.**
Stash or commit your work in all four first. There is no confirmation prompt.

If only the core-pin strings need to move, and you do not want to detach
anything, rewrite them and commit the pin lines per repo:

```bash
grep -rl 234482dc --include=package.json --include=bun.lock minimal-agent-* \
  | grep -v node_modules
```

Then bump the root gitlinks and run `bun run pins:check`.

`pins:check` reads `git show <gitlink>:file`, not your working tree. A rewrite
in the working tree alone still reports stale until the pin commits land and
the root gitlinks move.

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
