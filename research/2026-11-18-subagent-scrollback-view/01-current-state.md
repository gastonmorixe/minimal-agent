# 01 — Current state: what the TUI can and cannot do for "follow a sub-agent"

Author: Daniel (7075489f) · 2026-11-18 · status: verified against the working tree

> **Update 12:0x.** This file was written first (cli `ac51c8c`). Since then: the scheduler leak in section 5 is **fixed on main** (`152ace3`); section 2.1's "likely, not proven" is now **measured** (`20-gating-experiment.md`: a naive or LF-first foreign write corrupts the lead at 85 to 95% of offsets); and `Compositor.writeBlock` (Benjamin, uncommitted, shared checkout) is the answer to gaps G1 and G2 (0 corrupt offsets of 21,677 in my sweep). The tables below keep their original wording where they describe the state of `ac51c8c`; read `02-primitives-spec.md` for the current state and the decisions.

Goal of this file: one place that says, with evidence, **what exists today**, **what blocks the
feature**, and **which facts the design depends on**. Every claim has a `path:line`, or is marked
`MEASURED` (I ran it), `SURVEY` (I counted it over real files on this machine), or `NOT VERIFIED`.
Paths are relative to the monorepo root. Line numbers are from the working tree on 2026-11-18 and
will drift.

---------------------------------------------------------------------------------------------------

## 0. The ask, in one paragraph

Today the user cannot see what a background sub-agent (a headless `minimal-agent` worker) is doing.
The only surface is the fleet widget: a header row plus one truncated row per worker, repainted
every second in the live area (`minimal-agent-plugins/ma-sub-agents-plugin/lib/widget.ts:157`). The
user wants to **select** a sub-agent in the TUI and **stream its work into the real scrollback**:
one at a time, any subset, or all of them. It must look like the rest of the TUI. The TUI does not
use the alternate screen and must not start to.

---------------------------------------------------------------------------------------------------

## 1. The screen model (the part that constrains everything)

```
  terminal viewport
  ┌───────────────────────────────────────────────────────────────┐
  │ SCROLLBACK  append-only. The terminal owns it. A row that was │
  │ written can never be changed again.                           │
  │   ...                                                         │
  │   the lead's streamed markdown, tool cards, notices           │
  │   (partial last row: the lead may be mid-line)                │
  │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
  │ LIVE AREA   the compositor owns it: erase + redraw per frame  │
  │   status row · decoration rows · editor · footer rows         │
  └───────────────────────────────────────────────────────────────┘
```

Source: `minimal-agent-cli/docs/tui/00-overview.md`, `01-compositor.md`. The hard rules, as the code
states them (`compositor.ts` header comments, `docs/tui/00-overview.md` "Hard rules"):

| # | Rule | Consequence for a follow feature |
|---|------|----------------------------------|
| 1 | The compositor never touches scrollback. | A committed row is final. Anything that changes (spinner, partial text, "now running") must live in the live area, never in scrollback. |
| 2 | No absolute cursor moves: only `ESC[A`, `\r`, `ESC[C`, `ESC[K`, `ESC[J`. | No "update row N of a lane block in place". |
| 3 | No DEC scroll regions. | No fixed pane that scrolls independently. |
| 4 | Resize emits nothing. | Pre-wrapped rows are fixed at the width they were written. A lane block cannot reflow later. |
| 5 | All writes go through the compositor (`StdioInterceptor` patches stdout, stderr and `console.*`). | The compositor is the single choke point for every byte. That is where a gate can be exact. |
| 6 | The live area is clipped to `rows - 2`, footer rows drop first (`ui/live-area-fit.ts:37`, `:45`). | At most `rows - 2` live rows exist. Eight worker rows plus a prompt do not fit a 24-row terminal. |

---------------------------------------------------------------------------------------------------

## 2. Every path that writes into scrollback today

The follow feature adds a new writer. Whether it can corrupt anything depends on how the existing
writers behave, so I traced all of them.

