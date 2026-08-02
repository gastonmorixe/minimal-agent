---
project: "minimal-agent"
title: "File mutation surfaces and plugin lifecycle hooks"
type: audit
status: snapshot
scope: monorepo
working-dir: "."
created-at: "2026-08-01T12:32:11-0400"
updated-at: "2026-08-01T12:32:11-0400"
audited-at: "2026-07-30T19:00:00-0400"
audited-by: "agent-session"
method: "codebase-grep + source-read of core tools, modes, HookBus, channel catalog, plugin manifests"
confidence: high
version-synced: "0.1.0"
tags:
  monorepo: "v0.1.0"
  core: "v0.1.0"
  plugins: "v0.1.0"
pins:
  monorepo: "3036ca3"
  core: "93a1c9a"
  plugins: "fbb7179"
remotes:
  monorepo: "https://github.com/gastonmorixe/minimal-agent"
  core: "https://github.com/gastonmorixe/minimal-agent-core"
  plugins: "https://github.com/gastonmorixe/minimal-agent-plugins"
primary-sources:
  - path: "minimal-agent-core/src/tools/tool-definitions.ts"
    role: "built-in tool schemas (Bash, Read, Write, Edit, Glob, Grep, Mode)"
  - path: "minimal-agent-core/src/tools/tools.ts"
    role: "executeTool dispatch; execBash / execWrite / execEdit"
  - path: "minimal-agent-core/src/agent/tool-round.ts"
    role: "per-tool pipeline; mode gate; tool.didInvoke emit"
  - path: "minimal-agent-core/src/modes/modes.ts"
    role: "ModeManager.isToolAllowed; CLI --tools gate; ToolPermission"
  - path: "minimal-agent-core/src/sdk/tool-filter.ts"
    role: "advertisement vs dispatch policy"
  - path: "minimal-agent-core/src/plugins/hooks/channels.ts"
    role: "channel catalog (shape, permission, intended semantics)"
  - path: "minimal-agent-core/src/plugins/hooks/hook-bus.ts"
    role: "chain / broadcast-sync / stream dispatch; halt + rewrite"
  - path: "minimal-agent-core/src/plugins/hooks/tool-lifecycle.ts"
    role: "ToolDidInvokePayload contract"
  - path: "minimal-agent-core/src/plugins/hooks/types.ts"
    role: "ChannelShape; ChainResult"
  - path: "minimal-agent-core/src/host/repl-editor-hooks.ts"
    role: "applyTurnWillStart; editor hook wiring"
  - path: "minimal-agent-core/plugin-api/src/types/plugin.ts"
    role: "ManifestHookSubscription; ManifestMode.permissions"
  - path: "minimal-agent-plugins/*/manifest.json"
    role: "plugin tools, commands, hooks, modes"
related:
  - "minimal-agent-core/docs/changes/2026-05-10-feat-file-lock.md"
  - "minimal-agent-core/docs/changes/2026-05-10-feat-memory-plugin-v0.3.md"
  - "minimal-agent-core/docs/changes/2026-06-07-feat-diagnostics-plugin.md"
  - "minimal-agent-core/docs/changes/2026-05-30-sub-agents.md"
  - "docs/versioning-and-releases.md"
findings:
  - id: F1
    summary: "Core workspace mutators are Write, Edit, and Bash; there is no Delete tool."
  - id: F2
    summary: "HookBus chain semantics support rewrite + veto; catalog declares tool.willInvoke and message.willSend for that."
  - id: F3
    summary: "tool.willInvoke and message.willSend are declared but not emitted anywhere at audit time."
  - id: F4
    summary: "Live hard tool denial is ModeManager + CLI tool filter at dispatch, not a plugin pre-exec chain."
  - id: F5
    summary: "Live rewrite/veto chains: turn.willStart (pre-run) and tool.didInvoke (post-exec augmentation only)."
