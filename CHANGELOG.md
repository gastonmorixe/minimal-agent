---
project: "minimal-agent"
title: "Changelog"
type: changelog
status: living
scope: monorepo
working-dir: "."
created-at: "2026-07-12T20:53:58-0400"
updated-at: "2026-11-18T00:00:00-0500"
format: "Keep a Changelog (pragmatic, date-stamped) + YAML frontmatter audit trail"
latest-unreleased:
  - id: "2026-11-18-workflow-docs-and-worktree-rm-fix"
    type: fix
    status: landed
    detail: "worktree:rm no longer deletes stashes, tagged or detached commits, or ignored notes, and never prunes. pins:core --commit can resume. New: bun run hooks. README and AGENTS rewritten around the workflow"
  - id: "2026-11-18-worktree-scripts"
    type: feat
    status: landed
    detail: "worktree:new makes a full umbrella worktree with every submodule and one root install. worktree:rm removes one and stops when work would be lost"
  - id: "2026-11-18-workspace-install-contexts"
    type: fix
    status: landed
    detail: "Root workspace excludes studio and inspector. New: pins (status report), pins:lock, pins:verify, catalogs:check. pins:check also compares each bun.lock with its package.json. link:reset removed"
  - id: "2026-11-15-debug-dump-order-pin-sweep"
    type: chore
    status: landed
    detail: "Bump all pins to core d0a6462 (debug dump: system before messages). Regenerate cli/web bun.lock. Add config pin approval line"
  - id: "2026-11-11-plugin-roots-three-tiers"
    type: refactor
    status: landed
    detail: "Plugin roots are project, user, embedded. Home tier ~/.agents/plugins removed. Dev mode skips the plugins clone. link:plugins removed"
  - id: "2026-11-03-cli-compile-scripts"
    type: feat
    status: landed
    detail: "Root cli:compile:dev and cli:compile:release build a standalone CLI binary. Pins bumped for compiled-binary support and Anthropic account plan"
  - id: "2026-11-01-pin-sweep-scripts"
    type: feat
    status: landed
    detail: "pins:mains sets every gitlink to origin/main. pins:check fails on a consumer core pin that differs from the core gitlink"
  - id: "2026-10-31-web-in-umbrella"
    type: feat
    status: landed
    detail: "minimal-agent-web joins the umbrella as a fourth submodule; root scripts, CI, and version tool cover it (spec S59)"
  - id: "2026-10-31-cli-in-umbrella-link-dev"
    type: feat
    status: landed
    detail: "Root scripts, CI, and version tool cover minimal-agent-cli; link:dev links local core into consumers"
  - id: "2026-10-14-writing-style-opencode-pins"
    type: chore
    status: landed
    detail: "Bump core (prompt writing-style audit) and plugins (writing-style, OpenCode catalog refresh) pins"
  - id: "2026-10-04-meta-fleet-quota-pins"
    type: fix
    status: landed
    detail: "Bump core (Cursor path aliases) and plugins (Meta Responses, fleet contextSize, quota footer, prompt-cache docs) pins"
  - id: "2026-10-01-cursor-carry-mcp-guard-compact-pins"
    type: fix
    status: landed
    detail: "Bump core (compact preamble + retry cap) and plugins (Cursor conversation carry, MCP bridge guard) pins"
  - id: "2026-09-28-cursor-allowlist-toolless-models-pin"
    type: fix
    status: landed
    detail: "Bump plugins pin for Cursor tool allowlist, tool-less hang fix, model refresh"
latest-release:
  version: "0.1.0"
  tag: "v0.1.0"
  id: "2026-07-12-v0.1.0"
related:
  - "README.md"
  - "AGENTS.md"
  - "minimal-agent-core/docs/CHANGELOG.md"
  - "minimal-agent-plugins/CHANGELOG.md"
  - "minimal-agent-cli/CHANGELOG.md"
  - "minimal-agent-web/README.md"
remotes:
  monorepo: "https://github.com/gastonmorixe/minimal-agent"
  core: "https://github.com/gastonmorixe/minimal-agent-core"
  plugins: "https://github.com/gastonmorixe/minimal-agent-plugins"
  cli: "https://github.com/gastonmorixe/minimal-agent-cli"
  web: "https://github.com/gastonmorixe/minimal-agent-web"
  config: "https://github.com/gastonmorixe/minimal-agent-config"
---

# Changelog

All notable changes to the **minimal-agent monorepo** (umbrella pins +
orchestration) are documented here.

