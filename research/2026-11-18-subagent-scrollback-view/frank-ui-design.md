# Sub-agent scrollback view: UI design

Author: Frank (932e6ae3), TUI designer, for Daniel (7075489f). Written 2026-11-18.
Read against these checkouts: cli `ac51c8c`, core `483f7fd`, plugins `805fa66`.
Re-checked after the 09:31 pull (cli `57ff8a7`, core `3e4d1fe`, plugins `a742aca`): every cited
file and line still holds. One new fact, a worker's model can change while it runs, is in 3.5
and section 7, item 12. Re-checked again after the 10:13 pull (cli `36fc6dd`, core `2c0a266`,
plugins `6fb9e6c`): the scheduler floor moved to line 579 (section 6, item 3). Everything else
is the same, and the sub-agents plugin did not change. Revised at 10:30 with Daniel's measured
gating (`20-gating-experiment.md`): restore write in 3.11, lane hues in 3.1, `writeBlock` in
section 6, and section 7 items 3 to 6 and 9.
Scope: look, layout, interaction. No source was changed. Section 7 lists what I could not verify.

Working name of the feature: **follow**. You *follow* a worker, and its work is appended to
your scrollback as a **lane**. You *peek* at a worker when you only want a look.

Contents

1. Design principles
2. The live area, state by state
3. The scrollback
4. Key bindings and slash commands
5. Ideas that are native to append-only scrollback
6. Primitives: what I need, drop, change and add
7. Facts I could not verify
8. Suggested build order

---

## 0. Legend

Mockups are plain text. Colour is described under each mockup with these tokens.

| Token      | Source                                   | Used for                                        |
| ---------- | ---------------------------------------- | ----------------------------------------------- |
| `[lane]`   | the lane's hue, `lane.*` tokens, see 3.1 | rail, tag                                       |
| `[sky]`    | `PALETTE.sky`                            | running glyph, fleet brand `◈`                  |
| `[lime]`   | `PALETTE.lime`                           | done `✔`, diff additions                        |
| `[gold]`   | `PALETTE.gold`                           | warnings, incomplete `⚠`, held, pending marks   |
| `[red]`    | `PALETTE.red`                            | failed `✘`, errors                              |
| `[pink]`   | `PALETTE.pink`                           | diff removals (as today)                        |
| `[violet]` | `PALETTE.violet`                         | selection marker `▌`, key names in hint rows    |
| `[dim]`    | SGR dim                                  | secondary text, backlog rows, timestamps        |
| `[dgray]`  | `slots.codes.DARK_GRAY`                  | frame chrome, counters                          |
| `[lgray]`  | `slots.codes.LIGHT_GRAY`                 | labels (`explorer`, `fleet 3f2a`)               |
| `[selbg]`  | `bgRgb(55,45,85)`, the picker's bar      | the cursor row in the selector                  |

Glyphs. All are 1 cell wide in the repo's `displayWidth` (I measured each one).

| Glyph       | Meaning                                              | Status                         |
| ----------- | ---------------------------------------------------- | ------------------------------ |
| `▎ ┃ ║ ╏`   | lane rail (4 shapes x 5 hues, see 3.1)               | new                            |
| `◈`         | fleet / sub-agents identity                          | existing (`style.ts`)          |
| `◐◓◑◒ ✔ ⚠ ✘ ○` | running, done, incomplete, failed, queued         | existing                       |
| `» • ✚ ✦`   | Bash, Read, Write, Edit                              | existing (`tool-presentation`) |
| `╭ │ ┊ ╰`   | card frame and elision                               | existing                       |
| `▌`         | selector cursor                                      | existing (`picker.ts`)         |
| `✎`         | "writing" / last words                               | existing (widget)              |
| `↺`         | replayed late: this row is backlog, not live         | new                            |
| `⇡`         | blocks waiting for the lead's line to end            | new                            |
| `‖`         | feed held by the user                                | new                            |
| `✉`         | mailbox message                                      | new, see section 7             |

---

## 1. Design principles

1. **Two speeds, two places.** "Now" lives in the live area and is volatile. "Done" lives in
   scrollback and is permanent. A spinner, a partial sentence or a running tool never reaches
   scrollback. A reader who scrolls up finds only complete units.
2. **The rail is the worker.** One coloured bar, `▎`, marks a lane everywhere: on the fleet row,
   in the selector, and on every scrollback row that the worker produced. The fleet row is the
   head of the lane. The scrollback rows are its tail. Rows without a rail are the lead's.
3. **The tag is the truth, colour is a hint.** `A12` is printed in text. Eight lanes cannot be
   told apart by colour alone, a copy-paste loses colour, and `NO_COLOR` exists.
4. **Blocks are atomic and ordered by event time.** One block is one write. Blocks from all lanes
   go through one queue in event-time order. A block shows the time of the event, not the time of
   the commit, so a delayed commit does not lie.
5. **Honest gaps.** Every hole in the record is marked: attach, unfollow, hold, stall, backlog
   that was skipped. Append-only means the reader cannot be given the missing rows later, so the
   marker must say they are missing and how to get them.
6. **Reuse the host's chrome.** Cards, diffs and notices are the host's renderers with a
   different left gutter. The plugin sends semantic blocks. It draws no frames.
7. **Reflow-safe rows.** Nothing in scrollback is right-aligned or padded to the edge. A later
   resize reflows a short row without damage. Right alignment is allowed in the live area only,
   because that area is repainted.
8. **Density follows load.** One followed worker gets detail. Eight get a digest. The defaults
   move with the number of lanes, and the user can pin them.
9. **Zero cost when unused.** No workers, no rows. Workers but no follow, today's widget plus one
   hint. Nothing that is followed enters the lead's context.

---

## 2. The live area, state by state

All mockups show the live area only. `❯ ▏` is the prompt with its cursor. The line
`(quota · intercom rows)` stands for the footer rows of other plugins, which do not change.
Width is 80 columns unless a mockup says otherwise. Rows are clamped to `cols - 1`, as today.

### 2.1 No sub-agents

<!-- w=80 -->
```
❯ ▏

  (quota · intercom rows)
```

Unchanged. `renderWidget` returns `null`, as today. `/agents` with an empty fleet commits one dim
row, `◈ no sub-agents in this session`, and opens nothing.

### 2.2 Fleet running, nothing followed

<!-- w=80 -->
```
❯ ▏

  (quota · intercom rows)
 ◈ fleet 3f2a · ◐ 3 · ✔ 1 · ✘ 0 · ctx 91.4k · out 4.2k               ^G follow
   ◑ A1  explorer   3m21  Bash: rg -n "parseArgs" src (0m04) · 9 tools
   ◐ A2  worker     3m20  ✎ The fix moves the guard into parseArgs… · 14 tools
   ◓ A4  reviewer   0m31  thinking… · 2 tools
   ✔ A3  explorer   done  3 call sites, all in src/cli → AgentResult A3
```

- Today's widget, byte for byte, plus one thing: the `[dim]` hint `^G follow` at the right end of
  the header. Without the chord primitive the hint reads `/agents`.
- Change to today's rows: they are width-aware. Columns drop from the right in this order: token
  figures, tool count, then the activity text is clipped. Today a row is built to about 105 cells
  and the host cuts it with `…`.

### 2.3 Selection mode

Opened by `^G` or `/agents`. It is a modal overlay (`editor.overlay.open`), like `/usage` and
`/config`. The prompt is hidden. The overlay layer replaces the default footer, which includes
the fleet widget. So the selector is drawn as the widget's larger form: same header, same row
grammar, and the user sees the widget grow, not get replaced.

<!-- w=80 -->
```
 ◈ fleet 3f2a · ◐ 5 · ✔ 9 · ⚠ 1 · ✘ 2 · 17         following 2 · +1 −1 · normal
   ↑ 3 more
   ▎ A4  explorer  ◑  2m10  Bash: rg -n "liveArea" src (0m03)
 ▌+▎ A7  worker    ◐  1m02  ✎ The fix moves the guard into applyStreamLine…
     A8  reviewer  ◓  0m31  thinking…
  −▎ A5  worker    ◐  4m48  Bash: bun test (1m12)
     A9  worker    ○        queued…
     A2  explorer  ✔  done  No blocking issues; 2 nits in widget.ts
     A3  worker    ✘        budget exceeded: started turn 4 with maxTurns 3
   ↓ 7 more
   ├ peek A7 · worker · sonnet · 9 turns · 14 tools ✘1 · ctx 22.4k
   │ » Bash  $ bun test lib/stream.test.ts · 12 pass 0 fail · 1.2s
   │ ✦ Edit  lib/stream.ts · +3 −1
   │ ✎ The fix moves the guard into applyStreamLine so a late tool_result…
   ╰ ␣ mark · ⏎ apply · s solo · a all · n none · ⇥ peek · v level · / filter
```