| Writer | Mechanism | Ordered with the lead? | Atomic? | Where |
|--------|-----------|------------------------|---------|-------|
| Lead assistant text | `formatter.write()` into the `mdstream` subprocess. Its stdout is drained asynchronously into `compositor.writeStream` | yes, by construction | no: arrives as many small chunks | `repl-live-area.ts:1082-1096` (`baseSink`), `ui/formatter/formatter.ts` |
| Lead thinking text | faint chunks via `writeDirectSink`, or a second formatter | yes | no | `repl-live-area.ts:1061`, `:1165-1187` |
| Tool cards, notices (`╭ │ ╰`) | `onTranscriptLine(line)` → `compositor.writeStream(line + "\n")`, block close adds a blank row | yes | one call per row | `repl-live-area.ts:1131-1164` |
| Queue echo, mode-change chip | `renderInOrder(step)`: waits for earlier turn steps | partly (see §2.2) | one call | `repl-live-area.ts:380`, `:428`, `:1228`; `interactive-session.ts:480` |
| **Plugin toast** (`notification.emit`) | listener calls `writeNoticeLines` → `compositor.writeStream("\n\n" + lines + "\n")` | **no gate** | one call | `repl-live-area.ts:810-819`, `:602-606` |
| Slash command result | `writeNoticeLines` after an async `dispatchCommand` | **no gate** (commands run out of band, also mid-turn) | one call | `commands/dispatch-submit.ts:106-130` |
| Diagnostics (warn/error blocks) | `process.stderr.write` → interceptor → `writeStream` | **no gate** | one call | `ui/status/scrollback.ts:134` |

### 2.1 The toast path is the closest thing to what we need, and it has no gate

`notification.emit` is the existing "another agent's activity shows up in my scrollback" path. The
intercom plugin's `beat` slot emits one toast per arrived message (`ma-intercom-plugin/handlers/beat.ts:114`).
The code comment says it "lands BETWEEN turns" (`repl-live-area.ts:806-809`). **The code does not
enforce that**: the listener does not read `running` and does not wait for anything. It is a
fire-and-forget write at an arbitrary moment. The gating experiment (`20-gating-experiment.md`)
measured this case: a toast writes `\n\n` first, which is the "LF first" policy (P7), corrupt at
**85% of real write boundaries** with a markdown formatter active, in a replayed real-mdstream stream
(FakeTerminal and real tmux). I did not reproduce it in a live REPL session.

### 2.2 `renderInOrder` orders against model events, not against mdstream's output

`renderInOrder` is the existing ordering seam. It is implemented by `TurnRenderPump`
(`turn-render-pump.ts:1-24`): a step waits while an earlier text chunk is "with the consumer". But
the consumer of a text chunk is `baseSink`, which returns right after `formatter.write(s)`
(`repl-live-area.ts:1094`). mdstream's reply bytes arrive later, asynchronously. So even an ordered
step can run while mdstream still owes bytes for earlier text. The seam is the wrong layer for a
byte-exact gate. The compositor sees the final bytes and is the right layer.

---------------------------------------------------------------------------------------------------

## 3. What the lead's markdown formatter does to rows (MEASURED)

`mdstream` 0.3.9 (`~/.minimal-agent/bin/mdstream` → `/Users/gaston/Projects/mdstream/target/release/mdstream`),
run with stdout as a pipe, `COLUMNS=80`, input in 3 to 7 character chunks. Scripts:
`experiments/mdprobe/` (`python3 probe2.py table|fence|para`, `python3 probe3.py wrap|softbreak`).
Notation: `<CR>` = `\r`, `<EL>` = `ESC[K`, `<LF>` = `\n`; SGR removed.

```
paragraph "Hello **world** para.\n\nSecond.\n", fed 3 chars at a time
  Hel / lo / **w / orl / d** / pa / ra.          raw text echoed on the CURRENT row, no newline
  <CR><EL>Hello world para.<LF><LF>S             at "\n\n": clear the row, write the FORMATTED line, blank row
  eco / nd.                                       next paragraph echoes raw again
  <LF>

table "| a | b |\n|---|---|\n| 1 | 22 |\n| 333 | 4 |\n\n"
  | a | b |                                       raw echo
  <CR><EL>|---|---|                               each new raw line overwrites the SAME row (scratch row)
  <CR><EL>| 1 | 22 |
  <CR><EL>| 333 | 4 |
  <CR><EL>  a  │ b  <LF>                          at table end: clear scratch row, emit the whole formatted table
  ━━━━━┿━━━━<LF> ... 333 │ 4  <LF><LF>

fenced block "```bash\necho hi\nls -la\n```\n"
  ```bash  →  <CR><EL>── bash ──────<LF>           header row (complete, ends in LF)
  echo hi  →  <CR><EL>  1  echo hi<LF>            per code line: raw echo, then rewrite with a line number + LF
  ```      →  <CR><EL>──────────────<LF>

one long paragraph (200 chars, wraps to 3 rows at 80 cols)
  echo shows only the TAIL, clipped with a leading "…", on ONE row (never wraps while streaming)
  at "\n": <CR><EL> + the whole paragraph as one long line (the terminal wraps it) + <LF><LF>
```