## [Unreleased]

### Pin approvals (S46)

The lead approves each umbrella gitlink below (decision 20; D21, Q5, Q7).
Each gitlink is the full 40-character SHA of that repo's `main`.
`bun run pins:mains` rewrites only the SHAs on these lines.

<!-- pin-approvals:start -->
- Approved: `minimal-agent-core` at `07f723fe3d44a6c0d7a6bbb1edf92bd7160f066b` (lead, decision 20).
- Approved: `minimal-agent-plugins` at `8180cf33bc218a86117cd3c2c9adb51ecf2d0e4c` (lead, decision 20).
- Approved: `minimal-agent-cli` at `1529ff36c991d1fbda32bf8ba9921233a69038f2` (lead, decision 20).
- Approved: `minimal-agent-web` at `6eb9c581cae0eaaf0ccf21604fc87931842f7dc9` (lead, decision 20).
- Approved: `minimal-agent-config` at `8c966cfaf6725ab84c643c76f59e5473224275c6` (lead, decision 20).
<!-- pin-approvals:end -->

### Added

- 2026-11-18: **`bun run hooks`** sets up the commit hooks in the umbrella
  and in each submodule. `bun install` does it through the `prepare` scripts,
  but not on a machine where lifecycle scripts are off (`ignore-scripts` in
  `~/.npmrc`). There, no repo had a hook and any commit message was accepted.
- 2026-11-18: **`README.md` and `AGENTS.md` are rewritten around the
  workflow.** The README starts with how the six repos and the one install
  fit together, then clone, daily work, "Commit and land a change" (a
  submodule change, a core change, getting the latest), worktrees, and the
  reference for pins and for the workspace. `AGENTS.md` starts with ten rules
  and has one "Git and Bun workflow" section with the commands in order.
  Every command in both files was run in a fresh clone.
- 2026-11-18: **`bun run worktree:new <name>` and `bun run worktree:rm
  <name>`.** `worktree:new` makes a full umbrella worktree next to the main
  checkout: the umbrella on a new branch from `origin/main`, every submodule
  checked out from the local objects, one root install, and the commit hooks.
  It ends with a check that the cli uses the core checkout of that worktree.
  `worktree:rm` removes one, and stops when the umbrella or a submodule has
  uncommitted files or commits that are on no remote, because
  `git worktree remove --force` deletes the submodule repos of a worktree.
- 2026-11-18: **Model registries refreshed from live 2026-11-18 catalogs**:
  plugins `49383be` (lead task, stored auth, no secrets logged). OpenAI
  +`gpt-6.2-astra` / +`gpt-6.2-sol` (Responses + `-chat`); OpenCode Go
  +`hy4-flash-free` / +`qwen4-max`; OpenCode Zen +`gpt-6.2-sol` /
  +`gpt-6.2-astra` / +`hy4-flash-free`, retired `-glm-5.3-flash-free` /
  `-minimax-m3.1-flash-free`; OpenRouter `gpt-6.1-sol` -> `gpt-6.2-sol`
  flagship, Kimi K3.1 Pro repriced `2/10` -> `0.2403/8.4023`; HuggingFace
  Kimi-K2.7-Code + GLM-5.3 backend repricing; Wafer 3 cache-read reprices;
  Anthropic live-models beta-header fix (400 -> 200, no registry drift).
  Meta/Grok/Ollama/Cursor/ClinePass: no drift. Details are in
  `minimal-agent-plugins/CHANGELOG.md`.
- 2026-11-18: **The prompt-cache anchor marker is on by default**: core
  `f705b0f`, plugins `92f519a`, cli `5a531dd`, web `1d102ef`. `cacheAnchor`
  is on unless something turns it off: `"cacheAnchor": false` in the config,
  `MINIMAL_AGENT_CACHE_ANCHOR=0`, or `--no-cache-anchor`. Sub-agents inherit
  an explicit off. `thinkingHistory` stays `"strip"`. With the default system
  prompt the cap of 4 cache markers drops the anchor, so those requests are
  unchanged on the wire. 11 request goldens gained the anchor marker only.
- 2026-11-18: **The cache warning no longer blames the client for a likely
  server-side cache miss**: plugins `617e0a7`. `ma-cache-plugin` fingerprints
  each request prefix. A read of 0 with an unchanged prefix (after a request
  that read its cache) is now the info code `server_miss` with the request
  id, not a `prefix_changed` warning. Real client changes still warn and name
  the changed part, including the thinking removal + cache lookback cascade.
  The server's `cache_missed_input_tokens` is shown as the "server-reported
  miss size", not as tokens lost.
