# minimal-agent-monorepo

Umbrella repo that pins the two first-party trees together via **git submodules**:

| Path | Remote | Branch |
|------|--------|--------|
| [`minimal-agent/`](./minimal-agent) | `gastonmorixe/minimal-agent-dev-private` | `dev-private` |
| [`minimal-agent-plugins/`](./minimal-agent-plugins) | `gastonmorixe/minimal-agent-plugins` | `main` |

Each submodule stays its own git history and publish surface. This repo only records which commits of each belong together.

## Clone

```bash
git clone --recurse-submodules <this-repo-url> minimal-agent-monorepo
cd minimal-agent-monorepo
```

If you already cloned without submodules:

```bash
git submodule update --init --recursive
```

## Layout

```
minimal-agent-monorepo/
├── minimal-agent/           # core harness (submodule)
├── minimal-agent-plugins/   # external plugins (submodule)
├── package.json             # convenience scripts only (no shared node_modules)
└── README.md
```

## Day-to-day

Work inside each submodule as usual (they are full checkouts):

```bash
cd minimal-agent && bun install && bun run check
cd ../minimal-agent-plugins && bun install && bun run check
```

Or from the monorepo root:

```bash
bun run install:all
bun run check
```

### Plugin discovery

minimal-agent loads plugins from (precedence: closer-to-user wins):

1. `<cwd>/.agents/plugins/`
2. `~/.agents/plugins/`
3. `<agent-install>/plugins/`

Symlink plugins you care about into the home root:

```bash
mkdir -p ~/.agents/plugins
ln -sfn "$PWD/minimal-agent-plugins/ma-fetch-plugin" ~/.agents/plugins/ma-fetch-plugin
# …repeat per plugin, or:
bun run link:plugins
```

Run the agent from source:

```bash
./minimal-agent/minimal-agent
# or
bun run start
```

## Updating submodule pins

```bash
# advance both to latest tracked branch tips
git submodule update --remote --merge
git add minimal-agent minimal-agent-plugins
git commit -m "chore: bump submodule pins"
```

To pin a specific commit, `cd` into the submodule, check out that commit, then commit the pin from the monorepo root.

## Why submodules (not one giant workspace)

- Core and plugins already ship as independent repos with their own workspaces, locks, and CI.
- Nested `workspaces` across both trees would fight Bun's single-root install model.
- Submodules keep history, remotes, and PR surfaces separate while still giving one checkout that "knows" a compatible pair of commits.
