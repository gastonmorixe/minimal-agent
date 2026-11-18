# 03 — Implementation plan: follow a sub-agent in the scrollback

Author: Daniel (7075489f) · 2026-11-18 · Status: plan for review. **Nothing here is implemented.**
Read with: `02-primitives-spec.md` (seams S1 to S11), `frank-ui-design.md` (the screens), `20-gating-experiment.md` (why the writer is gated), `01-current-state.md` (what exists).
No dates: sizes are in units of "a change a reviewer can read in one sitting" (S under 150 changed lines, M under 500, L above) and are estimates by analogy, not measurements.

---------------------------------------------------------------------------------------------------

## 1. Principles of the plan

1. **Safety before looks.** The first thing built is the part that cannot corrupt the lead's scrollback (`writeBlock`, the sanitizer). Looks come after.
2. **Value in the order the user feels it.** The user's complaint is "I cannot see what a sub-agent is doing". The first release answers that **without writing a single row into scrollback** (a selector with a live peek). Streaming comes after it is safe.
3. **One change = one repo = one gate.** Each task below lives in one submodule and keeps that submodule's `bun run check` green (`AGENTS.md`: core, plugins, cli each have their own gate; the umbrella CI is the full gate). Cross-repo work follows the pin order of the monorepo: core first, then cli and plugins, then the umbrella pin bump.
4. **No second renderer, no second writer.** Rows come from the host's renderers; writes go through `Compositor.writeBlock`. The plugin sends data (spec section 4).
5. **Measure the constants.** Nine numbers are my guess or Frank's (2 s deadline, 4 repaints per second, 20-row tag rule, 12-row group cut, 120 rows per minute fuse, and others). Each is a constant in one file, and a debug counter reports the real value (task H6).
6. **Every phase can stop and still be good.** After V1 the user can look. After V2 the user can follow one worker. Nothing later is needed for the earlier phases to make sense.

---------------------------------------------------------------------------------------------------

## 2. The critical path in one picture

```
 H1 writeBlock committed + foreign writers routed ──────────────┐
 H2 control-sequence sanitizer ─────────────────────────────────┤
 H3 exact-width glyph bug (independent) ··············· (any time)│
 H5 fake-fleet harness + recorded fixtures ──┐                  │
                                             ▼                  ▼
 V1  tailer ─▶ selector /agents + volatile peek ─▶ /peek snapshot card        (plugin only; H5 needed)
                                             │                  │
                                             ▼                  ▼
 V2  lane channel (S2) + lane renderer A + attach/seal/unfollow + /follow one   (needs H1 H2)
                                             │
                                             ▼
 V3  renderer B (text, cards, diffs, notices, mail, stall) + calm points + levels + tag rule
                                             │
                                             ▼
 V4  many lanes: grouped order, roster, strip, row budget, fuse, caps
                                             │
                                             ▼
 V5  polish: chords, selector keys, markers on resume, OSC links, P9 (optional), follow by sid
```
`H3` and `H6` can happen at any time. `V1` can start the day `H5` exists and does **not** wait for `H1`/`H2`, because it commits nothing to scrollback except through the existing notice path (and that path is rerouted by `H1`).

---------------------------------------------------------------------------------------------------

## 3. Tasks

Columns: **Id** · **Task** · **Repo** · **Where** · **Depends on** · **Size** · **Test that proves it**. "Owner" is left open on purpose.

### 3.1 Hardening track (H): useful on its own, required by the feature