- 2026-11-18: **The web follow-ups of the session identity fix**: core
  `f38d9c8`, plugins `bd666f4`, cli `01ec00f`, web `a684831`. (1) The Task
  tool takes `ctx.agent.sessionId` first, so each web session keeps its own
  board. (2) A worker that a sub-agent starts is the CLI, not a second web
  server: the web host publishes `MINIMAL_AGENT_BIN` (the sibling CLI entry)
  when the var is unset. (3) MA-02 no longer says that every session has a
  transcript file: a host can keep it in memory, and `SessionInfo` gives the
  id. Only the prompt fixtures and the request goldens change in that line.
  The details are in the changelog of each repo.
- 2026-11-18: **Each web session gives plugins its own identity**: core
  `fb25b02`, plugins `dd9df6d`, cli `3d83761`, web `22fbfdf`. A host with
  many sessions in one process (the web host) opens each session with the
  core session plugin scope, so a plugin tool (SessionInfo, ModelInfo,
  SessionHistory, tasks) reads the id, live target, model info and token
  counters of its own session, and net-dbg records each session into its
  own folder. Before, a web session showed the boot default model, the
  process sid or "unknown", agent v0.0.0, and the usage of every session.
  Web session ids are UUIDs. The CLI does not change. The details are in
  the changelog of each repo.
- 2026-11-18: **Gitlinks bumped to the mains of the day** (`bun run
  pins:mains`): core `40465ca`, plugins `a1680f7`, cli `c314a86`, web
  `aa42a02`, config `7b504c3` (unchanged). The details of each change are in
  the changelog of its repo. CI state: the push runs of the last umbrella
  commits were cancelled by the next push, so no run covers all of these
  mains together. The last complete green run is `44359890627` on `4932c28`.
  Not merged: the no-direct-stdio guard (`feat/no-direct-writes` in five
  repos) and the `ste/dictionary` branches. An OAuth token in the public
  history of core (`88af477`) and plugins (`5dc09da`) must be revoked; see
  `research/handoffs/` (git-ignored, local).

### Changed

- 2026-11-18: **The root workspace and the standalone installs are checked
  against each other.** Inside the umbrella, an install in any submodule is
  the root install: it uses the root lockfile and the root `overrides`, and
  never reads the submodule's own `bun.lock`. Five things follow from that.
  - `minimal-agent-studio/` and `minimal-agent-inspector/` were members of
    the root workspace, because Bun does not read `.gitignore` for workspace
    globs. `workspaces` now names the five submodules
    (`minimal-agent-{core,plugins,cli,web,config}`) and no longer takes every
    `minimal-agent-*` folder. The member list is the same 71 packages.
    `catalogs:check` fails when a submodule matches no pattern.
  - New `bun run catalogs:check` (also in root `bun run check`): the tool
    versions of the core and plugins catalogs, the cli and web
    `devDependencies` and the config peers must equal the root catalog. The
    root `bun-types` and `typescript` now use `catalog:` (`bun-types` was
    `^1.3.14`).
  - The root `overrides` gains `brace-expansion ^5.0.6`. The same guard in
    core, plugins and cli applies only to their standalone installs.
  - `bun run pins:check` also fails when a committed `bun.lock` and its
    `package.json` name different SHAs for a git dependency, and prints a
    note for a config pin behind the config gitlink. It found that the core
    `bun.lock` was last regenerated on 2026-11-07: it held config `4448bfa`
    and the old tool versions, so a frozen install of a standalone core clone
    failed.
  - New `bun run pins:verify`: clone each submodule at its gitlink outside
    the umbrella and install it alone. `bun run link:reset` is removed: its
    frozen install was the root install, so the workspace link came back and
    the pin was not tested. `bun run install:all` is now `bun install`.
  - `bun run pins:core` checks the same lockfile rule before it writes
    anything. Without that, a refresh to a core commit with a stale
    `bun.lock` pushed the consumer pins and then stopped at `pins:check`,
    with the umbrella still on the old core.
  - New `bun run pins`: one report with each checkout, what the umbrella
    records, the two checks, and a numbered list of the commands to run next.
  - New `bun run pins:lock`: update the committed `bun.lock` of core, cli and
    web in a clone outside the umbrella and copy it back.

  The matching commits are in core (regenerated `bun.lock`), web
  (`@types/node ^26`, `bun-types ^1.4.4`, the `brace-expansion` guard, new
  `bun.lock`), cli and config (docs), and plugins. The plugins gate now also
  passes in a standalone clone: its tests import core source through the
  installed package directory and not from `../../minimal-agent-core`, and
  its STE audit reads the installed core when no sibling checkout exists.
  Gitlinks: core `07f723f`, plugins `8180cf3`, cli `1529ff3`, web `6eb9c58`,
  config `8c966cf`. Every consumer pins core `07f723f` (`pins:check` reports
  0 stale and no lockfile difference).