gaps:
  - id: G1
    summary: "No plugin seam before Edit/Write/Bash execution (tool.willInvoke unwired)."
  - id: G2
    summary: "No plugin seam to redact/rewrite outbound LLM requests (message.willSend unwired)."
  - id: G3
    summary: "ASK mode denies Edit/Write but not Bash, BackgroundRun, Computer, or ChromeCDP."
---

# File mutation surfaces and plugin lifecycle hooks

Audit snapshot of **what can create, edit, or remove files** in minimal-agent,
and **which lifecycle mechanisms** can (or cannot yet) let a plugin **block,
rewrite, or observe** those actions and outbound network traffic.

This document consolidates research performed against the monorepo working
trees at the pin SHAs in the frontmatter. It is **descriptive**, not a design
RFC: where the catalog promises a seam that core does not emit, that is called
out as a gap.

## Verdict

1. **Fundamental workspace mutators** are the core tools **Write**, **Edit**,
   and **Bash**. There is no dedicated Delete tool; deletion/rename/move go
   through Bash (or empty overwrite via Write/Edit).
2. **Indirect / high-power mutators** exist as plugins: BackgroundRun,
   Computer, ChromeCDP, and skill-declared scripts/tools.
3. The **HookBus `chain` shape** is the intended transactional extension point
   (awaited rewrite + `{halt: true}`). It is real and used for some channels.
4. The seams most relevant to a **policy / redaction plugin** —
   `tool.willInvoke` (before tool exec) and `message.willSend` (before
   network) — are **in the catalog but not emitted** at audit time.
5. **Hard tool denial that works today** is **mode permissions** (and CLI
   `--tools` / `--no-tools`) inside `executeToolRound`, not a free-form plugin
   hook on each call.

## Part 1 — File mutation surfaces

### 1.1 Core built-in tools

Defined in `minimal-agent-core/src/tools/tool-definitions.ts`, executed by
`executeTool` in `minimal-agent-core/src/tools/tools.ts`.

| Tool | Mutates workspace? | Behavior |
| ---- | ------------------ | -------- |
| **Write** | Yes — create/overwrite | `mkdirSync` parents; `Bun.write(file_path, content)`. Overwrites existing files. |
| **Edit** | Yes — in-place replace | Exact `old_string` → `new_string`; uniqueness check unless `replace_all`. Does not create missing files. |
| **Bash** | Yes — arbitrary | `bash -c` with sticky cwd; full shell (`rm`, `mv`, `cp`, redirects, git, editors, …). Primary path for delete/rename/move. |
| **Read** | No | Read-only. |
| **Glob** | No | In-process `Bun.Glob` (no shell). |
| **Grep** | No | Content search. |
| **Mode** | No | Intercepted in the agent loop (not in `tools.ts`); reports live mode + permissions. |

`reflection-ack` is a dispatcher safety valve for confused small models; it is
not a filesystem tool.

#### Write / Edit locking

Edit and Write acquire a cooperative sibling `.locked` file via
`withFileLock` when file-lock config enables it (see
`plugin-api/src/utils/file-lock.ts` and `ma-file-lock-plugin`). Locking is
wired **inside core** `tools.ts`, not via `tool.willInvoke` — the file-lock
change doc explicitly rejected waiting on the unwired hook for v1.

### 1.2 Plugin tools that can mutate files (directly or indirectly)

Plugin tools are declared under `tuis[].trigger.type === "tool"` in each
`manifest.json`.

#### High-power / workspace-relevant

| Tool | Plugin id | Mutation path |
| ---- | --------- | ------------- |
| **BackgroundRun** (+ Status/Logs/Stop) | `ma-bg` | Same shell power as Bash, detached; also writes job logs/state under `~/.minimal-agent/sessions/<sid>.bgjobs/`. |
| **Computer** | `ma-computer-use` | Accessibility / CGEvent UI control; apps can save/delete; `screenshot` with `format: path` writes PNGs. |
| **ChromeCDP** | `ma-chrome-cdp` | Downloads (`setdownload`), `eval` / generic `send` can cause browser-side writes. |
| **Skill** (+ skill-declared tools) | `ma-skills` | Loads SKILL.md; model runs bundled scripts via Bash; skills may register dynamic tools with `handler.type: "script"` that `Bun.spawn` scripts. |

