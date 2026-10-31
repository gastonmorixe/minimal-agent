# Packet for Gaston: ACP interoperability (decisions needed)

From: Amber (17855fb3), with Emma (db09fa39) and Ronald (fd5aa0d3). Date: 2026-10-31.
One source of truth: the files below. This page is only the index and the questions.

## Read these

1. `research/2026-10-31-acp-plugin-spec-v3.md` (spec v3.1, Emma). The plan, with sources and tags.
2. `research/2026-10-31-wire-event-mapper-design.md` (Amber). Neutral types, stop map, tool table.
3. `research/2026-10-31-acp-core-facts-R1-R3-R4.md` (Ronald). Core facts with file:line.
4. `research/acp-spike/` (Amber). 97-line agent plus 87-line client, zero dependencies, Bun built-ins. Run: `cd research/acp-spike && bun run drive.ts`.

## What the team agreed (all three)

- ACP and `--output-format` both stay. stream-json keeps its bytes.
- ACP is a plugin (`ma-acp-plugin`). It runs INSIDE the host, through a new manifest field `hostModes`. A separate bin was judged worse than hostModes: no SINGLE public call boots a Session with the host's plugins, tools, and hooks. UPDATE (origin/main 4b1c828, checked by Amber and Emma): main now exports 45 `./host/*` pieces and 19 `./host-kit/*` pieces: build-agent-core (`buildAgentCore`, `openAgentCoreSession`, `BuildAgentCoreDeps`), the eight sdk adapters (lifecycle-port, media-resolver, mode-provider, prompt-contributor, session-persistence, tool-executor, tool-registry), `PluginLoader`, command-registry, modes, auto-ask, hooks, plugin-stream, session-store, blob-store, file-tracking-store, feedback-tracker, auto-plugins, plus `./host/provider-discovery-boot` (`bootProviderDiscovery`). So a bin is POSSIBLE. What is still missing: no single boot call, and two boot helpers that `index.ts main()` uses are NOT public (`resolveStartupProviderState` in provider-boot.ts, `bootSessionStores` in session-store-boot.ts; no matching export in package.json). A bin would also re-compose the rest of `main()` (lines 190 to 1246: auth, model choice, mode manager, saveEcho, turnAttachments) and would lose the host-only lifecycle hooks (turn.willStart, sessionStart/End, cwdDidChange). The plugins repo pin (57181d54) is OLDER than these exports, so a plugin needs a pin bump first. Team vote stays hostModes (Amber, Emma). Ronald: A unless a single boot call exists (none does).
NOTE: main moves fast. Every tree tag in this packet is `origin/main 4b1c828`. Re-check before you decide.
- Zero third-party runtime dependencies. We hand-roll the transport (about 100 lines, spiked).
- The plugin builds on the runtime Session. It does not import legacy shapes (`src/llm/adapter-legacy.ts`).
- Stop reasons: decided, with sources. Refusal ends as a normal turn in core, so ACP must read the last turn's stop reason.
- Approval gate: a plugin hook that waits for the editor. Own deadline, deny on every failure path, two tests.
- Stdout carries only ACP messages. Negative control: a MANUAL run (a copy of the agent with one human line printed to stdout) made the check fail with exit 1. `drive.ts` has no negative-control path yet. The plugin's spawn test must include one.

## Decisions we need from you