How to read the left margin (5 cells: space, cursor, sign, rail, space):

| Margin   | Meaning                                                         |
| -------- | --------------------------------------------------------------- |
| `   ▎ `  | followed now. Rail in `[lane]`.                                 |
| `     `  | not followed.                                                   |
| ` ▌+▎ `  | cursor row, marked to follow. `+` in `[gold]`, rail in `[lane]`. |
| `  −▎ `  | marked to unfollow. `−` in `[gold]`, rail `[dim]`.              |

- The cursor row has the picker's look: `▌` in `[violet]`, the row on `[selbg]`, text bold white.
- Marks are **staged**. Nothing happens until `⏎`. Attach and unfollow markers are permanent in
  scrollback, so a stray keypress must not write one.
- `⏎` with no marks toggles the cursor row and applies. So the short path is `^G ↓ ⏎`.
- The header shows the worker count (`17`), the staged change (`following 2 · +1 −1`) and
  the feed level (see 3.10).
- The row order is frozen while the selector is open. Glyphs, times and activity update in
  place, but no row moves under the cursor. Order at open: followed, running, queued, failed,
  incomplete, done, stopped; newest first inside each group.
- **Peek** (`⇥`) shows the last items of the cursor's worker inside the overlay. It is volatile.
  Nothing is written to scrollback. Peek works for a worker that is not followed, and for one
  that has ended.
- Digits jump: typing `1` `2` moves the cursor to `A12`. Letters are commands. `/` starts a text
  filter over id, label, status and task:

<!-- w=80 -->
```
 ◈ fleet 3f2a · / review▏                                 3 of 17 · esc clears
     A8  reviewer  ◓  0m31  thinking…
 ▌   A11 reviewer  ○        queued…
     A6  reviewer  ✔  done  2 blocking issues in spawn-plan.ts
   ╰ type to filter · ⏎ keep filter · esc clear
```

Selector height. `S = clamp(rows - 13, 7, 18)` rows in total. The overlay is short-lived, so it
may take more than half of the screen.

| Terminal rows | Budget (`rows-2`) | Selector `S` | List window | With peek open        |
| ------------- | ----------------- | ------------ | ----------- | --------------------- |
| 20            | 18                | 7            | 3           | peek is not offered   |
| 24            | 22                | 11           | 7           | list 3, peek 3        |
| 40            | 38                | 18           | 8           | list 8, peek 5        |
| 50            | 48                | 18           | 8           | list 8, peek 5        |

Fixed rows: header 1, `↑ more` 1, `↓ more` 1, hint 1, and 1 for the peek title when peek is open.
The window is at most 8 rows. With about 100 workers the list scrolls, and the two indicator rows
always show how many are above and below.

### 2.4 Following one

<!-- w=80 -->
```
❯ ▏

  (quota · intercom rows)
 ◈ fleet 3f2a · ◐ 3 · ✔ 1 · ✘ 0 · ctx 91.4k · out 4.2k    following A2 · normal
 ▎ ◐ A2  worker     3m20  Bash: bun test src/cli (0m07) · 14 tools ✘1
 ▎   └ ✎ …so the loop stops one short of argv.length and reads the last flag
   ◑ A1  explorer   3m21  Bash: rg -n "parseArgs" src (0m04) · 9 tools
   ◓ A4  reviewer   0m31  thinking… · 2 tools
```

- A followed row gets the rail in column 1, in `[lane]`, and its tag in `[lane]` bold. It sorts
  to the top. Rows that are not followed are identical to today.
- The followed row **is** the ticker. There is no second panel. It shows the tool in flight with
  its time, or `thinking…`, or `✎` and the text.
- With exactly one lane followed and at least 30 terminal rows, the row gets a second line,
  `└ ✎`: the worker's last words. With text deltas (77% of streams) this is the live tail,
  repainted at most 4 times per second. Without deltas it is the last completed text item. It is
  correct in the two cases.
- The header's right end says who is followed and at which level.

### 2.5 Following a subset

<!-- w=80 -->
```
 ◈ fleet 3f2a · ◐ 4 · ✔ 1 · ✘ 0 · ctx 118k · out 6.0k      following 2 · normal
 ▎ ◑ A1  explorer   3m21  Bash: rg -n "parseArgs" src (0m04) · 9 tools
 ▎ ◐ A2  worker     3m20  ✎ The fix moves the guard into parseArgs… · 14 tools
   ◓ A4  reviewer   0m31  thinking… · 2 tools
   ◒ A5  worker     0m12  Read: lib/stream.ts · 1 tool
   ✔ A3  explorer   done  3 call sites, all in src/cli → AgentResult A3
```

Colour: the rail and tag of A1 are `lane.steel`, of A2 `lane.seafoam` (see 3.1). The two rails
have the same colours in scrollback.

### 2.6 Following all

"All" is a standing choice. A worker that is spawned later is followed from its first event.

With enough rows (40 and more) the block is one row per worker, as in 2.5 with a rail on each
row. With fewer rows the followed lanes become a **strip** of chips:

<!-- w=80 -->
```
 ◈ fleet 3f2a · ◐ 8 · ✔ 3 · ✘ 0 · ctx 212k · out 14.1k    following all · quiet
 ▎A1 ◑ Bash 0m04    ▎A2 ✎ text         ▎A4 ◓ think        ▎A5 ◐ Bash 1m12
 ┃A6 ◑ Read         ┃A7 ◒ Grep         ┃A8 ✎ text         ┃A9 ⚠ idle 1m30
```

- A chip is rail, tag, phase glyph, one word, and the time when it is above 3 seconds.
  It is 18 cells with its gap, so 4 chips fit in 80 columns, 3 in 60, 6 in 120.
- `A6` to `A9` have the second rail shape, `┃`. Their hues repeat those of `A1` to `A4` (see 3.1).
- `⚠ idle 1m30` is `[gold]`, as today.

### 2.7 Held feed, and a feed that waits

The user holds the feed with `^T` or `/follow hold`:

<!-- w=80 -->
```
 ◈ fleet 3f2a · ◐ 3 · ✔ 1 · ✘ 0 · ctx 91.4k  ‖ held 2m10 · 14 steps · ^T resume
 ▎ ◐ A2  worker     5m30  Bash: bun test src/cli (0m07) · 19 tools ✘1
   ◑ A1  explorer   5m31  Read: src/cli/args.ts · 12 tools
```

- `‖ held …` is `[gold]`. The live rows continue to move. Only the scrollback writes stop.
- On resume, one block lands. It has the shape of the backlog banner (see 3.9): a rule with the
  hold time, a row for the steps that are not shown, the last round as `↺` rows, then `live`.

The feed can also wait by itself, for the lead's line to end. This is short, and it is shown
only when it is longer than 1 second:

<!-- w=80 -->
```
 ◈ fleet 3f2a · ◐ 3 · ✔ 1 · ✘ 0 · ctx 91.4k           following 2 · ⇡ 3 waiting
```

`⇡ 3 waiting` is `[dim]`. It tells the user that the scrollback is behind the live rows, and why.

### 2.8 A followed worker ends, fails or stalls

<!-- w=80 -->
```
 ◈ fleet 3f2a · ◐ 2 · ✔ 2 · ✘ 1 · ctx 131k · out 9.8k      following 3 · normal
 ▎ ✔ A2  worker     done  Moved the guard into parseArgs; 41 pass · sealed
 ▎ ✘ A5  worker           budget exceeded: started turn 4 with maxTu… · sealed
 ▎ ◐ A7  explorer   6m02  Read: src/ui/compositor.ts · idle 1m30 · 31 tools
   ◑ A1  explorer   7m40  Bash: rg -n "liveArea" src (0m02) · 22 tools
```

- **Done**: `✔` in `[lime]`, the result's short text, and `sealed` in `[dim]`. The seal card is
  in scrollback (see 3.8). The row stays until the fleet is idle, as today.
- **Failed**: `✘` and the cause in `[red]`. The seal card has the cause and the hint.
- **Stalled**: `idle 1m30` in `[gold]`, as today. After 2 minutes one stall row is committed to
  scrollback (see 3.5), once for each stall.
