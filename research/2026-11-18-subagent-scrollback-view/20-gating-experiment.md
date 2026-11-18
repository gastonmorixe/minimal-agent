# 20 — When may a foreign block be written into scrollback while the lead streams?

Author: Daniel (7075489f) · 2026-11-18 · code under test: cli `ac51c8c` and `57ff8a7` (results are byte-identical on both), mdstream 0.3.9
The first worker (A2) built the sweep and timed out before it wrote the report. I finished the experiment, fixed two harness errors, added the policies P5 to P9, and ran the real-terminal checks. Every number below was produced by the scripts in `experiments/`. Product source was **not edited**.

## 1. Result in six lines

1. **A naive block corrupts the lead's text at 94.9% of byte offsets, and at 87.7% of the real `writeStream` boundaries** (792 of 903). Corrupt means: the lead's raw echo stays in scrollback as a duplicate row, or the block's first row glues onto the lead's row, or lead rows are lost.
2. **`streamCol == 0` is a safe gate only with a live area mounted** (production). Without one it fails at 235 offsets, all right after a `\r`. It is safe but slow: it allows 16% of the boundaries, and a block waits for the lead's open row to end, which is at most one lead paragraph (about 0.9 s for a 265-character paragraph at the median stream rate, about 7 s for a 2,000-character one).
3. **Ending the open row with a line feed first (what a toast, a slash-command echo, and the first draft of `Compositor.writeBlock` all do) is as bad as writing naively: corrupt at 85.0% of boundaries.** The formatter rewrites its row in place, and after the LF the rewrite lands on the next row.
4. **A safe gate that does not wait exists: clear the open row, write the block, put the open row back, all in one write.** Policy P9 had **0 corrupt cases at all 21,677 offsets**, covers 91% of the 903 real boundaries, and waits 10 bytes (0.6 input chunks, about 10 ms) on average.
5. Confirmed in **real tmux 3.8** (286 captures): naive 60 of 72 corrupt; P9-allowed offsets 182 of 182 clean.
6. Not measured: any emulator other than tmux, any mdstream other than 0.3.9, markdown beyond the 12 scenarios (section 8).

> **Status update, 11:55.** After my message of 09:5x, Benjamin (f9288ce8) rewrote the uncommitted `Compositor.writeBlock` in the shared checkout (branch `feat/no-direct-writes`) twice. It no longer ends the row with a line feed. It now **queues the block and splices it in right after the first line feed of a later chunk** (or writes it at once when the row is already closed), waits when the stream moves the cursor with anything but SGR/EL/ED/OSC, keeps arrival order, and drains at `flushStream()`/`unmount()` (the formatter has ended by then). He tests it against real mdstream 0.3.9 output at every offset (`src/ui/compositor-block.mdstream.test.ts`, fixture `mdstream-segments.json`), with negative controls for append-to-the-open-row and LF-first. In this report's terms that is **P1b plus a splice and a drain**. I re-ran my sweep on his working tree (compositor.ts diff sha `e2dc5cdcbc4d`): **0 corrupt offsets of 21,677** (live area on and off, raw and lead-sink models), and 2,334 offsets (10.8%) where it lands between two rows of one markdown structure (cosmetic). It is simple, and slower than P9: landing delay computed from the recordings (`experiments/landing-delay.py`), mean 12.0 input chunks (about 0.2 s at the median stream rate), worst case 53 chunks (0.9 s), set by the longest single lead row; a 2,000-character unbroken paragraph at 290 characters per second would be 7 s. **P9 (below) is an optional upgrade that cuts the wait to about 10 ms; it is not a prerequisite.** Rows below that say "`writeBlock` as drafted" mean the FIRST draft (LF, then block).

## 2. The question and the model

A plugin wants to commit a 4-row block (a "lane block" from a sub-agent) into scrollback. Everything the lead says goes through `compositor.writeStream`. The lead's markdown comes from mdstream, which **echoes the raw partial row and rewrites it in place** (`\r ESC[K` + the formatted row) at the next newline (`01-current-state.md` section 3). So the row under the cursor can hold text that a later write will overwrite.

