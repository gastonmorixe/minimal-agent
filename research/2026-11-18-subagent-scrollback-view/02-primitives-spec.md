# 02 — Primitives spec: what the host must give a plugin so it can "follow" a sub-agent

Author: Daniel (7075489f) · 2026-11-18 · Status: spec for review. **No product code was written or changed.**
Inputs: `01-current-state.md` (what exists), `20-gating-experiment.md` (what is safe to write), `21-scheduler-timer-leak.md`, `frank-ui-design.md` (the screens), Erik's `research/2026-11-18-mission-control/05-tui-kit.md` (the shared layout kit), the code at cli `1bdf58d` (+ uncommitted working tree of the shared checkout, 11:0x), core `3e4d1fe`, plugins `a742aca`.
Line numbers refer to that tree. The CLI working tree has other sessions' uncommitted edits, so a few `compositor.ts` lines will move.
Words: **seam** = a host function or channel that a plugin may call. **lane** = one followed worker's feed in scrollback. **block** = rows written in ONE `writeStream` call.

---------------------------------------------------------------------------------------------------

## 0. Summary

The feature needs **one new scrollback seam and a few small ones**. Most of it is plugin code on data that already exists.

| # | Seam | Today | Size | Blocks v1? |
|---|------|-------|------|------------|
| S1 | **Block writer**: a foreign write that never corrupts the lead, with calm commit points, a queue, state queries | **Exists, uncommitted**: `Compositor.writeBlock` (Benjamin, f9288ce8). Passes my sweep: 0 corrupt at 21,677 offsets | small: commit it, add 3 reads and a calm hook | yes |
| S2 | **Lane channel**: plugin to host, validated and clamped, with an ack | missing (`notification.emit` is a toast, ungated, cannot carry a lane) | small to medium (new core channel + payload types) | yes |
| S3 | **Lane renderer** (host): gutter, tag rule, digest row, host cards in the gutter | missing. Renderers exist (`formatToolHeaderRows`, `formatToolPreview`, `renderCommandNoticeBlock`, `formatMarkdownLines`) but are CLI-internal | medium (`src/ui/lane/`, about 400 lines) | stage A: no. stage B: yes |
| S4 | **Control-sequence sanitizer** at S2 | missing; the lead's own tool card passes raw escapes (measured) | small | yes |
| S5 | **Slot context**: `rows` (and later the row budget) | `ctx.tui` has `columns` only | tiny (3 lines) | no |
| S6 | **Selector keys**: PageUp/PageDown/Home/End under a modal overlay | not dispatched | tiny | no (arrows work) |
| S7 | **Plugin chords**: unbound `Ctrl+<letter>` offered to `editor.key` | silently dropped | small | no (slash commands work) |
| S8 | **Command echo through S1** | `/follow` dispatches mid-turn (verified), its echo is an ungated write | small, CLI | yes for the slash path |
| S9 | **Lane markers in the lead's transcript** and in `--resume` | notes are persisted (`notification.emit`) but never rendered on resume | small to medium | no |
| S10 | **Event tailer** (plugin side) | `streamReader` (stream only) | medium, plugin only | yes |
| S11 | OSC-aware `displayWidth` | strips CSI only (measured: a 10-cell OSC 8 link measures 43) | small, core | no (links are optional) |