- When no worker is active the widget collapses to nothing, as today. The seals stay in
  scrollback.

### 2.9 Eight or more workers: the row budget

This is the normal case, so it has a rule and not a fallback. The fleet block limits itself to
`F` rows, header included:

```
F = clamp(floor(rows / 2) - 7, 1, 10)
```

The 7 is: status 1, gap 2, prompt 1, footer spacer 1, and 2 rows for other footers. I ask for
the real number from the host (section 6, item 3), then the 7 goes away.

Three forms, picked in this order:

1. **Rows.** One row per worker. Used when the followed lanes fit: `followed + 1 <= F`. The rows
   are followed first, then running, queued, and ended. The last row is `… +N more · ^G` when
   workers remain.
2. **Strip.** Header and chip rows (see 2.6). Used when the followed lanes do not fit in rows.
   Workers that are not followed are in the header counts only.
3. **Line.** `F = 1`. The header only, with one rail for each followed lane.

Real numbers for 8 running workers, all followed, at 80 columns, while the lead is busy:

| Terminal rows | Budget | `F` | Form  | Fleet rows          | Live area in total |
| ------------- | ------ | --- | ----- | ------------------- | ------------------ |
| 16            | 14     | 1   | line  | 1                   | 8                  |
| 24            | 22     | 5   | strip | 3 (header, 2 chip)  | 10                 |
| 30            | 28     | 8   | strip | 3                   | 10                 |
| 40            | 38     | 10  | rows  | 9 (header, 8 rows)  | 16                 |
| 50            | 48     | 10  | rows  | 9                   | 16                 |

The same 8 workers with only 2 followed, at 24 rows (`F = 5`), are in rows form:

<!-- w=80 -->
```
 ◈ fleet 3f2a · ◐ 8 · ✔ 3 · ✘ 0 · ctx 212k · out 14.1k     following 2 · normal
 ▎ ◑ A1  explorer   3m21  Bash: rg -n "parseArgs" src (0m04) · 9 tools
 ▎ ◐ A2  worker     3m20  ✎ The fix moves the guard into parseArgs… · 14 tools
   ◓ A4  reviewer   0m31  thinking… · 2 tools
   … +5 more · ^G
```

Line form, at 16 rows or fewer:

<!-- w=80 -->
```
 ◈ fleet 3f2a · ◐ 8 · ✔ 3 · ✘ 0 · ▎▎▎▎┃┃┃┃ following all · quiet
```

Each rail is in its lane colour. A rail blinks to `[dim]` and back when its lane commits a block,
so the line still shows which lanes are active.

If the prompt grows (the user types 6 lines), the editor takes rows first and `F` shrinks. The
block moves from rows to strip to line. It never pushes the prompt.

### 2.10 Narrow and short terminals

60 columns, following one. Token figures and the tool count are dropped, and the label is cut:

<!-- w=60 -->
```
 ◈ fleet 3f2a · ◐ 3 · ✔ 1 · ✘ 0       following A2 · normal
 ▎ ◐ A2  worker    3m20  Bash: bun test src/cli (0m07)
 ▎   └ ✎ …one short of argv.length and reads the last flag
   ◑ A1  explorer  3m21  Bash: rg -n "parseArgs" src (0m04)
   ◓ A4  reviewer  0m31  thinking…
```

60 columns, the selector. The hint row keeps the 5 most used keys:

<!-- w=60 -->
```
 ◈ fleet 3f2a · ◐ 5 · ✔ 9 · ✘ 2 · 17      following 2 · +1
   ↑ 3 more
   ▎ A4  explorer ◑  2m10  Bash: rg -n "liveArea" src
 ▌+▎ A7  worker   ◐  1m02  ✎ The fix moves the guard in…
     A8  reviewer ◓  0m31  thinking…
     A9  worker   ○        queued…
   ↓ 11 more
   ╰ ␣ mark · ⏎ apply · a all · ⇥ peek · / filter
```

Below 50 columns the scrollback gutter also changes (see 3.11). Below 40 columns the fleet block
is in line form at every height.

120 columns, following a subset. The model and the turn count come back:

<!-- w=120 -->
```
 ◈ fleet 3f2a · ◐ 4 · ✔ 1 · ✘ 0 · ctx 118k · out 6.0k (thinking 412)                          following 2 · normal · ^G
 ▎ ◑ A1  explorer   sonnet   3m21  Bash: rg -n "parseArgs\(" src --type ts (0m04) · 9 tools · 4 turns · ctx 30.9k
 ▎ ◐ A2  worker     sonnet   3m20  ✎ The fix moves the guard into parseArgs so the… · 14 tools ✘1 · 9 turns · ctx 22.4k
   ◓ A4  reviewer   opus     0m31  thinking… · 2 tools · 1 turn · ctx 18.0k · out 96
   ◒ A5  worker     sonnet   0m12  Read: minimal-agent-plugins/ma-sub-agents-plugin/lib/stream.ts · 1 tool · 1 turn
   ✔ A3  explorer   sonnet   done  3 call sites, all in src/cli; none passes a negative index → AgentResult A3
```

120 columns, the selector. The task's first line is a column, and peek has room for 5 rows:

<!-- w=120 -->
```
 ◈ fleet 3f2a · ◐ 5 · ✔ 9 · ⚠ 1 · ✘ 2 · 17 workers                                    following 2 · +1 −1 · normal
   ↑ 3 more
   ▎ A4  explorer  ◑  2m10  Bash: rg -n "liveArea" src (0m03)                 task  Find every caller of setLiveArea…
 ▌+▎ A7  worker    ◐  1m02  ✎ The fix moves the guard into applyStreamLine…   task  Fix the late tool_result race in…
     A8  reviewer  ◓  0m31  thinking…                                          task  Review the diff of A7 for…
  −▎ A5  worker    ◐  4m48  Bash: bun test (1m12)                              task  Add tests for the stream reader…
     A2  explorer  ✔  done  No blocking issues; 2 nits in widget.ts            task  Check widget.ts for width bugs
   ↓ 9 more
   ├ peek A7 · worker · sonnet · fresh · 9 turns · 14 tools ✘1 · ctx 22.4k · out 340 · sid 0a4508c3
   │ • Read  lib/stream.ts · 538 lines
   │ » Bash  $ bun test lib/stream.test.ts · 12 pass 0 fail · 1.2s
   │ ✦ Edit  lib/stream.ts · +3 −1
   │ ✎ The fix moves the guard into applyStreamLine so a late tool_result cannot clear a newer in-flight tool.
   ╰ ␣ mark · ⏎ apply · s solo · a all · n none · r running only · ⇥ peek · v level · h hold · / filter · esc close
```

### 2.11 The lead streams and the user types, at the same moment

<!-- w=80 -->
```
⠹ Thinking… 12s · 1.2k tok
  ⏳ queued · 1  ·  ↑ edit
  ╰  1 ▸ also check the tests in lib/

❯ and when A2 is done, ask the reviewer to look at args.ts▏

  (quota · intercom rows)
 ◈ fleet 3f2a · ◐ 3 · ✔ 1 · ✘ 0 · ctx 91.4k           following 2 · ⇡ 2 waiting
 ▎ ◑ A1  explorer   3m21  Bash: rg -n "parseArgs" src (0m04) · 9 tools
 ▎ ◐ A2  worker     3m20  ✎ The fix moves the guard into parseArgs… · 14 tools
   ◓ A4  reviewer   0m31  thinking… · 2 tools
```

- The status row, the queue block and the prompt are the host's and do not change.
- Outside the selector the feature takes **no** keys except its chords. Typing, history, the
  slash menu and the queue keys work as today.
- `⇡ 2 waiting`: two lane blocks are ready and wait for the lead's line to end. They commit, in
  order, in one frame.
- The live rows repaint at most 4 times per second for each lane, and the repaints of all lanes
  are joined into one `setLiveArea` call. A burst of 400 events per second costs 4 paints.

---

## 3. The scrollback

### 3.1 The lane gutter

Every row of a lane starts with a 5-cell gutter. The host's rows start with 2 spaces. So a lane
is the host's rendering, moved 3 cells to the right, with a name in the margin.

<!-- w=80 -->
```
  The parser has two entry points. I'll take parseArgs.      <- the lead
A2 ▎ I'll fix the loop bound first, then add the tests.      <- lane, tagged
   ▎ • Read  src/cli/args.ts · 212 lines                     <- lane, same run
```

