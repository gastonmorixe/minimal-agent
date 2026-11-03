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

Umbrella repository that pins four first-party trees together with **git submodules**:

| Path                                                | Repository                                                                                    | Branch |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------ |
| [`minimal-agent-core/`](./minimal-agent-core)       | [`gastonmorixe/minimal-agent-core`](https://github.com/gastonmorixe/minimal-agent-core)       | `main` |
| [`minimal-agent-plugins/`](./minimal-agent-plugins) | [`gastonmorixe/minimal-agent-plugins`](https://github.com/gastonmorixe/minimal-agent-plugins) | `main` |
| [`minimal-agent-cli/`](./minimal-agent-cli)         | [`gastonmorixe/minimal-agent-cli`](https://github.com/gastonmorixe/minimal-agent-cli)         | `main` |
| [`minimal-agent-web/`](./minimal-agent-web)         | [`gastonmorixe/minimal-agent-web`](https://github.com/gastonmorixe/minimal-agent-web)         | `main` |

Each submodule keeps its own history, CI, and release surface. This repository only records which commits of each belong together.

## Clone

```bash
git clone --recurse-submodules https://github.com/gastonmorixe/minimal-agent.git
cd minimal-agent
```

If you cloned without submodules:

```bash
git submodule update --init --recursive
```

## Layout

```
minimal-agent/                   # this monorepo
├── minimal-agent-core/          # presentation-free SDK + conversation engine (submodule)
├── minimal-agent-plugins/       # first-party plugins (submodule)
├── minimal-agent-cli/           # terminal client and `minimal-agent` bin (submodule)
├── minimal-agent-web/           # Bun server + Vite/React frontend over core (submodule)
├── package.json                 # convenience scripts only
└── README.md
```

> **Core is a library.** It has no bin. The terminal client and the
> `minimal-agent` executable live in `minimal-agent-cli`.

## Develop

Each submodule is its own Bun workspace (with a shared **catalog** for toolchain
versions). Work inside them as normal checkouts:

```bash
cd minimal-agent-core && bun install && bun run check
cd ../minimal-agent-plugins && bun install && bun run check
cd ../minimal-agent-cli && bun install && bun run check
cd ../minimal-agent-web && bun install && bun run check
```

Or from the monorepo root (orchestrates all four; does **not** merge them into one
install graph):

```bash
bun run install:all
bun run check
bun run start
```

Inside the plugins workspace, run each package’s `test` script in parallel:

```bash
cd minimal-agent-plugins
bun run test:plugins          # bun --filter 'ma-*' test
```

Toolchain versions (`typescript`, `oxlint`, `biome`, `bun-types`, …) are declared
once per repo under `workspaces.catalog` and referenced as `"catalog:"` from
`devDependencies`. Bump a version in the catalog, then `bun install`.

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

Neither one runs `bun install` or touches `node_modules`, so a `link:dev`
link stays in place. Each build checks the new binary the way a user runs
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

Develop and commit inside each submodule first, then bump the pin here:

```bash
git add minimal-agent-core minimal-agent-plugins minimal-agent-cli minimal-agent-web
git commit -m "chore: bump submodule pins"
```

Or pin every submodule to its `origin/main` in one command. It prints
`old -> new` and updates the pin approval lines in `CHANGELOG.md`:

```bash
bun run pins:mains   # stage each gitlink at origin/main
bun run pins:check   # fail if a cli, plugins, or web core pin differs from the core gitlink
```

`git submodule update --remote` advances every submodule to the tip of its tracked branch, then stage and commit as above. Prefer explicit pins for reproducible checkouts.

## Why submodules

- Core, plugins, cli, and web already ship as independent repositories with their own workspaces, locks, and CI.
- A single nested Bun workspace across all four trees fights Bun's single-root install model.
- Submodules keep PR surfaces separate while still giving one checkout that knows a compatible pair of commits.

## Related

- Core harness: [minimal-agent-core](https://github.com/gastonmorixe/minimal-agent-core)
- Plugins: [minimal-agent-plugins](https://github.com/gastonmorixe/minimal-agent-plugins)
- Terminal host: [minimal-agent-cli](https://github.com/gastonmorixe/minimal-agent-cli)
- Web app: [minimal-agent-web](https://github.com/gastonmorixe/minimal-agent-web)

## Versioning

All four remotes share a coordinated stable version (currently **0.1.0**, tag
`v0.1.0`). Bump with:

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
