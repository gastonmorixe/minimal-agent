# ACP Level 1: transport design and spawn test plan (design only, no repo edit)

Author: Amber (17855fb3). Status: DRAFT for review by Emma (db09fa39) and Ronald (fd5aa0d3). Date: 2026-10-31.
Tags: VERIFIED (measured or read this session) / OPINION / OPEN.
Rule: zero third-party runtime dependencies (core AGENTS.md:29-43). Bun built-ins only. Tests are written FIRST.

## 1. Scope of Level 1

Methods: `initialize`, `session/new`, `session/prompt`, `session/cancel` (notification). Updates: `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`, `usage_update`. Model and effort config options (Gaston's order) are Level 1.5: they need the core PR first (Ronald). No fs, no terminal, no permission, no `session/load` at Level 1.

## 2. Transport (hand-rolled) [VERIFIED by spike: research/acp-spike/agent.ts, 97 lines]

Parts, each a small readable file with its own test:

| File (plugin) | Job | Size estimate |
|---|---|---|
| `framer.ts` | split stdin bytes on "\n", UTF-8 decode with `stream: true`, max line guard (8 MiB), emit one string per line, never block the read loop | about 30 lines |
| `jsonrpc.ts` | parse, validate (`jsonrpc: "2.0"`, `method` string, id types number or string or null), dispatch requests and notifications, error codes -32700 -32600 -32601 -32602 -32603, pending map for agent-to-client requests with id counter and rejection on close | about 80 lines |
| `writer.ts` | THE ONLY place that touches stdout: one `write(obj)` that does `JSON.stringify` plus "\n". Rejects objects that stringify to text containing a raw newline (cannot happen with JSON.stringify, assert in test) | about 15 lines |
| `acp-types.ts` | our own minimal ACP v1 types for the methods we support, with the schema page cited in comments | about 80 lines |
| `agent.ts` | handlers: session map `sessionId -> {session, abort}`, prompt loop, cancel | about 150 lines |
| `encode.ts` | AgentEvent to ACP update (uses the shared pure helpers: stop cause, tool category, usage, severity map) | about 120 lines |

Rules (from the spec, stated again so tests can cite them):
1. stdout carries ONLY ACP messages. `console.log` is rerouted to stderr at boot. Children never inherit stdout (`stdio: "pipe"`).
2. Never call `process.exit` after writing to stdout. Set `process.exitCode` and let the loop drain. [VERIFIED, MEASURED: research/acp-spike/pipe-flush, Bun 1.4.4, `process.exit` lost data 5/5 at 1 MB and 8 MB with a slow reader, `exitCode` lost none]. Open: the lingering-handle hang risk of a natural exit. Test it.
3. Handlers never block the read loop (the spike uses `void dispatch(line)`). A prompt runs while a `session/cancel` notification can still arrive.
4. A `session/cancel` after the turn ended is a no-op. A cancel before a prompt starts must not cancel the NEXT prompt: the spike creates a fresh AbortController after a cancelled turn. [VERIFIED in spike]. OPEN: the cancel for a session with no running turn must not leave an aborted controller behind (check in test 14).
5. Cancel answers the prompt with `stopReason: "cancelled"` as a normal result. Catch the abort error and map it (ACP prompt-turn page, VERIFIED).
6. Request ids from the client can be numbers or strings. Echo them back unchanged (a string id "1" must not become the number 1).

## 3. Test plan (spawn tests, a hand-written client, a fake provider)

Harness: a `client.ts` test helper like `research/acp-spike/drive.ts` (`waitFor`, tolerant parse, purity check, negative mode). A fake provider (scripted: text deltas, a tool call, a refusal, a max_tokens, an error) injected through the Session so no network is used. OPEN: how the plugin gets a fake provider inside a spawned process (env var `MA_ACP_FAKE_SCRIPT=<path>` read only in a test build? Danger: a test hook in production code). Alternative: run the agent IN PROCESS with in-memory streams for logic tests, and use ONE spawned test only for the stdout purity and exit behavior. I prefer that split.

### 3a. In-process tests (fast, many)

| # | Test | Asserts |
|---|---|---|
| 1 | initialize ok | result has `protocolVersion: 1`, `agentCapabilities.loadSession: false`, `promptCapabilities` object, `authMethods: []`, no mcp capability |
| 2 | initialize with higher client version | agent answers with ITS version (ACP: "respond with the latest it supports") |
| 3 | prompt before initialize | JSON-RPC error (spec: clients MUST initialize first) |
| 4 | session/new returns a unique `sessionId` per call | two ids differ |
| 5 | session/new with `mcpServers` non-empty | ignored, no error, no mcp capability advertised |
| 6 | prompt streams text | N `agent_message_chunk` updates, all with the same `messageId`, then result `end_turn`, and every update comes BEFORE the result |
| 7 | thinking | `agent_thought_chunk`, and the signature is never sent |
| 8 | tool call | order: `tool_call` (pending) then `tool_call_update` in_progress then completed, same `toolCallId` (equals the tool_use id), `kind` from the table, `locations` from `file_path` or `path` (incl. aliases `target_directory`) |
| 9 | tool error | `tool_call_update` status failed |
| 10 | stop map, all rows | completed to end_turn, refusal to refusal, max_tokens_capped to max_tokens, stream_interrupted_capped to end_turn plus `_meta.minimal-agent/reason`, pause_turn to end_turn plus notice plus _meta, context_window_exceeded to max_tokens plus notice "context window full", provider error stop to end_turn plus notice, aborted to cancelled, failed and waiting to a JSON-RPC error AFTER the error text was sent |
| 11 | notice severity | warn becomes warning, info stays, error stays (one assertion per value). With the notices capability absent: an agent_message_chunk fallback and NO `notice` update |
| 12 | usage_update | `used` equals the LAST turn's input plus cacheRead plus cacheCreation (never a sum across turns, test with 3 turns), `size` equals contextWindow, no `cost` key |
| 13 | unknown method | -32601, connection stays alive |
| 14 | cancel idle session | no-op, the next prompt runs normally |
| 15 | cancel mid-stream | prompt result `cancelled`, no JSON-RPC error, session accepts a new prompt afterwards |
| 16 | cancel mid-tool | tool call update is failed or cancelled-like, result `cancelled`, the Bash process GROUP is gone. See "Test 16 evidence" below for what is and is not guaranteed |
| 17 | prompt on unknown sessionId | -32602 |
| 18 | two sessions in one process | prompts run concurrently, updates carry the right `sessionId`, cancel of one does not touch the other. **CONDITIONAL [Emma]: this is Level 2 or later if Gaston picks "one process per ACP session" (packet 7f).** Under that choice, replace it with test 18b: a second `session/new` on the same connection is rejected with -32602 and a clear message, and the first session is unaffected |
| 19 | second prompt while one is running on the same session | defined behavior: ACP does not say. OPEN: reject with an error, or queue. Decide with Emma, then test |
| 20 | malformed JSON line | -32700 with id null, connection stays alive |
| 21 | line without `jsonrpc` | -32600 |
| 22 | oversize line (above the guard) | -32600, the buffer is dropped, later lines still work |
| 23 | string request id | echoed as a string |
| 24 | stdin closes mid-turn | the turn aborts, the process exits 0 with `exitCode`, no data loss |
| 25 | gate hook (Phase 2) | see spec section 8 tests (a) never answers, (b) throws, (c) cancelled outcome |

### 3b. Spawned-process tests (few, slow)

| # | Test | Asserts |
|---|---|---|
| S1 | purity | spawn the real command, run initialize and a prompt with a large reply: every stdout line parses as JSON-RPC 2.0 |
| S2 | negative control | a build with a stray `console.log` or a stray `process.stdout.write("x\n")` makes S1 FAIL (the check can fail, spike: `drive.ts --negative` exit 0 means caught) |
| S3 | tool prints to stdout | a Bash tool that prints a line does not break the stream |
| S4 | slow reader, big output | 1 MB and 8 MB prompt result, reader sleeps 5 ms per chunk, 5 runs, ALL bytes arrive, exit code 0. This is the exact case where `process.exit` loses data |
| S5 | exit paths | stdin EOF, SIGTERM (ACP has no shutdown method, a client kills the process), SIGINT: all exit without losing already-written bytes. Claude Code docs say SIGTERM leaves the turn unfinished and exits 143 (code.claude.com headless page, VERIFIED): choose our own code and document it |
| S6 | stderr | startup rows and logs appear on stderr, never stdout |

## 4. Fidelity to the real schema [OPEN, important]

My spike and my types are written from doc pages. Fidelity risk. Mitigations that fit the zero-dependency rule:
1. A test fixture of GOLDEN messages copied from the ACP docs examples (initialize, session/new, session/update variants, tool_call, request_permission) with the doc URL next to each. The agent's output for the matching scenario must equal the golden after normalizing ids.
2. A one-off, manual cross-check against the official SDK in untracked scratch (as I did for enums: StopReason, ToolKind, ToolCallStatus, PermissionOptionKind, SessionUpdate). Record the date and SDK version in the test comment. Never a dependency.
3. Ask Gaston (packet item 3) for a test-only devDependency on the SDK. Team vote: no.

## 5. Decisions from Emma's review (2026-10-31 16:31) and my checks

- Q-B DECIDED, reject: a second `session/prompt` on a session with a running turn gets JSON-RPC -32602 "a turn is already running for this session". Do not queue, do not touch the running turn. Evidence [Amber, VERIFIED origin/main]: `Session.run` throws `session ${id} already has a run in progress` (src/runtime/session.ts:175-176). The ACP prompt-turn page has no rule [Emma]. Test 19 asserts the error and that the first turn is unaffected.
- Q-A DECIDED: in-process tests pass a scripted `sendFn` or provider as a normal parameter (DI seam, not a production hook). The ONE spawned suite (S1 to S6) reuses core's existing recipe: `MINIMAL_AGENT_TEST_AUTH=1` (src/auth/auth.ts:442-445, refuses outside test, VERIFIED) plus the test transport env, as src/e2e/output-format-g3.e2e.test.ts does. Do not invent `MA_ACP_FAKE_SCRIPT`. UNVERIFIED by me: the exact transport env var name (`MINIMAL_AGENT_TRANSPORT` is documented in help.ts:361 as "http2 or fetch", so the test transport value must be read from the e2e file, not guessed).
- Q-C OPINION (tag it so): stdin EOF aborts running turns, flushes, exit 0. SIGTERM aborts, flushes, exit 143 (128+15), as Claude Code does (headless docs). SIGINT exit 130. Set `process.exitCode`, never `process.exit`. S5 asserts each code and that all bytes written before the signal arrived.
- Q-D DECIDED: in-process tests live in minimal-agent-plugins/ma-acp-plugin/test against the entry function. Until hostModes exists, S1 to S6 spawn a tiny launcher in the plugin test folder that calls the entry with real stdio.

Diffs from Emma, status:
1. Framer size guard per chunk: DONE and PROVEN in the spike. `research/acp-spike/agent.ts` now bounds the buffer per chunk and keeps a `discarding` flag until the next newline. `research/acp-spike/framer-test.ts` runs 12 checks, all pass (exit 0): one 8 MiB chunk with no newline gives exactly one -32600, the rest of that line is dropped and NOT parsed (no -32700), the stream recovers after the newline, a two-chunk oversize line works, a request split mid-JSON is answered once, a string id is echoed as a string, malformed JSON gives -32700 with id null, no stray stdout. Note on semantics: a request sent on the SAME line as an oversize tail is dropped too. That is correct NDJSON, say it in the plugin docs.
2. Test 24: assert exit code 0, and add "a pending agent-to-client request (permission) is REJECTED on close, not left hanging". Added as test 24b.
3. Test 16 pid check: NOW VERIFIED [Ronald's explorer, file:line, src/ relative]. My spot-check on origin/main 4b1c828 (`git show origin/main:src/tools/tools.ts`) CONFIRMS the mechanism: `Bun.spawn(["bash", "-c", command], {... detached: true ...})`, `process.kill(-proc.pid, sig)` at :620, `escalateKill` defined at :629 and called at :641, :701, :719, and an abort listener near :676. The `tools-abort.test.ts` file exists on main. My line numbers differ by a few lines from his in places (his tree is the PR branch), so treat every line number below as APPROXIMATE and re-grep before citing. Abort kills the Bash child as a PROCESS GROUP. Chain: `agent-core.ts:991 runToolCalls(..., signal)` to `sdk/tool-calls.ts:39,47 executor.execute(tool, signal)` (port `sdk/ports.ts:76`) to `host/sdk-adapters/tool-executor-adapter.ts:148,167` (signal into ToolRoundContext) and `:172 executeToolRound` to `agent/tool-round.ts:795-796 executeTool(name, input, {signal})` (plugin tools via `:633 loader.dispatch`) to `tools/tools.ts:362 execBash`. Kill: `tools/tools.ts:590-604` `Bun.spawn(["bash","-c",cmd], {detached: true})` so bash leads its own group, `:613-628 killTree = process.kill(-pid, sig)` (falls back to proc.kill), `:629-635 escalateKill` SIGTERM then SIGKILL after 2000 ms, `:717-724 signal.addEventListener("abort")` (also fires if already aborted), `:669-677` cancels the stdout and stderr readers. Existing tests: `tools/tools-abort.test.ts:198` ("Bash abort kills backgrounded children too", `sleep N & wait` then pgrep), `:176` (`sleep 30 && echo never` aborts in under 2 s), `host/repl.abort.test.ts:492` (real AgentCore plus Bash, abort end to end).
   Test 16 evidence rules: (a) our ACP `session/cancel` only has to abort the SAME AbortSignal that the Session already passes down, so the kill comes for free and the plugin must not kill processes itself. (b) CAVEAT [Ronald]: a descendant that calls `setsid` or double-forks LEAVES the group and SURVIVES. Only the reader cancel (:669-677) stops the hang. So the test asserts "the direct bash process GROUP is gone" (check with `pgrep -g <pgid>` after at most 2.5 s, which covers the 2000 ms escalation), NOT "every descendant is gone". (c) Add test 16b: a tool that ignores SIGTERM (`trap '' TERM; sleep 30`) is gone after the SIGKILL escalation, and the prompt result is still `cancelled` within about 2.5 s. (d) Cancel timing, ANSWERED from code [Ronald, tools/tools.ts on his branch, not re-read by me]: the turn waits for the Bash PROCESS TO EXIT, not for the 2 s timer. `onAbort` (:717-720) calls `escalateKill` (:629-635): SIGTERM now, then `setTimeout(2000).unref` for SIGKILL only if the child is still alive. `execBash` awaits drain(stdout) and drain(stderr) and `await proc.exited` (:729-733), then returns ABORTED or the partial output (:741+). So: a child that obeys SIGTERM ends at once and the cancel settles in milliseconds. A child that TRAPS TERM keeps `proc.exited` pending until the SIGKILL at about 2 s, so the cancel result can take up to about 2 s, and it goes out AFTER the tool is really dead. That matches ACP's "after all ongoing operations have been aborted". My spot-check on origin/main 4b1c828 (src/tools/tools.ts) CONFIRMS the shape: `escalateKill` at :629 sends `killTree("SIGTERM")`, then `setTimeout(..., 2000).unref?.()` which sends SIGKILL only `if (proc.exitCode == null && proc.signalCode == null)`; the readers are awaited at :730-731 (`drain(proc.stdout ...)`, `drain(proc.stderr ...)`) and `await proc.exited` at :733; `ABORTED_RESULT` returns at :318 (already aborted) and :748 (no output). Still UNVERIFIED: whether the turn waits for anything else after the tool returns (next-round logic on an aborted signal). Test 16b measures it: assert the `cancelled` result arrives AFTER the process group is gone, and within 2.5 s. Add test 16c: a SIGTERM-obeying `sleep 30` gives `cancelled` in under 500 ms (so we know the fast path is fast).
4. Test 8 `locations`: field names are now VERIFIED by Ronald (src/tools/tool-definitions.ts: Read, Write, Edit file_path; Glob, Grep path with aliases). Keep UNVERIFIED only for aliases beyond the ones listed.
5. Test 26 (new): `session/cancel` for an unknown sessionId is ignored, no crash, no error response (it is a notification).
6. Fidelity: check EACH golden against schema.json field lists (required fields), not only against the doc example. Add this as a step.
Tests added: 24b (pending request rejected on close), 26 (cancel unknown session), 22b (one chunk, no newline, above the limit: DONE in framer-test.ts).