| Cells | Content                                                                     |
| ----- | --------------------------------------------------------------------------- |
| 0-2   | the tag, `[lane]` bold, padded to 3. Blank on the rows that follow in a run. |
| 3     | the rail, `[lane]`                                                          |
| 4     | space                                                                       |

**Tag rule.** The tag is printed on a lane's row when one of these is true: the last write to
scrollback was not this lane's; 20 lane rows have passed since this lane's last tag; 60 seconds
have passed. Otherwise the cells are blank, as a chat client does for messages from one author.
So a tag is never more than one screen away, and a run of one worker reads as one piece.

**Colour and shape come from the id, not from a pool.** For `A<n>`:

```
hue  = [steel, seafoam, sand, orchid, slate][(n - 1) mod 5]
rail = [▎, ┃, ║, ╏][floor((n - 1) / 5) mod 4]
```

`A1` is always steel with `▎`. `A6` is steel with `┃`. This gives 20 different rails with no
state. A replay, a second terminal or a reader months later gets the same rails. Ids above `A99`
make the tag 4 cells and that lane's gutter 6.

**The lane hues mean nothing else.** Every hue of the house palette already has a meaning: lime
is success and additions, pink is removals and errors, gold is warnings, red is danger, sky is
"running" and the accent, cyan is muted text, violet is the selection. A gold rail would read as
a warning. So the five lane hues are new, and they are none of these:

| Token          | 256-colour | Hex       | Near, but not                                 |
| -------------- | ---------- | --------- | --------------------------------------------- |
| `lane.steel`   | 68         | `#5f87d7` | sky (`#00d7ff`): darker, bluer                |
| `lane.seafoam` | 115        | `#87d7af` | lime (`#87ff00`): pastel, blue-green          |
| `lane.sand`    | 180        | `#d7af87` | gold (`#ffaf00`), orange: no saturation       |
| `lane.orchid`  | 176        | `#d787d7` | pink (`#ff00af`), violet (`#b48cff`): soft, warm |
| `lane.slate`   | 109        | `#87afaf` | cyan: greyed, it never reads as a link        |

- With 5 hues, the eight lanes of a full fleet (`A1` to `A8`) use each hue once or twice. Where a
  hue repeats (`A1` and `A6`), the rail shape differs. The tag in text settles every case.
- The hues are theme tokens, so a light theme can give darker ones. `sand` and `seafoam` are weak
  on a white background.
- The tag and the rail are in the lane hue. Everything to the right of the rail keeps its
  semantic colour: a `✘` is red, an addition is lime, in every lane.

**Tool icon colours.** I accept that they overlap the house palette (Bash orange, Read sky,
Write lime, Edit gold, Glob violet, Grep pink): an icon sits in the content column and the rail in
column 3, and none of them uses a lane hue.

The inner width of a framed card is `cols - 8` (gutter 5, `│ ` 2, safety 1). The lead's is
`cols - 5`. At 80 columns a lane card has 72 cells for content.

### 3.2 Assistant text

A text item is committed when it is complete. Most are one line (median 66 characters).

<!-- w=80 -->
```
A2 ▎ I'll fix the loop bound first, then add the tests. · 12:04:41
   ▎ » Bash  $ rg -n "parseArgs\(" src · 14 lines
   ▎ The bound is wrong in two places. `parseArgs` reads one cell past the
   ▎ end, and `parseFlags` repeats the same loop. I'll change both and keep
   ▎ the public signature.
```

- Plain foreground, formatted by the same formatter that session replay uses, at the lane's
  width. No frame: prose is not a card for the lead and is not one here.
- A tagged row carries the event time as a `[dim]` suffix, ` · 12:04:41`. It is inline, not
  right-aligned (principle 7). A date prefix is added on the first tagged row of a day, by the
  rule that `tool-time.ts` uses.
- Long text is clipped by the feed level (3.10) with the host's elision:

<!-- w=80 -->
```
A2 ▎ The bound is wrong in two places. `parseArgs` reads one cell past the
   ▎ end, and `parseFlags` repeats the same loop. I'll change both and keep
   ▎ the public signature. The tests need one new case for an empty argv
   ▎ ┊
   ▎ shown 3/19 L · /peek A2 for the full text
```

### 3.3 Thinking

One `[dim]` row, with the duration. Never content: the thinking text is empty in every finished
item in the data.

<!-- w=80 -->
```
   ▎ · thought 4.2s
```

At `normal` the row is shown only when the worker thought for 3 seconds or more. At `full` it is
always shown. At `quiet` it is never shown.

### 3.4 A tool call and its result

A call and its result are **one** block, committed when the result arrives. A call in flight is
in the live row only. There are two forms.

**Digest row.** One line: icon, name, argument, result summary, and the duration when it is 1
second or more. This is the form for most calls. Bash and Read are 76% of all calls, so this row
is the most seen thing in the feature:

<!-- w=80 -->
```
A1 ▎ • Read  src/cli/args.ts · 212 lines · 12:04:40
   ▎ » Bash  $ rg -n "parseArgs\(" src · 14 lines
   ▎ » Bash  $ bun test src/cli · 41 pass 0 fail · 1.2s
   ▎ » Bash  $ git status --short · (no output)
   ▎ ✚ Write research/args-callers.md · new file · 38 lines
```

- The icon and its colour are the tool's, from `tool-presentation.ts`. The name is `[bold]`. The
  argument is plain. The summary and the duration are `[dim]`.
- The summary: for Read, the line count. For Grep and Glob, the match count. For Bash, in this
  order: (1) a **test count**, when one of the last 8 output lines is a count line of a test
  runner (`N pass`, `N fail`, `N passed`, `N failed`, `N skip`), joined as `41 pass 0 fail`;
  (2) else the **last** non-empty output line when the transcript has the output; (3) else the
  stream's `outputSummary` (its first line). Rule (1) is what the Bash mockups show. Without it,
  a `bun test` row would end with `Ran 41 tests across 3 files. [1.20s]`, which hides the one
  number the user looks for. A test run is a large share of a worker's Bash calls.
- The paths are shown relative to the worker's cwd.

**Card.** The host's tool card, in the lane gutter, with a row cap. Used at `normal` for a Bash
whose output is more than 1 line and at most the cap, for every edit, and for every error.

<!-- w=80 -->
```
A2 ▎ ╭ » Bash  $ bun test lib/stream.test.ts · 12:04:52
   ▎ │
   ▎ │ lib/stream.test.ts:
   ▎ │ ✓ feedStream folds a tool call into the state
   ▎ │ ✓ a late tool_result does not clear a newer tool
   ▎ ┊
   ▎ ╰ shown 3/14 L · 12 pass 0 fail · 1.2s
```

This is the golden `bash-long` card with a different gutter and a cap of 3. A result that the
worker spilled to a file (17% of results) keeps the host's own clip text.

### 3.5 Errors, notices and stalls

A failed tool call. At every level an error keeps at least its first line. It is never folded
into a count:

<!-- w=80 -->
```
A2 ▎ ╭ ✦ Edit  src/cli/args.ts · 12:05:02
   ▎ │
   ▎ ╰ ✘ Edit error: you did not read src/cli/args.ts in this session
```

At `quiet` the same error is one row:

<!-- w=80 -->
```
A2 ▎ ✘ Edit  src/cli/args.ts · Edit error: you did not read src/cli/args.ts…
```

`✘` and the error text are `[red]`. The tool's icon is replaced by `✘` in the digest row.

A notice from the worker's loop has the lead's own notice look, `!` in bold yellow or `›` in dim:

<!-- w=80 -->
```
A2 ▎ ! Response hit the max_tokens ceiling — auto-continuing (1/3)
   ▎ › Adopted model "sonnet" (was "opus")
```

A stall is committed once, when a followed worker has had no event for 2 minutes and no tool is
in flight. It is a complete fact, not a half-state:

<!-- w=80 -->
```
A7 ▎ ⚠ no events for 2m00 · last: Read src/ui/compositor.ts · 12:09:12
```

`[gold]`. When events come back the next block is a normal one. The reader sees the hole and its
cause.

A change of target while the worker runs. Since plugins `e6552cf`, a running worker follows a
switch of its lead's credential, provider, model or effort, and keeps its work. That makes the
model in the attach card or the roster wrong from that point, so the change is one row in the
lane. The worker's core emits a `model_adopted` notice when it applies the switch (section 7,
item 12). The host draws it with its own notice renderer and its own wording
(`targetChangeText`), without the leading blank row:

<!-- w=80 -->
```
A2 ▎ › Changed model to "opus" (was "sonnet") · 12:07:15
```

When more values change (credential, provider, effort), the host's text grows and wraps in the
lane gutter, like any notice. An unset value reads "the model default" or "none", as the host
writes it for the lead.

`[dim]`. It is never folded, also at `quiet`, because the reader needs it to know which model
did the rows below it. The live row, the selector and the next waypoint show the new model.

### 3.6 An Edit diff

The host's diff card (`diff-rows.ts`), in the lane gutter:

<!-- w=80 -->
```
A2 ▎ ╭ ✦ Edit  src/cli/args.ts · 12:05:20
   ▎ │
   ▎ │ +3 −1
   ▎ │ 1    function parseArgs(argv: string[]) {
   ▎ │ 2 -    for (let i = 0; i <= argv.length; i++) {
   ▎ │ 2 +    for (let i = 0; i < argv.length; i++) {
   ▎ │ 3 +      const arg = argv[i]
   ▎ │ 4 +      if (arg === undefined) continue
   ▎ ╰ 5        const next = argv[i + 1]
```

- Removals `[pink]`, additions `[lime]`, with the host's syntax highlight when it has one.
- The line numbers start at 1. The diff is built from `old_string` and `new_string`, as session
  replay does (`deriveEditDisplay`), and those do not hold the place in the file. See section 7.
- The cap is 12 rows at `normal`. At `quiet` an edit is a digest row: `✦ Edit  path · +3 −1`.

### 3.7 Mailbox messages

A message is drawn in the lane of its **sender**:

<!-- w=80 -->
```
A2 ▎ ✉ claim → *  I own src/cli/args.ts until my edit lands. · 12:05:10
A5 ▎ ✉ blocker → lead  bun test fails on main before my change (3 tests).
     ✉ note lead → A5  Go on. A2 fixes those 3 tests. · 12:06:02
```

- `✉` and the kind are `[lane]`. `→ *` is a broadcast. The body is plain and wraps in the gutter.
- A message from the lead has no rail, because the lead has none. It is `[dim]` and is shown
  only when its recipient is followed. The lead's own `Mailbox` tool card is already in
  scrollback, so this row is a short echo next to the lane it is for.

### 3.8 The seal

When a followed worker ends, one card closes its lane. It is the host's notice card
(`command-notice.ts`) in the lane gutter.

<!-- w=80 -->
```
A2 ▎ ╭ ✔ A2 worker · done · 12:11:40
   ▎ │
   ▎ │ Moved the bound check into parseArgs and parseFlags. Added 3 tests
   ▎ │ for an empty argv, a trailing flag and a repeated flag. All 41 pass.
   ▎ │ artifacts: src/cli/args.ts, src/cli/args.test.ts
   ▎ ┊
   ▎ │ shown 3/42 L · full text: SubAgentsAgentResult A2
   ▎ ╰ 7m09 · 23 tools ✘1 · 9 turns · ctx 41.2k · out 3.1k · sid 0a4508c3
```

- Title: status glyph and status word in the status colour (`[lime]`), tag in `[lane]`.
- Body: the result text, clipped. The final report can be 11,000 characters, so the clip and the
  pointer to `SubAgentsAgentResult` are always there.
- Footer, `[dgray]`: wall time, tools, failed tools, turns, tokens, and the worker's session id.
  With these a reader can find the transcript file years later.

Failed, incomplete and stopped:

<!-- w=80 -->
```
A5 ▎ ╭ ✘ A5 worker · failed · 12:09:03
   ▎ │
   ▎ │ budget exceeded: started turn 4 with maxTurns 3
   ▎ │ hint: raise budget.maxTurns or split the task
   ▎ ╰ 4m51 · 11 tools · 4 turns · ctx 28.0k · out 1.9k · sid 7b3eb14a
A6 ▎ ╭ ⚠ A6 explorer · incomplete · 12:09:40
   ▎ │
   ▎ │ NO DELIVERABLE — findings.md is missing. Not a success.
   ▎ ╰ 2m02 · 6 tools · 3 turns · ctx 19.4k · out 640 · sid 51c0aa2e
A8 ▎ ╭ ✘ A8 reviewer · stopped · 12:10:15
   ▎ ╰ stopped by the lead · 0m58 · 3 tools · sid 9d14e7f0
```

`[red]` for failed, `[gold]` for incomplete, `[dim]` for stopped. The wording is the wording of
`render.ts` today.

### 3.9 Attach, backlog, live, unfollow

**Attach to one worker.** One atomic block: who it is, what was skipped, the last round, then
the line where "live" starts.

<!-- w=80 -->
```
A2 ▎ ╭ ◈ following A2 · worker · sonnet · fresh · 12:04:31
   ▎ │ task  Fix the off-by-one in parseArgs and add tests for the empty…
   ▎ │ sid 0a4508c3 · lead 3f2a · started 12:01:10 · 3m21 in · 14 tools
   ▎ ╰ … 47 earlier steps not shown · /follow A2 --all replays them
   ▎ ↺ ✦ Edit  src/cli/args.ts · +3 −1 · 12:03:58
   ▎ ↺ » Bash  $ bun test src/cli · 39 pass 2 fail · 1.4s · 12:04:12
   ▎ ↺ The two failures are in parseFlags, which repeats the loop. · 12:04:20
   ▎ ── live ──
```

- `◈` and `following` are `[sky]`. The tag is `[lane]`. The task and the facts are `[dim]`.
- **Backlog.** The default is the last round, at most 6 rows, always as digest rows, always
  `[dim]`, always with `↺` and the **original** time. `↺` means: this happened before you
  looked, and it was written late. A typical worker has 40 to 60 tool calls, so the rest is one
  row that counts them and names the command that replays them.
- `── live ──` is a short rule in `[lane]`. It is not drawn to the edge (principle 7). Rows
  below it were committed as they happened.
- A worker with no history gets the card only. No backlog rows, no `live` rule.
- `/follow A2 --all` replays the full history as digest rows under a rule
  `── replay · 61 steps ──`, in chunks of 40 rows for each write, then `── live ──`.

**Attach to several at once** (3 or more, or `all`). One roster card, not one card for each
worker. Eight attach cards would be 40 rows. The roster is also the colour key for the reader:

<!-- w=80 -->
```
  ╭ ◈ following 8 workers · fleet 3f2a · quiet · 12:04:31
  │ A1 ▎ explorer  sonnet  3m21  Find every caller of parseArgs and…
  │ A2 ▎ worker    sonnet  3m20  Fix the off-by-one in parseArgs and add…
  │ A4 ▎ reviewer  opus    0m31  Review the diff of A2 for regressions…
  │ A5 ▎ worker    sonnet  4m48  Add tests for the stream reader…
  │ A6 ┃ explorer  sonnet  1m02  List the tools that write files…
  │ A7 ┃ explorer  sonnet  6m02  Map the compositor's write paths…
  │ A8 ┃ worker    sonnet  0m12  Update the README for the new flags…
  │ A9 ┃ log-miner opus    0m05  Find the first failed gate in ci.log…
  ╰ live from here · no backlog · /peek A2 shows one · ^G changes the set
```

The roster is the lead-side card (2-space gutter): it is about the fleet, not from one worker.
Each rail has its lane's hue and shape. With `all`, a worker that is spawned later gets the short
single attach card when its first event arrives.

**Unfollow.** One row, so the reader knows the record stops here and the worker did not:

<!-- w=80 -->
```
A2 ▎ ── unfollowed · 9m02 in · still running · /follow A2 to return ── 12:10:33
```

**Resume after a hold.** The same shape as the backlog:

<!-- w=80 -->
```
A2 ▎ ── resumed · held 2m10 · 14 steps ── 12:09:40
   ▎ … 9 earlier steps not shown · /peek A2 20 shows them
   ▎ ↺ » Bash  $ bun test src/cli · 41 pass 0 fail · 1.3s · 12:09:21
   ▎ ↺ All 41 pass. I'll write the report. · 12:09:30
   ▎ ── live ──
```

**Waypoint.** A lane that has run for 5 minutes since its last banner gets one status rule, on
its next commit. Never on a timer alone, so a silent lane writes nothing:

<!-- w=80 -->
```
A2 ▎ ── worker · sonnet · 5m00 in · 19 tools ✘1 · 7 turns · 12:06:10
```

`[dim]`. It is a progress mark for the user who watches, and it tells a later reader who `A2`
was without a scroll to the attach card.

### 3.10 Feed levels