1. **hostModes.** OK to add a `hostModes` contribution to the plugin manifest (public contract change in plugin-api, plus a dispatch slot in the host)? Alternative C: extract a public `bootHost` into `src/host-public/boot.ts` (a large move out of index.ts, size is an ESTIMATE, not measured). All three of us prefer hostModes.
2. **Core pin.** May `ma-acp-plugin` depend on `@minimal-agent/core` through the root git pin? Existing plugins already do (plugins root package.json:28-29).
3. **ACP SDK as a test-only devDependency.** All three say NO (a hand-written test client also checks our framing). Core AGENTS.md:33-35 lists only toolchain devDependencies.
4. **C2 deviation.** Your rule was one shared mapping layer for both outputs. We propose: stream-json stays on AgentEvent plus envelope (its bytes are pinned by goldens). ACP uses shared pure helpers plus its own encoder. Is that enough?
5. **Mapper export path.** A new file re-exported from `./sdk/events` needs no new public subpath. A new subpath needs edits to BOTH `package.json` exports AND `src/architecture/public-exports.json` (the list the arch test reads, origin/main public-api.test.ts:42-46), and your OK.
6. **Where the command lives.** Team opinion: `minimal-agent-cli`.
7. **Legacy paths.** Full list of legacy paths the plugin must never import. We only know `src/llm/adapter-legacy.ts` (legacy shapes) and that the legacy `Agent` class is gone (core AGENTS.md:242-245).