#### Agent-home / session state (disk, not the project tree)

| Surface | Plugin / owner | Typical paths |
| ------- | -------------- | ------------- |
| **MemoryTool** + `<ma::emit::memory>` | `memory` | `~/.minimal-agent/memory.md`, project memory, session scratch |
| **Task** | `tasks` | `<sid>.tasks.jsonl` |
| **CronCreate / CronDelete / CronReschedule**, `/loop`, `/schedule` | `schedule` | `<sid>.cron.json` (empty set may unlink) |
| **SpawnAgent**, **ReportResult**, **Mailbox**, … | `sub-agents` | fleet store, logs, result JSON, presence |
| **Peers / Send / Inbox** | `intercom` | presence, selfstate, inbox JSONL |
| **LockStatus** | `file-lock` | inspect locks; locks themselves created by core Edit/Write |
| **/config** | `config` | `~/.minimal-agent/config.jsonc` |
| Prompt history | `history` | project + global `history.jsonl` |
| Session store / blobs / queue | core | transcript JSONL, blobs, drafts, queue |

#### Related but not workspace editors

| Surface | Notes |
| ------- | ----- |
| **ShowDiff** / `<ma::emit::diff>` | Render only; does not apply patches. |
| **diagnostics** | After Edit/Write runs biome/tsc/oxlint in **check** mode; does **not** `--write` / auto-format on disk. |
| Fetch, WebSearch, SessionHistory, ModelInfo, Speak*, … | Read / network / TTS; not project-file mutators. |

### 1.3 Mode gate relevant to mutation

`ma-ask-mode` contributes mode `ask` with permissions that deny **Edit** and
**Write** at dispatch. It does **not** deny Bash, BackgroundRun, Computer, or
ChromeCDP. Soft guidance only for those vectors.

### 1.4 Practical summary (mutation)

| Intent | Primary mechanism |
| ------ | ----------------- |
| Create / overwrite workspace file | **Write** |
| Surgical edit | **Edit** |
| Delete / rename / move / shell side effects | **Bash** (also **BackgroundRun**) |
| Bypass structured tools | **Computer**, **ChromeCDP**, skill scripts |
| Harness state only | Memory, Task, Cron, sub-agents, intercom, config, history, sessions |

---

## Part 2 — Lifecycle, hooks, and policy seams

### 2.1 Events vs hooks

From `plugin-api` manifest docs and `src/plugins/hooks/types.ts`:

| Manifest field | Bus | Semantics |
| -------------- | --- | --------- |
| `events[]` | EventBus | Observation (“X happened”); async; cannot block the caller. |
| `hooks[]` | HookBus (or EventBus for broadcast-async channels) | Extension points; shape comes from the channel catalog, not the plugin. |

Plugins must declare `permissions: ["hooks:…"]` covering each subscribed
channel (wildcards like `hooks:turn.*` allowed). The loader drops
subscriptions that are not granted.

### 2.2 Channel shapes

| Shape | Delivery | Can rewrite / veto? |
| ----- | -------- | ------------------- |
| **`chain`** | Payload threaded high→low priority; emitter **awaits** | Yes: `{payload}`, `{halt:true}`, or both |
| **`broadcast-sync`** | Inline priority order | Shared mutable holders (e.g. `editor.key` halt); return value ignored |
| **`broadcast-async`** | Fire-and-forget | No |
| **`stream`** | Multicast `AsyncIterable` | Consume tokens; not a veto gate |

`ChainResult<T>`:

