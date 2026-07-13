# minimal-agent

Umbrella repository that pins two first-party trees together with **git submodules**:

| Path | Repository | Branch |
|------|------------|--------|
| [`minimal-agent-core/`](./minimal-agent-core) | [`gastonmorixe/minimal-agent-core`](https://github.com/gastonmorixe/minimal-agent-core) | `main` |
| [`minimal-agent-plugins/`](./minimal-agent-plugins) | [`gastonmorixe/minimal-agent-plugins`](https://github.com/gastonmorixe/minimal-agent-plugins) | `main` |

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
├── minimal-agent-core/          # harness (submodule)
├── minimal-agent-plugins/       # first-party plugins (submodule)
├── package.json                 # convenience scripts only
└── README.md
```

## Develop

Each submodule is its own Bun workspace (with a shared **catalog** for toolchain
versions). Work inside them as normal checkouts:

```bash
cd minimal-agent-core && bun install && bun run check
cd ../minimal-agent-plugins && bun install && bun run check
```

Or from the monorepo root (orchestrates both; does **not** merge them into one
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

Run the agent from source:

```bash
./minimal-agent-core/minimal-agent
# or
bun run start
```

## Updating submodule pins

Develop and commit inside each submodule first, then bump the pin here:

```bash
git add minimal-agent-core minimal-agent-plugins
git commit -m "chore: bump submodule pins"
```

`git submodule update --remote` advances both to the tip of the tracked branch, then stage and commit as above. Prefer explicit pins for reproducible checkouts.

## Why submodules

- Core and plugins already ship as independent repositories with their own workspaces, locks, and CI.
- A single nested Bun workspace across both trees fights Bun's single-root install model.
- Submodules keep PR surfaces separate while still giving one checkout that knows a compatible pair of commits.

## Related

- Core harness: [minimal-agent-core](https://github.com/gastonmorixe/minimal-agent-core)
- Plugins: [minimal-agent-plugins](https://github.com/gastonmorixe/minimal-agent-plugins)

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