7b. **hostMode permission and opt-in.** A host mode owns stdin and stdout for the whole process, which is more power than any current contribution. Vote [Emma, Amber]: require BOTH a manifest permission token `hostMode:stdio` AND the user enabling the plugin (the `enabled` field exists). Do you agree?
7c. **sessionStart and sessionEnd count.** `index.ts` fires them once per process. ACP has many sessions per process. Team default: fire per ACP session. Plugins that count sessions would see a different number than in the REPL. OK?
7d. **Per-session working directory.** Core uses `process.cwd()` in tool-round.ts (lines 194, 507, 628) and nothing calls `process.chdir`. Level 1: the first session fixes the cwd, a `session/new` with a different cwd is rejected. A real fix is a later core change. OK?
7e. **Cost of hostModes is higher than first said (UNMEASURED).** `index.ts main()` builds ONE session through process-global state (`getSessionId()`, `getLiveModelId`, one captured `agent`, `bootSessionStores` for one `sid`, `InteractiveSession.create` with one set of `initialMessages`). ACP needs many sessions per process. So the host mode cannot just branch before the banner. The host needs its own per-session `openSession` built from the exported pieces. This raises the cost of option A and of the boot-extraction option alike. We have not measured it. Details: `research/2026-10-31-hostmodes-contract-draft.md` section 7b. Do you want a measured estimate (a spike) before you decide on item 1?
7f. **Fallback that may make Level 1 cheaper: one process per ACP session.** [Emma] If each ACP session runs in its own process, the existing single-session boot works unchanged and the host needs no per-session open path. Cost: more processes, and it is UNVERIFIED whether Zed and JetBrains accept an agent that serves one session per process (ACP's `session/new` can be called more than once on one connection, so a client that expects many sessions on one connection would break). Facts that back the cost claim [Emma, verified]: `bootSessionStores` takes ONE `sid` and `resumeSid` and writes files (`SessionStore.open` for a new session, `SessionStore.fork` plus the `<sid>.*` sidecar copy for resume, session-store-boot.ts:85-107). `InteractiveSession.create` builds one global `agent`. `hostLifecycle.sessionStart` reads the process-global `getSessionId()`. The compact and continue commands close over that one agent. `getLiveModelId = () => agent.getModel()` is a rebinding (index.ts:568 and :1037) read by the model-info tool (:585), so with many sessions that tool would report the wrong session's model. We have NOT read the body of `bootSessionStores`, so whether it can run once per ACP session is OPEN. Choose: (a) many sessions per process (needs the per-session open path, cost up, unmeasured), or (b) ONE session per process at Level 1 (cheap, but a second `session/new` on the same connection is rejected). Test 18 of the transport design (two sessions in one process) is Level 2 or later if you pick (b).
8. **Model and effort switching (you ordered it, via Olivia a982c935).** The ACP plugin will offer `model` and `effort` as session config options and handle `session/set_config_option`. It needs a small core change (`AgentCore.setEffort`, `getEffort`, and validation in `setModel`), through the existing `./sdk/agent-core` subpath, as its own PR after PR #5. Decision: should the plugin reach it through `Session.setModel` and `Session.setEffort` wrappers, or through a switch function in the hostModes context? No new subpath either way. Design: `research/2026-10-31-wire-event-mapper-design.md` section 7a, spec v3.1 section 10b.
9. **Same-provider models only at Level 1?** Team vote: yes. `AgentCore.providerId` is fixed (agent-core.ts:149, :198, :496), so a cross-provider id would hit the old transport.
9b. **Cross-provider switching later: yes or no?** It needs a core change (re-create the transport and auth). We have not designed it.
10. **Do model and effort changes persist in the session (resume)?** Today they do NOT: the session meta record writes `model` once and has no effort field (`src/session/session-store.ts:592-624`, origin/main). Only the REPL error picker calls `setModel`. Level 1: session-local. Do you want persistence later?
11. **Notice for an automatic model change (FYI, decided by Olivia, Ronald, Amber).** A new core notice `model_adopted {from, to, effortReset, effortFrom}`, severity "info", emitted when preflight adopts another model (agent-core.ts:460). It also appears in `json` and `stream-json` output as an added notice kind, so it is a visible change for those readers. Ronald owns the core PR.

## Separate issue (security), not part of PR #5 or the ACP work

**Core: chain hooks fail open.** Any approval-style `beforeTool` hook in any plugin is skipped when it throws or times out, and then the tool RUNS.
- `src/plugins/hooks/hook-bus.ts` emitChain, lines about 155-170: a throw or timeout is reported, then `continue`.
- `src/host/sdk-adapters/lifecycle-port-adapter.ts` lines about 139-141: `catch { return allowDecision(payload) }`.
Fix idea: a fail-closed listener option for approval hooks. The ACP plugin works around it (no `timeoutMs`, own deadline, try/catch returns deny).

## Finding: process.exit loses data on a slow pipe (Bun 1.4.4), affects PR #5

MEASURED by Amber and reproduced by Emma: after a large write to a pipe, `process.exit(0)` loses output when the reader is slow. 1 MB and 8 MB payloads with a 5 ms reader lost data on 5 of 5 runs. Setting `process.exitCode` and letting the loop drain lost nothing. The "write an empty chunk, then exit in the callback" trick still loses data. Source for the cause: oven-sh/bun PR #45319 (open, not merged, conflicts with main). Harness: `research/acp-spike/pipe-flush`. Ronald decided: the event-stream route will not call `process.exit` after stdout writes, and a worker picks the exact fix. The ACP plugin follows the same rule.

## Status of PR #5 (stream-json), from Emma and Ronald

NOT merged. PARTLY pushed [Ronald, code-verified, rechecked by Amber with git at 16:29]: `origin/feat/stream-json-gaps` is at 5bb08e4, with 2006a26, 81d5de9 and cc7d359 below it. NINE commits are local and unpushed [Amber, `git log origin/feat/stream-json-gaps..HEAD` at 16:40, read-only]: 540020c, 6d28dcd, 5eb6182, 80f2c01, 107f770, 54d1aba, d9abc72 (e2e: spawn the CLI to check the stream-json session wiring), 26aebc9 (e2e: a large stream-json success run keeps every line), 7be64cf (end the event-stream route by exit code, not process.exit). The last three are new since Emma's list of six. Emma's approval of d9abc72, 26aebc9 and 7be64cf: not known to me.
7be64cf reviewed by Amber, read-only, from the diff (I did not run its tests): the fix is `process.exitCode = code` plus return instead of `process.exit(code)` on the waiting and failed paths of `runCoreEventStream` (run-non-interactive.ts). New test `stream-json-exit-tail.test.ts` spawns a child with the real stdout, reads it with a 5 ms pause per read, 5 runs at 70 KB, 1 MB, 4 MB, asserts exit code 1, last line `run_finished` with outcome `waiting`, and fails if the child does not end by itself within 30 s. Known gap [Ronald, in the commit message]: `main().catch` still calls `process.exit(1)` after writing the failure lines (index.ts:1305), so a thrown error after a large stream can still lose the queued tail. It becomes a tracked "known gap" in the PR body plus a follow-up outside PR #5 (scope).
Fail-first PROVEN [Ronald, 16:42, throwaway worktree at 7be64cf with ONLY run-non-interactive.ts reverted to the parent 26aebc9, `bun test src/host/startup/stream-json-exit-tail.test.ts`]: without the fix 70 KB passes, 1 MB fails (expected 0 lost, received 5), 4 MB fails (expected 0, received 5): 1 pass, 2 fail. With the fix: 3 pass, 0 fail. Same file, same harness. It goes in the PR body. The PR body will also say the test child bypasses index.ts (no plugins, provider warmups or hooks). Cheap follow-up idea [Amber, Ronald logs it, NOT in PR #5]: an architecture test that fails on `process.exit(` inside run-non-interactive.ts.
Review status [Emma, in team chat, not a PR review]: approved 2006a26, 81d5de9, cc7d359, 5bb08e4, 540020c, 6d28dcd, 5eb6182, 80f2c01, 54d1aba (Emma ran 158 tests, 0 fail, typecheck 0, on the working tree). 107f770 is approved in design only, with two required checks open: a spawn test for the pipe flush before exit, and the REPL guard.

MAIN MOVED. origin/main is now 4b1c828, the PR base is 4a229cb. One real conflict [Ronald]: `src/host/sdk-adapters/build-agent-core.ts`, between his local C5a (adds `sessionId` to `BuildAgentCoreDeps` and an `id` spread) and main's 6d2ed87 (S34 fold). I checked the PUSHED part (5bb08e4) against main with `git merge-tree`: clean, no overlapping files. The conflict comes from the local commits. Plan [Ronald, Amber and Emma agree]: a MERGE commit of origin/main into the branch, plain push, no rebase and no force push, because a rebase would rewrite four pushed commits. The fast-forward plan no longer works.

Gate status, stated exactly [Ronald]:
- The full core `bun run check` has NOT run on the latest local head or on the merged tree yet (it is running in a throwaway worktree).
- Earlier results: `test:arch` passed 184/0. The full suite failed only 3 tmux tests.
- PROVEN on clean `origin/main` 4b1c828 [Ronald, worktree `tmp/core-main`, `bun install --frozen-lockfile`, with the gitignored local driver `tmp/truncation-tmux-driver.ts` copied in]: the SAME 3 tests fail on plain main. `src/bus/abort-keystroke-tmux.test.ts`: 1 pass, 2 fail (kitty CSI-u Ctrl+C, kitty CSI-u ESC). `src/e2e/truncation-tmux.test.ts`: 1 fail (Read of a huge file shows `[truncated: ...]`). On the merged tree (main plus our commits): 5138 pass, 3 fail. On our branch: 5122 pass, 3 fail. So: "3 tmux tests fail on clean main on this machine. Our merge adds no new failure." Caveat: the truncation test needs a gitignored local driver, so on a fresh clone it SKIPS and CI may never run it.
- The web e2e was not run (the Playwright browser is missing).
Nothing about PR #5 is "green" or "done". Next: merge main, full gate on the merged tree, Emma's OK, plain push.
Follow-up idea [Emma]: replace `exit(1)` on the event-stream route with `process.exitCode` only AFTER a spawn test shows the data loss on our real CLI.

## Order of work (once you decide)

0. PR #5 merges (Ronald, after the merge-from-main step above). It owns events.ts, run-non-interactive.ts, stream-json-writer.ts, index.ts until then.
1. Phase 0: shared helpers and mapper types (Ronald), stream-json tests stay green, no golden edit.
2. Phase 1: hostModes contract, then `ma-acp-plugin` Level 1 (initialize, session/new, session/prompt, session/cancel) with a spawn test first.
3. Phase 2: gate tests, session/load, modes, plan, images. Phase 3: client fs and terminal.

## Hygiene

- Spike left no tracked file changed. `git status` at the root shows only two submodule pointers (` M minimal-agent-core` is Ronald's branch, ` M minimal-agent-web` is not ours). Nobody should commit a pin bump by accident.
- Stage explicit paths only.