Test: record the exact bytes that mdstream sends (through the real `Formatter`), then for **every** byte offset `k` of the stream (not inside a UTF-8 character or an escape): fresh `Compositor` + `FakeTerminal` (rows 30, scrollback 2000), feed `out[0:k]`, inject the block, feed `out[k:]`, flush. A cut is **corrupt** when, after removing the 4 marker rows, the lead's rows differ from the same run without a block (extra rows, lost rows, or reordered rows), or when the marker rows are not present exactly once and contiguous. A cut is **ugly** (not corrupt) when the block lands between two rows that are adjacent in the golden render, for example between two bullets.

| Dimension | Values |
|-----------|--------|
| Scenarios (12) | para-short, para-long (wraps), soft-break, bullets, numbered, heading, blockquote, table (3 rows), fence (bash, 4 lines), mixed, thinking (faint via mdstream), thinking-direct (faint, no formatter) |
| Widths | 40, 80, 120 columns |
| Live area | off, and on (3 rows, mounted) |
| Cuts | every offset (stride 1): 21,677 offsets over 36 recordings, 43,354 with live area off and on |
| Input chunks | 3 to 7 characters, 20 ms quiet between writes (a deterministic cycle) |
| Block variants | one write, two writes, starting with LF, without LF, plus P4 to P7 below |
| Control | the same stream split at the same offset with NO block: 0 differences in 72 combos, so the split itself never corrupts |