| Id | Task | Repo | Where | Dep | Size | Done when |
|----|------|------|-------|-----|------|-----------|
| **H1** | Commit `Compositor.writeBlock` (queue, wait for a final row, drain at `flushStream` and `unmount`) and **route every foreign writer through it**: diagnostics sink (done in the working tree), `writeNoticeLines` (`repl-live-area.ts:602`), command echo `flushQueueItemToScrollback` for slash commands (`:385`), `notification.emit` toasts (`:812`). In flight: Benjamin (f9288ce8), branch `feat/no-direct-writes` | cli | `ui/compositor.ts`, `repl-live-area.ts`, `startup/diagnostic-sinks.ts`, `startup/live-repl.ts` | none | M | the existing `compositor-block*.test.ts` + my sweep variant `writeblock-one` (0 corrupt of 21,677); new: toast, command echo and `writeNoticeLines` pass through `writeBlock`; resize hold; `unmount` drain |
| **H1b** | `writeBlock` extras: `opts.calm` and `deadlineMs`, `markCalm(kind)` calls at the REPL's four calm points, read-only `state()`, `onCommit`, queue cap with a `⚠ N rows dropped` row | cli | `ui/compositor.ts`, `repl-live-area.ts` (`textStop :1270`, tool card close `:1161`, turn end `:1359`, idle) | H1 | M | unit tests per spec 3.4; soak test (section 6) |
| **H2** | Sanitizer for untrusted text: keep SGR, `\n`, expanded tabs; drop every other CSI, OSC, DCS, APC, C1, BEL; bare `\r` becomes a line break; close SGR at each row end. Shared variant of `stripTerminalControls` (`startup/startup-plugin-rows-emit.ts:81`) | cli | new `ui/sanitize-scrollback.ts` | none | S | the 8 hostile samples from my probe (`\x1b[2J`, `\x1b]52;c;…\x07`, `\x1b]0;…`, bare `\r`, BEL, C1, DCS, partial escape at the end) + property test: output has no byte below 0x20 except `\n`, and `\x1b` is followed only by `[…m` |
| **H3** | **Exact-width glyph loss** in `eraseLiveSeq` (a row ending exactly at the terminal width loses its last glyph). Add a real-terminal-faithful option to `FakeTerminal` (CUF clamped at `cols - 1`) and move in the failing test, which already exists as `experiments/exact-width-loss.regression.test.ts` with `fake-terminal.clamped.ts` (3 fail today). Reported to Benjamin; independent of lanes | cli | `ui/compositor.ts`, `test-utils/fake-terminal.ts` | none | M | failing test written first; `exact-width-rate.py` shows 0 lost in 18,000 chars at 40/80/120 cols in real tmux |
| **H4** | Scheduler timer chain growth | cli | `ui/status/live-area-scheduler.ts` | none | **done**, cli `152ace3` | (Erik) 4 tests |
| **H5** | **Fake-fleet harness**: a dev command and a test helper that replay recorded worker streams and transcripts at 1x or 10x into a temp session dir, creating fleet records so the real plugin code runs against them. Recorded fixtures: 6 real workers (a quick explorer, a long worker with Edit and Write, a failing one, a stalled one, a worker with a notice, one that ends `incomplete`), with secrets and absolute paths removed | plugins | `ma-sub-agents-plugin/lib/__fixtures__/lane/*.ndjson`, `*.jsonl`, `lib/lane/replay-harness.ts`, hidden command `/lane-demo` | none | M | the harness reproduces a real run's `streamProgress` at each tick (golden) |
| **H6** | Debug counters for the guessed constants (gate wait ms, rows per minute per lane, fuse trips, queue depth, blocks dropped), printed by `MINIMAL_AGENT_FOLLOW_DEBUG=1` and in the existing `--dump` status (`ui/status/debug-dump*`) | cli, plugins | `ui/status/debug-dump.ts` | H1b | S | counters appear in the dump; a test asserts the names |

### 3.2 V1 — "Look" (no continuous scrollback writes)

Delivers the headline: **the user can see what a sub-agent is doing.**

