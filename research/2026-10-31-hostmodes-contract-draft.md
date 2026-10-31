# hostModes contract: draft text (design only, no repo edit)

Author: Amber (17855fb3). Status: DRAFT for review by Emma (db09fa39), Ronald (fd5aa0d3), and Gaston's OK (public contract change).
Date: 2026-10-31. Tree: origin/main 4b1c828 unless noted. Tags: VERIFIED / OPINION / OPEN.
Emma's two rules for this text: (1) name the dispatch slot, (2) say who calls turn.willStart, sessionStart, sessionEnd around each ACP prompt.

## 1. Why a manifest contribution

A plugin cannot own a run mode today. VERIFIED [Emma, Amber, Ronald]: no subcommand, bin, or run-mode contribution exists in the manifest (plugin-api/src/types/plugin.ts:443-626 lists prompt, setup, promptFragments, tuis, modes, events, hooks, liveAreaSlots, commands, permissions and others).

## 2. Where the slot goes: facts from index.ts on main 4b1c828

Boot order in `src/index.ts main()` (lines 190 to 1246, VERIFIED [Amber]):
1. :254 `bootProviderDiscovery`
2. :261 `runStartupSubcommand` (the hard-coded switch, returns true when it handled the command)
3. :358 `resolveStartupProviderState`
4. :570 `PluginLoader.load` (plugins and their manifests load HERE)
5. :952 `bootSessionStores`
6. about :1100 to :1128 session-start work, resume header, draft restore
7. :1130 `const prompt = await extractPrompt()`; if there is a prompt: `runNonInteractivePrompt` (:1133)
8. else :1214 `runRepl` (or the live-area stack)

Consequence, two facts that decide the design:
- The built-in subcommand switch (`runStartupSubcommand`, run-subcommand.ts:65 onward, cases dump, sessions, usage, list-*, login, logout, auth-status) runs at step 2, BEFORE `PluginLoader.load` at step 4. So a plugin-provided mode cannot be dispatched from that switch: the plugin is not loaded yet. A slot there would force loading plugins early, which changes boot for every command.
- The natural slot is step 7: AFTER full boot (provider, auth, loader, modes, stores) and at the same branch where the host already chooses between "answer one prompt" and "start the REPL". That is where a third choice, "hand the process to a plugin host mode", fits.

Recommended dispatch slot (OPINION, Amber): a flag in the argv parser plus a branch at step 7.
- `parse-argv.ts` gets one generic flag `--host-mode <id>` (the plugin does not add flags itself, avoiding unknown-flag errors and the old flag registry).
- `command-plan.ts` (CommandName union at the top of the file, VERIFIED) gets a `"host-mode"` command with capabilities `{needsStartupUi: false, needsAuth: true, needsNetwork: true, needsFormatter: false, needsQuota: false, supportsPromptInput: false}` (the CapabilityName fields are VERIFIED, the values are my proposal).
- In `main()`: `if (commandPlan.command === "host-mode") { await runHostMode(...) }` placed after the session stores boot (:952) and BEFORE the ready banner at :1050-1054 and the resume block at :1078 (see 7a item 9: both write to stdout). The first draft said "step 7 before extractPrompt", which is too late.
- Why not the subcommand switch: it runs before plugins load (above). Why not a bare `minimal-agent acp` positional: see 7a item 1. Positional words exist (`src/cli/cli-args.ts` SUBCOMMANDS table), but that table is static, so `acp` would hard-code a plugin id in core and break C3. A flag matches how plugin ids stay out of core.
- OPEN: user-facing spelling. `minimal-agent --host-mode acp` is accurate but long. A plugin could declare an alias (`--acp`) in the manifest and the parser could read aliases from loaded manifests, but parsing happens BEFORE plugins load (step 4). So an alias would need a static registry. Decision: `--host-mode acp` only, and let the editor config carry the long form.

## 3. Manifest field (OPINION)

```jsonc
// manifest.json
"hostModes": [
  {
    "id": "acp",                       // matched against --host-mode <id>
    "description": "Agent Client Protocol over stdio",
    "entry": "./host-mode.ts",         // default export: HostModeHandler
    "permissions": ["hostMode:stdio"]  // OPEN: new permission token? see section 6
  }
]
```