One level for the feed. `v` in the selector, `^O` as a chord, or a flag on `/follow`.

| Item                | `seals`     | `quiet`             | `normal`                          | `full`                |
| ------------------- | ----------- | ------------------- | --------------------------------- | --------------------- |
| attach, unfollow    | yes         | yes                 | yes                               | yes                   |
| seal                | yes, 3 rows | yes, 3 rows         | yes, 6 rows                       | yes, 20 rows          |
| text                | no          | 1 row, clipped      | up to 6 rows                      | up to 40 rows         |
| thinking            | no          | no                  | 1 row when 3 s or more            | 1 row always          |
| Read, Grep, Glob    | no          | digest row          | digest row                        | host card, 10 rows    |
| Bash, ok            | no          | digest row          | digest row, or card of 4 rows     | host card, 10 rows    |
| Edit, Write         | no          | digest row          | diff card, 12 rows                | host card, host cap   |
| tool error          | no          | 1 row, never folded | card, 6 rows                      | card, host cap        |
| run error, notice   | 1 row       | 1 row               | full                              | full                  |
| mailbox             | no          | 1 row               | full                              | full                  |
| stall row, waypoint | no          | yes                 | yes                               | yes                   |

- `auto` is the default: `normal` for 1 or 2 lanes, `quiet` for 3 or more. The header shows the
  level in use. A level that the user sets stays until the user changes it.
- `seals` with `/follow all` is the low-noise mode: one card when each worker ends, and nothing
  more.
- **Flood fuse.** A lane that commits more than 120 rows in a minute drops one level for itself,
  and says so in one row: `A2 ▎ ⚠ busy lane · showing quiet until it calms · ^O overrides`. It
  goes back after a minute under 40 rows, with no row.
- A level change is not written to scrollback. It changes only what comes next.

### 3.11 How lanes interleave

**Among lanes.** A block is atomic, so two lanes cannot mix inside a block. All lanes share one
queue in event-time order. What remains is the order of the blocks, and there are two orders,
taken from turbo's `stream` and `grouped`:

`stream`: each item is its own block. The default for 1 or 2 lanes.

<!-- w=80 -->
```
A1 ▎ • Read  src/cli/args.ts · 212 lines · 12:04:40
A2 ▎ I'll fix the loop bound first, then add the tests. · 12:04:41
A1 ▎ » Bash  $ rg -n "parseArgs\(" src · 14 lines · 12:04:42
A2 ▎ ✦ Edit  src/cli/args.ts · +3 −1 · 12:04:44
A1 ▎ parseArgs has 14 callers; 3 pass a slice. · 12:04:46
```

`grouped`: a lane's items are held until its model round ends (`turn_completed`), then the round
is one block. The default for 3 or more lanes. Eight lanes read as paragraphs, not as confetti.
The live rows still show each step as it happens.

<!-- w=80 -->
```
A1 ▎ • Read  src/cli/args.ts · 212 lines · 12:04:40
   ▎ » Bash  $ rg -n "parseArgs\(" src · 14 lines
   ▎ parseArgs has 14 callers; 3 pass a slice.
A2 ▎ I'll fix the loop bound first, then add the tests. · 12:04:41
   ▎ ✦ Edit  src/cli/args.ts · +3 −1
   ▎ » Bash  $ bun test src/cli · 41 pass 0 fail · 1.2s
A5 ▎ • Read  lib/stream.ts · 538 lines · 12:04:43
   ▎ • Read  lib/stream.test.ts · 292 lines
```

A group is cut when it reaches 12 rows or 20 seconds, so a long round does not hold its lane.
Errors and seals are never held: they end the group at once.

**Against the lead.** The lead's formatter (mdstream) echoes a partial row and rewrites it in
place with `\r ESC[K`. A block written into that row corrupts the scrollback: Daniel measured
corruption at 94.9% of byte offsets and 87.7% of real write boundaries, also for a block that
starts with a line feed (`20-gating-experiment.md`). So a block goes through one of four
commit points, best first:

1. The lead is idle. The block is written at once.
2. The lead is between two items: a text block ended, or a tool card closed.
3. The lead is at a blank line in its text.
4. **Restore write**, after 2 seconds without gate 1, 2 or 3. This is Daniel's measured policy
   P9: 0 corrupt cases at all 21,677 byte offsets, 91% of the 903 real boundaries, a mean wait of
   about 10 ms. The writer looks at the lead's open row and does one of these, as ONE write:

   | Open row of the lead                                 | Write                                          |
   | ---------------------------------------------------- | ---------------------------------------------- |
   | empty (`streamCol == 0`, no CR pending)              | the block                                      |
   | text, shorter than the terminal                      | `\r ESC[K` + block + the same row again        |
   | mdstream's clipped echo (starts with `…`, full width) | `\r ESC[K` + block. No replay: the next chunk redraws it. |
   | a CR is pending                                      | `\r ESC[K` + block. No replay.                 |
   | a wrapped row, an unknown cursor move, exactly the width | wait for the next line feed                |

   After a "wait" the block goes at the next line feed of any kind. With a formatter active the
   writer never adds a line feed of its own to make room: that is the corrupt case.

Gates 1 to 3 are the calm commit points. They never split a list or a table. The restore write
is correct at any offset, but in 14% of its writes it lands between two rows of one markdown
structure. That is cosmetic, and it happens only when the lead streams for more than 2 seconds
with no calm point.

What the user sees of a restore write: nothing special. The block appears above the row that was
streaming, and that row goes on streaming under it. The lead streams `…flag, not the`, and A2's
block is due:

<!-- w=80 -->
```
  The bound is wrong in two places. parseArgs reads one cell past the end of
  argv, so the last flag
```

One frame later. The partial row was cleared, the block was written, and the row was written
again. The next chunk continues it:

<!-- w=80 -->
```
  The bound is wrong in two places. parseArgs reads one cell past the end of
A2 ▎ ✦ Edit  src/cli/args.ts · +3 −1 · 12:04:44
  argv, so the last flag is read twice
```

The lead's paragraph is split by one lane row, and no row is duplicated or glued. Every row names
its owner, so the split reads correctly: a lead row starts with 2 spaces or `  │`, a lane row with
a tag or a rail.

<!-- w=80 -->
```
  The parser has two entry points. I'll take parseArgs myself and leave the
  callers to the workers.

A1 ▎ • Read  src/cli/args.ts · 212 lines · 12:04:40
   ▎ » Bash  $ rg -n "parseArgs\(" src · 14 lines
A2 ▎ I'll fix the loop bound first, then add the tests. · 12:04:41

  ╭ » Bash  $ bun test --timeout 600000 · 12:04:43
  │
  │ src/cli/args.test.ts:
  │ ✓ parses a single flag
A2 ▎ ✦ Edit  src/cli/args.ts · +3 −1 · 12:04:44
  │ ✓ parses a repeated flag
  │ ✗ parses a trailing flag
  ╰ shown 3/212 L

  Two tests fail on main before any change.
```

- One blank row separates the lead's text from a lane run, before and after. No blank row
  between lane blocks. The compositor's blank-line cap removes the extras.
- The `A2` row inside the lead's card is a restore write at an empty row. A lead tool can run
  for minutes, and that is when the user most wants to see the workers, so the feed must not
  stop for it.
- A block never goes into the lead's open row as it is. The writer clears that row and puts it
  back, or it waits (gate 4).

**In a narrow terminal** (under 50 columns) the tag moves to its own row and the gutter is 2
cells, so the content keeps its width:

<!-- w=60 -->
```
▎ A2 worker · 12:04:41
▎ I'll fix the loop bound first, then add the
▎ tests.
▎ ✦ Edit  src/cli/args.ts · +3 −1
```

### 3.12 Months later: who did what

A reader lands in the middle of old scrollback. This is what the design gives them, without
colour and without the session:

1. **Rail or no rail.** A row that starts with 2 spaces is the lead's. A row with a tag or a
   rail in the first 4 cells is a worker's.
2. **Which worker.** The tag is at most 20 rows above, at the start of the line. `^A2 ` is a
   pattern for the terminal's search.
3. **When.** Every tagged row has the event time. The first of a day has the date.
4. **Who `A2` was.** Up: the attach card or the roster (role, model, task, session id, lead id).
   Near: a waypoint, at most 5 minutes of work away. Down: the seal.
5. **How it ended.** The seal: status, result, numbers, and the worker's session id, which
   names the transcript file `~/.minimal-agent/sessions/<sid>.jsonl`.