| Id | Task | Repo | Where | Dep | Size | Done when |
|----|------|------|-------|-----|------|-----------|
| V1.1 | **Tailer**: offset reader for `<sid>.stream.ndjson` and `<sid>.jsonl` (cut at the last `\n`, whole UTF-8, reset on shrink, 4 MB cap), `LaneEvent` fold, join of stream and transcript by tool id with a 1 s window, last-N-rounds and "earlier steps" count | plugins | `ma-sub-agents-plugin/lib/lane/{tailer,events,join}.ts` | H5 | M | folds the 6 fixtures to golden `LaneEvent[]`; reader tests: grows, shrinks, ends mid-line, ends mid-UTF-8, file missing, transcript lagging |
| V1.2 | **Digest row** helper (icon, name, arg, summary, time) and `kit.toolIcon(name)` so the plugin reuses `TOOL_PRESENTATION` instead of copying 7 icons | core (type), cli (impl) | `plugin-api/utils/style-slots.ts` (`TerminalKit`), `terminal-kit/kit.ts`, `plugins-ui/tool-presentation.ts` | none | S | golden rows at 40/60/80/120 for Bash, Read, Grep, Glob, Edit, Write, an error, an unknown tool; every row at most `cols - 1` |
| V1.3 | **`/agents` selector** (modal overlay): rows from the fleet file, frozen order, window of 8 with `↑/↓ N more`, marks (staged), `Enter` applies, digits jump, `/` filter, `Tab` peek (volatile, in the overlay), `esc` closes. Applying with marks only toggles the set for V2; in V1 it opens the peek | plugins | `handlers/cmd_agents.ts`, `handlers/on_key.ts`, `lib/lane/selector.ts` (pure state machine + renderer), `manifest.json` (`headless.commands[]` for `agents`, `follow`, `unfollow`, `peek`; `headless.hooks[]` `on_key` on `editor.key` at priority 80; permissions `hooks:editor.key`, `hooks:editor.footer.set`, `hooks:editor.overlay.open`, `hooks:editor.overlay.close`, exactly as `ma-usage-plugin`) | V1.1, V1.2 | M | selector state machine tests (key script); renders at 24/40/50 rows and 60/80/120 columns; 100 rows; `/usage` overlay tests are the pattern |
| V1.4 | **`/peek A2 [N]`**: one notice card of digest rows (the last round, or the last N items), committed through the existing `CommandResult.notice.block`. No subscription | plugins | `handlers/cmd_peek.ts` | V1.1, V1.2 | S | golden card; works for a worker that has ended |
| V1.5 | Fleet widget: `^G`/`/agents` hint in the header; width-aware columns (fixes the `String.length` clip at `widget.ts:127`) | plugins | `lib/widget.ts` | V1.3 | S | existing `widget.test.ts` goldens updated and a wide-character case |
| V1.6 | Docs: plugin README section "Looking at a worker", cli docs chapter stub | plugins, cli | `README.md`, `docs/tui/08-lanes.md` | V1.4 | S | |

**V1 exit:** in a real session with 3 running workers the user opens `/agents`, sees each worker's live activity in the overlay, peeks at one, runs `/peek A2` and gets a card in scrollback. Nothing else is written. **Risk: low.**

### 3.3 V2 — "Follow one"

| Id | Task | Repo | Where | Dep | Size | Done when |
|----|------|------|-------|-----|------|-----------|
| V2.1 | **Lane channel** `scrollback.lane` (+ `scrollback.lane.committed`): payload types in plugin-api, channel registration, permission `hooks:scrollback.lane`, host listener with validation, clamps, sanitizer, per-block and per-second row caps, ack | core (types, channel), cli (listener) | `plugin-api/src/types/lane-block.ts`, `src/plugins/hooks/channels.ts`; cli `startup/lane-writer.ts` | H1, H2 | M | validation table; unknown kind dropped and counted; caps; ack carries `waitedMs`; no listener means a no-op |
| V2.2 | **Lane renderer A**: `laneStyle(n)`, `gutter(ref, showTag, cols)` with the three tag conditions owned by the renderer, `bannerRows` (with `maxRows`/`moreHint`), `rosterRows`, `ruleRow` (with the `time` flag), `digestRow` (kinds `rows`, `banner`, `roster`, `rule`, and a stage-A `tool` as digest only). Payload: `lane` optional, `replay` per item | cli | `ui/lane/{style,gutter,digest,banner,rule}.ts`, five palette tokens in `terminal-kit/palette.ts` | V1.2, V2.1 | M | golden rows for every kind at 40/60/80/120; tag rule (first, after another writer, 20 rows, 60 s); rail and hue for `n = 1..40`; narrow layout under 50 columns |
| V2.3 | **`/follow A2`**, `/unfollow`, attach card (task, sid, lead id, started, `… N earlier steps not shown`), last round as `↺` rows with original times, `── live ──`, unfollow row, **seal card** on end (done, failed, incomplete, stopped, lost) | plugins | `handlers/cmd_follow.ts`, `lib/lane/{follow-state,policy}.ts` | V1.1, V2.2 | M | with the harness: attach, live rows, seal, in order; a worker killed mid-tool is sealed once; a double `/follow` is idempotent |
| V2.4 | **Widget as the head of the lane**: rail and tag on followed rows, followed rows sort first, `following A2 · normal` in the header, the ticker is the fleet row (1 Hz is enough) | plugins | `lib/widget.ts` | V2.3 | S | goldens |
| V2.5 | Lead-idle commit only (the `writeBlock` row-final rule), no calm points yet; a flag `MINIMAL_AGENT_DISABLE_FOLLOW=1` kills the feature | plugins, cli | | V2.3 | S | |