What does **not** need a new primitive: the selector (modal overlay: `editor.overlay.open` + `editor.footer.set` + `editor.key`), slash commands, the fleet widget as the live ticker, `/peek` as a notice card.
What I **dropped** from my first list: a focusable non-modal live-area panel (Frank: the modal overlay is enough; an open overlay replaces the fleet widget, so the selector is drawn as the widget's larger form).

### Decisions I need from the owner (Gaston)
1. **v1 gate**: the committed-to-be `writeBlock` (waits for the lead's row to end; mean wait about 0.2 s, worst case one lead paragraph, 0.9 s in my longest scenario) or the P9 "restore write" (mean 10 ms, more state to get right). I recommend `writeBlock` for v1 and P9 only if the waits are measured and annoy. See section 3.
2. **A new generic core channel** `scrollback.lane` (plus a payload type in plugin-api). Core stays free of sub-agent words; mission control's `f` (follow) and background jobs could use it.
3. **Chords** `Ctrl+G` (selector), `Ctrl+O` (level), `Ctrl+T` (hold) are acceptable? Without S7, only the slash commands exist.
4. **Lane palette**: 5 new non-semantic theme tokens (`steel 68, seafoam 115, sand 180, orchid 176, slate 109`, from Frank).
5. **Persistence**: are lane markers on `--resume` (S9) in scope for the first release? I say no.
6. **Scope**: live-area REPL only. No print mode, no ACP, no web host.

---------------------------------------------------------------------------------------------------

## 1. Architecture: who owns what

```
 worker process (headless)                lead process (the CLI REPL, one process, plugins in-process)
 ┌──────────────────────────┐             ┌───────────────────────────────────────────────────────────┐
 │ <sid>.stream.ndjson  ────┼─ files ────▶│ sub-agents plugin (policy)                                │
 │ <sid>.jsonl          ────┼─ (append)  ─▶│  S10 LaneTailer  ─▶ LaneEvent[] ─▶ feed policy            │
 └──────────────────────────┘             │      (level, order, hold, fuse, grouping, event-time sort)│
                                          │  selector (modal overlay) · /follow /peek · fleet widget  │
                                          │            │ bus: scrollback.lane  (S2)  ▲ ack committed  │
                                          │            ▼                              │               │
                                          │ host (CLI) mechanism                                      │
                                          │  S4 sanitize ─▶ S3 lane renderer (gutter, tag, cards)     │
                                          │            ─▶ S1 Compositor.writeBlock (gate, queue)      │
                                          │            ─▶ writeStream ─▶ terminal scrollback          │
                                          └───────────────────────────────────────────────────────────┘
```

Rules of the split:
- The **plugin decides what to show and when** (which events, level, grouping, ordering across lanes, hold, flood fuse). It knows workers.
- The **host decides how it looks and when it may be written** (gutter, rails, cards, widths, the gate). It knows the terminal.
- The plugin never draws frames and never writes to a stream (the existing rule, `channels.ts` comment on `notification.emit`). It sends **data**; the host sends **rows**.
- Lane content **never enters the lead's model context**. The only worker-to-model channel stays the existing `prompt.inject` digest (`supervisor-shell.ts:128`). Lane rows are not written to the lead's transcript either (S9 stores one marker row per attach/seal).

### Invariants (each has a test in section 9)
- **I1** Every write into scrollback that the lead's formatter did not produce goes through `writeBlock`. That includes toasts, diagnostics and command echoes (today they are P7-class writes).
- **I2** A block is one `writeStream` call, so it is atomic (compositor frame: BSU, erase live area, bytes, redraw).
- **I3** Scrollback receives only **complete units**. No spinner, partial sentence, or "running" state is ever committed.
- **I4** Every committed row is at most `cols - 1` cells wide. Nothing is right-aligned or padded to the edge in scrollback (a later resize reflows it).
- **I5** Untrusted text is sanitized before it can reach the terminal (S4).
- **I6** Zero cost when unused: no followed lane means no timers, no reads, no rows.
- **I7** Fail closed: an unknown cursor move, an unmodelable state, or a missing file means "wait" or "degrade to a one-line row", never "guess".
- **I8** The follow feature is off by default. `/agents` and `/follow` are the only entry points.

---------------------------------------------------------------------------------------------------

## 2. Facts that shaped the spec (measured, not assumed)

| Fact | Evidence | Consequence |
|------|----------|-------------|
| A naive foreign write corrupts the lead at **94.9%** of byte offsets and **87.7%** of real write boundaries; ending the open row with LF first is **just as bad** (85.0%) | `20-gating-experiment.md` §4, real mdstream 0.3.9, 36 recordings, real tmux 3.8 | S1 is a hard requirement. Toasts and command echoes already have this hazard |
| `streamCol == 0` is not enough without a live area (235 offsets after a `\r`) | same, §4 | gate on "last visible byte is LF", not on the column |
| The first `writeBlock` draft (LF then block) was P7. The **current** one (queue; splice in right after the first line feed of a later chunk; wait if the stream moved the cursor with anything but SGR/EL/ED/OSC; drain at `flushStream`) has **0 corrupt offsets of 21,677**, live area on and off, raw and lead-sink models (variant P10 in my sweep, re-run on the working tree with diff sha `e2dc5cdcbc4d`). It lands between two rows of one markdown structure at 2,334 offsets (10.8%), cosmetic | `20-gating-experiment.md`, `results/tables.md` row P10; Benjamin's own test `compositor-block.mdstream.test.ts` says the same with his 6 fixtures | use it |
| Landing delay of the current rule: mean 12.0 input chunks (about 0.2 s), max 53 (0.9 s); by scenario 2.2 chunks (a heading) to 26 (a long paragraph, which is one row until its line feed) | `experiments/landing-delay.py` (rule B); 1 chunk = about 17 ms at the median real stream rate of 290 chars/s | acceptable for v1; the 2 s deadline fallback bounds the tail |
| Worker thinking text is empty in **100%** of 10,479 finished items; `text_delta` in 77% of streams; `thinking_delta` in 3% | survey of 411 stream files | item-level correctness; thinking is `· thought 4.2s` |
| Median worker: 116 transcript records, 5.5 min; p95 281 records, 22 min. Events/s: median 0.9, p95 3.8, bursts to 400 | same survey | attach backlog needs a window; the ticker needs a rate limit |
| Bash is 64% of tool calls, Read 12%. 8 concurrent workers are common (peak 8 in many of 1,242 fleets; up to 94 distinct workers per lead) | same | digest rows for Bash/Read; the selector needs a window and a filter |
| `displayWidth` strips CSI only; an OSC 8 link measures 43 cells instead of 10 | `/tmp/osc-width.ts` run; `term-width.ts:23` `ANSI_RE`, `:157` | links and marks must be appended after clamping, or core learns OSC (S11) |
| `wordWrap` carries SGR into each fragment (verified: `\x1b[1mbold…\x1b[0m` per row) | same run | a gutter can be prefixed after wrapping, no re-wrap needed |
| Lead tool card passes raw control bytes: `\x1b[2J`, `\x1b]52;c;…\x07`, bare `\r`, BEL are emitted unchanged | probe of `formatToolPreview`, this session | S4 is required for any text that is not the lead's own tool output. Real tool results carry ESC in 0.02% (7 of 32,692) and bare CR in 0.07% |
| Rendering text through a spawned `mdstream` costs about 4 ms and under 1 ms of lead CPU per item (8 in parallel: 0.9 ms/item) | `/tmp/md-spawn-bench.ts` | no long-lived formatter needed for lanes |
| `liveArea` slot handlers run at most once per 1000 ms from the timer; events re-fire them at once. The timer chain leak is **fixed on main** (`152ace3`) | `21-scheduler-timer-leak.md`; `live-area-scheduler.ts:570-585` | the ticker may use `refreshOn`; 1 Hz needs nothing new |
| A registered slash command dispatches at once, with no `running` check; its echo is an ungated write | `repl-live-area.ts:759-764`, `commands/dispatch-submit.ts` (`flushCommandLine`) | `/follow` works mid-turn; its echo needs S8 |
| `flushQueueItemToScrollback` writes `\n\n\n…` and `writeNoticeLines` writes `\n\n…` with no gate | `repl-live-area.ts:385-397`, `:602-606` | S8 |
| `note` records are skipped by the fold and by replay; `notification.emit {text}` persists one with no visible row | `session-restore.ts:292`, `session-replay.ts:805-808` (timestamps), `repl-live-area.ts:812-819`, `agent-core.ts:491` | S9 needs a replay change to show markers |
| `sessions:read` window reads and parses the **whole file** on each call (`readFileSync` + `parseLines`) | `sessions-read.ts:510-514` | the tailer reads the two files itself with byte offsets (the plugin already does: `progress.ts`, `stream.ts:514`) |
| The compositor erases the **last glyph** of a row that ends exactly at the terminal width when a later write arrives (no formatter); 1.2 lost per 1,000 chars at 80/120 cols | `20-gating-experiment.md` §7b, real tmux | separate bug B1 (section 8); not caused by lanes |

---------------------------------------------------------------------------------------------------

## 3. S1 — The block writer (`Compositor.writeBlock`)

### 3.1 Status
Benjamin (f9288ce8) has it uncommitted in the shared cli checkout (branch `feat/no-direct-writes`, +143/−36 lines in `compositor.ts`, tests `compositor-block.test.ts`, `compositor-block.mdstream.test.ts`, fixture `mdstream-segments.json`, plus routing of the diagnostics sink in `diagnostic-sinks.ts` and `live-repl.ts`). I read it. Behavior:
- `writeBlock(text)`: queue the block. It is written at once when the row is closed (the last visible byte written was `\n`; a bare `\r` does not count) and the stream has not moved the cursor with anything but SGR, EL, ED or OSC. Otherwise it is **spliced in right after the first `\n` of a later chunk**, so the row before it is final. When not a TTY or not mounted: plain `writeStream`.
- `flushStream()` and `unmount()` drain the queue (the lead's formatter has ended by then), prefixing a `\n` when the row is still open.
- Arrival order is kept. A row that fills the width exactly counts as open.
My sweep (`gate-sweep.ts`, variant `writeblock-one` = policy **P10**) on the working tree (diff sha `e2dc5cdcbc4d`, 11:55): **0 corrupt offsets of 21,677**, live area on and off, raw and lead-sink models; 2,334 offsets (10.8%) where it lands between two rows of one markdown structure (cosmetic; the earlier draft had 906). His two negative controls (append to the open row; LF first) fail as they should.

### 3.2 What the follow feature needs on top (all small, all additive)
| # | Addition | Why |
|---|----------|-----|
| S1a | `writeBlock(text, opts?)` with `opts.calm?: boolean` and `opts.deadlineMs?: number` (default 2000). A **calm block** waits for a calm point, then falls back to the row-final rule after the deadline | Frank's gates 1 to 3: idle, between items, blank row. They never split a list or a card |
| S1b | `markCalm(kind)`, called by the REPL: after `formatter.end()` in `textStop` (`repl-live-area.ts:1270`), after a tool card closes (`isOuterFrameClose`, `:1161`), at turn end (`:1359`, near `flushStream`), and at idle | gives S1a its calm points. 4 one-line calls |
| S1c | read-only `state()`: `{ rowClosed, blankRowsAbove, streamWriteCount, queueDepth, oldestWaitMs }` | the lane renderer needs `blankRowsAbove` (blank-row policy), `streamWriteCount` (the tag rule: "was the last write another writer's?"), and the queue numbers for `⇡ N waiting` |
| S1d | an optional `onCommit(info)` callback per block: `{ rows, at: epoch ms, waitedMs }` | the ack of S2, and the data for the fuse |
| S1e | **route the other foreign writers through it**: `writeNoticeLines` (`repl-live-area.ts:602`), command echoes (`flushQueueItemToScrollback` for slash commands), `notification.emit` toasts. All three are P7-class today | I1. The hazard exists now, independent of this feature |
| S1f | a queue cap (for example 200 blocks or 2,000 rows). Past it, drop the oldest **lane** blocks and commit one row `⚠ N lane rows dropped (queue full)` | a lead that never reaches a calm point, with 8 busy lanes, must not grow memory without bound |
| S1g | resize hold: a block written while `streamHold` is true joins `heldStream` (`writeStream` already does this at `compositor.ts:263-266`), so it needs no new code. **Add a test** | the sweep does not cover it |

### 3.3 Optional upgrade: P9, the restore write
If the measured waits annoy: inside `writeBlock`, when the open row is non-empty and shorter than the terminal, write `\r ESC[K` + block + the same row again, as one write. When it is mdstream's clipped echo (starts with `…`, fills the width), write `\r ESC[K` + block with no replay. If a `\r` is pending, no replay. Otherwise wait. The compositor must keep the text of the open row (rebuilt from the bytes it saw: SGR, `\r`, `\n`, `ESC[K`, `ESC[J`, text; any other CSI makes it "unknown" until the next LF).
Measured (`20-gating-experiment.md`): 0 corrupt at 21,677 offsets, 91% of the 903 real boundaries, mean wait 10 ms; 120 of 120 clean in real tmux; but **not** for a row that is exactly the terminal width unclipped (10 of 32 corrupt in tmux: emulator-dependent, so excluded). It needs a unit test that replays the old mdstream 0.2.1 fixture (has `ESC[1A`), because no recording of 0.3.9 exercises the unknown-CSI branch.
**I do not recommend building it for v1.**

### 3.4 Tests that must stay green
`compositor-block.mdstream.test.ts` (every offset of real mdstream output, with and without a live area), plus the new: calm gate + deadline; queue cap; `streamHold`; `flushStream` and `unmount` drain; a block that arrives inside an open fence; two lanes interleaving.

---------------------------------------------------------------------------------------------------

## 4. S2 — The lane channel (plugin to host)

### 4.1 Contract
A new broadcast channel in core `plugins/hooks/channels.ts`, same shape as `notification.emit` (`broadcast-async`):

```ts
// core: minimal-agent-core/plugin-api/src/types/lane-block.ts  (type only)
export interface LaneRef {
  /** Stable key of the lane (the worker's session id). */
  key: string
  /** Short text tag shown in the margin, at most 4 cells: "A12". */
  tag: string
  /** Number that picks hue and rail shape. Same n gives the same look on replay. */
  n: number
}

export type LaneBlockInput =
  | { kind: "rows";    rows: string[]; at?: number; replay?: boolean }                 // stage A: pre-styled rows (SGR only)
  | { kind: "banner";  block: CommandNoticeBlock; maxRows?: number; moreHint?: string }   // attach card, seal: host frames it
  | { kind: "roster";  entries: { lane: LaneRef; cells: string[] }[] }    // attach of 3 or more: lead-side card (2-space gutter), the host draws each rail from its LaneRef
  | { kind: "text";    markdown: string; at?: number; maxRows?: number; moreHint?: string; replay?: boolean }
  | { kind: "tool";    name: string; input: Record<string, unknown>; output?: string; isError?: boolean; durationMs?: number; detail: "digest" | "card" | "full"; at?: number; replay?: boolean }
  | { kind: "thinking"; durationMs?: number }
  | { kind: "notice";  notice: TurnNotice }                               // host renders it as the lead's own notice, WITHOUT its leading blank row
  | { kind: "mail";    from: string; to: string; mailKind: string; body: string }   // the row belongs to the SENDER's lane; from the lead: no lane, 5-space indent
  | { kind: "rule";    label: string; time?: boolean }                    // unfollow, hold, resume, waypoint: label + time of block.at. `── live ──` sets time:false
  | { kind: "stall";   quietMs: number; last?: string }

export interface LaneBlock {
  id: string                    // unique per block: `${lane?.key ?? "fleet"}:${seq}`
  /** Absent for a fleet-level block: the roster card, and a mail row FROM the lead (no rail, 5-space indent). */
  lane?: LaneRef
  at: number                    // epoch ms of the EVENT, not of the commit
  items: LaneBlockInput[]       // one block = one round or one group, in order
  hold?: "calm" | "rowFinal"    // default "calm" (S1a); errors and seals use "rowFinal"
}
// `at` on an item (default: block.at) is the time of THAT item's event; a `replay: true` item shows it after the `↺`. `replay: true` is PER ITEM (Frank): the attach block mixes a non-replay card, replay rows (the host draws "↺" and the original time of each item's `at`) and the non-replay `── live ──` rule, and it must stay ONE atomic write.
// channel "scrollback.lane": payload LaneBlock          (plugin -> host)
// channel "scrollback.lane.committed": payload { id, rows, at, waitedMs }   (host -> plugin)
// permission: "hooks:scrollback.lane"
```

### 4.2 Host guarantees
1. **Validate and clamp** like `coerceNoticeBlock` (`command-notice.ts:40-70`): max items per block (40), rows per item (200), row length (4,000 chars); reject unknown kinds; a malformed payload is dropped and counted in a diagnostics row, never thrown.
2. **Sanitize** (S4) every string field.
3. **Render** (S3) at the current width, **one `writeBlock` call per LaneBlock** (all of its items), so a round is atomic.
4. **Ack** with `scrollback.lane.committed` after the write (S1d).
5. **Hard safety net**: at most 40 rows per block and 200 rows per second over all lanes. Over the limit, the block is cut with `┊ … N rows not shown` and counted. The plugin's own fuse (Frank 3.10) is the UX; this is the guard.
6. Never writes while the REPL is shutting down (`unmount` drains first).
7. If no live-area REPL is active (print mode, ACP, web), the channel has no listener and the plugin's `ctx.emit` is a no-op. Followers must degrade to "feature unavailable" (the plugin checks once for a host capability flag; see S5).

### 4.3 Staging
- **Stage A (ship first, no S3):** `rows` and `banner`. The plugin pre-renders rows with SGR only from `ctx.tui.kit` helpers; the host adds the gutter, clamps, sanitizes, and writes. That is enough for **`/peek`** (a banner card of digest rows), the **attach card**, **seal**, and **rules**.
- **Stage B:** `text`, `tool`, `thinking`, `notice`, `mail`, `stall`: the host draws them with the lead's renderers (S3). This is what gives the lead's look for free (cards, diffs, highlight, notices).

### 4.4 Why not reuse `notification.emit`
It writes through `writeNoticeLines` (`\n\n` + rows) with no gate and no attribution, frames everything as a toast, and has no ack. I keep it as the carrier for **persisted markers** only (S9).

---------------------------------------------------------------------------------------------------

## 5. S3 — The lane renderer (host, `minimal-agent-cli/src/ui/lane/`)

Pure functions plus one async step (markdown).

| Function | Does | Reuses |
|----------|------|--------|
| `laneStyle(ref)` | hue and rail from `n`: `hue = LANE_HUES[(n-1) % 5]`, `rail = "▎┃║╏"[floor((n-1)/5) % 4]` (20 lanes, no state, same on replay) | new theme tokens (S-palette) |
| `renderLaneBlock(block, ctx)` | the whole block to rows, gutter included | below |
| `gutter(ref, showTag, cols)` | 5 cells: tag (3, bold in the lane hue, or blank), rail, space; under 50 columns the tag moves to its own row and the gutter is 2 cells (hence `cols`). **The renderer owns all three tag conditions**: the last write was not this lane's (`streamWriteCount` from S1c changed: only the host sees the lead's and the toasts' writes), 20 lane rows since this lane's last tag, 60 s since it. Counters are per lane | S1c |
| `digestRow(tool, innerCols, showTime)` | one row: `icon name  arg · summary · 1.2s`, plus ` · 12:04:41` **only when the row is tagged** (`showTime`). Summary: **Read** = line count; **Bash** = (1) a test count when one of the last 8 output lines is a count line (`N pass`, `N fail`, `N passed`, `N failed`, `N skip`), joined as `41 pass 0 fail`; (2) else the last non-empty line; (3) else the stream's `outputSummary`; **Grep/Glob** = match count; **error** = first line in red, never folded (Frank 3.4: the real last line of `bun test` is `Ran 41 tests across 3 files`, so a plain last-line rule would not match his mockups) | `toolIcon`, `TOOL_PRESENTATION`, `formatToolInputBody` |
| `card(tool, detail, innerCols)` | the host's tool card with a row cap, in the gutter | `formatToolHeaderRows`, `formatToolPreview`, `deriveDisplayFallback` (Edit and Write diffs from `input`), `renderDiffRows` |
| `textRows(markdown, innerCols)` | markdown to rows, clipped by level with the host's elision `┊` + `shown n/m L` | `formatMarkdownLines` (spawns `mdstream`; falls back to plain wrapped text when no formatter) |
| `noticeRows(notice)` | `renderTurnNotice` **with its leading `\n` removed** (every case starts with `\n  `, `turn-notice.ts:87` area: inside a lane there is no blank row above). The `model_adopted` notice is the switch row; the host's wording is accepted (`› Changed model to …`), without a `(lead switched)` suffix | `ui/turn-notice.ts` |
| `bannerRows(block, opts)` | `renderCommandNoticeBlock(block, innerCols)` with `maxRows` and `moreHint` (the seal body clips to 3, 6 or 20 rows by level and the host draws `┊` then `shown 3/42 L · full text: SubAgentsAgentResult A2`; a text item clips to 1, 6 or 40 rows) | `command-notice.ts:100` |
| `rosterRows(entries)` | the attach card for 3 or more lanes: a lead-side card (2-space gutter, not a lane gutter) whose body rows hold per-lane rails, drawn by the host from each entry's `LaneRef` (so the card is also the colour key) | `command-notice.ts` |
| `stallRow(quietMs, last)` | `⚠ no events for 2m00 · last: Read src/ui/compositor.ts`, gold, one row | |
| `mailRow(from, to, kind, body)` | `✉ kind → to  body`, in the **sender's** lane; mail from the lead has no lane, no rail and a 5-space indent | |
| `ruleRow(label, at, time)` | `── label ── 12:10:33`, not drawn to the edge; `time: false` for `── live ──` (it has no time) | |
| `timeSuffix(at)` | ` · 12:04:41`, date on the first row of a day | `ToolTimeTracker` (`tool-time.ts`) shared with the lead |

**Width.** `innerCols = cols - 5` for prose, `cols - 8` inside a framed card (gutter 5, `│ ` 2, safety 1). Under 50 columns the tag moves to its own row and the gutter is 2 cells (Frank 3.11). Every row is clamped to `cols - 1` (`clampTranscriptRow`, `format.ts:1151`) **after** the gutter is added. Pass `cols - 3` to the existing renderers instead of re-wrapping.
**New in the host:** the digest row, and a `maxRows` option on `formatToolPreview` and `renderCommandNoticeBlock`. Everything else is reuse.
**Blank rows:** one blank row between the lead's text and a lane run, none between lane blocks; use `state().blankRowsAbove` to avoid doubling (`capBlankLines` caps at 2 anyway).
**Async:** markdown rendering is async (about 4 ms). The renderer must keep the block order while awaiting: render all items of a block, then enqueue once.
**Fallback without a formatter:** plain wrapped text in the gutter. No spawn.

**Palette (S-palette):** five tokens in `terminal-kit/palette.ts`: `lane.steel 68, lane.seafoam 115, lane.sand 180, lane.orchid 176, lane.slate 109`, none of which is a state colour (sky, lime, gold, pink, violet, red, cyan are taken by state or tools). The tag and rail take the hue; content keeps its own semantic colours. Tool icon colours overlap the hues' neighbours, accepted by Frank (icon is in the content column).

---------------------------------------------------------------------------------------------------

## 6. S4 — The control-sequence sanitizer

Needed at S2: lane text is worker output, i.e. untrusted text that the lead's terminal would otherwise execute. Measured: the lead's tool card emits `\x1b[2J` (clear screen), `\x1b]52;c;…` (clipboard write) and `\x1b]0;…` (title) unchanged.

Spec `sanitizeForScrollback(text, opts)`:
- Keep: SGR (`CSI … m`), `\n`, text. Expand tabs (`expandTabs`, `term-width.ts:239`).
- Drop: every other CSI, every OSC, DCS, APC, PM, SOS, C1 controls (0x80-0x9f), DEL, BEL and all C0 except `\n` and `\t`; **bare `\r` becomes a line break** (a bare `\r` would rewrite the row).
- After sanitizing, **close SGR** at the end of each row (`\x1b[0m`) so a worker's style cannot leak into the gutter or the next block.
- Bound the length (row 4,000 chars, block 200 rows).
- Existing code to build on: `stripTerminalControls` in `startup/startup-plugin-rows-emit.ts:81` (strips all escapes, SGR too). Make an SGR-preserving variant and share it. Add the 8 hostile samples from my probe as tests.
Applying it to the lead's own tool cards is out of scope here, but I flag it: the same hole exists today.

---------------------------------------------------------------------------------------------------

## 7. S5 to S9, S11 — the small seams

### S5 — Slot context rows (and budget)
`terminalUiCapability()` (`plugins-ui/ui-loader.ts`) returns `{capability, columns, paletteJson, kit}` on every call. Add `rows: process.stdout.rows ?? 24`. Type: `TerminalUiCapability` (`plugin.ts:43`). `LiveAreaHandlerContext.tui` already carries it to slots. A **row budget** (how many rows this slot may use after the host's own rows) is the better value; until then Frank's formula `F = clamp(floor(rows/2) - 7, 1, 10)` stands, and it must be a single constant. The `terminal.resize {cols, rows}` bus event (`live-repl.ts:233`) already exists for `refreshOn`.
**Ticker rate:** with the timer fix, a plugin may emit its own event and list it in `refreshOn`; events fire at once (no 1000 ms floor, floor is on the periodic timer only, `live-area-scheduler.ts:579`), so a producer must throttle itself to 4 per second per lane, joined across lanes. **NOT VERIFIED:** whether a plugin's `ctx.emit` may use an undeclared channel name from a slot handler. The v1 ticker at 1 Hz (the fleet widget already runs at 1 Hz) needs none of this.

### S6 — Selector keys
Under `editor.overlay.open` the host dispatches printables, Backspace, Enter, Tab, Escape, EscapeEscape and the four arrows to `editor.key` (`key-dispatch.ts:295, 338, 462, 529, 635, 763-781`). `Delete`, `Home`, `End`, `PageUp`, `PageDown` reach `consumeEscape` and are ignored or edit the hidden buffer (`:758-792`). Add `dispatchKeyHook("PageUp"|"PageDown"|"Home"|"End"|"Delete")` for `\x1b[5~`, `\x1b[6~`, `\x1b[H`/`\x1b[1~`, `\x1b[F`/`\x1b[4~`, `\x1b[3~` **only when `host.isOverlayOwned()`**, so the editor's normal behavior is unchanged. About 12 lines, additive key names (`EditorKeyPayload.key` is a free string, `editor/types.ts:327`). Frank's selector uses arrows and `←`/`→` for paging, so this is polish.
**What an open overlay costs:** the overlay layer (priority 50) replaces the default footer, including the fleet widget and every slot row (`footer-layers.ts:32-38`). The selector therefore draws the widget's larger form itself. One owner at a time: opening `/agents` while `/config` is open replaces `/config` (`editor-controller.ts:989`). Both are accepted.

### S7 — Plugin chords
Today an unbound `Ctrl+<letter>` byte is consumed and dropped (`consumePending`: after the `isPrintableChar` branch nothing matches). Kitty/xterm terminals send the same keys as CSI-u (`\x1b[103;5u`) or modifyOtherKeys, which fall to `"ignore"` in `parseModifiedKeySequence`.
Spec: when no overlay owns the input, offer `Ctrl+B, F, G, N, O, P, T, X, Y` (bare byte and CSI-u forms) to `editor.key` as `"Ctrl+G"` etc.; if no listener halts, drop as today. **Reserved for the host, never offered:** `A C D E H I J K L M Q R S U V W Z \ [` (editing, abort, history, newline, flow control, suspend). `Ctrl+R` is already dispatched. Chords do nothing when the session has no workers. Conflicts between plugins follow the existing hook priority. Caveats: tmux and terminals can take a key before it reaches the process (not tested); `Alt+<letter>` is unreliable on macOS (Option types a symbol unless kitty or Option-as-Meta is on), so none is used.
**NOT VERIFIED, and it decides the parser:** whether the user's terminal sends `Ctrl+G` as the bare byte `0x07` or as kitty CSI-u (`ESC[103;5u`) once the CLI has enabled kitty flag 1. The repo's doc says modified keys such as `Ctrl+C` arrive as CSI-u under flag 1 (`docs/tui/05-input-pipeline.md`, last paragraph), and the CSI-u switch handles `Ctrl+ \ a d e k u w` (`key-dispatch.ts:994-1013`) but **not `Ctrl+R` or `Ctrl+V`**, which have only the bare-byte path (`:601-623`). So if iTerm sends `Ctrl+R` as CSI-u, history search and clipboard paste would be ignored there today, independent of this feature; I could not test it without pressing keys in the owner's terminal. Ten-second check: `bun run research/2026-11-18-subagent-scrollback-view/experiments/key-probe.ts` in the terminal the CLI is used in (it switches on the same keyboard modes as the CLI and prints the bytes of each key). Any chord implementation must parse **both** forms.

### S8 — Command echo through S1
`/follow` and `/peek` are dispatched at once even mid-turn. `dispatchCommandAndApply` starts with `flushCommandLine`, which writes `\n\n\n<echo>\n` unconditionally (`repl-live-area.ts:385-397`). Route it, and `writeNoticeLines`, through `writeBlock` (S1e). Benjamin's change already routes the diagnostics sink; these two are the same pattern. Without it, `/follow A2` typed while the lead streams can leave a duplicate raw row.

### S9 — Lane markers in the lead's transcript
Persist one `note` record at attach, unfollow, hold, resume and seal, with `notification.emit({ text })` (no `block`, so no visible row: `repl-live-area.ts:812-819` persists `text` through `agent.appendNote`). Text format (one line, machine-readable prefix): `lane A2 follow 12:04:31 sid 0a4508c3` / `lane A2 seal done 12:11:40`. **Replay change (CLI):** `session-replay.ts` skips notes; add a `noteBoundaries(records)` like `compactDisplayBoundaries` and print notes with the `lane ` prefix as one dim row at their position. Optional for the first release. Without it a resumed session shows no trace of the lanes.

### S11 — OSC-aware widths (core)
`ANSI_RE` (`term-width.ts:23`) matches CSI only. Measured: an OSC 8 link `\x1b]8;;URL\x1b\\transcript\x1b]8;;\x1b\\` has `displayWidth` 43 (10 expected); `truncateDisplayWidth` cuts inside it; OSC 133 and 1337 marks measure 8 and 15 for zero cells. **Either** extend `ANSI_RE` to OSC (`ESC ] … (BEL | ESC \)`) with tests, **or** append links and marks after clamping and wrapping. Needed only for the optional links in seals and for marks. Not in v1.

---------------------------------------------------------------------------------------------------

## 8. S10 — The event tailer (plugin side) and the plugin's own changes

### 8.1 Sources and who is the truth for what
| Fact | Source | Notes |
|------|--------|-------|
| liveness: phase, tool in flight and since, idle, outcome, error, `result` | `<sid>.stream.ndjson` | already folded by `streamReader` (`stream.ts:514`) |
| assistant **text** (complete) | stream `item_completed(text).text` | no transcript needed |
| tool call **input** (full) | stream `item_started(tool_use).input` | exact args for the header and Edit/Write diff |
| tool **result**: error flag, duration, summary | stream `tool_result` (`isError`, `durationMs`, `outputSummary` one line + `(+N lines)`) | `outputSummary` is lossy |
| tool result **content** (full, up to the inline limit; `rawPath` for big ones) | transcript `<sid>.jsonl` `tool_result` record, joined by id (`tool_use_id` equals the stream's `id`: verified on `toolu_01UAuc…`) | needed for the Bash last line, the Read line count, cards |
| thinking duration | stream `item_started`/`item_completed(thinking)` timestamps; else first to last `thinking_delta` | text is empty in 100% of items: duration only |
| round boundary | stream `turn_completed.turn`; transcript `round_checkpoint.round` | for `grouped` order |
| notices, errors | stream `notice`, `error`, `run_finished` | `model_adopted` becomes the switch row |
| model/provider/effort | stream `session_started` (+ `model_adopted` for later switches) | the attach card must say "at attach" |
| mailbox | `<leadSid>.mailbox.jsonl` | rows of the sender's lane |
| fleet: id, label, type, status, task | `<leadSid>.subagents.jsonl` (last record wins) | the selector's rows |

### 8.2 Incremental reading
Both files are append-only. Reuse the `streamReader` method: keep a byte offset per file, read the new bytes, **cut at the last `\n`**, decode UTF-8 whole, reset on shrink, cap one read at 4 MB. Do not use the `sessions:read` capability (reads the whole file on every call, and its `window` is not an offset reader). The plugin already declares only `models:read`; no capability is added.

### 8.3 LaneEvent and the join
```ts
type LaneEvent =
  | { t: "text"; at: number; markdown: string; turn: number }
  | { t: "tool"; at: number; id: string; name: string; input: Record<string, unknown>; isError: boolean; durationMs: number; output?: string; summary: string; turn: number }
  | { t: "thinking"; at: number; durationMs?: number; turn: number }
  | { t: "notice"; at: number; notice: TurnNotice }
  | { t: "round"; at: number; turn: number }           // turn_completed: closes a group
  | { t: "mail"; at: number; from: string; to: string; kind: string; body: string }
  | { t: "end"; at: number; status: "done" | "failed" | "incomplete" | "stopped" | "lost"; result?: string; facts: SealFacts }
```
**Join window.** A tool event is emitted when the stream's `tool_result` arrives. The transcript record may land a moment later. Wait up to 1 s for it; if it is not there, emit with `summary` only and `output` absent, and the renderer degrades to the one-line digest. A committed block is immutable, so the choice is made once.
**Event-time order.** One tick reads all followed lanes, merges the new events by `at`, and emits blocks in that order. The host writes in arrival order.
**Backlog on attach.** Read the transcript from the start (median 256 KB, p95 755 KB: cheap). Emit: the attach card, `… N earlier steps not shown`, the last round as `replay: true` digest rows, then a `── live ──` rule. `--all` replays everything in chunks of 40 rows per block.
**Missing files.** No stream file (a worker started before streams existed): transcript only, no liveness; the widget's existing fallback applies. No transcript yet: wait. A partial last line: ignored until its newline.
**Ended workers.** Peek and attach work for a worker that has ended: the files stay. A fleet record whose process is gone but has no result is sealed `lost`.

### 8.4 Plugin surface (`ma-sub-agents-plugin`)
| Piece | Where |
|-------|-------|
| `lib/lane/tailer.ts`, `events.ts`, `join.ts` | new, pure plus the offset reader |
| `lib/lane/follow-state.ts` | the follow set, level (`auto` default: normal for 1 or 2 lanes, quiet for 3 or more), order, hold, fuse counters. In memory in v1 |
| `lib/lane/policy.ts` | event to `LaneBlock` (grouping by round, 12 rows or 20 s cut, never-hold for errors and seals) |
| `handlers/cmd_agents.ts`, `cmd_follow.ts`, `cmd_peek.ts` | `/agents`, `/follow …`, `/unfollow`, `/peek A2 [N]` (manifest `commands[]`) |
| `handlers/on_key.ts` | selector keys under `editor.overlay.open` (same pattern as `ma-usage-plugin`); permission `hooks:editor.key` |
| `lib/widget.ts` | followed rows get the rail and sort first; header shows `following …`, `‖ held`, `⇡ N waiting` |
| `manifest.json` | exact additions, copied from the `ma-usage-plugin` pattern (`manifest.json` of that plugin): `permissions` + `hooks:editor.key`, `hooks:editor.footer.set`, `hooks:editor.overlay.open`, `hooks:editor.overlay.close`, `hooks:scrollback.lane` (today it has only `hooks:agent.willStop`, `hooks:agent.didStart`); `headless.commands[]` entries `{name, summary, argHint, handler}` for `agents`, `follow`, `unfollow`, `peek` (the plugin has no `commands` today: its headless keys are `tools`, `hooks`, `turnAttachments`); `headless.hooks[]` entry `{id: "on_key", channel: "editor.key", handler, priority}` (usage uses priority 80, config 80, slash-menu 70, history 60; the selector must claim keys before history and slash-menu, so 80 again); `capabilities` stays `["models:read"]` |
Note that the plugin's `liveAreaSlots` entry (`fleet_supervisor`, `refreshMs: 1000`) already ticks the supervisor; the tailer runs inside the same tick, only for followed lanes (I6).

### 8.5 Selector data
Rows from the fleet file; order frozen while open (followed, running, queued, failed, incomplete, done, stopped); a window of at most 8 rows with `↑ N more`/`↓ N more`; digits jump; `/` filters over id, label, status, task; `Tab` peeks (volatile, never written to scrollback). Hundreds of rows are possible (94 distinct workers in one real lead).

---------------------------------------------------------------------------------------------------

## 9. Hazards, invariants and tests

### 9.1 Hazards (open items are marked)
| # | Hazard | Status |
|---|--------|--------|
| B1 | **Exact-width row loses its last glyph** when a later write arrives (compositor `eraseLiveSeq` emits `ESC[<streamCol>C` with `streamCol == cols`; terminals clamp at `cols-1`). 1.2 per 1,000 chars at 80/120 cols, no formatter. FakeTerminal hides it (`fake-terminal.ts:300-304`) | **open**; failing regression test ready in `experiments/exact-width-loss.regression.test.ts` (3 fail, controls pass); reported to Benjamin; independent of lanes |
| B2 | Foreign writers other than lanes are P7-class (toasts, command echoes, `writeNoticeLines`) | **open**: S1e |
| B3 | Untrusted control sequences reach the terminal through tool cards | **open**: S4, and the same hole in the lead's own cards |
| B4 | Scheduler timer chain growth | **fixed** (`152ace3`) |
| B5 | An open overlay hides the fleet widget and all slot rows | accepted: selector draws its own form |
| B6 | Followed lanes plus a long prompt could push the prompt | the fleet block limits itself to `F` rows; the editor takes rows first (Frank 2.9) |
| B7 | `withSuspendedLiveArea` may leave the cursor mid-row (`compositor.ts` sets `streamCol = 0` by assumption) | no production caller found in cli/core src (grep: only the interface `repl.ts:195`); queue must not write while suspended: add a test |
| B8 | A lane block queued during a resize drag | S1g: joins `heldStream`; **add a test** |
| B9 | A lead that never reaches a calm point | deadline fallback + queue cap (S1a, S1f) |
| B10 | Worker output may hold secrets; lane rows go to the lead's terminal history (not to the lead's model, not to its transcript) | same user, same machine; state it in the README |
| B11 | `✉` may draw as an emoji in some fonts | fallback `↦`; check in iTerm, Ghostty, kitty |
| B12 | `--resume` shows no trace of a past follow | optional: S9 |
| B13 | Different emulators | tested: FakeTerminal (lenient and strict wrap), tmux 3.8. **Not** iTerm2, Ghostty, kitty, Terminal.app |

### 9.2 Tests (what "done" means)
1. **S1:** the existing block tests, plus calm/deadline/cap/`streamHold`/`unmount`/two-lane interleave. Port `gate-sweep.ts` (variant `writeblock-one`) as a regression test that runs on the repo's recordings (small subset in CI: 6 scenarios x 80 cols, about 10 s).
2. **S2/S4:** payload validation table; 8 hostile strings; clamp limits; unknown kind dropped; ack emitted.
3. **S3:** golden rows at 40, 60, 80, 120 columns for every kind and every level, with the repo's `displayWidth` check on each row (all rows at most `cols-1`); tag rule (first row, after another writer, 20 rows, 60 s); rail and hue from `n` for `n = 1..40`; narrow layout under 50 columns; no formatter fallback.
4. **S10:** the `LaneEvent` fold on **real captured streams** (copy a few lines from real `.stream.ndjson` and `.jsonl` with the secrets and paths removed, as `stream.test.ts` already does); the join window; offset reader on a file that grows, shrinks, ends mid-line, ends mid-UTF-8.
5. **Soak:** 8 simulated lanes at the real event rates (median 0.9/s, p95 3.8/s, burst 400/s for 2 s) plus a lead streaming mdstream for 5 simulated minutes in FakeTerminal, with the sweep's analyzer asserting no lead row is duplicated, lost or glued, and no more than `rows-2` live rows.
6. **Real terminal:** `tmux-sample.py` style capture of one attach, one seal and one interleave at 60 and 120 columns; compare with the golden.
7. **Selector:** key script under a fake overlay owner (the `/usage` tests are the pattern): mark, apply, filter, peek, digits, 100 rows.
8. **Resume** (only with S9): a session with 3 lane notes replays 3 dim rows at the right positions.

---------------------------------------------------------------------------------------------------

## 10. What I did not verify
- That a plugin's `ctx.emit` can use an undeclared channel from a slot handler (S5).
- Any emulator besides FakeTerminal and tmux 3.8; any mdstream besides 0.3.9.
- Live behavior: nothing in this spec was tried in a running REPL with a real follow. The gate numbers come from replayed recordings.
- The cost of `ToolTimeTracker` shared state across lead and lanes (it is read in the host's replay; I did not trace every writer).
- That `stream-json` keeps `fromTarget`/`toTarget` in the `model_adopted` notice (Frank's item 12).
- The size estimates (about 400 lines for S3, 150 for S1 extras, 60 for S4) are by analogy with the observed diffs: Erik's scheduler fix is +7 lines product and +129 test lines; Benjamin's `writeBlock` is +143/−36 plus tests.
