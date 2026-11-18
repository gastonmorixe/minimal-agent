# Follow a sub-agent in the CLI scrollback

Date: 2026-11-18. Status: **design and plan; no product code was written or changed.**
Asked by: Gaston. Work by: Daniel (7075489f, analysis, spec, plan, experiments), Frank (932e6ae3, UI design), with input from Erik (652070b6, mission control) and Benjamin (f9288ce8, `Compositor.writeBlock`).

## The request

"It is impossible right now to inspect in the CLI TUI what a sub-agent is doing. The TUI has no alt-screen. Design the TUI primitives that are missing so a plugin can let the user **select** a sub-agent and **stream what it does into the scrollback**: one at a time, any of them, or all. Show the UI for every state."

## Read in this order

| # | File | What it is | Length |
|---|------|------------|-------:|
| 1 | **this README** | the answer in one page | |
| 2 | [`frank-ui-design.md`](frank-ui-design.md) | **the screens**: live area in every state (none, running, selector, follow one / some / all, held, ended, 8+ workers, narrow, lead streaming), scrollback for every kind (text, thinking, tool, diff, error, notice, mailbox, seal, attach, backlog, live rule, unfollow, levels, interleave, "months later"), keys and slash commands, 43 mockups | 1,215 |
| 3 | [`02-primitives-spec.md`](02-primitives-spec.md) | **what the host must add**: 11 seams (S1 to S11), the lane channel contract, the renderer, the sanitizer, the tailer, invariants, hazards, tests | |
| 4 | [`03-plan.md`](03-plan.md) | **how to build it**: tasks with repo, dependency, size and a test that proves each; phases V1 to V5; risks; open questions | |
| 5 | [`01-current-state.md`](01-current-state.md) | what exists today, with `path:line` and measurements | |
| 6 | [`20-gating-experiment.md`](20-gating-experiment.md) | the experiment behind the one hard problem: when may a foreign block be written while the lead streams markdown? | |
| 7 | [`21-scheduler-timer-leak.md`](21-scheduler-timer-leak.md) | a bug found on the way (fixed on main, `152ace3`) | |
| | `review-claims.md` | **does not exist**: the independent claim-check reviewer (A4) was stopped before it reported. The spec's `path:line` claims are checked only by its author | |

## The answer in 12 lines

1. **Two speeds.** "Now" (a spinner, a running tool, a partial sentence) lives in the live area, on the fleet widget row. Scrollback receives only **complete, atomic blocks** (one model round or one tool call with its result). A reader who scrolls up never finds a half-state.
2. **The lane.** Each followed worker gets a 5-cell gutter in the margin: a short tag (`A12`), a coloured rail (`▎ ┃ ║ ╏`), from the worker's id alone (20 distinct looks, no state, the same on replay). The host's own tool cards, diffs and notices are reused inside the gutter. Rows without a rail are the lead's.
3. **Select.** `/agents` (or `Ctrl+G`) opens the widget's larger form as a modal: staged marks, `⏎` applies, `Tab` peeks (volatile), `/` filters, digits jump, a window of 8 rows over about 100 workers. `/follow A2`, `/follow all`, `/follow only A2`, `/unfollow`, `/peek A2`, hold, levels.
4. **Honest gaps.** Attach, backlog, unfollow, hold and stall each leave one row, so a reader months later knows what is missing. Every tagged row has its event time.
5. **Density follows load.** 1 or 2 lanes show digest rows and cards. 3 or more default to `quiet` and grouped-by-round order. A flood fuse drops a noisy lane one level.
6. **The hard part is not the look.** Writing a foreign block into scrollback while the lead streams markdown **corrupts the lead's text at 95% of byte offsets** (measured on real mdstream output, 21,677 offsets, confirmed in real tmux). Ending the row with a line feed first is as bad (85% of real write boundaries). Today's toasts, command echoes and `writeNoticeLines` have that hazard.
7. **The fix exists and is nearly done.** `Compositor.writeBlock` (Benjamin, uncommitted in the shared checkout) queues a block and splices it in after the lead's row is final. My sweep finds **0 corrupt offsets of 21,677** on it.
8. **What the host must add** (spec): commit `writeBlock` and route every foreign writer through it; a generic `scrollback.lane` channel; a lane renderer in the CLI (gutter, tag rule, digest row); a control-sequence sanitizer (a worker's `\x1b[2J` or OSC 52 must not reach the terminal; the lead's own tool cards pass them today); `rows` in the slot context; optional chords and selector keys.
9. **What the plugin adds**: an incremental tailer over the worker's two append-only files (the stream for liveness, the transcript for full tool output), the selector, the commands, the follow policy. No new capability.
10. **Data reality** (411 worker streams): thinking text is empty in 100% of items, so thinking is `· thought 4.2s`; text deltas exist in 77%; tool output in the stream is a one-line summary, so full output comes from the transcript. Peak concurrency is 8 in many fleets. The design is correct at item level and treats deltas as a bonus.
11. **First release shows nothing new in scrollback**: the selector with a live peek and `/peek A2` answer "what is that worker doing" with no new writer at all (phase V1).
12. **Not tested**: any terminal besides tmux 3.8 and the repo's emulator; any mdstream besides 0.3.9; a live REPL session with a real follow (nothing here was run end to end, because there is no implementation).

## Bugs and hazards found on the way