What this means:

1. **A row can exist twice in time**: first as raw text, later rewritten in place. If anything else
   is written between those two moments, the rewrite lands on the wrong row. The raw echo stays in
   scrollback as a permanent duplicate of the formatted line.
2. In these probes mdstream did **not** emit `ESC[nA` (cursor up). The 2026-10-31 fixture
   (`minimal-agent-cli/src/test-utils/fixtures/mdstream-redraw-80col.bin`: `…tools.<ESC>[1A<CR><ESC>[J…`)
   shows an older version did. The code still handles it (`compositor.ts:970-980`). A gate must
   not depend on "no cursor-up".
3. **`streamCol == 0` is not the same as "safe to write"**. `updateStreamCol` treats `\r` as a
   column reset (`compositor.ts:951-962`), and `suffixAfterLastRedrawClear` treats `\r ESC[K` as a
   redraw anchor (`:970-980`). So right after mdstream's `<CR><EL>` the compositor believes it is at
   column 0, while the formatted line has not been written yet.
4. Tables hold a scratch row for their whole length, so "no newline arrived" can last for many
   input lines. Fences complete a row (with an LF) per code line, so a block can legally land
   between two code lines of the same fence. That is not corruption, but it is ugly.

The gating experiment (`20-gating-experiment.md`) turns these observations into numbers for every
byte offset of recorded formatter output.

---------------------------------------------------------------------------------------------------

## 4. The compositor, as seen by a writer

State the compositor already tracks (`ui/compositor.ts`):

| Field | Meaning | Visibility |
|-------|---------|------------|
| `streamCol` (`:75`) | visible column of the last partial stream row; 0 at row start | private |
| `consecutiveNewlines` (`:88`) | run of `\n` at the tail of the stream, capped at 3 (`capBlankLines`, `:302`) | private |
| `liveHeightValue`, `cursorRowInLive`, `sepRowsAboveLive`, `liveSepDrawn` | live-area geometry | private |
| `streamHold`, `heldStream` (`:176-178`) | during a resize drag, stream bytes are buffered until the next `setLiveArea` | private |
| `mounted`, `tty` | pass-through when not a TTY or not mounted (`writeStream`, `:245-268`) | private |

One scrollback write is **one atomic terminal frame**: `BSU, hide cursor, erase live area, chunk,
redraw live area, ESU` (`writeBufferedStream`, `:365-387`; BSU/ESU = DEC mode 2026 when the
terminal supports it). So a multi-row block written in a single `writeStream` call is atomic with
respect to the live area, and with respect to every other `writeStream` call (JavaScript is single
threaded). What is **not** atomic is anything the lead's formatter has already half-said.

Public surface a writer can use today: `writeStream(chunk)`, `flushStream()`, `setLiveArea`,
`withSuspendedLiveArea`, `mount/unmount`, `notifyResize`, `setDrawColumns`, `beginStreamHold`,
`liveHeight`. There is no public "is the stream at a block boundary" query and no block queue.

Two places a new writer must cooperate with:

- `streamHold` (resize drag): a block committed during a hold must join `heldStream`, or it would
  paint intermediate-width frames.
- `withSuspendedLiveArea` (`:530`): an overlay owns the tty; the callback may leave the cursor
  mid-line (`streamCol = 0` is only assumed, `:555`). Commits must wait while suspended.

---------------------------------------------------------------------------------------------------

## 5. Live area, slots, footers

| Piece | Behavior | Evidence |
|-------|----------|----------|
| Plugin "slots" | a plugin declares `ui.liveAreaSlots[]`; the host calls its handler every `refreshMs` (minimum **1000 ms**) and paints the returned string. A multi-line value is split on `"\n"` into rows. | `plugin.ts:1149-1197`, `live-area-scheduler.ts:572`, `:632` |
| Placement | `position: "header"` (decoration band above the prompt) or `"footer"` (below), sorted by `order` | `plugin.ts:1155-1163`, `live-area-scheduler.ts:611-637` |
| Row budget | `maxLiveHeight` limits editor rows only; the compositor clips the whole frame to `rows - 2` and shows `… +N more rows`; footer rows drop first | `docs/tui/02-live-area-layout.md` "Height budget", `ui/live-area-fit.ts:45-100` |
| Footer layers | `FooterLayers.compose()` returns **only the highest-priority non-empty layer** | `editor/footer-layers.ts:32-38` |
| Event-driven refresh | `refreshOn: ["event"]` re-fires the slot off-cycle | `live-area-scheduler.ts:351-363` |
| Resize | the CLI emits `terminal.resize {cols, rows}` on the global bus; slots can list it in `refreshOn`. This is the only way a plugin learns the **row** count; `ctx.tui.columns` is a snapshot | `startup/live-repl.ts:217-235`, `plugin.ts:43-55` |