```ts
// plugin-api (types only)
export interface HostModeContext {
  argv: readonly string[]            // args after --host-mode <id>
  stdin: NodeJS.ReadStream
  stdout: NodeJS.WriteStream         // the host guarantees nothing else writes here
  stderr: NodeJS.WriteStream
  abort: AbortSignal                 // process shutdown (SIGTERM, SIGINT)
  cwd: string
  env: Record<string, string>
  log: PluginLogger                  // writes to stderr
  runtime: HostRuntime               // see below
}
export interface HostRuntime {
  openSession(opts?: { sessionId?: string; resume?: boolean }): Promise<HostSession>
  listModels(): ModelView[]          // current provider only, decided by Olivia
  modelInfo(id: string): ModelInfoSnapshot | undefined
  listSessions(): SessionIndexEntry[]            // for session/list, Level 2
  commands(): CommandInfo[]                      // available_commands_update, Level 2
  modes(): LoadedMode[]                          // session modes
}
export interface HostSession {
  readonly sessionId: string
  run(input: string, opts: { emitDeltas: true; signal: AbortSignal }): AsyncIterable<SessionEntry>   // string, like Session.run (runtime/session.ts:170-173). The plugin flattens ACP ContentBlock[] (text, resource_link) to a string.
  answer(askId: string, value: string): void     // PendingAskRegistry (runtime/session.ts:100-111)
  getModel(): string
  setModel(id: string): void                     // checked setter, Ronald's core PR
  getEffort(): string | undefined
  setEffort(level: string | undefined): void
  close(): Promise<void>
}
export type HostModeHandler = (ctx: HostModeContext) => Promise<number>  // resolves to exit code
```

OPEN: `HostSession.run` returning `SessionEntry` exposes a core type through plugin-api. Plugin-api currently has no dependency on `src/sdk` types (VERIFIED: plugin-api/src has llm, net, types, utils). Either plugin-api re-declares a neutral `HostSessionEntry`, or `@minimal-agent/core` root export types are imported by the plugin (0 plugins do that today [Ronald]). Decision needed.

## 4. Who calls the host-only lifecycle hooks (Emma's rule 2)

VERIFIED [Ronald, R4]: `sessionStart`, `sessionEnd`, `cwdDidChange`, `instructionsDidLoad` are called only from `src/index.ts` (:632-642, :1024, :1186, :1249). `turn.willStart` is applied by the host (`applyTurnWillStart`, run-non-interactive.ts:265), not by AgentCore.

Contract (OPINION): THE HOST calls them, never the plugin.
- `sessionStart` and `sessionEnd`: once per `openSession` and per `close`, called inside the `HostRuntime` implementation, so every ACP session fires them exactly like a REPL session.
- `turn.willStart`: called by `HostSession.run` before the first model request of each `session/prompt`, the same way run-non-interactive.ts:265 does it.
- `turn.didEnd`, tool hooks, send hooks: already fire on the Session route (VERIFIED [Ronald]: build-agent-core.ts:221-222, 352-353).
- `cwdDidChange`: ACP `session/new` carries `cwd`. OPEN: does a session with a different cwd than the process need `process.chdir` (affects every tool), or a per-session cwd in the Session options? Core uses `process.cwd()` inside tool-round.ts (VERIFIED: tool-round.ts:507 `cwd: process.cwd()`), so per-session cwd is NOT supported today. For Level 1, a second session with another cwd is an error or a documented limitation. Needs a decision.
Test (host side, before any plugin exists): a fake host mode asserts the order sessionStart, turn.willStart, tool hooks, turn.didEnd, sessionEnd with a recording hook plugin.

## 5. Host guarantees