- 2026-11-15: Pins advance to core `d0a6462`, plugins `af8b38f`, cli
  `ce8726d`, and web `26eea59`. In the `--debug` request dump, the system
  block now sits directly before the messages (order: tools, system,
  messages). Every cli, plugins, and web package now pins core `d0a6462`
  (`pins:check` reports 0 stale). The cli and web `bun.lock` files were
  out of sync with their `package.json` dev dependencies (biome, oxlint,
  commitlint, config `55ba040`). Both are regenerated and pass
  `bun install --frozen-lockfile`. The pin approval block gains a
  `minimal-agent-config` line, so `pins:mains` covers all five submodules.

- 2026-11-11: Plugin roots are now 3 tiers: project
  (`<cwd>/.agents/minimal-agent/plugins`), user (`~/.minimal-agent/plugins`),
  and embedded (`<cli>/plugins` plus the `minimal-agent-plugins` checkout).
  The home tier `~/.agents/plugins` is removed, and the project path moves
  from `<cwd>/.agents/plugins`. The CLI warns about plugin packages in an old
  root and moves nothing. When a checkout holds plugin packages (dev mode),
  the CLI does not clone the plugins repo. `bun run link:plugins` and
  `scripts/link-plugins.ts` are removed. README and AGENTS.md describe the new
  roots.

- 2026-11-03: Pins advance to core `2333bfb`, plugins `48d9a93`, cli
  `383eb8b`, and web `8898e46`. Each repo gets a docs pass: CHANGELOG,
  README, and AGENTS.md now match the code. The CLI `--help` text is
  fixed (help strings only). Details are in each repo's CHANGELOG.

- 2026-11-01: `bun run start` runs the CLI (`minimal-agent-cli`). Core is a
  library and has no bin.

- 2026-10-14: Core pin advanced to `1f3dd89` (`310d6d9`..`1f3dd89`) and plugins
  pin to `973b87a` (`a4ce3af`..`973b87a`). Details are in
  `minimal-agent-core/docs/CHANGELOG.md` and `minimal-agent-plugins/CHANGELOG.md`.
  - Model-facing prose in core and plugins follows the writing-style rules.
    Prompt-audit tests in both repos now enforce no semicolons, no emoji, no
    sycophancy or signposting, and no `---` before a heading.
  - OpenCode Go and Zen catalogs are refreshed from live `/v1/models`. Some
    retired ids no longer resolve.
  - Both gates are green: core 0 lint warnings, plugins 4375 pass, 0 warnings.

### Fixed

- 2026-11-18: **`worktree:rm` deleted work that it reported as safe.** A
  review found seven cases, each one reproduced: a stash in a submodule; a
  commit kept only by a local tag; a commit left on a detached HEAD; a
  worktree folder that was moved by hand; a submodule that was deinitialized;
  a branch that was pushed and then deleted on the remote; an ignored file
  such as a note under `research/`. It also ran `git worktree prune`, which
  deleted the submodule repos of every other worktree whose folder was absent
  at that moment. Now it checks every submodule repo that the worktree owns
  (not only the ones checked out), fetches first, reads all refs and the
  reflog, counts a commit as safe only when a remote has it or has the same
  change, and never prunes. It no longer stops for an unpushed commit on the
  umbrella branch, because that branch is kept. 13 scenarios are tested.
- 2026-11-18: **`pins:core --commit` can finish a run that stopped after a
  consumer push.** A consumer that already pinned the target core was
  skipped, and its gitlink stayed on the old commit, so `pins:check` failed
  with all pins stale. Its gitlink is now staged with the others. The
  preflight reads a consumer with no core pin at its gitlink, as `pins:check`
  does.
- 2026-11-18: `catalogs:check` reports a submodule that matches no
  `workspaces` pattern also when it is not checked out.