6. **What is missing.** `… 47 earlier steps not shown`, `── unfollowed ──`, `── resumed · held
   2m10 ──`, `⚠ no events for 2m00`. Each hole has a row.
7. **What was written late.** `↺`, with the original time.
8. **What the user asked.** The typed `/follow A2` is in scrollback with its own timestamp,
   because the host echoes command lines. A follow that started with `^G` has the attach card.

---

## 4. Key bindings and slash commands

### 4.1 What is taken

I read `src/editor/key-dispatch.ts`, `src/input/input.ts`, the input-pipeline doc and the
`editor.key` hooks of the plugins. Daniel's second message confirmed the closed key set.

| Key                                   | Owner today                                           |
| ------------------------------------- | ----------------------------------------------------- |
| `Esc`, `Ctrl+C`                       | abort-quit FSM, after the capture stack and the hooks |
| `Esc Esc`                             | history-edit                                          |
| `Shift+Tab`, `Ctrl+Shift+Tab`         | mode cycle                                            |
| `Alt+M`                               | interrupt and apply mode                              |
| `Ctrl+A E K U W D`                    | line editing                                          |
| `Ctrl+V`                              | clipboard paste                                       |
| `Ctrl+\`                              | show hidden characters                                |
| `Ctrl+R`                              | history (reserved, swallowed)                         |
| `Ctrl+J`, `Shift+Enter`, `Alt+Enter`  | newline (`Alt+Enter` also the prompts menu)           |
| `Alt+B`, `Alt+F`                      | word left, word right                                 |
| `↑ ↓` on an empty prompt              | queue navigation, then history                        |
| `Tab`, `Enter`, `Esc` in a menu       | slash menu, prompts, mentions, config, usage          |
| `/` and `$` as the typed character    | slash menu                                            |

Free, by Daniel's check: `Ctrl+G`, `Ctrl+T`, `Ctrl+O`, `Ctrl+N`, `Ctrl+P`, `Ctrl+L`. I leave
`Ctrl+N`, `Ctrl+P` and `Ctrl+L` alone: readline users expect history and clear-screen there. I
use no `Alt` chord (not reliable on macOS) and no F-key (not verified).

### 4.2 Global chords (need the "plugin chords" primitive)

| Chord    | Action                                                                     | Why this key                       |
| -------- | -------------------------------------------------------------------------- | ---------------------------------- |
| `Ctrl+G` | open the selector. In the selector: close it.                              | G for "gang". Free.                |
| `Ctrl+O` | cycle the feed level: `auto → quiet → normal → full → seals`               | "open up", as in other agent CLIs. |
| `Ctrl+T` | hold and resume the feed                                                   | T for "ticker". Free.              |

The chords do nothing when the session has no workers. They are not offered to the model.

### 4.3 Keys in the selector (work today under a modal overlay)

Each of these is in the set that an overlay owner receives: arrows, Enter, Tab, Escape,
printable characters, Backspace.

| Key           | Action                                                                      |
| ------------- | --------------------------------------------------------------------------- |
| `↑` `↓`       | move the cursor (`k` `j` also)                                              |
| `←` `→`       | page up, page down                                                          |
| `Space`       | mark or unmark the cursor row (staged)                                      |
| `Enter`       | apply the marks and close. With no marks: toggle the cursor row, apply.     |
| `s`           | solo: follow only the cursor row, apply                                     |
| `a`           | follow all (standing), apply                                                |
| `n`           | follow none, apply                                                          |
| `r`           | show only running workers, on and off                                       |
| `Tab`         | peek, on and off                                                            |
| `v`           | cycle the feed level                                                        |
| `h`           | hold and resume the feed                                                    |
| `0`-`9`       | jump to that id (`1` `2` goes to `A12`, 800 ms between digits)              |
| `/`           | filter. Then text, `Backspace`, `Enter` keeps it, `Esc` clears it.          |
| `Esc`         | clear the filter, or else close with no change                              |

There is no key that stops a worker. A stop is destructive and is the lead's tool today. I keep
it out of this design.

### 4.4 Slash commands (the path with no new key primitive)

None of these names is in use. I checked the plugin manifests (`config`, `history-edit`, `hooks`,
`loop`, `schedule`, `security`, `usage`) and the CLI commands (`help`, `dump`, `resume`,
`sessions`, `compact`, `continue` and the others).

| Command                               | Action                                                        |
| ------------------------------------- | ------------------------------------------------------------- |
| `/agents`                             | open the selector. `/follow` with no argument is the same.    |
| `/follow A2`                          | follow one, added to the set                                  |
| `/follow A2 A5 A7`                    | follow several                                                |
| `/follow all`                         | follow all, also the workers that come later                  |
| `/follow @reviewer`                   | follow every worker with that label                           |
| `/follow only A2`                     | follow A2 and unfollow the others                             |
| `/unfollow A2`, `/unfollow`           | unfollow one, or all                                          |
| `/follow hold`, `/follow resume`      | hold and resume the feed                                      |
| `/follow level quiet`                 | set the level: `auto`, `seals`, `quiet`, `normal`, `full`     |
| `/follow order grouped`               | set the order: `auto`, `stream`, `grouped`                    |
| `/peek A2`, `/peek A2 20`             | commit one snapshot card: the last round, or the last 20 items |

Flags on `/follow <ids>`: `--all` (replay the full history), `--no-backlog`, `--last N`, and the
levels as flags (`--quiet`, `--normal`, `--full`, `--seals`).

`/peek` is the committed peek. It is one notice card with digest rows and no subscription. It
needs no lane writer: a plugin can already emit a notice block (`notification.emit`). It is the
first thing that can ship.

---

## 5. Ideas that are native to append-only scrollback

Each of these works because scrollback cannot be edited. None needs a cursor move.

1. **The live row is the head of the lane.** The same rail in the widget and in scrollback. The
   eye goes from "what it does now" to "what it did" along one colour.
2. **Peek and follow are two tools.** Peek is volatile and free. Follow is permanent and costs
   rows. Most questions ("is A7 stuck?") need peek only. The selector makes peek one key.
3. **The tag collapses as in a chat.** A run from one worker has its name once. It comes back
   after another writer, 20 rows or 60 seconds.
4. **Grouped by model round.** turbo's grouped order, with the round as the group. The buffer is
   small (12 rows, 20 seconds) and the live row covers the wait.
5. **Backlog as `↺` rows and a `live` rule.** The reader can tell "written late" from "written
   as it happened". docker compose and stern do not mark this.
6. **Waypoints.** A status rule, on a commit, at most one for each 5 minutes of a lane. It is
   the buildkit idea turned around: the progress line is committed, but rarely.
7. **Honest gaps.** Unfollow, hold, stall and skipped backlog each leave one row.
8. **Colour and rail from the id.** No allocation, no state, same result on replay.
9. **The roster is the key.** A follow of many workers starts with a card that maps tag, rail
   colour, role, model and task.
10. **`seals` as a level.** `/follow all --seals` gives one card for each worker's end and
    nothing more. It is a good default for a user who wants a record and not a feed.
11. **The flood fuse.** A lane that floods drops one level for itself and says so.
12. **`⇡ waiting`.** The lag between the live rows and scrollback is shown, with its cause.
13. **OSC 8 links** (optional, needs a core change). The `sid` in a seal links to the transcript
    file, and a path in a digest row links to the file. A link needs no cursor move and still
    works months later. But core's `displayWidth` counts the link's bytes as cells (section 7,
    item 6), so links come after that fix.
14. **Marks on banners only** (optional, same core change as 13). If the host adds jump marks, put them on the attach
    card and the seal, not on every block. Then "previous mark" goes from worker to worker, and
    the marks of the user's own prompts are not lost among them.

---

## 6. Primitives: what I need, drop, change and add

Daniel's five assumptions, then what I add.

| # | Primitive                              | Verdict            | What the design needs from it                                                                                                                                                                                                             |
| - | -------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | Boundary-gated atomic lane writer      | **Keep, extend**   | This is the SAME primitive as the host's own `Compositor.writeBlock` (Benjamin's uncommitted work, branch `feat/no-direct-writes`), with a lane queue on top. It is not a second writer: lanes, toasts, warn rows and command echoes all go through `writeBlock`. What the lanes add on top: (a) Gates 1 to 3 in front of the restore write, with a 2 s deadline (3.11). The restore write itself (P9) belongs inside `writeBlock`, because only the compositor knows the open row. (b) One queue for all lanes, in event-time order. (c) The queue depth and the oldest wait, for `⇡ waiting`. (d) "Was the last scrollback write this lane's?", for the tag rule. (e) A gutter parameter, and `cols - 3` passed to the host renderers. (f) Every row clamped to `cols - 1`. |
| 2 | Focusable live-area panel, key capture | **Drop for v1**    | The modal overlay that `/usage` and `/config` use is enough for the selector. I need two small things from it: the picker's selection style in the kit (so the plugin does not copy `bgRgb(55,45,85)`), and rows and columns (item 3).      |
| 3 | Per-lane ticker rows                   | **Change**         | No new rows. The ticker is the fleet row. What is missing: (a) a push repaint for a live-area slot, joined to at most 4 per second. The scheduler's floor is 1000 ms (`live-area-scheduler.ts:579` since cli `152ace3`, Erik's one-timer-per-slot fix; build the push repaint on top of it and keep its timer tests green). (b) The slot's `cols`, `rows` and the row budget it may use. `LiveAreaHandlerContext` has none of these. |
| 4 | Event tailer with backfill             | **Keep, extend**   | Item-level units. A join of the stream's `item_started` with the transcript's `tool_result` by id, for the full output. The round boundary (`turn_completed`), for the grouped order. "Last round" and "count of earlier steps", for the backlog. The duration of a thinking item. |
| 5 | OSC marks                              | **Optional, last. Needs a core change.** | Only on attach cards and seals. OSC 8 links are worth more. Core's `displayWidth` strips only CSI, so an OSC 8 link `transcript` measures 43 cells instead of 10, and `truncateDisplayWidth` cuts inside it (Daniel's check; I got 58 cells for a longer URL). Either core's ANSI regex learns OSC, or every link and mark is appended after clamping and wrapping. |
| 6 | Plugin chords                          | **Add**            | `Ctrl+G`, `Ctrl+O`, `Ctrl+T`, delivered to a plugin when no overlay owns the input.                                                                                                                                                         |
| 7 | Semantic lane blocks, host-rendered    | **Add**            | The plugin sends `{lane, at, kind, …}` with kind `text`, `tool`, `notice`, `mail`, `rule`, `banner`, `seal`. The host draws it with the renderers that session replay uses. Two things are new in the host: a **digest row** for a tool call (3.4), and a `maxRows` cap on the tool card and the notice card. |
| 8 | Command dispatch during a turn         | **Works today**    | A registered command dispatches at once, also mid-turn (`repl-live-area.ts:759-764`, Daniel's check). But its echo is an ungated write today, so `/follow` typed while the lead streams can corrupt the lead's row. The echo must also go through `writeBlock`. |
| 9 | Markers in the lead's transcript       | **Add, small**     | Store attach, unfollow and seal as note records (`appendNote` exists for notices). Then `--resume` replays "A2 was followed from 12:04 to 12:11", not the whole feed. Without this, a resumed session shows no trace of the lanes.           |

What the compositor cannot do today, in short: commit a block at a safe boundary of the lead's
stream (1, `writeBlock` plus P9); tell a caller who wrote last (1d); repaint a plugin's live rows faster than once per
second (3a); give a slot its row budget (3b); deliver a chord to a plugin (6).

What needs no new primitive: the selector (modal overlay and `editor.footer.set`), the slash
commands, and `/peek` as a notice card.

---

## 7. Facts I could not verify

I did not guess these. The design names each place where one matters.

1. **Edit line numbers.** `deriveEditDisplay` builds the diff from `old_string` and
   `new_string` with a start of 0. I found no stored patch with the real line numbers in a
   worker's transcript. My diff mockup (3.6) therefore starts at line 1. If the tailer can get
   the real numbers, the card is the lead's card with no change.
2. **Thinking duration.** The stream I read (`0a4508c3…`) has `thinking_delta` lines and no
   `item_started` or `item_completed` for thinking. So the duration would be first delta to last
   delta. Daniel counted 10,479 finished thinking items, so other providers have item events. The
   tailer must handle the two cases. Where there is neither, the row is `· thought`.
3. **Slash commands during a turn.** VERIFIED by Daniel. A registered command dispatches at
   once, with no `running` check, also mid-turn (`repl-live-area.ts:759-764`). So `/follow`
   works with no chord. Its echo is an ungated write today, so it needs `writeBlock` too
   (section 6, item 8).
4. **The existing "finished" digest.** VERIFIED by Daniel. It rides `prompt.inject` and then
   `onSubmit` with empty `commitLines`, so it prints NO scrollback row. The seal is the only end
   row of a followed worker. No duplicate.
5. **The lead's formatter and cursor moves.** Measured by Daniel (`20-gating-experiment.md`):
   mdstream rewrites only its open row, with `\r ESC[K`, and shows a clipped echo (`…` plus the
   tail) when a row is wider than the terminal. The restore write (3.11, gate 4) handles both
   cases, and it waits on a wrapped row or an unknown cursor move. Tested in FakeTerminal and
   tmux 3.8 only, not in iTerm2, Ghostty or kitty.
6. **OSC 8 and width.** VERIFIED by Daniel, and it fails today. Core's `displayWidth` strips
   only CSI: an OSC 8 link measures as its bytes (43 cells for a 10-cell word), and
   `truncateDisplayWidth` cuts inside it. Links and marks need a core change first (section 6,
   item 5).
7. **`✉` in real terminals.** It is 1 cell in `displayWidth`. Some fonts draw U+2709 as a
   colour emoji, which `style.ts` forbids. Check it in iTerm, Ghostty and kitty. The fallback
   is `↦`.
8. **The status gap.** The layout doc says 2 gap rows in one place and 1 in the cursor formula.
   My row budgets (2.9) use 2. With 1, each total is one row less. The formula for `F` goes away
   when the host gives the budget.
9. **Tool icons other than Bash, Read, Write, Edit.** VERIFIED: Grep is `⌕` pink and Glob is
   `✱` violet (`tool-presentation.ts:32-33`). Both are 1 cell. Their digest rows have the same
   shape as Read's: `⌕ Grep  "parseArgs\(" src · 14 matches`.
10. **The order of footer slots.** The compositor drops footer rows from the bottom. If the
    fleet slot is the last, it is clipped first. The self-limit in 2.9 avoids the clip, but only
    with the budget from item 3b.
11. **Free chords.** `Ctrl+G`, `Ctrl+O` and `Ctrl+T` are free by Daniel's reading. I confirmed
    that `key-dispatch.ts` has no branch for them. I did not test them in tmux, where a user's
    own bindings can take a key before it reaches us.
12. **A target switch in the worker's stream.** Answered from the code, not yet seen in a real
    stream file. The worker applies a switch in `cli/src/startup/target-control-worker.ts:301`
    with `core.switchTarget(...)` and no `quiet`. Core then emits a `notice` of kind
    `model_adopted` (`core/src/sdk/agent-core.ts:354`), with `from`, `to`, `fromTarget`,
    `toTarget` and the effort reset. So the switch row in 3.5 comes from that notice, at the
    time of the switch. The tailer must render this one notice kind as the switch row and not as
    the generic `›` notice, or the reader gets two rows. What I did not verify: that the
    stream-json writer keeps `fromTarget` and `toTarget`. Without them the row can name the
    model and the effort, but not a provider or credential change.

Numbers that are my choice and not measured: the 2 s gate deadline, 4 repaints per second, the
tag rule (20 rows, 60 s), the group cut (12 rows, 20 s), the waypoint period (5 min), the stall
row (2 min), the fuse (120 rows per minute), the backlog (last round, 6 rows). Each should be a
constant in one file, and the first three should be measured in a real session before they are
fixed.

---

## 8. Suggested build order

This is the order that gives the user something at each step. The plan is Daniel's.

1. **`/peek A2`.** A notice card with digest rows. No new primitive. It proves the tailer, the
   digest row and the lane gutter.
2. **The selector with peek.** `/agents`, modal overlay. No scrollback writes. It already
   answers "what is that worker doing".
3. **Follow one, lead idle.** The lane queue on `writeBlock`, gate 1 only. Attach card, digest
   rows, seal.
4. **Gates 2 and 3, the restore write, and the live row.** Follow while the lead works. The
   restore write (P9) lands inside `writeBlock` first, with Daniel's sweep as its regression
   test. Then push repaint and `⇡ waiting`.
5. **Many lanes.** Roster, grouped order, strip form, row budget, levels, fuse.
6. **Chords, markers on resume, links.**
