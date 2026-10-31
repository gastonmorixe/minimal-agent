# Neutral wire-event mapper: design draft (types only, no repo edit)

Author: Amber (session 17855fb3). Status: DRAFT for review by Ronald (fd5aa0d3) and Emma (db09fa39).
Date: 2026-10-31. Gaston decides ties.
Tags: VERIFIED (read in code this session, tree named) / OPINION / OPEN.

Trees: BRANCH = `feat/stream-json-envelope` (PR #5, base 4a229cb). MAIN = `origin/main` 4b1c828 (it moved from b8d0c2d on 2026-10-31 16:2x, so facts below tagged "main" were checked on b8d0c2d first and re-checked on 4b1c828 where noted. Re-check before relying on a line number: main moves fast).

## 1. Purpose

One place that turns core output into a neutral "wire event". Two thin encoders sit on top:
- stream-json encoder (core). Bytes must not change. No golden edit.
- ACP encoder (ma-acp-plugin). ACP field names stay in the plugin.

Start only after PR #5 merges (Ronald owns events.ts and run-non-interactive.ts until then).
Placement (OPINION, Ronald's pick): new file `src/sdk/wire-events.ts`, re-exported from `./sdk/events`. No new public subpath, so no PUBLIC_EXPORTS edit (freeze is by subpath, public-api.test.ts:61-62). OPEN: biome and arch tests must accept a re-export barrel.

## 2. Input facts (VERIFIED on BRANCH, src/sdk/events.ts)

| Core event | Fields |
|---|---|
| item_started | itemType (text, tool_use, thinking), id, input? (tool_use only) |
| item_completed | itemType, id, text? |
| text_delta, thinking_delta | id, text. Only with emitDeltas or sink kinds |
| tool_call | callId, toolName, input, inputSummary. Needs `kinds` |
| tool_output | callId, toolName, text, truncated, totalBytes. Cap 16 KiB (TOOL_OUTPUT_TEXT_CAP). Needs `kinds` |
| tool_result | id, name, isError, inputSummary?, outputSummary?, durationMs? |
| turn_completed | turn, stopReason (StopReason or null), usage (EventUsage). NOT emitted on truncated turns |
| notice | notice: TurnNotice |
| error | message, code?, hint?, recoverable? |
| status | StatusFields |
| user_message | text, queued? |
| run_finished | outcome: TurnOutcome |

Envelope (BRANCH, events.ts:460-490): `{sessionId, seq, ts}`. First line `session_started` (streamVersion 1, model, provider, effort, cwd, version, outputFormat). Last line `run_finished`.

EventUsage (VERIFIED): inputTokens, outputTokens, cacheReadTokens?, cacheCreationTokens?. No cost. No window size.

TurnOutcome (VERIFIED, MAIN stop-policy.ts:46): completed, truncated, failed, aborted, waiting.

Provider StopReason (VERIFIED, MAIN plugin-api/src/llm/canonical-events.ts:51): end_turn, tool_use, max_tokens, stop_sequence, refusal, pause_turn, context_window_exceeded, content_filter, error.

TurnNotice kinds (VERIFIED, MAIN src/agent/turn-notice.ts): StopNotice (kind = refusal or content_filter or similar, severity error, category, message), max_tokens_salvaged, max_tokens_continuing, max_tokens_capped, reflection_ack, stream_interrupted_salvaged, stream_interrupted_continuing, stream_interrupted_capped, ask_denied.

## 3. Neutral wire event (proposal, OPINION)

Rule: neutral names. No ACP words (`sessionUpdate`, `agent_message_chunk`, `kind: "execute"`).

```ts
// src/sdk/wire-events.ts (design only)
export type WireToolStatus = "pending" | "running" | "succeeded" | "failed" | "denied"

export type WireStopCause =
  | { kind: "completed" }
  | { kind: "truncated"; reason: "max_tokens" | "interrupted_text" }
  | { kind: "refused"; category: string | null; message: string | null }
  | { kind: "aborted" }
  | { kind: "failed"; message: string; code?: string }
  | { kind: "waiting" }

export type WireEvent =
  | { type: "message_delta"; messageId: string; channel: "answer" | "reasoning"; text: string }
  | { type: "message_done"; messageId: string; channel: "answer" | "reasoning"; text?: string }
  | { type: "tool_started"; toolCallId: string; toolName: string; input: Record<string, unknown>; summary: string }
  | { type: "tool_progress"; toolCallId: string; text: string; truncated: boolean; totalBytes: number }
  | { type: "tool_finished"; toolCallId: string; toolName: string; status: WireToolStatus; summary?: string; durationMs?: number }
  | { type: "usage"; inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number }
  | { type: "notice"; severity: "info" | "warn" | "error"; code: string; detail?: Record<string, unknown> }
  | { type: "turn_stopped"; cause: WireStopCause }
```

Why these choices:
- `messageId` comes from the core item `id` (text_delta and thinking_delta carry `id`). VERIFIED source exists. So the "messageId has no source" worry (Emma) is answered: the item id is the source. The ACP encoder may pass it as `messageId`. OPEN: confirm that one item id equals one ACP message (a turn can have text, then a tool, then text: separate items, separate ids, which is what ACP wants).
- `toolCallId` comes from `callId` and `tool_result.id`. Emma verified the tool_use id is both. OPEN: confirm tool_call.callId equals tool_result.id on the Session route (I did not read it).
- `turn_stopped` replaces reliance on `turn_completed` (not emitted on truncated). Source: run outcome plus the last notice before run_finished.

## 4. Stop-cause derivation (VERIFIED facts, derivation is OPINION)

Inputs: the run_finished outcome, the last `notice` seen in this run, and the last turn_completed.stopReason if any.

| Outcome | Last notice | Cause |
|---|---|---|
| completed | none | completed |
| completed | StopNotice (refusal, content_filter) | refused (category, message). RESOLVED: yes, the run outcome is "completed" on a refusal (row 13). See RESOLVED-1 below |
| truncated | max_tokens_capped | truncated / max_tokens |
| truncated | stream_interrupted_capped | truncated / interrupted_text |
| aborted | any | aborted |
| failed | none | failed (message from the last `error` event) |
| waiting | none | waiting |

Evidence: agent-core.ts:917-930 (MAIN and BRANCH): on truncated, emitNotice then `outcome = "truncated"; break rounds`. No turn_completed on that path (:940, :1010 are the only emit sites, Ronald).

RESOLVED-1: StopNotice route (VERIFIED, MAIN src/sdk/agent-core.ts:899-900). After each response the loop calls `detectStopNotice(lastResponse.stopReason, lastResponse.stopDetails)` and emits the notice if non-null (kinds: refusal, content_filter, turn-notice.ts:31). It is "pure projection; no retry, no history change". Then `decideNext` runs as for any response. With no tool calls the turn takes the natural exit (:938-941) and emits turn_completed, so a refusal ends as outcome "completed" with turn_completed.stopReason = "refusal" (or "content_filter"). Consequence for the ACP layer: outcome completed AND (last notice is a StopNotice OR turn_completed.stopReason is refusal or content_filter) means ACP stopReason `refusal`, not `end_turn`. Both signals exist, so use turn_completed.stopReason as the primary source and the notice for the message text. VERIFIED decideNext (MAIN src/sdk/stop-policy.ts, decideResponse): rows 2 to 7 and 13. No row continues on refusal. Row 13 (the last line of decideResponse) says: "Other stop reasons with no tool call (refusal, pause_turn, none) settle the same way; the loop already surfaced any stop notice." and returns `{row: 13, kind: "stop", outcome: "completed"}`. So refusal, pause_turn, content_filter, stop_sequence, end_turn, context_window_exceeded and null ALL end as outcome "completed" when there is no tool call. Only max_tokens (rows 3, 4), terminal-less closes (rows 5 to 7) and tool calls (row 2) differ.
Consequence: outcome alone cannot tell end_turn from refusal. The ACP layer MUST read turn_completed.stopReason (emitted on the row 13 natural exit, agent-core.ts:940) for the cause. See section 4a.

## 4a. Final stop map (VERIFIED sources above, mapping is OPINION)

Inputs: outcome (run_finished), turn_completed.stopReason of the LAST turn (when emitted), last capped notice.

| Outcome | Last turn stopReason | Notice | ACP stopReason |
|---|---|---|---|
| completed | end_turn, stop_sequence, null, tool_use | none | end_turn |
| completed | refusal, content_filter | StopNotice | refusal |
| completed | pause_turn | none | end_turn plus notice plus `_meta.stopReason`. DECIDED (Amber, Ronald). The loop does not resume a paused turn (row 13) |
| completed | context_window_exceeded | none | max_tokens plus notice "context window full" plus `_meta.stopReason`. DECIDED, LOSSY (Amber, Ronald). Never say "output limit" in the notice |
| completed | error | none | end_turn plus notice plus `_meta.stopReason: "error"`. DECIDED (Amber, Ronald). Evidence: adapters that set stopReason "error" also yield a stream_error that the host throws (ma-llm-openai-plugin/responses/response-stream.ts:405-415, anthropic-stream.ts:267-276), so real errors arrive as waiting or failed. A completed turn with stop "error" is rare. Same as core and stream-json (C2) |
| truncated | (none emitted) | max_tokens_capped | max_tokens |
| truncated | (none emitted) | stream_interrupted_capped | end_turn plus notice plus _meta reason |
| aborted | any | any | cancelled |
| failed | none | none | JSON-RPC error (row 12: a refused tool batch) |
| waiting | none | none | JSON-RPC error (row 11: permanent or unrecoverable error, run paused) |

Rule: the primary signal is the outcome. For "completed", refine with the stopReason of the LAST turn_completed. For "truncated", refine with the last capped notice.

Refinements [Ronald, verified in agent-core.ts and turn-notice.ts]:
1. Only refusal and content_filter get a core notice (STOP_NOTICE_KINDS, turn-notice.ts:31, emitted at agent-core.ts:899-900). pause_turn and context_window_exceeded get NONE. So for those rows the "plus notice" is created by the ACP encoder, core sends nothing.
2. Use the LAST turn_completed.stopReason, never "any refusal seen". Two exceptions: (a) a pending mode switch makes the loop run one more round and skip turn_completed for that round (agent-core.ts:932-936). (b) a refusal response that also has tool_use blocks runs the tools (row 2) and continues, so it is not the end of the turn.
3. A classified context_length error that is THROWN goes through rows 9 to 11 (outcome waiting), not row 13. Only an un-thrown stop reason context_window_exceeded reaches row 13.
4. Before a JSON-RPC error for failed or waiting, send the error text as a notice or agent_message_chunk, so the editor keeps and explains the partial reply.
Never send max_turn_requests (stop-policy.ts:45: no round cap).

## 5. How the stream-json encoder stays byte-identical

The stream-json encoder does NOT consume WireEvent. It consumes AgentEvent, as today (PR #5 serializeStreamJsonLine). The mapper is for the ACP encoder only at first. Rationale (OPINION): the stream-json goldens pin the exact AgentEvent keys. Routing them through a neutral type adds risk with no gain.
Sharing still happens in these pure helpers (extract later, behavior neutral):
- `toolKindOf(toolName)` (table, plugin side for ACP names, neutral categories in core)
- `deriveStopCause(outcome, notices)` (section 4)
- `toolStatusOf(event)`
Condition: stream-json tests (run-non-interactive.test.ts, tool-turn-golden, events-jsonl, output-format-g3) pass with no golden edit.
This narrows C2 from "one mapping layer for both" to "shared pure helpers, two consumers". Needs team OK.

## 6. Neutral tool categories (OPINION)

Core has no tool kind (Ronald: ToolDefinition = name, description, input_schema). Neutral categories in core: read, edit, delete, move, search, run, fetch, think, other. ACP encoder maps `run` to `execute`. First table:

| Tool | Source | Category | `locations` key (VERIFIED [Ronald] src/tools/tool-definitions.ts) |
|---|---|---|---|
| Read | core | read | file_path (:49-70), optional line from `offset` |
| Write | core | edit | file_path (:76-92). Alias for content: `contents` |
| Edit | core | edit | file_path (:98-122) |
| Bash | core | run | none. `command` (req), `timeout`, `description` (:30-43) |
| Glob | core | search | `path` if given (alias `target_directory`). `pattern` (req), alias `glob_pattern` (:128-145) |
| Grep | core | search | `path` if given. `pattern` (req) (:160-189) |
| Fetch | ma-fetch-plugin | fetch | none (url) |
| WebSearch | ma-web-search-plugin | fetch | none |
| Task | ma-tasks-plugin | think | none |
| Skill | ma-skills-plugin | other | none |
| everything else | | other | none |

VERIFIED [Amber] plugin tool names by grep of minimal-agent-plugins: `Fetch`, `WebSearch`, `Task`, `Skill`, `ChromeCDP`, `Computer`. There is no tool called WebFetch. Emma's v3 table says WebFetch: fix to Fetch. Mind input aliases (Write `contents`, Glob `glob_pattern` and `target_directory`): the encoder reads both names.

Join rule, VERIFIED [Ronald]: all four ids equal the tool_use block id. tool_call.callId = tool.id (sdk/tool-facts.ts:97). tool_result.id = tool.id (sdk/tool-calls.ts:60-62). item_started.id = block.id (agent-core-helpers.ts:54). tool_output.callId = tool.id (tool-facts.ts:112). So toolCallId = the tool_use id everywhere.

## 7. Usage

ACP `used` = "Tokens currently in context". `size` = "Total context window size in tokens". `cost` is optional (VERIFIED [Amber] ACP v1 schema.json, UsageUpdate).

`usage` carries tokens only (EventUsage, events.ts:43, per turn). Core has no running context total.
- `used` PROXY, agreed [Ronald, Amber]: the LAST turn's inputTokens + cacheReadTokens + cacheCreationTokens (the full prompt the model saw). Never a sum across turns. Same as core's fleet-token-count rule. Label it a proxy in the plugin docs.
- `size`: ctx.queryModelInfo().contextWindow, inside a loaded plugin (plugin-api types/plugin.ts:142 [Ronald]).
- `cost`: omit. Core has none (pricing is host side, quota/usage-stats.ts:38).
DECIDED. No longer open.

## 7a. Model and effort switching (Gaston's order, via Olivia a982c935): REQUIRED, not optional

ACP side, VERIFIED [Amber] https://agentclientprotocol.com/protocol/v1/session-config-options (fetched):
- `session/new` MAY return `configOptions` (an ordered list; order = priority). Each option: `id`, `name`, optional `description`, optional `category`, `type` ("select", or "boolean" only if the client advertises `session.configOptions.boolean`), `currentValue`, `options` (value, name, description; flat or grouped).
- Categories: `mode`, `model`, `model_config`, `thought_level`. Categories are UX only and MUST NOT be needed for correctness. Names that start with `_` are free for custom use.
- Client calls `session/set_config_option {sessionId, configId, value}` at ANY time, idle or mid-generation. The agent MUST answer with the COMPLETE list (so it can report dependent changes, for example a new model changes the reasoning levels).
- The agent MAY push `session/update` with `sessionUpdate: "config_option_update"` carrying the complete list (for example after a fallback to another model).
- `configOptions` supersede `modes`. If both are sent, keep them in sync. Every `currentValue` must work even if the client ignores the option.
- The schema enum list I read earlier (schema.json, SDK 2.2.0) already had `config_option_update` in SessionUpdate.

Core side, VERIFIED [Amber, origin/main] (matches Olivia's read):
- `AgentCore.setModel(model)` at src/sdk/agent-core.ts:243. Only assigns. No registry check, no effort re-check.
- Callers of setModel: src/host/interactive-session.ts:286-287 (`this.session.agentCore().setModel(model)`) and src/host/repl.ts:714 (`agent.setModel(picked)`). Plus the definition. Nothing else outside tests.
- Effort: `private effort: string | undefined` (agent-core.ts:152), assigned only in the constructor (:221), read per request at :503 inside `buildOutputConfig`. No setter, no getter.
- Validation helper exists: `validateEffortForModel(effort, modelEffortLevels)` in src/config/effort-resolution.ts (:92-110, line fixed by Olivia): ok when effort is undefined, error when the model declares no levels or the level is not in the list.

THREE model-change paths exist in core (VERIFIED [Amber] origin/main, Olivia found the third):
1. `AgentCore.setModel` (agent-core.ts:243), callers interactive-session.ts:286 and repl.ts:714.
2. The constructor sets it at start.
3. Preflight: `runPreflight` (agent-core.ts:457-464) does `if (result.adoptModelId) this.model = result.adoptModelId`. `adoptModelId` is produced by the preflight pipeline (src/agent/preflight-pipeline.ts, the `resolution.adoptModelId` branch, about :105-127). It fires when a preflight issue resolution switches the model. It emits NO event of its own that I found (UNVERIFIED: whether a notice accompanies it).
Consequence for the plugin: the model can change without any set_config_option call. The plugin must read the effective model after each request or turn and, when it differs from the last reported `currentValue`, push `config_option_update` with the COMPLETE list (ACP names "falling back to a different model due to rate limits or errors" as a reason, session-config-options page). RESOLVED: the plugin learns of an automatic change from the new core notice `model_adopted` (notice table below, line 202). No polling is needed to DETECT the change. `AgentCore.getModel()` already exists (VERIFIED [Amber] origin/main src/sdk/agent-core.ts:239, correction from Olivia), and the plugin uses it to BUILD the `model` option's `currentValue` (reached through the Session handle, `interactive-session.ts:282-283` shows the same call).
Also (Olivia, verified agent-core.ts:47 imports findModel): no validator port is needed in sdk. The sdk boundary scan (sdk-port-boundaries-scan.ts:57-73) does not forbid src/config or src/llm.
"Mid-turn" precision: a change applies from the next MODEL REQUEST, which can be inside the same turn (a turn can hold several requests, one per tool round). Effort option when the model has no levels: OMIT it (my decision, DECIDED unless Gaston objects: an empty or "default"-only select tells the user nothing and invites invalid sets).

Mapping (design, OPINION):
| ACP | Core | Note |
|---|---|---|
| configOption `model`, category `model`, type select | the hostModes context passes `listModels()` (registry `listRegisteredModels()`, model-registry.ts:242, FILTERED to the current providerId) and `modelInfo(id)` | DECIDED [Olivia, VERIFIED]: `queryModelInfo` is optional, takes no argument and returns the CURRENT model only (plugin-api types/plugin.ts:263, :734), so it cannot build the list. Values = model ids, names = display labels. SAME PROVIDER ONLY at Level 1: `AgentCore.providerId` is fixed (agent-core.ts:149, :198, :496), so a cross-provider id would hit the old transport |
| configOption `effort`, category `thought_level`, type select | `effort` levels of the CURRENT model (capabilities.effort levels, plugin-api ModelInfoSnapshot.effort `{levels, default}`, types/plugin.ts:152) | if the model has no levels, OMIT the option (do not send an empty select) |
| `session/set_config_option` model | `AgentCore.setModel` after a registry check | invalid id: JSON-RPC invalid params, state unchanged |
| `session/set_config_option` effort | NEW `AgentCore.setEffort`, validated by `validateEffortForModel` against the current model | invalid: JSON-RPC invalid params, state unchanged |
| reply to set_config_option | the COMPLETE list rebuilt from the new state | after a model change the effort options are rebuilt for the new model |
| `config_option_update` push | emitted when core changes state itself: the preflight `adoptModelId` path (agent-core.ts:460), or a mode change | complete list. Trigger for the model path: the new core notice `model_adopted` (below), emitted on every automatic change |
| `modes` (old API) | plugin `modes` (ModeManager) | send both while modes exist, keep in sync |

Notice table for model and effort (consensus Olivia and Ronald, a982c935 message of 16:23, Amber ACKs):
| Core signal | When | ACP output |
|---|---|---|
| NEW TurnNotice variant `model_adopted {from, to, effortReset: boolean, effortFrom: string \| null}`, severity "info" (DECIDED [Olivia, Ronald, Amber]; replaces the earlier `effort_reset`, which gave no signal when effort stayed valid. "info" is a legal severity, turn-notice.ts:83 already uses it) | On EVERY automatic model change at the `adoptModelId` path (agent-core.ts:460) where `to !== from` | `config_option_update` (complete list, new `model` currentValue, `effort` option rebuilt for the new model) PLUS a notice text ("model changed from X to Y", plus "effort reset from E to default" when `effortReset` is true), as an ACP `notice` if the client advertised it, else an agent_message_chunk fallback |
| ANY core `notice` event forwarded as an ACP `notice` | when the client advertised `session.notices` | SEVERITY MAP, required (VERIFIED [Olivia, Amber]): core `NoticeSeverity = "error" \| "warn" \| "info"` (src/agent/turn-notice.ts:43, values used at :48, :62, :83). ACP `NoticeSeverity` = `info`, `warning`, `error`, or custom values that start with `_` (ACP v1 schema.json, `NoticeSeverity`). So map `warn` to `warning`, `info` to `info`, `error` to `error`. Sending `warn` raw is invalid ACP. Add a unit test per value. `title` is required, non-empty plain text. A notice is a live event: ACP says agents "must not rely on a notice being received", so `config_option_update` stays the state signal and the notice is only for the user |
| explicit `session/set_config_option` | client asked | NO notice. The reply carries the complete list with the new currentValue (effort may be reset to default after a model change) |
| invalid configId, value, or unknown model | client asked | JSON-RPC -32602, state unchanged |
RESOLVED (Amber proposed, Olivia accepted at 16:24, Ronald owns the core PR): the earlier `effort_reset` fired only when effort changed, so an automatic model change with a still-valid effort gave the plugin no signal and the editor kept a stale `model` value. `model_adopted` fires on every automatic change, so push replaces polling. `AgentCore.getModel()` exists (agent-core.ts:239) and the plugin uses it only to BUILD `currentValue`, not to detect changes (see line 184).

Who applies a switch (Emma's decision item 8, my vote): the hostModes context passes a `session` handle with `setModel(id)` and `setEffort(level)` that call AgentCore through the Session wrapper (no new subpath). The plugin never touches AgentCore directly. Ronald owns the core PR (setEffort, getEffort, checked setModel). The wrapper vs context-function choice is packet item 8 (Gaston).
Watch item "model_adopted changes a public union" (`./sdk/turn-notice` is public on main 4b1c828): CHECKED, LOW RISK [Olivia, I did not re-run it]. cli/src has 0 TurnNotice uses. web has 1 at app/src/trace/trace-model.ts:258-265, a `String(notice.kind)` passthrough, not exhaustive. The only compile break is the intended one in core: `formatTurnNoticePlain` (src/agent/turn-notice.ts:203, `_exhaustive: never`). Ronald's PR must also add a changelog line (json and stream-json output gain a notice kind).

WHY listModels() and modelInfo(id) come through the hostModes context and NOT through a direct import of `@minimal-agent/core/host/model-registry` (RISK [Olivia], UNVERIFIED): origin/main now exports `./host/model-registry`, but the registry is a module-level singleton (src/llm/model-registry.ts, `registerModel` mutates module state, about :118). If the plugin's import resolves to a DIFFERENT copy of core than the host's, the plugin sees an EMPTY registry. Root AGENTS.md:142 says "core resolves each plugin's import to its own copy at runtime". It is ambiguous: it may mean the plugin's own copy of core (separate singleton) or the host's copy. Nobody has checked. Rule: the context passes the host's own functions, so there is one registry. If someone wants the direct import later, first test it: load a plugin that calls `listRegisteredModels()` and assert a non-empty list.

Same-provider models only at Level 1 (Emma item 9, my vote YES): switching to a model of another provider changes auth and transport, which Session may not support mid-session (UNVERIFIED). The `model` option lists only models of the current provider at Level 1. Cross-provider is a later phase after a test proves it.

Rules to write into the plugin docs and tests:
1. A change in the middle of a turn applies from the NEXT model request. The running request keeps its model and effort (core reads `this.model` and `this.effort` per request, :503). Say so in the reply text of the option description. VERIFY with a scripted provider.
2. After `setModel`, if the old effort is not valid for the new model (`validateEffortForModel` fails), reset effort to the new model's default (undefined) and report the new `effort` option in the reply. Never send an effort the model does not support (Olivia: today the old effort is still sent, a bug risk).
3. Unknown `configId`, or a `value` that is not in the option's list: JSON-RPC invalid params (-32602), state unchanged. A boolean `type` field when the client did not advertise boolean support: treat as invalid.
4. `currentValue` of every option is always usable without the client ever touching it (default = the session's startup model and resolved effort, effort-resolution.ts:46-66).
5. Persistence: whether a model or effort change is saved in the session (resume) is OPEN. Check what `/model` does in the REPL today (repl.ts:704-715 error picker only). Probably session-local for now. Decide with Olivia.

Core change required (separate small PR, NOT in PR #5, NOT in the ACP plugin PR), proposed by Olivia, agreed in principle [Amber]:
- `AgentCore.setEffort(e)` and `getEffort()`, validated with `validateEffortForModel` against the current model.
- `setModel` validates the id and re-checks effort (reset when invalid).
- Expose through an existing public subpath under src/sdk (agent-core is already exported as `./sdk/agent-core`), so no new subpath and no PUBLIC_EXPORTS edit.
- Core unit tests first: setEffort valid and invalid, setModel to a model with no effort levels clears effort, unknown model throws and leaves state unchanged.

ACP spawn tests (plugin PR, scripted provider that records each request):
- session/new lists `model` and, when the model has levels, `effort`.
- set model: reply is the full list and the effort options changed to the new model's levels.
- set an invalid value: error -32602, `currentValue` unchanged in a following full-list read.
- set effort then prompt: the next provider request carries the new effort. Same for the model.
- set model DURING a turn: the in-flight request keeps the old model, the next request uses the new one.
- model with no effort levels: no effort option in the list, and setting `effort` returns invalid params.

CLI `/model` and `/effort` commands: a separate CLI-owned change, not part of this ACP work unless Gaston asks (Olivia point 4).

## 8. Not decided here

- hostModes slot file (Ronald, after PR #5).
- Gate hook, permission options (Emma spec v3).
- ACP types (plugin).