- 2026-10-04: Core pin advanced to `8a38f10` (`c0e0256`..`8a38f10`) and plugins
  pin to `40a787d` (`cce11fe`..`40a787d`). Prior pin commit `8f7dfe7` already
  carried Meta Responses-primary to `cce11fe` (`6123ede`). Details are in
  `minimal-agent-core/docs/CHANGELOG.md` and `minimal-agent-plugins/CHANGELOG.md`.
  - Meta Muse Spark is Responses-primary (`store:false` + encrypted reasoning),
    with `muse-spark-1.3` catalog default and `prompt_cache_key` from vendor/
    metadata then `ctx.sessionId`.
  - Sub-agent fleet tokens use last-turn contextSize (`input+cacheRead+cacheCreate`)
    instead of summing billed `input+output` per turn.
  - Quota footer keeps session id and name while shrinking bars 8→4 before
    dropping identity.
  - Prompt-cache behavior documented for Meta, OpenAI, Cursor, and Grok.
  - Built-in tools accept Cursor-shaped `path` (Read/Write/Edit) and reject
    missing or mistyped required fields before filesystem work runs.

- 2026-10-01: Core pin advanced to `c0e0256` (`37c53c4`..`c0e0256`) and plugins
  pin to `35e7c8a` (`557072f`..`35e7c8a`, 3 commits, the last one a changelog
  fix). Pin commit `54d9730` carried the first plugins step (`de3743b`). Details are in
  `minimal-agent-core/docs/CHANGELOG.md` and `minimal-agent-plugins/CHANGELOG.md`.
  - Cursor no longer writes fake tool calls as text on long sessions. Each new
    prompt used to fold the whole transcript (about 500k characters, about 160
    past tool calls) into one user text, and the model copied those records
    instead of calling tools. The plugin now keeps the server's own checkpoint
    and KV blobs and sends them back on the next fresh Run with only the new
    user text, as the official CLI does. Kill switch `MA_CURSOR_CARRY=0`.
  - Cursor calls to the GetDynamicTools bridge get the real tool list on the
    wire instead of "Unknown tool".
  - `/compact` no longer hangs on plan (OAuth) auth. Compaction now sends the
    provider's system preamble and caps transport retries at 3.
  - Checks: core `bun run check` exit 0 (arch 131 pass). Plugins
    `bun run check` exit 0 (4298 pass, 0 fail). Live: Cursor e2e 6 of 6,
    including a new carry test that makes a real tool call and recalls an
    earlier tool result from a fresh Run.
  - Known issue resolved: the plugins entry from 2026-09-28 listed "no Cursor
    `conversation_state`". That is now carried.

- 2026-09-28 (later): Plugins pin advanced to `6a6cd5c` (`0ca71a6`..`6a6cd5c`,
  15 commits, the last one a changelog layout fix). Details are in `minimal-agent-plugins/CHANGELOG.md`.
  - Cursor models now see only minimal-agent tools. With MA tools on, the plugin
    sends `x-cursor-agent-allowed-tools: mcp_tool_call,get_mcp_tools_tool_call`.
    If the server demands another tool, the plugin retries once with it allowed.
    `MA_CURSOR_TOOL_FILTER=exclude` restores the old exclude list.
  - Cursor requests without tools (context compaction, titles, summaries) no
    longer hang: they now use the bidi wire. A unique session key per tool-less
    Run and cleanup on early return prevent collisions and leaked wires.
  - Cursor model catalog refreshed to CLI 2026.09.28: 471 registered ids, and all
    246 CLI ids resolve.
  - Checks: plugins `bun run check` passes in a clean worktree (4263 pass, 0 fail,
    oxlint 1.73.0). Live: e2e suite 5 of 5, a live model and mode matrix, and a
    real `/compact`.
  - Known issues are in the plugins CHANGELOG: Cursor debug mode, no Cursor
    `conversation_state`, and no per-provider auto-compaction switch.
  - Core pin unchanged.

