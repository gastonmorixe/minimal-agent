# Handoff: ACP plugin and stream-json work (2026-10-31)

Written by Olivia (a982c935). For team review: Emma (db09fa39), Ronald (fd5aa0d3), Amber (17855fb3).
Status: FINAL. Emma, Ronald and Amber agreed after their fixes were applied.

## 1. Goal

Make minimal-agent work with other tools, CLIs and apps:
- Ship ACP (Agent Client Protocol) as a PLUGIN on the new agentic core, not the legacy path.
- Keep stream-json `--output-format` working. Share code with ACP where you can, but do not break it.
- Policy: NO external runtime dependencies. Dev dependencies only.

## 2. State now (verified 2026-10-31 16:45 EDT)

- Every repo is on `main`, in sync with origin, with no pin drift.
  - monorepo: bc18b1d
  - core: 0887f97
  - plugins: 2a60adc
  - cli: 23e1fd8
  - web: 89983cf
- Core `origin/main` has MOVED since then, to 89e29cf (9f4e3d1 and 89e29cf add new host exports). The monorepo pin bc18b1d still points at 0887f97. Bump the pin when you start.
- Core PR #5 (stream-json envelope) is MERGED. Merge commit 0887f97: https://github.com/gastonmorixe/minimal-agent-core/pull/5
- Gate on 22b0409 (Ronald): typecheck, lint, format, biome, docs and arch all exit 0. Tests: 5212 pass, 3 fail. The 3 failures also fail on a clean 4b1c828: 2 kitty CSI-u abort tests and truncation-tmux (tmux).
- Nobody ran a gate on 0887f97 after the merge.
- The docs are committed in monorepo def2d48 under `research/`. That folder is gitignored, so the files were force-added.

## 3. Documents (read in this order)