Consequences:

- **A slot is a poll, not a panel.** A plugin that wants the ticker row to move the instant a lane
  event arrives has two bad options: wait up to 1 s, or abuse `refreshOn`.
- **Opening an overlay hides every slot row** (quota, fleet, intercom), because the overlay layer
  (priority 50) wins the whole footer. A selector for sub-agents must therefore draw its own fleet
  list; it cannot sit next to the fleet widget.
- **Defect, reproduced and now fixed (`21-scheduler-timer-leak.md`)**: `scheduleNext`
  (`live-area-scheduler.ts:570-577` at `ac51c8c`) assigned `s.timer` without clearing the previous
  timer, and a `refreshOn` event calls `fire` (`:356-359`) while the periodic timer is pending.
  Each settled event-driven fire added one more self-re-arming chain (2,401 chains after 10 minutes
  of streaming). Found by reading (Erik, 652070b6), reproduced by me, fixed by Erik in cli
  `152ace3` (`scheduleNext` clears the pending timer first). A slot may use `refreshOn` now.

---------------------------------------------------------------------------------------------------

## 6. Input: what a plugin can receive

Verified by reading `editor/key-dispatch.ts`. A plugin sees keys only through the `editor.key` hook,
and only for a closed set of names:

| Key | Dispatched to `editor.key` | Evidence |
|-----|----------------------------|----------|
| Escape, EscapeEscape | yes (after the host `InputCaptureStack`, which is host-only) | `key-dispatch.ts:295`, `:338` |
| Enter | yes | `:529`, `:549`, `:930` |
| Tab | yes | `:635`, `:944` |
| Arrows | yes | `:763-781` |
| Alt+Enter | yes | `:821`, `:922` |
| Ctrl+R | yes | `:606` |
| `/` and `$`, after the char is inserted | yes | `:670`, `:1043` |
| every printable char, Backspace | **only while a modal overlay owns the input** (`editor.overlay.open`). A space is printable, so it arrives as `" "`. | `:460-478`; `key-codec.ts:100-103` (`cp >= 0x20`) |
| Delete, Home, End, PageUp, PageDown | **no**: they edit the hidden buffer or are ignored | `:758-792` |
| Ctrl+A/E/K/U/W/D/V/C, Ctrl+\, Alt+B/F/M, Shift+Tab | consumed by the editor itself | `:555-629`, `:994-1013`, `:824-835` |
| Ctrl+G, Ctrl+T, Ctrl+O, Ctrl+N, Ctrl+P, Ctrl+L, any other unbound control byte | **silently dropped** (consumed from `pending`, no branch acts on them) | `:451` and the `if` chain after it |

Modal ownership (`editor.overlay.open {owner}` → `EditorController.openOverlay`, `editor-controller.ts:989`):
the prompt row and cursor are hidden, `submit()` is a no-op (`:1236`), the typed text is cleared,
and the plugin paints rows through `editor.footer.set` into the overlay layer. One owner at a time;
a new owner replaces the old one. Reference users: `ma-config-plugin`, `ma-usage-plugin`
(`handlers/cmd_usage.ts`, `handlers/on_key.ts`).

So a **modal selector for sub-agents is buildable today** with arrows, Space, Enter, Esc, letters
and type-to-filter. What does not exist: a non-modal focusable panel (prompt stays live), plugin
chords such as `Ctrl+G`, and any scroll keys.

---------------------------------------------------------------------------------------------------

## 7. The plugin API surface for UI (what a plugin may touch)