| # | Finding | State |
|---|---------|-------|
| 1 | `LiveAreaScheduler` leaked one timer chain per `refreshOn` event (2,401 chains after 10 min of model streaming) | **fixed on main** by Erik, `152ace3`; my 3 tests moved in |
| 2 | Toasts, slash-command echoes and `writeNoticeLines` write at any byte of the lead's stream (P7-class: corrupt at 85% of write boundaries when a formatter is active) | open; `writeBlock` fixes it once they are routed through it (plan H1) |
| 3 | The compositor erases the last glyph of a row that ends exactly at the terminal width (no formatter): 1.2 lost per 1,000 chars at 80 and 120 columns; the repo's emulator hides it | open; a failing test is ready in `experiments/exact-width-loss.regression.test.ts` |
| 4 | The lead's own tool cards pass raw terminal control sequences from tool output unchanged (`\x1b[2J`, OSC 52, bare `\r`); real results carry ESC in 0.02% of cases | open, not caused by this feature; spec S4 |
| 5 | Core's `displayWidth` strips only CSI: an OSC 8 link measures 43 cells instead of 10 | open; blocks optional links (spec S11) |
| 6 | An open overlay replaces the whole footer, including the fleet widget and every slot row | accepted; the selector draws its own form |

## Decisions I need from Gaston

See `02-primitives-spec.md` section 0 and `03-plan.md` section 10. The three that matter most: (1) the writer for v1 is `writeBlock` as it is (I recommend) or the P9 restore write; (2) a new generic core channel `scrollback.lane`; (3) are chords (`Ctrl+G`, `Ctrl+O`, `Ctrl+T`) wanted, or are slash commands enough for now.

## Experiments (`experiments/`)

All scripts run from `minimal-agent-cli/` and import the real modules by relative path. Nothing outside this folder was edited.

| Path | What |
|------|------|
| `gate-sweep.ts` | the gating sweep: real mdstream 0.3.9 to real Formatter to real Compositor to FakeTerminal, every byte offset, policies P0 to P10 (`capture`, `sweep`, `report`, `dump`, `find`). Worker A2 wrote the base; I added P4 to P10 and the strict-wrap mode |
| `recordings/`, `results/`, `results-strict/` | 36 captured streams, per-unit JSON and tables (about 20 MB) |
| `tmux-validate.ts`, `tmux-sample.py` | the same cuts replayed in a real tmux pane (private socket) |
| `landing-delay.py` | wait of the `writeBlock` rule, in input chunks and ms |
| `exact-width-*.ts/.py`, `fake-terminal.clamped.ts`, `exact-width-loss.regression.test.ts` | the exact-width bug: probes, rate, and a failing test |
| `scheduler-timer-leak*.ts` | the timer chain probe, the real-timer CPU probe, and the regression test (now on main) |
| `mdprobe/` | hand probes of mdstream's output |

Re-run commands are at the end of each report. A tmux-based script must use a private socket (`tmux -L <name>`) and never `kill-server` on the default one.

## Process notes (so you know how much to trust each part)

- Three of the four sub-agents I used timed out (the reuse-map explorer, the gating-experiment worker, the scheduler worker). I finished the gating experiment and the scheduler probe myself; the reuse-map is not a file, and the spec states which reuse claims rest on my own reading. The fourth (a claim-check reviewer, A4) was stopped when the session ended and wrote nothing, so **no independent review of the spec exists**.
- The gating experiment's first harness had two errors (fixed, listed in `20-gating-experiment.md` section 6), and one of my own tmux scripts killed another agent's tmux session once (09:17); all scripts now use a private socket.
- A figure I published first was wrong and is corrected in the report: a "14 s wait" divided output bytes by a character rate. The right wait is in input chunks: mean 0.2 s, worst case 0.9 s in the recordings.
- Erik's session (mission control) ended before it could review the spec. His plan (`research/2026-11-18-mission-control/`) lists "review Daniel's primitives spec" as its own next step.


## Status at hand-off (2026-11-18, 11:50)

- `Compositor.writeBlock` is **committed and on cli main** (`52e6893`, Benjamin; umbrella `12b600b`). It routes **only the diagnostics sink**. Still direct `compositor.writeStream` calls that can run while the lead streams (committed tree, `repl-live-area.ts`): `flushQueueItemToScrollback` `:396`, `writeNoticeLines` `:605`, and the **mode-change chip `:428`** (a fourth writer the spec's S1e list does not name). `notification.emit` toasts go through `writeNoticeLines`. Plan task H1 is therefore **half done**: the routing of these writers is open and has no owner.
- Frank (932e6ae3) took H2 (sanitizer), H5 (fake-fleet harness), then V1.1 (tailer). Nobody holds H1b, H3, H6 or V1.2 onward.
- Verified on two real worker sessions (303 tool calls): every `tool_result` id in `<sid>.stream.ndjson` is also the `tool_use_id` in `<sid>.jsonl` (303 of 303). A transcript `content` that has a `rawPath` is only a preview plus an annotation, and it is *longer* than `rawBytes` (an `output-preview` tail). **Full tool output is in the `.blobs/*.raw` file, not in the transcript line.** The spec's S-tailer text should read the blob when it needs more than the preview; check that before building V1.1.
- Not committed here: `experiments/results/` and `experiments/results-strict/` (22 MB, regenerable with `gate-sweep.ts sweep`). The 36 recordings (464 KB) are kept.