- 2026-09-28: Plugins pin advanced to `0ca71a6`. The Cursor provider
  no longer gets stuck after one or two prompts, and the model sees and calls
  MA tools again. There are 10 plugin commits (`b8d4623`..`0ca71a6`).
  - Main fix: answer the server's new `mcp_state_exec_args` (#36) request
    with the MA MCP tool list.
  - snake_case exclude-tools header.
  - Refreshed native-tool catalog (69 oneofs).
  - A reply for unsupported execs and `interaction_query`.
  - An error for empty streams.
  - A 30 s continuation no-progress guard.
  - Retry history keeps tool pairs.
  - Checks: plugins `bun run check` 4237 pass, 0 fail. Core check green.
  - Live: e2e tool round trip, a 3-prompt TUI session, and a forced retry.
  - Open items and Assumed behavior are listed in
    `minimal-agent-plugins/CHANGELOG.md`.
  - Known issue, not from these commits: plugins CI has been red since at
    least 2026-09-16. `bun.lock` is gitignored in the plugins repo, so a
    fresh install resolves `oxlint` `^1.73.0` to 1.86.0. With
    `oxlint-tsgolint` 0.24.0, that version panics ("unknown rule
    no-generated-empty-object-type"). A clean worktree at `0ca71a6` with
    oxlint 1.73.0 passes (4232 pass, 0 fail).
  - Core pin unchanged.

- 2026-09-15: Core pin advanced to `e378f63` — provider-scoped
  system-prompt resolution. Bare ids claimed by several providers
  (e.g. `claude-opus-5`) no longer resolve through the global
  last-write-wins map for the prompt preamble, so the Anthropic billing
  block ships and plan OAuth stops getting bare 429. Includes `542cb2b`.
  Plugins pin unchanged.

- 2026-09-10: Core pin advanced to `86e5421` — multi-mode /compact landing
  (remote|tail|local|fork modes, blocking local summary, structured 7-heading
  template). Plugins pin advanced to `9d11aab` — format fix on top of
  generic json mock type fix in opencode test (`b4d1f1c`) plus lint fix
  (`528a099`).

- 2026-09-02: Core pin advanced to `6573ec1` — Write accepts Cursor-shaped
  `contents` alias for `content` and returns a field error instead of
  `Bun.write(...): expects a Blob-y thing to write`. Plugins pin unchanged.

- 2026-08-17: Umbrella pins advanced after submodule landings that closed
  Cursor chat and CLI flag gates: core `06239c1` (`--effort` no longer
  swallows `--fast`) and plugins `a2e2d9f` (Cursor AgentService/Run CLI
  headers, exploded SKU encode, bidi KV acks + heartbeats so the TUI idles
  after a turn).

- 2026-08-14: Plugins pin advanced to `37bda5c` — full offline Cursor
  AvailableModels catalog (236 host ids, `cursor-auto` default, non-fast Grok
  SKUs) plus Grok 4.6 dual-surface registration. Core remains at `4199dbc`.

- 2026-08-13: Umbrella pins advanced after submodule landings that closed the
  dirty check gates: core `4199dbc` (editor history / session write
  capabilities + picker marker coverage) and plugins `e81c90a` (quota-status
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

- 2026-08-07 (MA-394837 delivery): **core pin** bumped `5afb5cf` →
  `4d9a0c9` (agent-loop SDK refactor enabling wave + README reframing).
  Umbrella README updated to three submodules and the future-state
  "terminal client being moved to minimal-agent-cli" framing. Plugins pin
  unchanged (`1648926`).

- 2026-08-05 (this session): GitHub Actions bump — `actions/checkout@v7` (was
  v6); monorepo CI inits submodules with retries so pin bumps that briefly race
  a sibling push do not hard-fail on `not our ref`. Install steps set `HUSKY=0`.
  Root + plugins installs stay non-frozen (`bun.lock` gitignored); core keeps
  `--frozen-lockfile`. `install:all` runs root `bun install` first so umbrella
  hooks install too. Check job also installs root deps for orchestration scripts.

### Fixed

- 2026-07-24 (this session): Bump **plugins** pin through `ea943b5` —
  `ma-env-info-plugin` host snapshot uses `placement: "afterInstructions"` so
  `cwd=` / env facts survive `--no-system-session-context`.

- 2026-07-24 (this session): Bump submodule pins for Cursor provider NetworkClient
  integration + live net-dbg proof:
  - **plugins** `228673c` — `ma-llm-cursor-plugin` AgentService/Run posts via host
    `NetworkClient` with `protocol: "h2"` (base64 req capture; raw http2/curl
    are explicit fallbacks only).
  - **core** includes `be5367c` (always-register h2 transport when fetch is
    primary) and `3352f3b` (status-line Sending request activity).
    Live proof: Julia session `cf23ea06` wrote
    `net-dbg/*-minimal-agent-cf23ea06-*` with Connect+proto to
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
core: ["5a03b28"]
plugins: ["61d1271", "33bf95a"]
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
  - id: "82d2ed3"
    summary: "workspaces.catalog for toolchain; tools/docs keeps TS6 for typedoc"
    plugins:
  - id: "741f431"
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