| Surface | What it is | Limit |
|---------|------------|-------|
| `ctx.tui` (`TerminalUiCapability`, `plugin.ts:43-55`) | `{capability, columns, paletteJson, kit}`. `kit` = ANSI codes, styles, palette, `bgRgb`, `renderUnifiedDiff` | given **only** to entries of the manifest `ui` block (slots and `ui.setup`); never to tool, hook, event or command handlers (`plugin.ts:38-42`) |
| Slash command (`CommandResult`) | `expand` / `notice` (framed block via the host) / `error` / `none` | a command handler has `ctx.emit` for bus events but no `tui` |
| Bus channels (`channels.ts`) | `editor.key`, `editor.footer.set`, `editor.picker.set`, `editor.overlay.open/close`, `notification.emit`, `prompt.inject`, `subagent.*`, `terminal.resize` | all fire-and-forget; the host validates and clamps payloads (`ui/command-notice.ts:40-70`) |
| Host-owned framing rule | "plugins never hand-draw ╭│╰ borders or write to a process stream" (`channels.ts:468-480`) | the design below follows it |
| Host renderers a plugin cannot call | tool cards (`ui/tool-transcript/*`), diffs, `replayToScrollback` (`session-replay.ts:247`) | CLI-internal; `02-primitives-spec.md` section 5 says which are reused (no separate reuse map: that worker timed out) |

There is **no plugin-facing way to append rows to scrollback** except `notification.emit` (framed
toast, ungated) and a command's `notice` result (user-triggered).

---------------------------------------------------------------------------------------------------

## 8. The sub-agents plugin today

| Piece | Fact | Evidence |
|-------|------|----------|
| Process model | a worker is a headless `minimal-agent` child with its own session id; the lead supervises it every second | plugin `README.md` "How a worker runs" |
| Supervisor runs as a UI slot | `ui.liveAreaSlots[fleet_supervisor]`, `position: "footer"`, `refreshMs: 1000`, `timeoutMs: 4000` | `manifest.json:361-380`, `handlers/heartbeat.ts` |
| Fleet widget | header + up to `maxRows = 6` worker rows + `… +N more`; running workers first | `lib/widget.ts:157-203`, `:166` |
| Capabilities declared | `["models:read"]` only | `manifest.json:6` |
| Worker files | `<sid>.stream.ndjson` (typed events, lossy), `<sid>.jsonl` (full transcript, append-only), `<sid>.result.json`, `<sid>.log`; fleet in `<leadSid>.subagents.jsonl` | `README.md` "Files" |
| Incremental stream reader | `streamReader`: reads only appended bytes, cuts at the last `\n`, folds into `StreamState`; activity ring of 40 | `lib/stream.ts:514-538`, `:124` |
| Stream-to-tool-label | `toolLabel(name, input)` one-liners (`Bash: bun test`) | `lib/stream.ts:197-210` |

### 8.1 What the worker data really contains (SURVEY of 411 stream files, 61 MB, on this machine)

| Fact | Number | Consequence |
|------|--------|-------------|
| files with `text_delta` | 315 of 411 (77%) | live text for a ticker is common but not guaranteed |
| files with `thinking_delta` | 12 of 411 (3%) | thinking content is almost never streamed |
| finished thinking items with non-empty text | **0 of 10,479** | never design "show the thinking". Show "thought for 4.2 s" |
| `tool_result` in the stream | only `inputSummary` (~120 chars), `outputSummary` (one line + `(+N lines)`), `durationMs`, `isError` | full tool output is **not** in the stream |
| `item_started(tool_use).input` | full input object | the card header and args are exact |
| transcript `<sid>.jsonl` | full assistant blocks and full `tool_result.content`; `rawPath` for big outputs (3,407 of 19,506 results = 17%) | the transcript is the complete source for cards; the stream is the liveness source |
| worker wall time | median 5.5 min, p95 22 min, max 63 min | long enough that people want to watch |
| event rate | median 0.9/s, p95 3.8/s, burst up to 400/s (thinking deltas) | the ticker must throttle (≤ about 4 repaints/s per lane) |
| transcript size | median 116 records, p95 281, max 1,435 | **an attach backlog cannot be dumped whole**; it needs a window and a collapse row |
| tool mix | Bash 12,527 (64%), Read 2,383, Grep 1,267, Edit 1,132, Write 494 | compact Bash and Read cards decide how the feed feels |
| assistant text items | median 66 chars, p95 175, max 11,023 | mostly one-liners; the final report can be long and needs a clip |

### 8.2 Real fleet sizes (SURVEY of 1,242 lead fleet files, about 12.7k workers)

- Peak concurrency of 8 occurs in many fleets. The largest fleets had 94, 78 and 64 distinct workers.
- Final status mix: done 6,567 · stopped 1,295 · failed 736 · incomplete 368 · running 390 (mostly
  records of dead leads).
- Types: worker 3,550 · explorer 3,019 · inline 1,142 · reviewer 1,018 · planner 538 · log-miner 49 · integrator 40.