1. `research/2026-10-31-acp-plugin-spec-v3.md`: the spec (v3.1, Emma). Section 10b, Q16 and Q17 cover model and effort switching.
2. `research/2026-10-31-wire-event-mapper-design.md`: wire mapping (Amber). It covers the neutral types, the stop table, tools, usage, configOptions and notices (section 7a).
3. `research/2026-10-31-acp-core-facts-R1-R3-R4.md`: core facts with file:line (Ronald).
4. The Gaston decision packet (Amber's file, in def2d48).
5. `research/2026-10-31-hostmodes-contract-draft.md`: the hostModes slot (sections 7a-7b).
6. `research/acp-spike/`: a hand-rolled agent of about 100 lines. The spike passed initialize, session/new, a streamed prompt and cancel. It wrote no non-JSON-RPC lines to stdout.

Ignore `research/2026-10-31-acp-plugin-spec-v2.md`. It is stale.

## 4. Decisions (team consensus)

- Host shape: a new `hostModes` plugin manifest field. The ACP mode runs inside the host process.
- Transport: hand-rolled JSON-RPC with zero dependencies. The ACP SDK is not a runtime dependency. The team says no to using it as a dev test client, but that is Gaston's call.
- Shared code: stream-json = AgentEvent + envelope. ACP = shared helpers + its own encoder. Golden tests pin the stream-json bytes.
- Mapper: a new file, re-exported from `./sdk/events`. No new subpath.
- Exit: never call `process.exit` after NDJSON writes. Set `process.exitCode` instead (measured on Bun 1.4.4; fixed in Ronald's 7be64cf).
- Stdout purity: only ACP messages go to stdout. All human output goes to stderr. A spawn test checks every stdout line.
- Approval gate: an awaited `beforeTool` chain hook that waits for `session/request_permission`. It sets no `timeoutMs` and owns its own deadline. It denies on throw, closed, cancelled, unknown or malformed answers.
- Usage: `used` = the LAST turn's input + cacheRead + cacheCreation tokens (a proxy, never a sum). `size` = `queryModelInfo().contextWindow`. No cost.
- Stop reasons: see the stop table in the design doc. The plugin never sends `max_turn_requests`.
- Notice severity map: core `warn` → ACP `warning`. `info` and `error` map to themselves. Send `sessionUpdate:"notice"` only if the client advertised `session.notices`. Otherwise fall back to `agent_message_chunk`.

### Model and effort switching (required: build and test it)

ACP v1 `configOptions`: https://agentclientprotocol.com/protocol/v1/session-config-options

1. `setModel(unknown id)` throws. Model and effort stay unchanged. Validate with `resolveModelForProvider(id, providerId)`, or with `resolveModel` when there is no providerId.
2. `setModel` with an effort the new model does not fit: effort becomes undefined (the model default). This happens in one synchronous step with the model change. No notice.
3. The automatic preflight `adoptModelId` (agent-core.ts:460) takes the same checked path. It emits a NEW TurnNotice `model_adopted {from, to, effortReset, effortFrom}`, severity `info`, every time `to !== from`. ACP then pushes `config_option_update`.
4. `setEffort(bad value)` throws. State stays unchanged.
5. A change applies from the next MODEL REQUEST. That can be inside the same turn.
6. Level 1 offers same-provider models only. `providerId` is fixed (agent-core.ts:149, :198, :496).
7. The hostModes context passes `listModels()`, `modelInfo(id)`, `setModel` and `setEffort`. The plugin does not import the model registry directly, because a separate copy of core could hold an empty registry (UNVERIFIED, see section 8).
8. If a model has no effort levels, omit the effort option.

## 5. Next work (in order)

1. Run the core gate on 0887f97 and confirm the only failures are the 3 known reds.
2. Phase 0 (Ronald): the shared mapper, as a pure refactor. No golden test edits.
3. Core PR (Ronald), tests first: setModel validation, setEffort/getEffort, the adoptModelId path and the `model_adopted` notice.
   - Add the case to `formatTurnNoticePlain` (agent/turn-notice.ts:203 has an exhaustive `never`).
   - TurnNotice is a PUBLIC type (`./sdk/turn-notice`), so add a CHANGELOG line.
   - A grep of cli and web found no exhaustive switch to break.
4. Thinking-history test: a thinking turn, then setModel, then a prompt. If the provider rejects the history, STOP and report.
5. The hostModes slot (agreed with Ronald): a branch in `main()` after `bootSessionStores` (index.ts:952) and before the ready banner (:1050) and the resume header (:1078), both of which write to stdout. It sits next to the `resume-mode.ts` predicates. NOT run-subcommand.ts: it runs at index.ts:261, before `PluginLoader.load` (:570), so it cannot dispatch plugin modes.
6. ACP plugin Level 1. Write the spawn test first.
7. Follow-up (Ronald): the `main().catch` → `process.exit(1)` tail can cut off stdout before it is flushed. Check it for ACP and stream-json.
8. Follow-up (separate core issue): chain hooks fail OPEN (see section 6).

## 6. Open for Gaston

- Is the `hostModes` contract OK?
- May plugins depend on the core pin?
- The ACP SDK as a dev-only test client (team says no).
- The mapper export path.
- The legacy path list.
- Q15: the narrowed shared-code rule.
- A separate core issue: chain hooks fail OPEN (hook-bus.ts:157-168, lifecycle-port-adapter.ts:139-141).
- Should model and effort changes persist on resume? Today they do not (session-store.ts:592-624).
- Should the plugin switch models through Session.setModel/setEffort wrappers, or through a switch function in the hostModes context?
- Switching to another provider's model mid-session, later?
- Single-session boot: index.ts `main()` builds ONE session from process-global state (packet 7e/7f). So the choice is either multi-session ACP in one process (costly) or one process per session.

## 7. Rules for the next agent

- Run every command from the monorepo root.
- Work inside the submodules. Push the submodule first, then bump the pin.
- Never use `git submodule update`, force push, `--no-verify` or `reset --hard`.
- Commits use Conventional Commits plus a `Co-authored-by: {Name} <{short-sid}@minimal-agent>` trailer.
- Runtime: `bun`, `bunx` and `uv run`. No runtime dependencies.
- `tmp/sync/sync-remote.sh` is a safe sync script (fast-forward only). It is gitignored.

## 8. Unverified

- The thinking-block signatures after a model switch.
- How a resumed session picks its model.
- Whether "core resolves each plugin's import to its own copy" (root AGENTS.md:142) means the plugin's own copy or the host's.
- Whether the arch test accepts a re-export barrel for the mapper.