**V2 exit:** `/follow A2` shows attach, a stream of digest rows, and the seal, correct while the lead is idle or streaming (the writer waits for a final row). Digest rows only; no cards or text yet. **Risk: medium** (first continuous writer).

### 3.4 V3 — "Follow well"

| Id | Task | Repo | Dep | Size | Done when |
|----|------|------|-----|------|-----------|
| V3.1 | **Renderer B**: `text` (through `formatMarkdownLines`, a spawned mdstream, about 4 ms an item, fallback to plain wrapped text, clipped by `maxRows`), `tool` cards with a row cap (`formatToolHeaderRows`, `formatToolPreview`, `maxRows`), **Edit and Write diffs** (`deriveDisplayFallback`), `notice` (`renderTurnNotice` without its leading blank row), `thinking` (`· thought 4.2s`), `mailRow`, `stallRow`; a `maxRows` option on the host's tool card and notice card | cli | V2.2 | L | golden rows per kind; the diff card equals the lead's card with a different gutter (byte compare after removing the gutter) |
| V3.2 | **Calm points**: `markCalm` after text block end, tool card close, turn end, idle; the lane queue uses `calm` with the 2 s deadline then the row-final rule | cli, plugins | H1b, V2.1 | M | soak test: while the lead streams a long answer with tool cards, a lane block lands at a calm point when one occurs within 2 s |
| V3.3 | **Levels** `seals`, `quiet`, `normal`, `full`, `auto`; `/follow level …`; the flood fuse (120 rows per minute drops one level and says so once) | plugins | V2.3 | M | table-driven tests, one per cell of Frank's table 3.10 |
| V3.4 | **Backlog options**: `--all` (chunks of 40 rows), `--last N`, `--no-backlog` | plugins | V2.3 | S | |
| V3.5 | **Switch row** from the `model_adopted` notice (Frank's item 12), rendered as the switch row, not as a generic notice | plugins | V3.1 | S | needs one real stream with a switch (not yet seen); until then unit tests with a synthetic line |
| V3.6 | Hold (`/follow hold`, `/follow resume`): blocks pause, live rows continue; the resume block has the backlog shape | plugins | V2.3 | S | |

**V3 exit:** following one or two workers reads like the lead's own transcript (cards, diffs, text, notices), while the lead streams, with no duplicated or glued row (the soak test). **Risk: medium.**

### 3.5 V4 — "Follow many"

| Id | Task | Repo | Dep | Size | Done when |
|----|------|------|-----|------|-----------|
| V4.1 | **Row budget**: `rows` in `terminalUiCapability()` (S5) and Frank's `F = clamp(floor(rows/2) - 7, 1, 10)`; forms rows, strip, line; reflow on `terminal.resize` via `refreshOn` | cli (3 lines), plugins | V2.4 | M | real numbers at 16/24/30/40/50 rows with 8 followed lanes match Frank's table 2.9; the prompt is never pushed |
| V4.2 | **Grouped order** (a lane's items held until the model round ends, cut at 12 rows or 20 s) and **roster card** for 3 or more lanes | plugins | V3.1 | M | interleave golden for 2 and 8 lanes; event-time ordering test |
| V4.3 | `/follow all` as a standing choice; later workers join from their first event; `@label`, `only`; selector with 100 rows | plugins | V1.3, V4.2 | S | |
| V4.4 | Queue limits at S1f in practice: cap, drop-oldest with a row, `⇡ N waiting` in the header | cli, plugins | H1b | S | the queue-full test |
| V4.5 | **Soak** (section 6, item 5) as a permanent test | cli | V4.2 | M | runs in CI in under 60 s |

**V4 exit:** 8 workers followed at once on a 24-row terminal; fleet block, prompt and footer all stay inside `rows - 2`; lead and lanes interleave without damage. **Risk: highest** (interaction of live area, writer and many sources).

### 3.6 V5 — polish (each item is optional and independent)

| Id | Task | Repo | Size | Note |
|----|------|------|------|------|
| V5.1 | **Chords** `Ctrl+G`, `Ctrl+O`, `Ctrl+T` (spec S7). First run `experiments/key-probe.ts` in the owner's terminal: it shows whether chords arrive as a bare byte or as CSI-u, and whether `Ctrl+R` and `Ctrl+V` already work there | cli | S | slash commands already do the same |
| V5.2 | **Selector keys** PageUp, PageDown, Home, End, Delete under an overlay (S6) | cli | S | |
| V5.3 | **Markers on `--resume`** (S9): notes `lane A2 follow …` / `lane A2 seal …`, a `noteBoundaries()` replay row | cli, plugins | M | |
| V5.4 | **OSC-aware `displayWidth`** (S11), then OSC 8 links on `sid` in seals and file paths in digest rows; marks on banners | core, cli | M | |
| V5.5 | **P9 restore write** inside `writeBlock` (spec 3.3), only if the measured waits (H6) annoy | cli | M | needs the old mdstream 0.2.1 fixture test |
| V5.6 | Follow a session by sid (mission control's `f`), not only a worker of this lead | plugins | M | depends on Erik's mission-control phase 3 |

---------------------------------------------------------------------------------------------------

## 4. What can run in parallel

| Lane of work | Tasks | Needs from another lane |
|--------------|-------|-------------------------|
| Host safety | H1, H1b, H2, H3 | nothing |
| Plugin data and selector | H5, V1.1, V1.3, V1.4, V1.5 | V1.2 (a small kit change) |
| Host renderer | V1.2, V2.2, V3.1 | V2.1 for the channel |
| Plugin follow logic | V2.3 to V2.5, V3.3 to V3.6, V4.2, V4.3 | V2.1, V2.2 |
| Docs and counters | V1.6, H6 | |

Two engineers can work without waiting for each other from the first day: one on the host (H1 to H3, then V2.1, V2.2, V3.1), one on the plugin (H5, V1, V2.3).

---------------------------------------------------------------------------------------------------

## 5. Order of repository changes (the pin rule)

`AGENTS.md`: develop inside the submodule, push the child repo first, then bump the pin in the umbrella.
1. **core**: `TerminalKit.toolIcon` type (V1.2), `lane-block.ts` types and the channel (V2.1), later `ANSI_RE` OSC (V5.4). Core changes are additive; core carries no sub-agent words.
2. **cli**: compositor and routing (H1, H1b), sanitizer (H2), lane writer and renderer (V2.1, V2.2, V3.1), kit icon (V1.2). cli pins core: bump with `bun run pins:core` after the core change lands.
3. **plugins**: tailer, selector, commands, policy, widget. Plugins import only `@minimal-agent/core/plugin-api/*`.
4. **umbrella**: pin bumps, then `bun run pins:check`.
The team's practice today (`Pablo`, `Walter`, 09:20 to 10:40): a draft pre-check PR on the umbrella, then fast-forward pushes of tested commits, short holds, and the real CI result reported after the push. I follow that; no merge commits.
Commit rules: Conventional Commits, `Co-authored-by` trailer for the session (`AGENTS.md`).

---------------------------------------------------------------------------------------------------

## 6. Test strategy (what "done" means across phases)

1. **Unit, pure:** renderer goldens at 40, 60, 80, 120 columns with the repo's `displayWidth` check on every row; state machines (selector, follow, fuse, grouping); sanitizer samples; the offset reader's edge cases.
2. **Real data, offline:** the 6 recorded workers (H5) replay at 1x and 10x; their folds are goldens. Streams and transcripts used in tests are copies of real ones with paths and secrets removed, as `stream.test.ts` already does.
3. **Gate regression:** the sweep (`experiments/gate-sweep.ts`, variant `writeblock-one`) as a small CI test (6 scenarios at 80 columns, about 10 s) so a change to the compositor that reopens the corruption fails the build. Today the repo's own `compositor-block.mdstream.test.ts` already covers every offset of real mdstream output.
4. **Real terminal:** one attach, one seal, one interleave at 60 and 120 columns in tmux (private socket `-L`, never the default one: see the incident below), compared with a golden capture. Not in CI; run before each phase exit. The tmux sampler exists (`experiments/tmux-sample.py`).
5. **Soak (V4.5):** 8 simulated lanes at the real event rates (median 0.9 per second, p95 3.8, bursts of 400 per second for 2 s) plus a lead streaming mdstream for 5 simulated minutes in FakeTerminal; the sweep's analyzer asserts no lead row is duplicated, lost or glued, the live area never exceeds `rows - 2`, and the queue never exceeds its cap.
6. **Hostile input:** worker output with escape sequences, `\r`, wide glyphs, RTL text, a 1 MB single row, a result with `rawPath`.
7. **Files that misbehave:** truncated, replaced, deleted, a transcript that lags the stream, a stream that has no `result`.
Tooling hygiene learned the hard way: test scripts that use tmux must use a private socket (`tmux -L <name>`) and must never call `kill-server` on the default one. I did, once, and killed another session's capture (Benjamin, 09:17).

---------------------------------------------------------------------------------------------------

## 7. Acceptance scenarios (the user's view)

| # | Scenario | Phase | Passes when |
|---|----------|-------|-------------|
| A1 | 3 workers running, user opens `/agents`, moves, peeks, closes | V1 | rows show live activity; nothing in scrollback; prompt returns intact |
| A2 | `/peek A2` on a worker that finished yesterday | V1 | one card with the last round and the result clipped, with the pointer to `SubAgentsAgentResult` |
| A3 | `/follow A2` while the lead idles | V2 | attach card, `↺` backlog rows, `── live ──`, live rows as they happen, seal at the end; `/unfollow` leaves one row |
| A4 | `/follow A2` while the lead streams a 30 s answer | V2 | no duplicated, glued or lost lead row; blocks land at row ends; `⇡ N waiting` appears only when the wait passes 1 s |
| A5 | Worker edits a file, runs a test that fails | V3 | the diff card and the test card look like the lead's; the error keeps its first line at every level |
| A6 | `/follow all` with 8 workers on a 24-row terminal | V4 | the fleet block self-limits to the strip, the prompt is never pushed, the roster card is the colour key, grouped order reads as paragraphs |
| A7 | Resize 120 to 60 columns during a flood | V4 | no duplicated rows beyond the documented single residue row; later blocks use the new width |
| A8 | A worker prints `\x1b[2J` and an OSC 52 | V2 | nothing executes; the text appears as text or is dropped |
| A9 | The lead aborts (Esc) while blocks are queued | V2 | the queue drains or is dropped once; no block appears after the next prompt |
| A10 | `--resume` of a session that followed A2 | V5 | one dim row per attach and seal at the right position |

---------------------------------------------------------------------------------------------------

## 8. Risks

| # | Risk | Likelihood x damage | Mitigation | Owner of the answer |
|---|------|---------------------|------------|---------------------|
| R1 | A foreign writer that bypasses `writeBlock` reopens the corruption | likely x high | H1 routes all known writers; **a lint-style test** that greps `compositor.writeStream(` callers outside an allow-list (lead sinks) and fails on a new one; Task 2 of the review lists missed writers | H1 |
| R2 | The lead streams for minutes with no row end (a very long paragraph, or a formatter that keeps a table open) and lane blocks wait | medium x medium | deadline and queue cap; P9 as the measured upgrade; `⇡ waiting` makes the lag visible | V3.2, H6 |
| R3 | Eight lanes plus a big prompt exceed `rows - 2` | likely x medium | the fleet block self-limits (V4.1); the compositor's own clip drops footer rows first | V4.1 |
| R4 | Real terminals differ from FakeTerminal and tmux (iTerm2, Ghostty, kitty, Terminal.app) | medium x medium | every phase exit runs the tmux sample; a 30-minute manual check in the three terminals the owner uses, before V3 | owner |
| R5 | The exact-width bug (H3) makes wrapped lane text lose glyphs | medium x low | H3 first | H3 |
| R6 | Worker data is lossy (no thinking text, one-line summaries, missing transcript) | certain x low | design is item-level and degrades to digest rows | V1.1 |
| R7 | The feature adds I/O every second for each lane | low x low | I6: nothing runs when nothing is followed; the offset reader reads only appended bytes; 4 MB cap | V1.1 |
| R8 | Secrets in worker output land in the terminal history | medium x medium | same user, same machine; not sent to the model; documented | docs |
| R9 | Plugin and host drift (the channel contract) | medium x medium | the payload type lives in plugin-api; validation in the host; a contract test in both repos | V2.1 |
| R10 | Another session edits the same files (the shared checkout has many writers) | high x low | work in a worktree; small commits; follow `AGENTS.md` | everyone |

---------------------------------------------------------------------------------------------------

## 9. Rollout

- No flag is needed to hide it: **nothing appears until the user types `/agents` or `/follow`.** `MINIMAL_AGENT_DISABLE_FOLLOW=1` is the kill switch.
- V1 ships first. V2 ships behind the user's explicit command. V3 and V4 change what `/follow` looks like, not whether it exists.
- Measure with `MINIMAL_AGENT_FOLLOW_DEBUG=1` for one week of real use between V2 and V3, then fix the nine guessed constants from data (H6).
- Docs: `docs/tui/08-lanes.md` (the gate, the gutter, the queue), the plugin README (commands and keys), and the research folder stays as the design record.

---------------------------------------------------------------------------------------------------

## 10. Open questions for the owner

| # | Question | My recommendation |
|---|----------|-------------------|
| Q1 | v1 gate: `writeBlock` as is (wait for a final row), or build P9? | `writeBlock` for V2 and V3; P9 only if H6 shows the waits annoy |
| Q2 | A generic core channel `scrollback.lane`? | yes: plugin-api type, no sub-agent words in core; mission control can reuse it |
| Q3 | Chords `Ctrl+G`, `Ctrl+O`, `Ctrl+T`? | yes, in V5; slash commands first |
| Q4 | Five new theme tokens for lane hues? | yes (Frank's table); no state colour for a lane |
| Q5 | Markers on `--resume` in the first release? | no, V5 |
| Q6 | Live-area REPL only? | yes; print, ACP and web do not get lanes |
| Q7 | Should toasts and command echoes move to `writeBlock` now, even without lanes? | yes, it fixes a hazard that exists today (H1) |
| Q8 | Should the lead's own tool cards also be sanitized? | yes, a separate small change after H2; the same hole exists today (0.02% of tool results carry an escape) |
| Q9 | Who builds what? | two engineers: one host (H1 to H3, V2.1, V2.2, V3.1), one plugin (H5, V1, V2.3); Frank reviews every golden |

---------------------------------------------------------------------------------------------------

## 11. People and work already in flight (so nobody does it twice)

| Who | What | Touches |
|-----|------|---------|
| Benjamin (f9288ce8) | `Compositor.writeBlock`, diagnostics routing; in the shared cli checkout, uncommitted | **H1** |
| Erik (652070b6) | scheduler fix (done, `152ace3`); mission control plan and `ma-tui-kit` | H4 done; `ma-tui-kit` layout components could serve V1.3 and V4.1; mission control's `f` is V5.6 |
| Frank (932e6ae3) | the UI design; reviews goldens | all rendering |
| Beverly (28e13c6f) | resume/continue work in cli, uncommitted | `main.ts` hunks shared with Benjamin: stage only your own hunks |
| Walter, Pablo, Scott, Donald | merge queue and holds | push order |
I touched no product source. All my scripts are in `research/2026-11-18-subagent-scrollback-view/experiments/`.