```ts
void
| { payload: T }
| { payload: T; halt: true }
| { halt: true; reason?: string }
```

Listener errors/timeouts are absorbed by HookBus (pass-through + log), so a
misbehaving plugin should not break the agent loop. Plugin priority is
clamped to `[0..100]` unless `UNSAFE_HOOKS=1`.

### 2.3 Channel catalog — intended semantics

Source of truth: `minimal-agent-core/src/plugins/hooks/channels.ts`.

#### Agent / turn / message / tool (policy-relevant)

| Channel | Shape | Wired (emitted)? | Intended capability |
| ------- | ----- | ---------------- | ------------------- |
| `agent.willStart` / `didStart` / `willStop` / `didStop` | broadcast-async | Partial / host-dependent | Lifecycle observation |
| **`turn.willStart`** | **chain** | **Yes** (REPL queue drain) | Rewrite user text for the model; `{halt}` vetoes the turn |
| `turn.didStart` / `didEnd` / `aborted` | broadcast-async | Observation | After-the-fact |
| **`message.willSend`** | **chain** | **No** | Mutate messages / system before network (redaction) |
| `message.didSend` | broadcast-async | No / unused for policy | After dispatch |
| `message.tokens` | stream | Stream path | Live token multicast |
| **`tool.willInvoke`** | **chain** | **No** | Rewrite input, swap tool, or veto **before** execute |
| **`tool.didInvoke`** | **chain** | **Yes** (`tool-round.ts`) | After tool returns; accumulate `findings` / `notes` |

#### Editor / prompt (UI and inject)

| Channel | Shape | Role |
| ------- | ----- | ---- |
| `editor.key` | broadcast-sync | Consume/rewrite keystrokes before default handling |
| `editor.buffer.*` / `footer` / `overlay.*` | sync/async | Overlays, styles, modal ownership |
| `prompt.submitted` | broadcast-async | After user submit |
| `prompt.inject` | broadcast-async | Plugin → host enqueue a turn (schedule, etc.) |
| `notification.emit` | broadcast-async | User-facing toast, not model context |
| `command.run` | broadcast-async | Dispatch slash command without buffer submit |

#### Sub-agent

| Channel | Shape | Wired? |
| ------- | ----- | ------ |
| `subagent.willSpawn` | chain | **No** (plugin uses in-process guard; catalog is aspirational) |
| `subagent.didSpawn` / `didReport` / `didExit` | broadcast-async | Plugin-emitted observation |

Historical notes: file-lock and memory change docs describe
`tool.willInvoke` / `message.willSend` as the clean long-term seams and
record that they were **not** wired when those features shipped.

### 2.4 What is actually wired for policy

#### A. Advertisement vs dispatch (not plugin hooks)

`sdk/tool-filter.ts` documents the split:

- **Advertisement** — which tools appear in the request body (`--tools` /
  `--no-tools`, SDK `ToolAdvertisementFilter`).
- **Dispatch** — after the model emits `tool_use`, refuse or run
  (`ModeManager.isToolAllowed`).

ASK mode typically keeps tools advertised (stable prompt cache) but refuses
disallowed tools at dispatch with a teaching `tool_result`.

#### B. Mode + CLI gate inside `executeToolRound`

Before Bash/Edit/Write (or plugin tools) run:

1. CLI name policy (`isToolNameAllowed`)
2. Active mode `ToolPermission[]` (first-match; `allow: true | false | "match"`
   with optional input predicate)

Denied → synthetic error content + transcript refusal; **no side effects**.

Plugins contribute modes via `manifest.modes[]` (example: `ma-ask-mode`).
User overlays may live under
`plugins.<id>.modes.<mode-id>.permissions` in config.

#### C. `turn.willStart` (rewrite / halt before `agent.run`)

`applyTurnWillStart` in `repl-editor-hooks.ts`; REPL skips the turn when
`halted`. Consumer example: `ma-intercom` expands `@peer` mentions for the
model while scrollback keeps the human form.

