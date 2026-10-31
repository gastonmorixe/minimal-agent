# Spec v3.1: minimal-agent as an ACP agent, through a plugin

v3.1 = v3 plus Amber's schema checks, the DECIDED stop rows, and the C2 deviation. Same file, same section numbers.

Author: Emma (session db09fa39). Base: Amber's spec v1 (session 17855fb3). Reviewed by Amber (R-1 to R-11) and Ronald (fd5aa0d3).
Status: DRAFT. Amber sends it to Gaston. Gaston decides ties.
Date: 2026-10-31.
Replaces: research/2026-10-31-acp-plugin-spec-v2.md.

Tags:
- VERIFIED = read in code or fetched this session. The name in brackets says who.
- UNVERIFIED = not checked.
- OPINION = a choice, not a fact.

Trees. Facts about exports depend on the tree:
- "PR5 base" = commit 4a229cb (the base of the open stream-json PR #5).
- "main" = origin/main 4b1c828 (it moved from b8d0c2d during this work: see section 10).
Each fact below names its tree when it matters.

## 1. Goal

Editors (Zed, JetBrains, others) run minimal-agent as an ACP agent. No custom glue per host.

## 2. Constraints from Gaston

- C1. Keep both. ACP and `--output-format` (text, json, stream-json) stay. No break for stream-json readers.
- C2. Share code. One neutral mapping layer. Two thin encoders on top: stream-json and ACP.
- C3. ACP is a plugin: `ma-acp-plugin` in minimal-agent-plugins. Not in core.
- C4. Target the new core only (section 4).
- C5. No external runtime dependencies (section 2a).

## 2a. Zero runtime dependencies (hard rule)

Source, VERIFIED [Emma, Amber] minimal-agent-core/AGENTS.md:29-43, "Zero runtime dependencies":
- `package.json` ships an empty `dependencies` block, by policy. The agent runs on Bun's standard library plus the repo source.
- The only devDependencies are the toolchain (Bun types, Biome, oxlint, typedoc, TypeScript, Husky, Commitlint). Lines 33-35.
- Lines 39-40: "Before reaching for a package, write the small piece you need as a readable file with a test."

Enforcement, VERIFIED [Emma, Amber]: src/architecture/public-api.test.ts:55-59 expects `dependencies` to equal `{}`, and `peerDependencies` and `optionalDependencies` to be undefined. It guards core only.

Plugins, VERIFIED [Emma, Amber, Ronald]:
- AGENTS.md:42-43 says "The extended-plugins repo follows the same policy: every plugin is zero-dependency." That text names the extended-plugins repo. It does not name minimal-agent-plugins.
- minimal-agent-plugins has no policy text (a search of its AGENTS.md for "dependenc" and "zero" finds nothing).
- Its root package.json has one `dependencies` entry: `@minimal-agent/core` (a git pin). `ma-prompts-plugin` also depends on `ma-autocomplete-kit` as `workspace:*`. The other 50 `ma-*` packages have no `dependencies` block. Both kinds are first-party.
- I found no test in plugins that enforces the rule (I read scripts/check.ts and scripts/typecheck.ts by search only).
- minimal-agent-cli has the same git pin on core.
- So the real rule is: no third-party runtime dependency. `ma-acp-plugin` declares none. It may import `@minimal-agent/core` through the root pin. OPEN for Gaston: confirm that the core pin is allowed. It is the existing pattern.

Consequences:
- Do NOT ship `@agentclientprotocol/sdk`. Hand-roll on Bun built-ins, in readable files with tests:
  - NDJSON framer (one JSON object per line, UTF-8, no embedded newline).
  - JSON-RPC 2.0 dispatcher: request, response, notification.
  - Error codes -32700, -32600, -32601, -32602, -32603.
  - Id correlation for agent-to-client requests (session/request_permission, later fs/* and terminal/*).
  - A maximum message size guard.
  - Own minimal ACP v1 types, only for the methods we support. Cite the schema page in comments.
- Conformance: a spawn test with a hand-written client.
- The official SDK is a manual cross-check in untracked scratch only. A test-only devDependency on it is NOT in the toolchain list (AGENTS.md:33-35). OPINION (Emma, Amber, Ronald): no. OPEN for Gaston.
- The shared mapper and any new code use Bun and Node built-ins only.

## 3. Background (sources)

- ACP is JSON-RPC between a client (editor) and an agent (subprocess).
- Transport, VERIFIED [Emma] (https://agentclientprotocol.com/protocol/v1/transports): stdio only. The client starts the agent as a subprocess. Messages are UTF-8 JSON-RPC, split by newline, with no embedded newline. The agent MUST NOT write anything to stdout that is not a valid ACP message. The agent MAY write logs to stderr. Streamable HTTP is only an RFD.
- Turn flow, VERIFIED [Amber] (https://agentclientprotocol.com/protocol/v1/prompt-turn, /tool-calls, /initialization): initialize, session/new, session/prompt, session/update notifications, session/cancel, stopReason on the prompt response. I did not re-read these pages.
- Schema (https://agentclientprotocol.com/protocol/v1/schema): VERIFIED [Amber, from schema.json in the SDK 2.2.0 package, scratch copy deleted] and VERIFIED [Emma, HTML page] for `ToolKind`, `ToolCallStatus`, `PermissionOptionKind`, and `usage_update` (`used`, `size`, optional `cost`; the notice update only with the client `notices` capability). The schema has 178 definitions. We write only the subset we use. Not read by me: the `StopReason` list (Amber: end_turn, max_tokens, max_turn_requests, refusal, cancelled) and the full `SessionUpdate` variant list.
- `_meta` is reserved for extension, type object or null. "Implementations MUST NOT make assumptions about values at these keys." [Amber schema.json:287, Emma HTML]. Our `_meta` keys are prefixed. A client may ignore them.
- ACP v1 has no per-event timestamp and no sequence number [Amber]. The only date key is `updatedAt` on session info, ISO 8601 [Amber, Emma HTML]. Our stream-json `ts` and `seq` have no ACP counterpart. Carry them in `_meta` only if needed.
- TypeScript library, VERIFIED [Emma] (https://agentclientprotocol.com/libraries/typescript): `@agentclientprotocol/sdk`, fluent `agent()` API. NOT USED at runtime (section 2a). Gemini CLI (`packages/cli/src/acp`) is the named production example, useful as a behavior reference.
- Pin ACP v1. v2 is a draft. VERIFIED [Emma] on the docs index.

## 4. Which core (answer to C4 and Q6)

VERIFIED [Emma, Ronald] in minimal-agent-core/AGENTS.md:242-245:
- `InteractiveSession` (src/host/interactive-session.ts) over `AgentCore` is "the one agent loop".
- "The legacy `Agent` class is gone."

VERIFIED [Emma] AGENTS.md:203-204: `src/llm/adapter-legacy.ts` converts older `SendOptions` and `StreamedResponse` shapes. It is a shape bridge. The plugin must not import it.

VERIFIED [Ronald]: other legacy remnants exist but are not loops: per-run callbacks in sdk/host-ports.ts:12-14 "until S37 removes them", and `label` on item_started until S37. I found no migration-manifest.json statement that names a legacy loop.

VERIFIED [Emma]: src/agent/ has helpers only (no class). The folder name is not a sign of a second loop.

Target for the plugin: the runtime `Session` (`createRuntime`, `openSession`, `session.run` yields `SessionEntry`). It wraps `AgentCore`. The public package exports it (the root export "." resolves to src/sdk/runtime.ts). Do not build `AgentCore` by hand in the plugin.

UNVERIFIED: a full list of other legacy paths. Ask Gaston.

## 5. Architecture

```
AgentEvent / SessionEntry   (core, sdk)
        |
  shared mapper             (core, sdk, exported)  -> neutral wire event
      /          \
stream-json     ACP encoder (in ma-acp-plugin)
encoder (core)  session/update, JSON-RPC
```

Rules:
- DEVIATION from C2 (Q15, needs Gaston OK): stream-json = `AgentEvent` plus envelope, unchanged. ACP = shared pure helpers plus its own encoder. The diagram above shows the original C2 intent.
- The neutral wire event carries neutral names. ACP field names stay in the plugin encoder.
- One place derives the tool title, the stop-reason map, and usage. The tool `kind` is derived in the plugin from `toolName` (section 6), because core's `tool_call` has no kind (VERIFIED [Ronald]: ToolCallEvent has callId, toolName, input, inputSummary).
- The stream-json bytes must not change. The net: run-non-interactive.test.ts, tool-turn-golden.test.ts, events-jsonl.integration.test.ts, output-format-g3.e2e.test.ts. No golden edit.
- Start the mapper AFTER PR #5 merges. PR #5 changes the same files. Ronald owns events.ts, run-non-interactive.ts, stream-json-writer.ts, and index.ts until the merge.
- The mapper lives in core/sdk. plugin-api re-exports types only. OPINION.
- Export freeze, VERIFIED [Emma, Amber] src/architecture/public-api.test.ts:61-62: the export list is frozen by subpath, from `src/architecture/public-exports.json`. A new subpath needs TWO edits in the same commit: the `exports` map in package.json AND `src/architecture/public-exports.json` (the test compares them). It also needs Gaston's OK. A symbol re-exported from an existing subpath (for example the mapper from `./sdk/events`) needs no list edit. UNVERIFIED: that the arch test accepts a re-export (Ronald runs test:arch).
- The plugin imports only public exports.
- main (4b1c828), VERIFIED [Emma, Amber]: 12 `./sdk/*` exports, 45 `./host/*` exports (14 at b8d0c2d), and a new `./host-kit/*` set (section 10). The first 14 `./host/*` names (at b8d0c2d) were: auth-store, auth-strategies, auth, oauth-login, error-hint, list-models, model-label, model-registry, provider-session, system-prompt-overrides, config, effort-resolution, network, cache-ttl. All point into `src/host-public/`. VERIFIED [Emma, `git show origin/main:package.json`]: the `./host-kit/*` set includes build-agent-core, lifecycle-port-adapter, tool-executor-adapter, tool-registry-adapter, mode-provider-adapter, session-persistence-adapter, plugin-loader, command-registry, modes, hooks, plugin-stream, session-store, blob-store, file-tracking-store, and more. `./host/provider-discovery-boot` also exists. `./host-kit/build-agent-core` is `export *` of src/host/sdk-adapters/build-agent-core.ts (VERIFIED [Emma]: `buildAgentCore`, `openAgentCoreSession`, `BuildAgentCoreDeps`, `toEffort`). Still no single boot function: the boot composition is in index.ts main().
- PR5 base (4a229cb), VERIFIED [Ronald, Amber]: export targets must sit under `src/sdk` or `plugin-api/src` (public-api.test.ts:65-69). No `./host/*` exports. The PR #5 rebase brings main's wider rule.

## 6. Mapping (AgentEvent to ACP)

Conditions, VERIFIED [Emma] in src/sdk/events.ts:
- `text_delta` and `thinking_delta` exist only when `session.run` gets `emitDeltas: true`.
- `tool_call` and `tool_output` exist only when the sink lists them in `kinds`. On the Session route, check `ALL_EVENT_KINDS` (runtime/session.ts:151).
- `tool_output` is cut at 16 KiB (`TOOL_OUTPUT_TEXT_CAP`). So `rawOutput` is lossy. The full output is in the `tool_result` path or the blob store. UNVERIFIED which one.

| Source | ACP update | Note |
|---|---|---|
| text_delta | agent_message_chunk | needs emitDeltas |
| thinking_delta | agent_thought_chunk | needs emitDeltas. Never send the signature (VERIFIED [Emma]: agent-core-helpers.ts never reads it) |
| tool_call | tool_call (status pending, then in_progress) | derive `kind` and `title` |
| tool_result ok | tool_call_update, status completed | output is capped |
| tool_result error | tool_call_update, status failed | |
| tool denied by the gate | tool_call_update, status failed, with a short text | core has no denial signal. A hook deny comes back as a `tool_result` with `isError` (tool-round.ts:516). The neutral type has no `denied` status. Map a denial to `failed` |
| item_started, item_completed | none (internal) | built AFTER the response ends, from final blocks (agent-core.ts:550). They arrive after all deltas of that turn. The ACP encoder must not wait for them to start streaming |
| EventUsage | usage_update | tokens only. See limits below |
| ask_user | session/request_permission | partial, see section 8 |
| Task tool | plan | UNVERIFIED how task changes reach events |

ACP tool-call `status` has four values: pending, in_progress, completed, failed. VERIFIED [Amber] on the tool-calls page.

Core notice to ACP `notice`, VERIFIED [Olivia, Amber schema.json; Emma re-read turn-notice.ts:38-44 and the schema HTML]:
- Core severity is `"error" | "warn" | "info"` (agent/turn-notice.ts, `NoticeSeverity`).
- ACP `NoticeSeverity` is `info`, `warning`, `error`, or a custom value that starts with `_`. Other unknown values are reserved for future ACP severities.
- So the plugin MUST map `warn` to `warning`. Sending `"warn"` raw is invalid. Add a unit test for each value (error, warn, info).
- `title` is required, plain text, and not empty (min length 1). Build it from the notice kind. Add a test that no notice leaves the plugin with an empty title.
- A notice is sent only if the client advertised the `notices` capability. Otherwise use an `agent_message_chunk` fallback for the ones that matter (section 7), and drop the rest.

Limits, so nobody expects more than core gives (VERIFIED [Ronald, report R3]):
- `usage_update` needs `used` and `size`. VERIFIED [Amber, Emma HTML]: `used` is "Tokens currently in context". `size` is "Total context window size in tokens". `cost` is optional ("Cumulative session cost").
  - `used` is the CURRENT context, not a sum over turns. PROXY [Ronald, Amber]: the LAST turn's `inputTokens + cacheReadTokens + cacheCreationTokens` (events.ts:43). That is the full prompt the model saw. Never a sum across turns (same rule as core's fleet-token-count). Label it a proxy in the plugin docs.
  - `size` comes from `ctx.queryModelInfo` `contextWindow` (types/plugin.ts:142).
  - `cost` is left out (core has none).
- Core has no cost (pricing is host-side, quota/usage-stats.ts:38) and no served-model field.
- `quota` is never emitted.
- Core defines no tool kind. `ToolDefinition` has name, description, input_schema only (sdk/ports.ts:56).

Tool `kind` draft table, OPINION. VERIFIED [Emma]: core defines only Bash, Read, Write, Edit, Glob, Grep (src/tools/tool-definitions.ts). The others come from plugins.

| Tool | ACP kind |
|---|---|
| Read | read |
| Write, Edit | edit |
| Bash | execute |
| Grep, Glob | search |
| Fetch, WebSearch | fetch |
| Task | think (or plan) |
| Skill, sub-agent tools, unknown | other |

ACP kinds: read, edit, delete, move, search, execute, think, fetch, switch_mode, other. VERIFIED [Amber].

## 7. Stop reason map

VERIFIED [Emma] `TurnOutcome` at src/sdk/stop-policy.ts:46: completed, truncated, failed, aborted, waiting. There is no round cap (line 45).

`truncated` has two reasons: `max_tokens` (row 4, line 84) and `interrupted_text` (row 6, line 86). The loop continues on its own before it ends a turn as truncated. VERIFIED [Emma]: `MAX_TOKENS_CONTINUATION_CAP = 5` (stop-policy.ts:41) and `MAX_INTERRUPTED_TURN_CONTINUATIONS = 1` (stop-policy.ts:43). So `truncated` is rare.

| Outcome | ACP result |
|---|---|
| completed, `turn_completed.stopReason` is refusal or content_filter | refusal |
| completed, any other stop reason | end_turn |
| truncated, notice max_tokens_capped | max_tokens |
| truncated, notice stream_interrupted_capped | end_turn, plus an ACP `notice` (only with client capability, else an agent_message_chunk fallback), plus `_meta: { "minimal-agent/reason": "interrupted_text" }` |
| aborted | cancelled (never a JSON-RPC error) |
| failed | JSON-RPC error |
| waiting | JSON-RPC error (the run paused after a permanent error). Send the error text first as a notice or agent_message_chunk, so the editor keeps and explains the partial reply |
| any | never max_turn_requests |

Failed rows follow the same rule: send the error text first, then answer the prompt with the JSON-RPC error.

DECIDED [Amber, Ronald, Emma agrees; table in research/2026-10-31-wire-event-mapper-design.md section 4a]. Provider stop reasons that end as outcome `completed` (row 13):

| Provider stop reason | ACP result |
|---|---|
| refusal, content_filter | refusal |
| pause_turn | end_turn, plus notice, plus `_meta` with the original stop reason |
| context_window_exceeded | max_tokens, plus notice "context window full", plus `_meta`. LOSSY: say so in the notice |
| error (on a completed turn) | end_turn, plus notice, plus `_meta` |

Evidence for the `error` row [Amber, Ronald]: the OpenAI-family and Anthropic adapters set stopReason "error" together with a stream error that the host throws (ma-llm-openai-plugin/responses/response-stream.ts:405-415, anthropic-stream.ts:267-276). So real errors arrive as `waiting` or `failed`, not as a completed turn. I did not re-read those files.

Reason for the interrupted_text choice [Amber]: ACP has max_tokens only for token limits. `interrupted_text` is a transport cut. A wrong max_tokens would mislead the editor.

Source of the stop reason, VERIFIED [Amber, Ronald; I re-read agent-core.ts:917-941]:
- `run_finished` has only `{type, outcome}` (events.ts:290-292). It has no `reason`.
- The reason reaches the stream as a notice, emitted just before the turn ends: `max_tokens_capped` for max_tokens, `stream_interrupted_capped` for interrupted_text (agent-core.ts:919-927). The mapper tells the two apart by the notice kind. No core change.
- CATCH: on `truncated` the loop does `break rounds` (line 929) before the natural-exit path that calls `emitTurnCompleted` (line 940). So a truncated turn emits NO `turn_completed`. Ronald confirms the Session route adds none. Rule: take the ACP stop reason from the run outcome plus the last notice, never from `turn_completed` alone.
- A client may drop a notice. The correctness part is the stop reason itself. The notice is extra.

Refusal path, VERIFIED [Amber, Emma]:
- agent-core.ts:899-900: after each response the loop calls `detectStopNotice(stopReason, stopDetails)` and emits the notice (kinds refusal, content_filter; agent/turn-notice.ts:155). It is a pure projection with no retry.
- stop-policy.ts:170-172, row 13: "Other stop reasons with no tool call (refusal, pause_turn, none) settle the same way". The row returns `stop` with outcome `completed`.
- So a provider refusal ends as outcome `completed`, and the natural exit emits `turn_completed` with `stopReason` "refusal" or "content_filter". The ACP layer reads `turn_completed.stopReason` first, and uses the notice only for the message text.
- `pause_turn` also ends as `completed` (row 13). See the DECIDED table above.

## 8. Approval gate

VERIFIED [Emma] docs/hooks.md and src/sdk/lifecycle.ts:
- Order: CLI tools and mode permissions (hard deny), then `tool.permissionChecked` (observe), then `tool.willInvoke` (chain), then execute.
- Hooks can deny or rewrite. They cannot allow what the mode refused. Silence is not allow.
- `LifecyclePort.beforeTool` returns `Promise<PolicyDecision<...>>` (lifecycle.ts:200).

VERIFIED [Amber, Ronald; tool-round.ts:430 and 494-526]:
- `modeManager.isToolAllowed` runs first (line 430, hard deny). Then `await lifecycle.beforeTool` (line 503).
- A hook decision of `deny` or `ask` is a refusal with the reason (line 516). `ask` is NOT a way to reach the client. An `allow` return proceeds.
- `HookBus.emitChain` is async and awaits each listener in priority order, with an optional per-listener `timeoutMs` (hook-bus.ts:148-189).
- Result: a plugin chain hook can await the ACP client's `session/request_permission`, then return allow, or return deny with a reason. No core change. (Ronald withdrew his earlier line that core work is needed.)
- The hook must run inside the host, in the same module as the ACP connection. This works under option A. It does not work under C unless the boot also loads plugin hooks.

RISK, VERIFIED [Ronald, Emma; main b8d0c2d, and the same files are unchanged on 4b1c828 (git diff empty)]: chain hooks fail open. See section 16.
- A listener that throws, or whose `withTimeout` rejects, is reported and skipped with `continue` (hook-bus.ts:157-168). The chain goes on. With no other listener, the result is allow.
- With no listeners, or on any throw, the adapter returns `allowDecision` (lifecycle-port-adapter.ts:131-141).
- So the per-listener `timeoutMs` also falls back to allow. This answers the earlier open question.
- Plugin-side rules until core changes: set no `timeoutMs` on the gate listener, keep an own deadline inside the hook, catch every error in the hook, and return `deny` on any error, timeout, or unknown outcome. Test: the client never answers, the own deadline fires, the tool does not run.

Host-only lifecycle, VERIFIED [Ronald]:
- `sessionStart`, `sessionEnd`, `cwdDidChange`, `instructionsDidLoad` are called only from src/index.ts (:632-642, :1024, :1186, :1249).
- `turn.willStart` is applied by the host (run-non-interactive.ts:265), not by AgentCore.
- A custom host gets none of them unless it calls them. The hostModes contract must say that the host calls them around each ACP prompt.

Limits that remain:
- A policy that returns `ask` still shows as deny. The ACP hook must not rely on core's `ask`.
- With no `askUser` port, an ask is denied and an `ask_denied` notice is emitted. The Session default is `PendingAskRegistry` plus `session.answer` (runtime/session.ts:100-111, 135-140).
- `AskUserOption` (events.ts:296-314) has `id`, `label`, `description`, `isDefault`, `destructive`. It is a question model for preflight, not a per-tool approval.

Rules from the ACP tool-calls page, VERIFIED [Amber]:
- The agent owns remembered decisions. "always" is stored by the plugin, with its scope. `kind` is only a UI hint.
- Do not treat an unrecognized outcome as approval.
- Ask again if the command or the resolved target changes.
- State the scope in the option `name`.
- Do not switch to a mode that reduces oversight without user action.
- If the turn is cancelled, the client answers the pending request with outcome "cancelled". The hook treats "cancelled" as DENY. The tool does not run.

Options sent to the client: allow_once, allow_always, reject_once, reject_always. Any error, timeout, or unknown outcome returns deny.

First test of Phase 2 (closes P2 and P4): in the acp host, register a `tool.willInvoke` hook that waits 3 seconds, then denies. Assert that the tool does not run and the model sees the denial.

## 9. Gaps and status

- G1 JSON-RPC on stdin: hand-rolled on Bun built-ins (section 2a). Open: P1.
- G2 many sessions in one process: SMALLER. VERIFIED [Emma, Amber] runtime/runtime.ts:111-118: one runtime holds a `Map` of sessions and throws on a duplicate id. The plugin keeps `sessionId -> Session` over one `createRuntime`.
- G3 approval gate: section 8.
- G4 slash commands: SMALLER. Amber found a host-owned registry (`getCommands`, `listCommandInfo`, `dispatchCommand`). UNVERIFIED by me. ACP `available_commands_update` can read it.
- G5 quota, status, jobs, sub-agents: send as `_meta` or as `notice`, only with client capability.
- G6 MCP: VERIFIED [Emma] no MCP client in core (a search of src, no tests, finds "mcp" only in auth/auth.ts). Plugins: not ruled out (not read). Advertise no MCP capability. Ignore `mcpServers` in `session/new`.
- P1 no way for a plugin to own a run mode. VERIFIED [Emma, Amber, Ronald]: no subcommand, bin, or run-mode contribution exists. The manifest contributions are prompt, setup, promptFragments, tuis, modes, events, hooks, liveAreaSlots, commands, permissions, capabilities, platforms, requiresUnsafeHooks, enabled (types/plugin.ts:443-626).
- P2 hooks in a non-TUI host: tool, send, and batch hooks fire on the Session route (VERIFIED [Ronald]: build-agent-core.ts:221-222, 352-353 wire `createLifecyclePort(loader.hooks())`). Host-only hooks: see section 8.

## 10. P1 options (how ACP gets stdin and stdout)

- A. New manifest contribution `hostModes: [{ id, flag or subcommand, entry }]`. The host runs the plugin entry after full boot. Cost: plugin-api grows (a public contract change), a dispatch slot in the host, Gaston's OK.
- B. The plugin ships its own bin that links core as a library, with no shared boot. NOT RULED OUT ANY MORE on main 4b1c828, but worse than A. History: it was ruled out on b8d0c2d and on the PR5 base, where `openAgentCoreSession` and the host adapters were not exported (VERIFIED [Emma, Ronald, Amber]). Amber found that main moved. VERIFIED [Emma, git show origin/main]: main 4b1c828 now exports them through `./host-kit/build-agent-core` (`buildAgentCore`, `openAgentCoreSession`, `BuildAgentCoreDeps`, `toEffort`), `./host-kit/plugin-loader`, `./host-kit/session-store`, `./host-kit/hooks`, the adapters, and `./host/provider-discovery-boot`. The `host-kit` comment says it is "narrower audience than `./host/*`, not for the web host" (src/host-public/build-agent-core.ts).
  - What B still lacks. VERIFIED [Emma, `git show origin/main:src/host/sdk-adapters/build-agent-core.ts`, interface `BuildAgentCoreDeps`]: it still REQUIRES `auth`, `model`, `loader` (or null), `modeManager` (or null), `store` (or null), `blobStore` (or null), `saveEcho`, and `turnAttachments`. The S34 "PORT fold" (commit 6d2ed87) made it do more: the new optional `turnAttachmentContext` lets it build the turn attachments and `saveEcho` itself, `compactSource` has a default, and `wireModelInfoSource` wires the model-info tool to the live model. These are additive. The big pieces (auth, model choice, loader, modeManager, stores) are still composed in index.ts main() (:358, :570, :952), and no public function does that. A bin would copy it and drift from the CLI. The gap is smaller than at b8d0c2d, so re-check it at each pin bump.
  - A bin is not the host, so it loses the host-only lifecycle hooks (`sessionStart`, `sessionEnd`, `cwdDidChange`, `instructionsDidLoad`, `turn.willStart`, section 8) unless it calls them itself.
  - A plugin repo pin is older than these exports. VERIFIED [Emma, git merge-base]: the plugins pin 57181d54 is an ancestor of main, and df9e9f8 (the commit that adds the `./host/*` session/quota/media/tools cluster) is NOT in it. So a plugin needs a pin bump before it can import host-kit.
  - A plugin that calls `createRuntime().openSession` itself (root export, src/runtime/index.ts:69-73) still gets a bare Session. The default tool executor is `NO_TOOLS_EXECUTOR`.
- C. Extract a public `bootHost(opts)` from `index.ts main()`. The CLI and a plugin bin both use it. Costs:
  - A large `index.ts` move, only after PR #5 merges.
  - On main, `src/host-public/` is a legal home (VERIFIED [Amber]: main allows `src/host-public`). CORRECTION [Amber, Emma re-read six files with `git show origin/main`]: the host-public files I checked (build-agent-core, hooks, lifecycle-port-adapter, plugin-loader, provider-discovery-boot, session-store) are each ONE line, `export * from "<internal module>"`. They re-export code that already exists. A `boot.ts` there would be a NEW function with real logic, extracted from index.ts main(). So the host-kit set is a precedent for the location and the export mechanism only, NOT for the size of the work. The extraction stays a large step. It needs both edits (package.json exports and public-exports.json) and Gaston's OK. On the PR5 base it cannot (targets must sit under `src/sdk` or `plugin-api/src`).
  - It must return the `PluginLoader`, so the bin can use commands, modes, and hooks. A bin is not loaded by the plugin loader.
  - It needs a `headless` option. `main()` also does TUI-only boot, such as the ready banner at index.ts:1054 [Ronald].
  - The approval gate hook must still run inside the process that has the ACP connection. That means the bin must load plugin hooks itself.
- D. (fallback) ACP lives in minimal-agent-cli, not as a plugin. It conflicts with C3. Use it only if Gaston drops C3.

Cost table:

| Option | Cost |
|---|---|
| A | New manifest field plus a host dispatch slot, PLUS a per-session open path in the host (see "Single-session boot" below). plugin-api contract change. Gaston OK. Cost UP, unmeasured |
| C | New `./host/boot` export plus a large extraction from index.ts main(), after PR #5. Gaston OK. Has the same single-session problem. Cost UP, unmeasured |
| B | Possible on main 4b1c828, but copies the index.ts boot and loses the host-only hooks. Plugin pin bump needed. Same single-session problem |

Single-session boot, found by Amber, VERIFIED by Emma (`git show origin/main:src/index.ts | sed -n 952,1046p`, and session-store-boot.ts). `main()` builds ONE conversation through process-global state:
- `bootSessionStores({ sid, resumeSid, ... })` (line 952) takes one session id. For a new session it opens `SessionStore.open(getSessionId())` (the per-process id). For a resume it calls `SessionStore.fork` and copies the `<sid>.*` sidecar files (session-store-boot.ts comments, lines 85-107). So it writes files. Whether it can run once per ACP session is OPEN: I read its comments and call list, not its full body.
- `InteractiveSession.create({... initialMessages, store, blobStore ...})` (line ~1001) builds the single global `agent`.
- `hostLifecycle.sessionStart({ sid: getSessionId(), ... })` (line ~1033) uses the process-global id.
- `registerCompactHostCommand(loader, agent)` and `registerContinueHostCommand` close over that ONE agent (lines ~1038-1040).
- `getLiveModelId = () => agent.getModel()` (lines 568 and 1037) is a rebinding of one variable. The model-info tool (line 585) reads it. With many sessions, the tool would report the model of the wrong session.
So ACP needs MANY sessions in one process, and the code after line 952 assumes one. The host-mode branch must sit BEFORE `InteractiveSession.create`, and the host must give the plugin an `openSession` that redoes the per-session part of this block for each ACP session, using the exported pieces (`openAgentCoreSession`, `Session`, the host-kit stores). That is a bigger change than "one branch before the banner". It also touches model switching (Q16): `getLiveModelId` must be per session.
Cost: UP, UNMEASURED. Nobody has estimated it. A fallback that avoids it: one process per ACP session (the editor starts one `minimal-agent --host-mode acp` per session). ACP allows an editor to start a process per agent, but a client that expects `session/new` many times in one process (Q4, section 9) would need many processes. UNVERIFIED how Zed and JetBrains behave. Gaston decides, with the cost known.

Votes: Emma A, Ronald A (changed from C after the export-rule fact), Amber A (changed from C after the hook-gate fact). Unanimous. Gaston decides.

Why A wins (VERIFIED facts):
- The gate hook and the host-only lifecycle hooks run inside the host (section 8). Under B, the bin would call them itself.
- No plugin pin bump is needed for A to start (the plugin runs inside the host that already has these modules).
- `ctx.queryModelInfo` (contextWindow, pricing) is available there (types/plugin.ts:142,160).
- No `index.ts` extraction is needed.

Conditions for A:
1. `hostModes` runs after full boot, so it gets loader, tools, lifecycle, modes, and ctx.
2. The host owns the stdout and stderr rules for the mode (section 11).
3. The host calls the host-only lifecycle hooks (section 8) around each ACP prompt.
4. A new manifest field is a public contract change. It needs a spec in the plugin-api docs and Gaston's OK.
5. Subcommands are a hard-coded switch today (`runStartupSubcommand`, host/startup/run-subcommand.ts:65-215 [Ronald]). The `hostModes` entry either adds a dispatch slot there, or a flag in the argv parser (host/cli/command-plan.ts, UNVERIFIED). Pick one and name it in the contract.

## 10a. hostModes contract sketch (OPINION)

Detailed draft: research/2026-10-31-hostmodes-contract-draft.md [Amber]. It names the dispatch slot (a flag `--host-mode <id>`, one branch in main() after full boot) and says the HOST calls the host-only hooks. Facts VERIFIED [Emma, git show origin/main:src/index.ts]: plugins load at line 570, the subcommand switch runs earlier at line 261, `extractPrompt` is at line 1130.
SLOT CORRECTION [Ronald, Amber; Emma re-read lines 1040-1092]: "before `extractPrompt`" is TOO LATE. `main()` writes to STDOUT before line 1130 whenever there is no prompt: the ready banner (`process.stdout.write(buildReadyBanner(...))` when `promptSource.kind === "none"`, about lines 1050-1054) and the resume header (about lines 1078-1090). A host mode has no prompt, so both would print on the ACP stdout. The branch must sit AFTER `bootSessionStores` (line 952) and BEFORE the banner (about line 1050). Also: the banner and the resume header can be skipped with a host-mode check, but the safer rule is the branch position. Per-session cwd is not supported (tool-round.ts uses `process.cwd()`, no `chdir` in non-test code): Level 1 returns an error for a second session with another cwd. Open for Gaston: a `hostMode:stdio` permission token plus user opt-in (team vote: yes).

A plugin that builds a Session itself would be the first plugin to import core's root (0 hits today [Ronald]). Under A the host passes what the entry needs.

The entry receives:

```
{
  argv,            // parsed args after the mode flag
  stdin, stdout, stderr,   // the host owns the rules, the entry owns the bytes
  abort,           // AbortSignal for process shutdown
  cwd, env,
  runtime or openSession,  // a ready session factory (the one index.ts uses)
  loader,          // commands, modes, hooks
  modeManager,
  lifecycle,       // the same port the CLI uses, plus host-only hook callers
  queryModelInfo,  // contextWindow, pricing
  log,             // writes to stderr
  listModels,      // () => registered models of the current provider (model-registry.ts:242) [Olivia]
  modelInfo,       // (modelId) => contextWindow, pricing, effort {levels, default}
  setModel,        // (modelId) => the checked setter (section 10b)
  setEffort,       // (effort) => the checked setter (section 10b)
}
```

The host guarantees:
- Boot is done (provider, auth, plugins, tools, modes).
- Hooks are wired. Host-only hooks are called around each prompt.
- Nothing else writes to stdout.

The entry returns a promise. Its resolution ends the process with exit code 0. A rejection ends it with 1.

## 10b. Model and effort switching (REQUIRED by Gaston, via Olivia a982c935)

Gaston's order: model switching and effort switching are part of the ACP work. They are not optional. Implement and test them.

ACP side, VERIFIED [Emma, https://agentclientprotocol.com/protocol/v1/session-config-options]:
- `session/new` MAY return `configOptions`. Each option has `id`, `name`, `type` ("select"; "boolean" only if the client advertises `session.configOptions.boolean`), `currentValue`, and `options` (value, name, description). Optional `category`: `mode`, `model`, `model_config`, `thought_level`. Categories are UX hints only and must not be needed for correctness. Names that start with `_` are free for custom use.
- The client may call `session/set_config_option {sessionId, configId, value}` at ANY time, idle or mid-generation.
- The agent MUST reply with the COMPLETE list of options and current values. This is how it reports dependent changes (for example, a new model changes the reasoning options).
- The agent MAY push `session/update` with `sessionUpdate: "config_option_update"` (full state), for example after a fallback to another model.
- `configOptions` supersede `modes`. During the transition, send both and keep them in sync.
- The order of the array is the agent's priority. `currentValue` must always be usable, even if the client ignores the option.

Core side, VERIFIED [Olivia, Emma re-read]:
- `AgentCore.setModel(model)` (agent-core.ts:243-245) only assigns `this.model`. No registry check. No effort re-check.
- `AgentCore.getModel()` exists (line 239). `effort` is `private` (line 152), assigned only in the constructor (line 221), and read per request (line 503). There is no `setEffort` or `getEffort`.
- Callers of `setModel` (non-test): src/host/repl.ts:714 (the error-recovery picker) and src/host/interactive-session.ts:287. No `/model` command exists in the CLI.
- THIRD model-change path, VERIFIED [Olivia, Ronald; Emma re-read agent-core.ts:457-462 and preflight-pipeline.ts:112-127]: `runPreflight` does `if (result.adoptModelId) this.model = result.adoptModelId`. A preflight issue can make the core change the model on its own, with the same missing effort check. For ACP this is the case where the model changes while the client did not ask. The plugin must send `config_option_update` when it happens. The change must go through the validated setter, with a test.
- `validateEffortForModel(effort, modelEffortLevels)` (src/config/effort-resolution.ts:92) is pure. `undefined` always passes. A model with no levels rejects any explicit effort. A level outside the list is rejected.
- `Session.agentCore()` (runtime/session.ts:292) is an escape hatch to the core. It is a host operation.
- BUG RISK: after `setModel`, the old effort is still sent even when the new model does not support it.

Additional risks, found by Emma (UNVERIFIED, to check before coding):
1. Prompt cache and history. A model switch changes the request prefix. Thinking blocks and signatures from one model may be rejected by another provider. Check what the history repair code does on a model change (src/agent/history-repair.ts) before the switch is allowed mid-session.
2. Provider switch. A model on another provider needs another auth and another adapter. `setModel` only changes the id. Decide: allow only models of the same provider in `configOptions`, or define the provider switch. OPINION: same provider only at Level 1.
3. Where the model list comes from. Use the model registry (host `./host/model-registry` export on main). The plugin must list only models the current credentials can use. UNVERIFIED how to know that.
4. Mid-turn change. The change applies from the next MODEL REQUEST [Olivia]. That can be inside the same turn, after a tool round. It is not "next turn". Write this in the docs. An in-flight request keeps its model and effort. VERIFIED [Emma, agent-core.ts:495 and 503]: `sendFn` gets `model: this.model` (line 495) and `buildOutputConfig({ effort: this.effort ... })` (line 503) inside ONE object literal, built synchronously. JavaScript runs that without a pause, so a request cannot mix the old model with the new effort, as long as `setModel` and `setEffort` are called as ONE step (see the setter rule below) and not between two awaits.
5. `Session.agentCore()` is a host escape hatch. A plugin cannot call it unless the hostModes context passes the Session or a switch function. Add `setModel` and `setEffort` to the hostModes context (section 10a) instead of exposing AgentCore.
6. Display name. The registry id differs from a human label. Use `model-label` (host export) for `name`.

Plan (OPINION, from Olivia, with my changes):
1. Core, small, separate PR (not PR #5, not the ACP plugin PR):
   - `AgentCore.setEffort(e)` and `getEffort()`.
   - `setEffort` validates with `validateEffortForModel` (effort-resolution.ts:92-110, pure) against the current model's levels. Invalid: throw, state unchanged.
   - `setModel` validates the id against the registry. Unknown: throw, state unchanged. Then it re-checks the effort: if the effort does not fit the new model, reset it to the model default (clear it), and return what changed so the caller can report it. One synchronous step. No half-applied state.
   - The preflight path (`adoptModelId`, agent-core.ts:460) uses the same validated setter, and emits a notice. Test it.
   - No new validator port is needed [Olivia]: the sdk boundary scan (sdk-port-boundaries-scan.ts:57-73) does not forbid src/config or src/llm, and agent-core.ts:47 already imports `findModel`. I did not read the scan file.
   - Exposure: `Session.agentCore()` (runtime/session.ts:286-292) is documented as the escape hatch for model switching. OPEN for Gaston: add thin `Session.setModel` and `Session.setEffort` wrappers, or have the host pass a switch function into the hostModes context. No new subpath is needed in either case, only a new method on an existing export.
   - Owner: Ronald, its own core PR after Phase 0, tests first [Olivia, pending Ronald].
   - Tests first: setEffort valid and invalid. setModel to a model without effort clears effort. Unknown model throws and state stays. A change between requests reaches the next request (scripted provider checks model and effort).
2. ACP plugin:
   - `session/new` returns `configOptions`: `model` (category `model`) and `effort` (category `thought_level`, levels from the model capabilities). Also a `mode` option if modes exist, in sync with `modes`.
   - `session/set_config_option`: validate, apply, reply with the full list. Unknown `configId` or invalid value: JSON-RPC invalid params (-32602), state unchanged.
   - After a model change, send `config_option_update` too, if the effort options changed.
   - A model change that core makes on its own (the preflight `adoptModelId` path above) also sends `config_option_update`. Core has no other fallback path [Olivia].
3. ACP spawn test: `session/new` lists both options. Set model, the reply shows the new effort options. Set an invalid value: error and no change. The next prompt carries the new model and effort (the scripted provider asserts it). Set an option while a turn runs: the running turn keeps its values.
4. CLI parity (`/model`, `/effort`) is a separate CLI change. Not in the ACP PR unless Gaston asks.

Ownership: the core change touches `agent-core.ts`. Ronald's PR #5 does not touch it, but Ronald owns events.ts and index.ts until the merge. The core PR for setEffort and setModel waits for the Gaston OK on the public export, and can start in parallel on its own branch. Ronald confirms the slot.

## 11. Stdout purity (hard rule)

ACP forbids any non-ACP byte on stdout. We found the same class of bug in stream-json: index.ts:1074 prints a human resume header to stdout in a non-interactive run (Ronald fixes it in PR #5).

Sources of stray stdout to close:
- `printStartupRow` (~index.ts:303): writes to stderr. VERIFIED [Ronald] (a worker confirms the call).
- Any `console.log` in plugin code. Rule: in acp mode, replace `console.log` with `console.error` at boot.
- A tool subprocess that inherits the parent stdout. Rule: children use `stdio: "pipe"`. Never inherit.
- Human output of any kind goes to stderr.

No `process.exit` after stdout writes. Set `process.exitCode` and let the loop drain. MEASURED [Amber, reproduced by Emma; Bun 1.4.4, research/acp-spike/pipe-flush, `bun run run.ts`]:
- `process.exit(0)` right after writes: no loss at 10 KB and 70 KB. At 1 MB and 8 MB with a 5 ms reader: data lost in 5 of 5 runs. With a fast reader (0 ms): no loss.
- `process.exitCode = 0` (natural exit): no loss in any case.
- Write an empty string, then `process.exit` in its callback: still lost data at 1 MB and 8 MB (5 of 5).
- So the ACP agent never calls `process.exit` after writing. On shutdown it lets the loop drain, or waits for the real last write.
- This also touches stream-json. The C5e failure lines are small (a few hundred bytes), so the risk there is low. But a long stream-json run that ends in `process.exit(1)` after a large output could lose its tail. Ronald: check whether the exit paths in run-non-interactive.ts and index.ts can use `process.exitCode`.

Tests (spawn):
- Send initialize and a prompt. Check that every stdout line parses as a JSON-RPC message.
- A tool that prints to stdout does not break the stream.
- Negative control: a stray human line on stdout makes the check fail.

## 12. Phases

- Phase 0. After PR #5 merges. Extract the shared mapper. No behavior change. stream-json tests stay green. Amber drafts the neutral wire-event types in research/ meanwhile (design only).
- Phase 1. The hostModes contract (Gaston OK), then `ma-acp-plugin` Level 1: initialize, session/new, session/prompt, session/cancel. Map text, thought, tool, usage, stopReason. No fs, no terminal, no permission. Spawn test first, with a fake provider and a hand-written client. Transport size: about 100 lines for framing, dispatch, errors, and cancel (Amber spike, see 13a), plus a pending-request map for agent-to-client calls.
- Phase 2. First tests: the gate tests (section 8). (a) The client never answers: the own deadline fires, the hook returns deny, the tool does not run. (b) The hook throws: the tool does not run. (c) The hook waits 3 seconds, then denies: the tool does not run and the model sees the denial. Then session/load, session/list, modes, plan, image input, the approval gate.
- Phase 3. Delegate Read, Write, Edit to client fs. Delegate Bash to client terminal. Slash commands.

## 13. Open questions

- Q1. Where does the command live? OPINION: minimal-agent-cli. Basis: migration-manifest rows target minimal-agent-cli, and the root AGENTS.md says the TUI moves there. Gaston confirms. Under A the flag lives in the host that parses argv.
- Q2. Gate placement: a hook (section 8). Decided, needs the async test.
- Q2b. A second `session/prompt` on a session that already runs a turn: DECIDED, reject with a JSON-RPC error (invalid params, "a turn is already running for this session") and leave the running turn alone. VERIFIED [Emma]: core `Session.run` throws `session ${id} already has a run in progress` (src/runtime/session.ts:175-176). The ACP prompt-turn page has no rule on it (I searched it for concurrent, already, in progress: nothing). No queueing.
- Q3. MCP: none in core. Decided in section 9.
- Q4. One process, many sessions. The runtime supports it (section 9, G2: `createRuntime` holds a Map of sessions). BUT `main()` builds one conversation from process-global state (section 10, "Single-session boot"), so many sessions in one process needs a per-session open path in the host. Cost UP, unmeasured. Fallback: one process per ACP session. OPEN for Gaston, with the cost known.
- Q5. Shape stream-json for Open Responses: no, not now. UNVERIFIED: I did not read that spec.
- Q6. Full list of legacy paths: Gaston.
- Q7. P1: A (unanimous). Gaston confirms, and OKs the plugin-api change.
- Q8. Mapper location: core/sdk, re-exported from an existing subpath. Gaston picks the file and export path.
- Q9. interrupted_text and the other stop rows: decided (section 7).
- Q10. Where does a full tool output come from, if `tool_output` is capped?
- Q11. `streamVersion`: PR #5 adds the first line, the envelope, and the last line. None has shipped. All belong to version 1. Bump only after the merge.
- Q12. Does the core git pin count as an allowed dependency in ma-acp-plugin? Gaston.
- Q13. Test-only devDependency on the ACP SDK: allowed? Emma, Amber, Ronald say no. Gaston.
- Q14. CLOSED. `used` = tokens currently in context (section 6).
- Q15. DEVIATION from Gaston's C2, needs Gaston OK. C2 asked for "one shared mapping layer, two thin encoders". The team (Amber, Ronald, Emma) proposes to narrow it: stream-json keeps consuming `AgentEvent` plus the envelope, because the goldens pin the exact keys. ACP uses shared pure helpers (tool category, stop-cause derivation, tool status) plus its own encoder. Reason: routing stream-json through a neutral type adds risk and no gain. Design: research/2026-10-31-wire-event-mapper-design.md section 5.
- Q16. Model switching. DECIDED by consensus [Olivia, Ronald; Emma agrees]:
  1. `setModel(unknown id)` throws. Model AND effort stay unchanged.
  2. `setModel(known id)` with an effort the new model does not fit: effort becomes `undefined` (the model default). No notice. The `session/set_config_option` reply shows the new `currentValue`.
  3. Automatic change (`adoptModelId`, agent-core.ts:460): same checked path and same reset. PLUS a new `TurnNotice` variant `model_adopted { from, to, effortReset: boolean, effortFrom: string | null }`, severity `info` (legal, agent/turn-notice.ts:83; union at lines 138-147) [Olivia, after Amber's challenge; supersedes `effort_reset`]. It is emitted on EVERY automatic change where `to !== from`, so the client never keeps a stale model value. It reaches json and stream-json as a `notice` event. ACP pushes `config_option_update`. A new notice kind is an added event: the stream-json goldens must stay byte-identical when no automatic change happens. Check also that the human renderer (`formatTurnNoticePlain`) handles the new kind (exhaustive switch).
  PUBLIC TYPE [Olivia, Emma re-read `git show origin/main:package.json`]: on main 4b1c828, `./sdk/turn-notice` is a public export (a shim over src/agent/turn-notice.ts that re-exports `TurnNotice`, `formatTurnNoticePlain`, `detectStopNotice`). So `model_adopted` adds a member to a PUBLIC union. Any exhaustive switch in a consumer breaks at its pin bump. Check at pin bump. I searched the local minimal-agent-cli/src and minimal-agent-web sources for `TurnNotice` and found no reference, but those checkouts are older than main (the web one is a known rewind), so this is UNVERIFIED for the real consumers.
  4. A change applies from the next MODEL REQUEST, which can be inside the same turn.
  5. Validation uses `findModel` plus `validateEffortForModel` directly. No port. No new export.
  6. Provider switch is a real bug, DECIDED [Olivia; Emma re-read agent-core.ts:149,198,496]. `providerId` is set once (lines 149, 198). Every request sends `selectedProviderId: this.providerId` (line 496). `setModel` changes only the id. So a model of another provider would go to the old provider's transport. RULE: Level 1 allows same-provider models only. `setModel` validates with `resolveModelForProvider(id, this.providerId)` (llm/model-registry.ts:222) when `providerId` is set, else `resolveModel` (line 169). Both throw on unknown. A cross-provider switch is out of scope.
  7. Model list, DECIDED [Olivia; Emma re-read plugin-api types/plugin.ts:263]. `ctx.queryModelInfo` is optional, takes no argument, and returns the CURRENT model only. The registry has `listRegisteredModels()` (model-registry.ts:242). RULE: the hostModes context passes `listModels()` (registered models, filtered to the current provider) and `modelInfo(id)`. I changed the contract sketch in section 10a to match.
  8. Effort levels come from `ModelInfoSnapshot.effort { levels, default }` (types/plugin.ts:152). If `levels` is empty, OMIT the effort option. A `set_config_option` for effort then gives invalid params.
  9. There are THREE model-change paths [Amber]: `setModel` (agent-core.ts:243), the constructor, and the preflight `adoptModelId` (line 460).
  OPEN for Gaston: add `Session.setModel` and `Session.setEffort` wrappers, or a switch function in the hostModes context. Amber votes for wrappers (the plugin never touches `AgentCore`).
  OPEN: thinking signatures across models of the same provider. UNVERIFIED: nobody found the rule in code. Keep a test: a thinking turn, then `setModel`, then a prompt must not fail. If it fails, strip or repair the thinking blocks on a model change, as its own decision.
  OPEN: which models the current credentials can use. Unknown. Level 1 lists registered models. A failed request after a switch uses the existing error path.
  CLOSED: the notice shape for the automatic path is `model_adopted` (item 3). Reasons [Olivia]: (1) the plugin sees events, not each model request, and `adoptModelId` runs in preflight (agent-core.ts:458-460), so polling `getModel()` would learn of the switch late; (2) json and stream-json consumers get the signal too; (3) the notice appears only when `to !== from`, so goldens stay byte-identical. Ronald still confirms the rename.
  Q-provider (for Gaston): cross-provider switching later, yes or no. Level 1 is same-provider only (item 6).
- Q17. Effort switching. DECIDED by consensus [Olivia, Ronald; Emma agrees]:
  1. `setEffort(bad value)` throws. State unchanged.
  2. ACP: `configOptions` in `session/new` = [model (category `model`), effort (category `thought_level`)]. `session/set_config_option` replies with the full list. Unknown `configId` or value: invalid params (-32602), no change.
  3. Tests first: core unit tests, plus an ACP spawn test where a scripted provider asserts the new model and effort on the next request. Existing goldens stay byte-identical.
  4. Owner: Ronald, own core PR after Phase 0.
  5. Persistence. VERIFIED [Olivia, Emma re-read src/session/session-store.ts:592-624]: the `meta` record is written ONCE at creation with `model`, and it has NO effort field. A same-sid resume keeps the meta intact (it only backfills `credentialName`). So today a model or effort change in a session is NOT persisted. Level 1: session-local. Persisting needs a new record kind and is Gaston's call. UNVERIFIED: how a resume picks the model (meta.model vs argv or config).
  6. If the model has no effort levels, the effort option is left out (item 8 under Q16).

## 13a. Team sync (Emma, Ronald, Amber), 2026-10-31

Agreed:
- Ronald owns sdk/events.ts, host/startup/run-non-interactive.ts, stream-json-writer.ts, index.ts until PR #5 merges. The mapper starts from merged main as a pure refactor.
- streamVersion 1 has not shipped. PR #5 content stays v1.
- Mapper in core/sdk. plugin-api re-exports types only. ACP names stay in the plugin.
- Mapper design draft: research/2026-10-31-wire-event-mapper-design.md (Amber). Types only. Under review.
- ACP builds on the runtime Session.
- Zero runtime dependencies (section 2a).
- Stdout purity is a hard rule with a spawn test.
- Host shape: A, unanimous (section 10).
- Gate: a hook, no core change (section 8).
- Stop reason: run outcome plus the last notice kind (section 7).

Amber spike, label Verified Offline [Amber, bun 1.4.4, not re-run by me]: a hand-rolled ACP agent on Bun built-ins, 97 lines (`agent.ts`), plus a hand-written client of 87 lines (`drive.ts`), in research/acp-spike. A real spawn showed:
- initialize returns protocolVersion 1.
- Turn 1: 3 streamed agent_message_chunk updates, stopReason end_turn.
- Turn 2 with session/cancel mid-turn: stopReason cancelled, returned as a normal result. The session accepts a new turn after cancel.
- stdout: 9 lines, 0 non-JSON-RPC lines. Logs went to stderr only.
- Negative control: one human line on stdout made the check fail (exit 1).

What the spike does NOT prove: fidelity to the full ACP schema (types written by hand from the doc pages, no schema validation), agent-to-client requests (permission, fs), or any real model run.

## 14. Not in scope

- Cost in usage_update (core computes none).
- Open Responses shaping.
- Anthropic stream event names.
- ACP v2.
- Streamable HTTP transport.
- Elicitation.
- Terminals as embedded content at Level 1.

## 15. Unverified list

- ACP schema: the `StopReason` list and the full `SessionUpdate` variant list (read by Amber from schema.json, not by me).
- Hand-rolled transport fidelity to the ACP schema.
- Slash command registry shape.
- Whether the arch test accepts a re-export from an existing subpath.
- Task events to ACP plan.
- The full `ctx` type beyond `queryModelInfo`.
- The argv parser (host/cli/command-plan.ts).
- A full list of legacy paths.
- Any test in minimal-agent-plugins that enforces zero dependencies.

## 16. Core: chain hooks fail open (separate issue, for the Gaston packet)

Found by Ronald, re-read by Emma on origin/main b8d0c2d. Emma checked that hook-bus.ts, lifecycle-port-adapter.ts and tool-round.ts are byte-identical between b8d0c2d and 4b1c828 (git diff is empty). It is NOT part of PR #5 and NOT part of the ACP work.

Facts, VERIFIED:
- hook-bus.ts:157-168: in `emitChain`, a listener that throws, or whose awaited result times out, is reported and skipped (`continue`). The chain does not stop.
- lifecycle-port-adapter.ts:131-141: with no listeners, or on any thrown error, `emitChain` returns `allowDecision(payload)`.

Effect: any approval-style `beforeTool` hook fails open today. A crash or a timeout in the hook lets the tool run. It is not an ACP-only problem. Any plugin that vetoes tools has it.

Mode and CLI permission deny runs before the hook (tool-round.ts:430), so the hard deny is not affected.

Fix idea, OPINION: a fail-closed option on the listener, so that a throw or a timeout becomes `deny`. It needs its own issue and PR, with a test. It touches the hook contract in plugin-api, so it needs Gaston's OK.

Until then, the ACP plugin follows the plugin-side rules in section 8.

## 17. Roles and hygiene

- Ronald: PR #5, then the shared mapper.
- Emma: this spec. Review only. No code.
- Amber: external fact checks, the spike, the neutral wire-event types (design only), review. She sends v3 to Gaston.
- Every claim carries a file and line or a URL, and its tree when it matters.
- No commit on a red gate.
- Co-authored-by trailer on every commit.
- Stage explicit paths only. Never run `git add -A` at the monorepo root. Never commit a submodule pin bump unless it is the intended change.
- Known state, VERIFIED [Ronald]: ` M minimal-agent-web` at the root is a checkout one commit behind its pin (checkout 9717f87, pin 89983cf). It is not a change by us. A pin bump stages only minimal-agent-core.