0. NEVER call `process.exit` after NDJSON writes (Ronald's request, 16:35). PROVEN on our own CLI route [Ronald, spawn tests, 5 runs each, 5 ms-per-read reader]: on the `exit(1)` waiting path (run-non-interactive.ts:233) 70 KB lost 0 of 5, 1 MB lost 5 of 5, 4 MB lost 5 of 5 (the last line was not `run_finished`). The success path does not lose data because it returns before `process.exit` (index.ts:1231 versus :1295). Rule for a host mode: end by returning an exit code that the host applies with `process.exitCode`, then let the loop drain. This also covers the plugin's own process. (My independent measurement of the same effect on Bun 1.4.4: research/acp-spike/pipe-flush.)
1. Boot is complete: providers, auth, plugins (and their hooks), tools, modes, stores.
2. stdout is clean: the host installs a guard BEFORE calling the handler: it replaces `console.log` with a stderr writer, and it does not print any startup row, banner, or resume header to stdout in this mode (the stray-stdout class of bug found at index.ts:1074 and :303). Verified by the same spawn purity test.
3. Shutdown: the host never calls `process.exit` after stdout writes (measured, Bun 1.4.4). The handler's returned exit code is applied with `process.exitCode`, then the loop drains.
4. Errors: a rejected handler promise becomes exit code 1 plus a stderr message, never a stdout line.
5. The mode does not open the TUI, does not read the TTY, does not start the live area, does not start quota polling (`needsQuota: false`).

## 6. Security and permissions (OPEN)

- A hostMode owns stdin and stdout: that is a large capability. Should it require an explicit permission token in the manifest and a user opt-in (`enabled` in config)? The loader already rejects hook subscriptions without matching permissions (plugin.ts hooks docs), so a `hostMode:stdio` token fits the pattern. Needs a decision with Gaston.
- Fail-open hooks (separate issue): the ACP approval gate relies on a `tool.willInvoke` chain hook. The host must not add its own timeout to it (`timeoutMs` makes a timeout a SKIP, hook-bus.ts:163-168).
- Only ONE host mode can run per process (it owns stdio). A second `--host-mode` is a usage error.

## 7. Tests the host change needs (written first)

1. `--host-mode acp` with the plugin missing: exit 2, one stderr line, nothing on stdout.
2. `--host-mode unknown`: same.
3. Boot runs once and plugins load before the entry is called (a recording plugin proves order).
4. `HostModeContext.stdout` purity: the handler writes one line, the process prints nothing else to stdout (spawn).
5. Lifecycle order test (section 4).
6. Exit code: handler resolves 0 gives exit 0, resolves 3 gives exit 3, rejects gives exit 1, all with stdout drained (slow reader, 8 MB).
7. No TTY needed: runs with stdin as a pipe and stdout as a pipe.
8. Normal commands (REPL, `--prompt`, `--list-models`) unchanged: the existing CLI tests are the net.

## 7a. Decisions and corrections from Emma's and Ronald's reviews (2026-10-31 16:32)

1. Positional claim FIXED and VERIFIED [Emma found it, Amber read it]: the file is `src/cli/cli-args.ts` (NOT src/host/cli/, my first lookup used the wrong path). `normalizeArgs` is at :191 and the static `SUBCOMMANDS` table at :75-95 maps positional words to flags: models, models-live, providers, flags, plugins, spinners, sessions, resume-same, usage, resume, login, logout, auth-status, help. So positional subcommands DO exist (my earlier "no positional parsing" was wrong). The real reason for `--host-mode acp` and not a positional `acp`: a positional name would HARD-CODE a plugin id in core's static table, which breaks C3 (nothing ACP in core). Section 2's "no positional parsing" sentence is wrong and replaced by this.
2. Q-H3 DECIDED [Emma, Amber agree]: Level 1, the first session fixes the process cwd. `session/new` with a different `cwd` gets JSON-RPC -32602 with the reason. NEVER `process.chdir` (it changes every tool of every session). Evidence [Emma, VERIFIED]: tool-round.ts uses `process.cwd()` at lines 194, 507, 628 and no non-test code calls `process.chdir`. Later core item: a per-session cwd option in Session and tool-round.
3. Q-H4: YES, both a manifest permission token `hostMode:stdio` and the user enabling the plugin (`enabled` field exists). Votes: Emma YES, Amber YES. Gaston decides. In the packet.
4. Prompt conversion [Emma, VERIFIED runtime/session.ts:170-173]: `Session.run(input: string, ...)` takes a STRING, ACP prompts are ContentBlock[]. Level 1: accept `text` and `resource_link` blocks only, flatten to one string (resource_link becomes a reference line). `image`, `audio` and embedded `resource` blocks get -32602, and `promptCapabilities` is advertised with explicit values `{image: false, audio: false, embeddedContext: false}`. Images later via media/ingest.ts. The conversion lives in the plugin, not the host. `HostSession.run` should take `string`, not `ContentBlock[]`. Type sketch in section 3 to be changed: `run(input: string, ...)`.
5. Event kinds [Emma, VERIFIED runtime/session.ts:151]: the Session log captures ALL kinds, so entries already carry tool_call and tool_output. The plugin passes only `emitDeltas: true`, no `kinds` list.
6. Stdout guard strengthened [Emma]: a guard that reroutes only `console.log` does not stop a direct `process.stdout.write` from other code (the index.ts:1074 class). The guard must ALSO wrap `process.stdout.write` so that only the handler's writer may write. OPEN: how to tell the handler's write from a stray one: a token object passed into the writer (`writer.write(token, obj)`), any other write goes to stderr and is logged. Core already has `src/architecture/no-direct-writes.test.ts` that fails on `console.*` and `process.stdout.write` in core code (per changelog, UNVERIFIED by me).
7. `--host-mode` combined with `--prompt` or `-` (stdin prompt): usage error, exit 2. Add to host test 2.
8. sessionStart/sessionEnd count [Emma]: `index.ts` calls them once per process, ACP has many sessions per process. OPEN, needs Gaston or a plugin owner: fire per ACP session (my draft) or once per process. Plugins that count sessions care. Team default until decided: PER ACP SESSION, documented.
9. Banner and resume block [Ronald found it, VERIFIED by Amber on origin/main 4b1c828, src/index.ts]: TWO stdout writes happen before :1130 when there is no prompt.
   - :1050-1054: `const willEnterRepl = promptSource.kind === "none"`, then `process.stdout.write(buildReadyBanner(modeManager, stdoutCols))`. `promptSource` comes from `extractPromptFromArgs(args)`, so a host-mode run (no `--prompt`) has kind "none" and WOULD print the ready banner to stdout.
   - :1078-1090: `shouldEmitResumeBlock = isInteractiveResume && (...)` where `isInteractiveResume = resumeSid && !args.includes("--prompt")`, then `process.stdout.write(buildResumeHeader(...))`, plus a replay block after it. A host-mode run with `--resume` would write the header and the replayed history to stdout.
   Both break ACP's NDJSON. My earlier slot "before extractPrompt at :1130" is TOO LATE. Corrected slot: after the session stores are booted (:952) and BEFORE :1050. Two ways, pick in the PR: (a) put the host-mode branch before :1050, or (b) make `willEnterRepl` and `isInteractiveResume` false when `commandPlan.command === "host-mode"`. DECIDED 16:34 [Ronald, Amber agree]: option (b). Reason [Ronald]: the two predicates already exist on his PR #5 branch as `host/startup/resume-mode.ts` (`isInteractiveResumeRun`, `wantsStreamJsonFailureLines`), so a host-mode check sits next to them and is read by the same callers. UNVERIFIED by me: that file is on his local branch and is not pushed, so I cannot read it. The host-mode PR must wait for PR #5 anyway. (Earlier I leaned to (a) as simpler to audit. (b) wins because it keeps one place that decides "is this run allowed to write human text to stdout".) This is also exactly the bug class the stdout guard (item 6) must catch: a spawn test with `--resume` must show zero non-JSON-RPC lines.

## 7b. What runs between :952 and :1050, keep / skip / move (Emma's request, VERIFIED by Amber from `git show origin/main:src/index.ts | sed -n 952,1050p`, origin/main 4b1c828)

| Step in index.ts | What it does | Writes to stdout? | Host mode |
|---|---|---|---|
| `bootSessionStores({sid, resumeSid, resumeSameSid, selectedModel, providerId, credentialName, systemHash, toolsHash})` (:952) | creates the session store, blob store, file-tracking store, for ONE `sid` | no (not found) | KEEP, but it is built for ONE session. ACP has many sessions: each `session/new` needs its own store. MOVE this call into `HostRuntime.openSession` |
| `new ToolTimeTracker()` (:~970) | shared day-state for tool headers in replay and live | no | SKIP in host mode (cosmetic, tied to the TUI replay) |
| `--output-schema` read and parse (:~978-990) | reads a file, on failure `process.stderr.write` then `process.exit(1)` | no (stderr) | SKIP. ACP has no output-schema. Note `process.exit(1)` here: after no stdout writes yet, so it is safe for data loss, but a host mode should not use it |
| `createMdstreamCodeHighlighter(formatterCmd)` and `warmup()` (:~995-1000) | starts a formatter helper | no (not found) | SKIP. It is a terminal rendering helper (may spawn a process: UNVERIFIED) |
| `InteractiveSession.create({... initialMessages, store, blobStore, ...})` (:1001-1030) | builds the ONE global session with `initialMessages` from `--resume` | not found in `InteractiveSession.create` (I grepped process.stdout and console in interactive-session.ts: no hit near `create`) | MOVE. This is the single-session design the host mode must NOT use. The host mode needs `openAgentCoreSession`/`Session` per ACP session (the host-kit exports). `InteractiveSession` is TUI-flavored: it wraps one Session (`this.session.agentCore()`, interactive-session.ts:283, :287) |
| `hostLifecycle.sessionStart?.({sid: getSessionId(), cwd, model})` (:~1033) | fires the host-only hook ONCE | no | MOVE into `openSession`, per ACP session (decision 7c). `getSessionId()` is a PROCESS-GLOBAL: ACP needs one id per session |
| `registerCompactHostCommand(loader, agent)`, `registerContinueHostCommand(loader, agent)` (:~1038) | registers `/compact`, `/continue` slash commands bound to THE agent | not found | MOVE, per session, or SKIP at Level 1 (slash commands are Level 2/3). They close over one `agent`, so they cannot serve many sessions as written |
| `getLiveModelId = () => agent.getModel()` (:~1044) | a module-level rebinding to the live model | no | MOVE: process-global again. With many sessions "the live model" is per session |
| `extractPromptFromArgs(args)` and the banner (:1050-1054) | prints the ready banner when no prompt | YES | SKIP in host mode (the stdout hazard) |

THREE findings that go beyond what the team had:
1. `main()` builds ONE session through module-level state (`getSessionId()`, `getLiveModelId`, the `agent` variable captured by the compact and continue commands). A host mode with many ACP sessions cannot reuse this section. It must build sessions through the exported pieces (`openAgentCoreSession`, `Session`) one by one. That makes the hostModes entry more than "branch before the banner": the branch must come BEFORE `InteractiveSession.create` (:1001) too, and the host must own a `openSession` that does the per-session part of this block.
2. The branch point is therefore after `bootSessionStores`'s ONE-TIME parts but before the per-session parts. Today `bootSessionStores` bundles both (it takes `sid`, `resumeSid`). OPEN: split it into a process-level part (paths, config) and a per-session part, or call it once per ACP session with a fresh `sid`. Calling it per session looks possible, I did not verify its side effects (it may write files, check hashes for resume drift).
3. Because of finding 1, extracting `bootHost` (option C in the spec) would face the same problem: the boot ends with a single-session assumption. Option A's host-side `openSession` has to solve it either way. Cost estimate of the hostModes PR goes UP. I did not measure it. Tell Gaston.

Test line [Emma]: a host-mode run prints NOTHING on stdout before the handler writes (spawn test, `--host-mode` with and without `--resume`, with a slow reader).

## 8. Open questions for the team

- Q-H1: flag spelling and the static-registry problem for aliases (section 2).
- Q-H2: `HostSession.run` yields a core type, or a neutral plugin-api type (section 3).
- Q-H3: per-session cwd (section 4).
- Q-H4: permission token and opt-in (section 6).
- Q-H5: ownership: `index.ts` is Ronald's until PR #5 merges. This change touches index.ts (one branch at step 7), parse-argv.ts, command-plan.ts and plugin-api types. It must be its own PR after PR #5 and after Phase 0, and needs Gaston's OK for the plugin-api contract.