#### D. `tool.didInvoke` (post-exec only)

After success or failure, before render / model return. Payload contract in
`tool-lifecycle.ts`:

- Read-only facts: `tool`, `input`, `cwd`, `ok`, optional `filePath`
- Accumulators: `findings[]`, `notes[]`

The agent folds findings into TUI chrome and notes into
`<ma::agent::diagnostics>`. This **cannot undo** a completed Write/Edit/Bash.
Primary consumer: `ma-diagnostics`.

### 2.5 Pipeline (audit-time truth)

```text
user submit
  → turn.willStart [chain: rewrite / halt]     ✅ wired
  → agent.run / build request
  → (message.willSend)                         ❌ catalog only — no redaction seam
  → network send
  → model tool_use
  → CLI + mode gate                            ✅ wired (not a plugin chain)
  → (tool.willInvoke)                          ❌ catalog only — no pre-exec plugin policy
  → execute Edit / Write / Bash / plugin tool
  → tool.didInvoke [findings / notes]          ✅ wired (after the fact)
  → tool_result → model
```

### 2.6 Implications for policy / redaction plugins

| Goal | Possible at audit time? | Mechanism |
| ---- | ----------------------- | --------- |
| Block Edit/Write under a mode | Yes | Contribute `modes[]` with `permissions` (like ask-mode) |
| Hide tools from the model | Yes | CLI / SDK advertisement filter (host), not a general mid-session plugin API |
| Inspect / rewrite / veto **one** tool call before it runs | **No** | Needs `emitChain("tool.willInvoke", …)` in `executeToolRound` before execute |
| Redact / rewrite outbound messages before network | **No** | Needs `emitChain("message.willSend", …)` on the send path |
| Annotate after a file write (lint, audit note) | Yes | `tool.didInvoke` |
| Rewrite user text before the turn | Yes | `turn.willStart` |
| Soft-steer via prompt only | Yes | Prompt fragments / PROMPT.md — not enforcement |

### 2.7 Known consumers (hooks)

| Plugin | Channel | Effect |
| ------ | ------- | ------ |
| `ma-intercom` | `turn.willStart`, `editor.*` | Mention expand; UI |
| `ma-diagnostics` | `tool.didInvoke` | LSP/lint/format **check** findings + notes |
| `ma-history`, `ma-config`, `ma-usage`, `ma-slash-menu` | `editor.key` / related | UI overlays, not filesystem policy |

No first-party plugin currently subscribes to `tool.willInvoke` or
`message.willSend` (nothing to listen to until core emits them).

---

## Part 3 — Evidence notes for auditors

### How to re-verify wiring

```bash
# Must find emit sites if/when wired:
rg 'emitChain.*"tool\.willInvoke"|emitChain.*"message\.willSend"' minimal-agent-core
rg 'emitChain.*"tool\.didInvoke"|applyTurnWillStart' minimal-agent-core

# Catalog declarations:
rg 'name: "tool\.willInvoke"|name: "message\.willSend"' \
  minimal-agent-core/src/plugins/hooks/channels.ts
```

At the pins recorded in frontmatter, `tool.willInvoke` and `message.willSend`
appear in the catalog and docs/comments only; `tool.didInvoke` and
`turn.willStart` have real emit paths.

### Design intent vs implementation

- **Intent** (HookBus + catalog): plugins should be able to veto/rewrite at
  tool and message boundaries.
- **Implementation** (audit time): those two chains are unfinished; file-lock
  and diagnostics were deliberately built around core call sites /
  `tool.didInvoke` instead of waiting on pre-exec wiring.
- **Working substitute for hard tool deny**: mode `permissions` + CLI tool
  filters.

---

## Changelog of this document

| When | What |
| ---- | ---- |
| 2026-08-01 | Initial audit snapshot written under `docs/` from session research (file mutators + hooks/lifecycle). |
