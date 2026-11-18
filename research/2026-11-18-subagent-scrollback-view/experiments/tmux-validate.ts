/**
 * Real-terminal check of the gate sweep: replay ONE recorded mdstream output
 * stream through the REAL Compositor onto a REAL tty (run this inside tmux),
 * inject the 4-row marker block at ONE cut, and exit. The pane is then read
 * back with `tmux capture-pane`, and compared with what `FakeTerminal` said.
 *
 * Mirrors `runPipeline()` in gate-sweep.ts (same pieces, same inject, same
 * live area). Only the terminal differs: tmux's emulator instead of FakeTerminal.
 *
 * `TEE=<file>` also appends every byte written to the terminal to <file>, so the
 * same bytes can be replayed through another emulator (`cat <file>` in tmux, or
 * `FakeTerminal.feed`) to tell an emulator difference from a compositor bug.
 *
 * Usage (inside a tty):
 *   bun run tmux-validate.ts <scenario> <width> <la:0|1> <seg> <idx> [none|block|restore|endrow|erase] [sink=raw]
 * `seg`/`idx` are the cut's piece index and string index (see `gate-sweep.ts find`).
 *
 * @module experiments/tmux-validate
 */
import { appendFileSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { Compositor } from "../../../minimal-agent-cli/src/ui/compositor.ts"
import { faintThinkingChunk } from "../../../minimal-agent-cli/src/ui/style/ansi.ts"

const HERE = import.meta.dir
const [scenario, widthS, laS, segS, idxS, modeS = "block"] = process.argv.slice(2)
if (!scenario || !widthS || !laS || !segS || !idxS) {
  console.error("usage: tmux-validate.ts <scenario> <width> <la:0|1> <seg> <idx> [none|block|restore|endrow|erase]")
  process.exit(2)
}
const la = laS === "1"
const cutSeg = Number(segS)
const cutIdx = Number(idxS)
const inject = modeS !== "none"
const restore = modeS === "restore"
const endrow = modeS === "endrow"
const eraseOnly = modeS === "erase"

const rec = JSON.parse(readFileSync(join(HERE, "recordings", `${scenario}@${widthS}.json`), "utf8")) as {
  segments: { chunk: number; text: string }[]
}
// The sweep wraps every piece of the two thinking scenarios in faintThinkingChunk (the lead's
// `thinkingOutput` sink) and drops empty pieces. The (seg, idx) of a cut refers to THOSE pieces.
// The first version of this file replayed the raw pieces, so every thinking cut landed on a
// different byte than the sweep's and its "failures" were not about the policy at all.
const FAINT = scenario.startsWith("thinking")
const pieces = rec.segments
  .map((s) => (FAINT ? faintThinkingChunk(s.text) : s.text))
  .filter((t) => t.length > 0)

const MARKERS = ["⟦L1·row1⟧", "⟦L1·row2⟧", "⟦L1·row3⟧", "⟦L1·row4⟧"]
const LA_LINES = ["LA·status", "LA·❯ editor", "LA·footer"]

const comp = new Compositor({
  output: {
    isTTY: process.stdout.isTTY,
    get columns() {
      return process.stdout.columns
    },
    get rows() {
      return process.stdout.rows
    },
    write: (s: string) => {
      if (process.env.TEE) appendFileSync(process.env.TEE, s)
      return process.stdout.write(s)
    },
  } as never,
})
comp.mount()
// Real sessions always have output above the live area. Without a prefill the
// first erase lands on (0,0), where tmux (>= 3.2, `scroll-on-clear`) pushes the
// visible screen into history, which is an emulator artifact, not a compositor bug.
const PREFILL = Number(process.env.PREFILL ?? 5)
for (let i = 0; i < PREFILL; i++) comp.writeStream(`prefill ${i}\n`)
if (la) comp.setLiveArea(LA_LINES, { row: 1, col: 5 })

const block = () => comp.writeStream(MARKERS.map((m) => `${m}\n`).join(""))
/** What Benjamin's uncommitted `Compositor.writeBlock` does: end the open row with one LF, then the block. */
const endRowBlock = () => {
  const open = (comp as never as { streamCol: number }).streamCol > 0
  comp.writeStream(`${open ? "\n" : ""}${MARKERS.map((m) => `${m}\n`).join("")}`)
}

/** Same model as gate-sweep.ts `partialRow`: the lead's half-written row, from the bytes written so far. */
function partialRow(pre: string): { row: string; crPending: boolean; unknown: boolean } {
  let row = ""
  let crPending = false
  let unknown = false
  let i = 0
  while (i < pre.length) {
    const ch = pre[i]!
    if (ch === "\x1b") {
      let e = i + 2
      if (pre[i + 1] === "[") {
        e = i + 2
        while (e < pre.length && !(pre.charCodeAt(e) >= 0x40 && pre.charCodeAt(e) <= 0x7e)) e++
        e++
      }
      const seq = pre.slice(i, e)
      if (/^\x1b\[[\d;]*m$/.test(seq)) row += seq
      else if (/^\x1b\[0?[KJ]$/.test(seq)) {
        if (crPending) {
          row = ""
          crPending = false
        }
      } else unknown = true
      i = e
      continue
    }
    if (ch === "\n") {
      row = ""
      crPending = false
      i++
      continue
    }
    if (ch === "\r") {
      crPending = true
      i++
      continue
    }
    if (crPending) {
      row = ""
      crPending = false
    }
    row += ch
    i++
  }
  return { row, crPending, unknown }
}
const eraseBlock = () => comp.writeStream(`\r\x1b[K${MARKERS.map((m) => `${m}\n`).join("")}`)
const restoreBlock = (pre: string) => {
  const { row, crPending, unknown } = partialRow(pre)
  const replay = !crPending && !unknown && row.length > 0 ? row : ""
  comp.writeStream(`\r\x1b[K${MARKERS.map((m) => `${m}\n`).join("")}${replay}`)
}

let pre = ""
for (let j = 0; j < pieces.length; j++) {
  const s = pieces[j]!
  if (j === cutSeg) {
    const a = s.slice(0, cutIdx)
    const b = s.slice(cutIdx)
    if (a) comp.writeStream(a)
    if (inject) eraseOnly ? eraseBlock() : restore ? restoreBlock(pre + a) : endrow ? endRowBlock() : block()
    if (b) comp.writeStream(b)
  } else comp.writeStream(s)
  pre += s
}
if (cutSeg === pieces.length && inject) eraseOnly ? eraseBlock() : restore ? restoreBlock(pre) : endrow ? endRowBlock() : block()
comp.flushStream()
// Leave the cursor below the live area, as the REPL does on exit.
comp.unmount()