Variation checks: `--sink lead` (the lead's `writeFormatterChunk` holding of trailing newlines) and `--prefill 26` (forces the terminal to scroll) give the same safe/unsafe verdicts for every policy. `STRICT_WRAP=1` (FakeTerminal where EL/ED keep the wrap-pending flag, VT520-style) gives identical numbers. `StreamCol` agreed with the emulator's cursor column at all 21,677 cuts (0 mismatches).

## 3. Policies

| Id | Rule | Where a foreign write may run |
|----|------|-------------------------------|
| P0 | naive | any offset |
| P1 | `streamCol == 0` | open row empty (by the compositor's count) |
| P1b | P1 and the last significant byte is not `\r` | open row empty and not about to be rewritten |
| P2 | P1 and the lead is not inside an open fence or table (oracle from the scripted input) | |
| P3 | after the lead's text block ended (`formatter.end()` resolved) | end of stream only |
| P4 | `\r ESC[K` + block, no replay | any offset |
| P5 | `\r ESC[K` + block + the open row again, one write | any offset |
| P5b | P5, but only when the open row fits in the width (or a `\r` is pending, then no replay) and the writer can model every byte | |
| P6 | P5b and not inside an open fence or table | |
| P7 | one LF if the row is open, then the block (= the FIRST draft of `Compositor.writeBlock`, 09:20; replaced at about 10:30 by a wait-for-row-final version, see the status box) | any offset |
| P8 | `\r ESC[K` + block, no replay, only when the open row is mdstream's clipped echo (starts with `…`, fills the width) | |
| **P9** | **P5b where the row is shorter than the width, P8 where it is a clipped echo; otherwise wait** | |

"The writer can model every byte" means: the open row is rebuilt from the bytes the compositor saw, understanding only SGR, `\r`, `\n`, `ESC[K`, `ESC[J` and text. Any other CSI (a cursor move) makes the row unmodelable until the next LF. Fail closed.

## 4. Results (live area on, the production case)

All offsets (21,677 per policy, 36 recordings), the safety stress test: any pipe chunking is covered.

| Policy | Recordings with a corrupt case (of 36) | Corrupt offsets | Allowed offsets | Mean wait | Longest wait |
|--------|---:|---:|---:|---:|---:|
| P0 naive | 36 | 20,568 (94.9%) | 100% | 0 | 19 B / 2 chunks |
| P1 `streamCol==0` | 0 | 0 | 9% | 46 B / 2.6 chunks | 575 B / 41 chunks |
| P1b | 0 | 0 | 7% | 47 B / 2.6 | 575 B / 41 |
| P2 | 0 | 0 | 7% | 61 B / 3.1 | 575 B / 41 |
| P3 end of text block | 0 | 0 | 1% | 407 B / 8.7 | 4,167 B / 53 |
| P4 erase, no replay | 36 | 4,938 | 100% | 0 | 19 B |
| P5 restore everywhere | 10 | 1,412 | 100% | 0 | 19 B |
| P5b | 0 | 0 | 93% | 11 B / 0.7 | 473 B / 34 |
| P6 | 0 | 0 | 83% | 28 B / 1.2 | 508 B / 34 |
| P7 first draft of `writeBlock` (LF, then block) | 36 | 20,286 (93.6%) | 100% | 0 | 19 B |
| P8 clipped echo only | 0 | 0 | 1% | 150 B / 6.3 | 933 B / 42 |
| **P9 = P5b ∪ P8** | **0** | **0** | **94%** | **11 B / 0.7** | **473 B / 34** |

Live area off (not a production state, shown for the gate P1): P1 fails in 30 of 36 recordings (235 offsets, the open row right after `\r`); P1b, P5b, P6, P9 stay at 0.

The writer in a single-threaded process only runs between two `writeStream` calls, so the realistic universe is the **903 real write boundaries**:

| Policy | Corrupt at boundaries | Allowed at boundaries | Mean wait | Longest wait |
|--------|---:|---:|---:|---:|
| P0 naive | 792 (87.7%) | 100% | 0 | 296 B / 2 chunks |
| P1 / P1b | 0 | 16% | 450 B / 7.5 chunks | 4,167 B / 52 |
| P3 | 0 | 5% | 508 B / 10.2 | 4,167 B / 53 |
| P7 first draft of `writeBlock` | 768 (85.0%) | 100% | 0 | 296 B |
| P5b | 0 | 84% | 180 B / 2.3 | 4,048 B / 45 |
| **P9** | **0** | **824 of 903 (91.3%)** | **10 B / 0.6** | **483 B / 34** |

Waiting time in seconds. One input chunk is about 5 characters. The median real stream rate is 290 characters per second (n = 30 streaming runs in the real worker streams, p25 207, p75 341, p95 705), so **one chunk is about 17 ms**. P9: mean 10 ms, worst case here 0.6 s. P1: mean 130 ms at boundaries, worst case one paragraph. **Current `writeBlock` (lands when the last visible byte is a line feed), measured as landing delay over the 300 write boundaries at 80 columns: mean 13.4 chunks (about 230 ms), worst case 53 chunks (0.9 s), by scenario from 2.2 chunks (a heading, 37 ms) to 26 chunks (a long paragraph, 440 ms).** The wait is bounded by the length of the lead's current paragraph, not by the stream.

What P9 leaves uncovered at boundaries (79 of 903): 74 are `thinking-direct` (no formatter: a raw row that wraps on screen, nothing to restore), 5 are an unclipped row of exactly the width. For these the writer waits for the next LF. If **no** formatter is active, an LF-then-block is a cosmetic split of a paragraph, not a duplicate (the text is not rewritten later). With a formatter, never use an LF fallback: 5 of those 6 cases corrupt.

**Ugly rate.** Where P9 writes, 114 of 824 boundary offsets (14%) land between two rows of one markdown structure (a list, a table, a soft break). That is cosmetic. Gates 1 to 3 of `frank-ui-design.md` section 3.11 (idle, between items, blank line) avoid it. Only 39 of 21,677 offsets (0.18%) are a blank-row boundary (`streamCol == 0` and `consecutiveNewlines >= 2`), and none of them splits a structure, so a "paragraph boundary" gate is clean but rare. The lead's own paragraphs end about once per paragraph, so it fires every 1 to 3 seconds in a normal answer.

## 5. Concrete screens (80 columns, live area on, 5 prefilled rows removed)

Lead input `Hello **world**, this is a short paragraph with `code`.` fed 3 to 7 characters at a time. The golden result (no block) is one row, `Hello world, this is a short paragraph with code.`

**Naive block, cut after `Hello ` (the lead's raw echo `Hello ` is on the row).** FakeTerminal and real tmux are identical:
```
Hello⟦L1·row1⟧          <- the lead's row and the block's first row, glued
⟦L1·row2⟧
⟦L1·row3⟧
⟦L1·row4⟧
Hello world, this is a short paragraph with code.
```

**Naive block, `streamCol == 0` but a `\r` is pending (live area off).** The row still holds the raw echo that the formatter is about to rewrite:
```
⟦L1·row1⟧orld**, this is a short paragraph with `code`.   <- the old raw tail survives behind the block
⟦L1·row2⟧
⟦L1·row3⟧
⟦L1·row4⟧
Hello world, this is a short paragraph with code.
```

**First draft of `writeBlock` (LF if the row is open, then the block), cut after `Hello `.** Real tmux:
```
Hello **                  <- the raw echo, left behind for good (a duplicate)
⟦L1·row1⟧
⟦L1·row2⟧
⟦L1·row3⟧
⟦L1·row4⟧
Hello world, this is a short paragraph with code.
```

**P9 (clear the row, block, put the row back), same cut.** Real tmux:
```
⟦L1·row1⟧
⟦L1·row2⟧
⟦L1·row3⟧
⟦L1·row4⟧
Hello world, this is a short paragraph with code.
```
Identical to the golden render plus the block.

**Clean but ugly (P1 allows it).** Between two bullets, `streamCol == 0`:
```
  • one
⟦L1·row1⟧ … ⟦L1·row4⟧     <- the block splits the list
  • two with bold
  • three
```

**Why the clipped echo needs P8.** When a paragraph is wider than the terminal, mdstream shows `…` plus the tail of the row on one row, and rewrites that whole row at every chunk: `\r ESC[K …the tail`. Restoring that row after the block would be wrong (the next chunk rewrites it anyway) and, at exactly the width, loses the last glyph on some emulators. So P9 clears the row and does not put it back. With real terminals the test is the same: 38 of 38 clean (tmux).

## 6. Real terminal check (tmux 3.8, private socket)

Replay the recorded stream through the real `Compositor` into a real pane (`tmux-validate.ts`), inject at a sampled cut, capture history + screen, remove the 4 marker rows, compare with a golden capture of the same stream. The wait is a sentinel file, not a sleep.

| Part | Writes | Captures | Clean | Corrupt |
|------|--------|---------:|------:|--------:|
| A | naive block, any offset | 72 | 12 | **60** |
| B | P6-allowed offsets (restore) | 120 | 120 | 0 |
| C | row exactly the width, unclipped (not allowed by P9) | 32 | 22 | **10** (confirms the exclusion) |
| D | clipped echo, erase only (P8) | 38 | 38 | 0 |
| E | real write boundaries allowed by P9 | 24 | 24 | 0 |

Seed 7, stratified by recording. FakeTerminal and tmux agreed on the three screens that I compared by eye.

**Two harness errors, fixed, so you can trust the rest.** (1) The first tmux run used fixed sleeps, and two captures were taken before the stream finished, which looked like corruption. It now waits for a sentinel file. (2) The validator replayed the raw pieces, while the sweep wraps the two thinking scenarios in `faintThinkingChunk` and drops empty pieces. Every thinking cut therefore landed on a different byte, and 2 of 54 cuts "failed". Fixed; after the fix every P9 cut is clean. I also killed another agent's tmux session once, because an early script called `tmux kill-server` on the default socket (Benjamin, 09:17, 5 minutes lost). All scripts now use a private socket (`tmux -L ma-gate-<pid>`).

## 7. Recommendation

1. **Do not use `streamCol == 0` as the only gate, and do not use "end the row with LF" (P7) for any foreign write.** P7 is what a toast (`writeNoticeLines`, starts with `\n\n`) and a slash-command echo (`flushQueueItemToScrollback`, starts with `\n\n\n`) do today, and what the first draft of `Compositor.writeBlock` did. With a markdown formatter active, each can leave a duplicate raw row in scrollback. That is **predicted by this model and real in tmux for a replayed stream; I did not reproduce it in a live REPL session.**
2. **v1 gate: Benjamin's current `writeBlock` (P1b plus a drain at `flushStream`).** It needs no knowledge of the formatter, passed my sweep's verdict (no corrupt offset), and he has the regression test. Route toasts, command echoes and diagnostics through it too, so they stop being P7.
3. **Optional upgrade: P9 inside `writeBlock`** (about 40 lines, the same `partialRow` model as `gate-sweep.ts`) when the real waits are measured and they annoy. It would cut the mean wait at a boundary from about 130 ms to about 10 ms, and the worst case from a whole paragraph to 0.6 s. It is more state to get right (the open row, clipped echo, unknown cursor moves), so do it only for a measured need.
4. **Keep Frank's calm gates in front of it** (idle, between items, blank row) as the preferred commit points, because they never split a list or a card. The calm gates need the REPL to tell the writer about item boundaries (`02-primitives-spec.md` S1a and S1b).
5. **Never wait forever.** The drain at `flushStream` ends every wait at the end of the turn. A lead that never ends its turn (a background loop) needs a deadline in the lane queue, and the deadline action must not add an LF while a formatter is active.
6. **Fail closed on any CSI that the writer does not model.** mdstream 0.3.9 emits no cursor move (0 `ESC[nA` in 36 recordings, `results/csi-inventory.md`). The 2026-10-31 fixture, from mdstream 0.2.1, has one, so an older formatter does. `writeBlock` as it stands does not depend on that, because it waits for a final LF; P9 does, so P9 needs a unit test that replays that old fixture.

## 7b. A separate bug found on the way: the compositor erases the last glyph of a row that ends exactly at the terminal width

Not about foreign blocks. Plain text, no formatter, live area on: if a streamed row ends **exactly** at the terminal width (no newline yet) and any later `writeStream` arrives, the compositor erases that row's last glyph. `updateStreamCol` returns `streamCol == cols` (the "exact fill" case, `term-width.ts` `cursorVisualCol`), `eraseLiveSeq` emits `ESC[<streamCol>C` then `ESC[J`, and real terminals clamp that cursor-forward at the last column (`cols - 1`), so `ESC[J` erases the glyph in the last column. Exact bytes (30 columns): `...abcd<CRLF><CRLF>LA·status<EL>...<UP1><CR><UP2><RT30><ED>|NEXT|`. Real tmux shows `abcdefghijklmnopqrstuvwxyzabc|NEXT|`: the `d` is gone. Repo's `FakeTerminal` lets the cursor sit at column == `cols` (`fake-terminal.ts:300-304`), which is why no unit test sees it.

Measured in real tmux, no formatter, live area on, chunks of 3 to 31 characters, 6 runs of 3,000 characters per width: **22 glyphs lost per 18,000 characters at 80 and 120 columns (1.2 per 1,000), 43 at 40 columns (2.4 per 1,000)**; about 10 to 15% of wrapped rows lose one glyph. With mdstream the loss is invisible (the raw echo is rewritten at the line feed, and the clipped echo is rewritten by every chunk). It hits text that streams without mdstream: `--formatter` off, mdstream missing, thinking without a formatter, plugin stdout. I told Benjamin (he is editing this file). **A failing regression test exists** (`experiments/exact-width-loss.regression.test.ts`, with `fake-terminal.clamped.ts`, a copy of the repo's FakeTerminal whose cursor-forward clamps at `cols - 1` like a real terminal): 3 tests fail today (30 cells, 30 cells then 6 more, 60 cells), the one-cell-short control passes, and the repo's own FakeTerminal passes the same run, which shows why no existing test sees the bug. Scripts: `exact-width-loss.ts`, `exact-width-rate.py`. No product code was changed; whoever owns `compositor.ts` can move the test into `src/ui/` and write the fix. This is also why every policy here stays out of exact-width rows.

- **Correction.** An earlier version of this report said a block could wait "up to 4 KB, about 14 s". That divided output bytes (4 KB, mostly repeated clipped echo) by a character rate. The right unit is input chunks: the longest wait in the sweep is 53 chunks, 0.9 s.

## 8. Limits of this experiment

- **Two emulators**: FakeTerminal (lenient and strict wrap) and tmux 3.8. Not iTerm2, Ghostty, kitty, Terminal.app, WezTerm, Windows Terminal. The exact-width case (a row of exactly the width) is where emulators differ most (deferred wrap), and P9 stays out of it on purpose.
- **mdstream 0.3.9 only.** The echo-and-rewrite contract is the thing that makes the gate necessary. A formatter that behaves differently changes D.
- **Markdown coverage**: 12 scenarios. Not covered: nested lists, long code lines that wrap, tables wider than the width, HTML, images, wide CJK or emoji in a partial row, links, setext headings, very long unbroken tokens.
- **Block shape**: 4 rows of plain ASCII with no SGR, ending in `\n`. A real block has SGR and wide glyphs, and the caller must clamp it to the width first.
- **Not covered by the sweep**: a resize hold (`streamHold`, the block must join `heldStream`), `withSuspendedLiveArea`, a live area taller than the viewport, a lead that writes between the block's two calls (the single-call variant is the one to use), several writers at once.
- **Chunking**: the sweep uses deterministic chunks of 3 to 7 characters. The all-offsets universe is safe for any chunking. Only the waiting times depend on the real pipe.
- **The stream rate** (290 characters per second) comes from 30 runs of `text_delta` in real worker streams. It is a small sample.
- `--prefill 26` gives the same verdicts, but its "ugly" counts are different from `prefill 0` (1,562 against 366 for P1), and I did not find out why.
- Whether the lead can really emit a toast, a diagnostic or a command echo mid-paragraph in a live session (the model says yes) was **not reproduced live**.

## 9. Re-run

```sh
cd minimal-agent-cli
X=../research/2026-11-18-subagent-scrollback-view/experiments/gate-sweep.ts
bun run $X capture                       # real mdstream -> real Formatter -> recordings/ (~20 s)
bun run $X scan                          # CSI inventory (is there ESC[nA ?)
bun run $X sweep --jobs 9                # 36 units, ~75 s -> results/*.json
bun run $X report                        # -> results/tables.md
bun run $X sweep --jobs 9 --sink lead && bun run $X report --sink lead
STRICT_WRAP=1 bun run $X sweep --jobs 9 && STRICT_WRAP=1 bun run $X report   # -> results-strict/
bun run $X find para-short 80 1 'D>0'    # list cuts of a class
bun run $X dump para-short 80 1 5 endrow-one --prefill 5     # one screen: variant = one-nolead | restore-one | erase-one | endrow-one
cd ../research/2026-11-18-subagent-scrollback-view/experiments
python3 tmux-sample.py --jobs 4          # real tmux, private socket, ~30 s
```
Files: `gate-sweep.ts` (A2's script, plus my P4 to P9 and the strict mode), `tmux-validate.ts`, `tmux-sample.py`, `exact-width-probe.ts`, `mdprobe/`, `recordings/` (36 captures), `results/` (per-unit JSON and tables, 15 MB), `results-strict/`. A copy of A2's original sweep is not kept in the tree.