So "8 or more workers" is the normal case, and a selector must handle on the order of 100 rows.

---------------------------------------------------------------------------------------------------

## 9. Gap table: what the feature needs vs. what exists

| # | Need | Exists today? | Verdict |
|---|------|---------------|---------|
| G1 | Append a multi-row, attributed block to scrollback **without corrupting the lead's streaming** | `notification.emit` and `writeNoticeLines`, ungated. **Now: `Compositor.writeBlock` exists, uncommitted** | **nearly done**: commit it and route the other foreign writers through it |
| G2 | Know "the lead's output is at a block boundary" | `streamCol`/`consecutiveNewlines` exist but private and not sufficient alone (§3). **Now: `rowClosed` inside `writeBlock`** | **answered** by `writeBlock`; calm points and a read-only `state()` are small additions (spec S1a to S1c) |
| G3 | Per-lane live rows that update on events, not on a 1 s poll | slots poll at ≥ 1 s; `refreshOn` has the suspected leak | **missing**: a push-based panel API; plus fix the leak |
| G4 | Select one, several or all workers (about 100 rows, multi-select, filter, peek) | modal overlay + arrows/Space/Enter/printables work; `editor.picker.set` is single-select | **buildable now** as a modal; wants a shared list component |
| G5 | Open the selector with one chord, control follow without leaving the prompt | slash commands work; `Ctrl+<letter>` is silently dropped | **missing (small)**: dispatch unbound control keys to `editor.key` |
| G6 | Read terminal rows and resize reliably | `terminal.resize` via `refreshOn` only | **missing (small)**: a documented viewport capability |
| G7 | Render worker activity with the **same look** as the lead (cards, diffs, markdown) | host renderers exist (`ui/tool-transcript`, `session-replay.ts`) but are CLI-internal | **missing** as a plugin API; the reuse list is in `02-primitives-spec.md` section 5 (S3) |
| G8 | Read worker activity incrementally | `streamReader` (stream only) | **partly**: add an item-level reader and a transcript tail |
| G9 | Frame, gutter and wrap rows by the host (rule: plugins do not hand-draw frames) | `renderCommandNoticeBlock` for generic blocks | **partly** |
| G10 | Order several lanes and the lead's own writes sensibly | none | **new**: chronological merge, rate limit, coalescing |

---------------------------------------------------------------------------------------------------

## 10. Existing hazards found on the way (independent of this feature)

1. Ungated plugin toasts and command notices can land at any byte of the lead's stream (§2.1).
   Measured in `20-gating-experiment.md`: P7-class, corrupt at 85% of write boundaries with a formatter active.
2. `LiveAreaScheduler` timer chain growth under `refreshOn` (§5): **fixed** (`152ace3`).
3. The overlay layer hides the fleet widget and every other slot while open (§5).
4. A comment claims toasts land "between turns" (`repl-live-area.ts:806`); no code enforces it (§2.1).

---------------------------------------------------------------------------------------------------

## 11. How this was verified, and what was not

Verified by reading: `compositor.ts`, `live-area-fit.ts`, `footer-layers.ts`, `live-area-scheduler.ts`
(selected ranges), `key-dispatch.ts` (all dispatch sites), `key-codec.ts`, `editor-controller.ts`
(overlay and submit), `repl-live-area.ts` (writers and turn loop), `repl-editor-hooks.ts`,
`channels.ts`, `plugin.ts` (UI types), `command-notice.ts`, the sub-agents plugin (`widget.ts`,
`stream.ts`, `manifest.json`, `README.md`).

Measured: mdstream output by hand (§3); worker and fleet statistics by script (§8).

Not verified:

- ~~That a P0 write corrupts real output~~: measured (replayed real mdstream output, FakeTerminal and tmux); not reproduced in a live REPL session.
- ~~That the timer leak reproduces~~: reproduced and fixed.
- Terminal behavior outside `FakeTerminal` (iTerm2, Ghostty, kitty, Terminal.app, tmux).
- How `mdstream` behaves with other versions, or with a different formatter configured by the user
  (`--formatter`), or with no formatter.
- Whether `replayToScrollback` can be called on slices of a growing transcript: **not verified**; the reuse-map worker timed out. The spec does not depend on it (the lane renderer calls the same header, preview and diff functions on one tool call at a time, as `replayToScrollback` does at `session-replay.ts:470-590`).
- Behavior of `repl.ts` (the plain, non-live-area REPL). The feature targets the live-area REPL only.
