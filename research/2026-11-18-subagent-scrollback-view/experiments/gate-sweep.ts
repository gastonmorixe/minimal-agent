#!/usr/bin/env bun
/**
 * gate-sweep.ts: gating experiment for "when may a plugin commit a FOREIGN
 * multi-row block into scrollback while the lead streams markdown?"
 *
 * Run it from inside `minimal-agent-cli/` (the imports are relative, so any cwd
 * works; this is the documented way):
 *
 *   cd minimal-agent-cli
 *   X=../research/2026-11-18-subagent-scrollback-view/experiments/gate-sweep.ts
 *   bun run $X capture                      # real mdstream -> real Formatter -> recordings/*.json (~20 s)
 *   bun run $X scan                         # CSI inventory of every recording (is there ESC[nA ?)
 *   bun run $X sweep [--jobs N] [--stride S] [--sink raw|lead] [--prefill P]
 *   bun run $X report [--sink raw|lead] [--prefill P]
 *   bun run $X dump <scenario> <width> <la:0|1> <cutIndex> [variant] [--sink raw|lead] [--prefill P]
 *   bun run $X find <scenario> <width> <la:0|1> <class> [--sink raw|lead]   # list cut indexes of a class
 *
 * Phases
 *   capture  real mdstream via the real `Formatter` (COLUMNS/LINES from the sink), input fed in
 *            token-like chunks (3..7 chars), wait for 20 ms of output quiescence after each write.
 *            Every `sink.write()` call is one "segment" (= one `compositor.writeStream` call in the lead),
 *            tagged with the input chunk that was just written.
 *   sweep    for EVERY valid cut k of the output stream (not inside a UTF-8 char or an escape sequence):
 *            fresh Compositor + FakeTerminal(cols=W, rows=30, scrollback 2000), feed out[0:k], inject a
 *            4-row marker block (naive P0), feed out[k:], flushStream(), compare with the GOLDEN run
 *            (same stream, no block). Runs with and without a mounted live area, 5 block variants.
 *            One child process per (scenario, width) unit -> results/<scenario>@<w>[.lead][.pfN].json
 *   report   policies P0..P3 (+P1b, P4) -> results/tables*.md
 *
 * The script edits nothing outside `experiments/`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { cpus, homedir } from "node:os"
import { join } from "node:path"

import { FakeTerminal } from "../../../minimal-agent-cli/src/test-utils/fake-terminal.ts"
import { Compositor } from "../../../minimal-agent-cli/src/ui/compositor.ts"
import { Formatter } from "../../../minimal-agent-cli/src/ui/formatter/formatter.ts"
import { faintThinkingChunk } from "../../../minimal-agent-cli/src/ui/style/ansi.ts"
import { displayWidth } from "../../../minimal-agent-core/plugin-api/src/utils/term-width.ts"

// ----------------------------------------------------------------------------
// constants
// ----------------------------------------------------------------------------
const HERE = import.meta.dir
const REC_DIR = join(HERE, "recordings")
const STRICT_WRAP = process.env.STRICT_WRAP === "1" // FakeTerminal: EL/ED keep the wrap-pending flag (VT520-style)
const RES_DIR = join(HERE, STRICT_WRAP ? "results-strict" : "results")
const MDSTREAM = join(homedir(), ".minimal-agent", "bin", "mdstream")
const ROWS = 30
const SCROLLBACK = 2000
const WIDTHS = [40, 80, 120]
const IDLE_MS = 20
const SIZES = [3, 5, 4, 7, 6, 3, 5, 7, 4, 6, 5, 3] // token-like chunk sizes, cycled (deterministic)

const MARKERS = ["⟦L1·row1⟧", "⟦L1·row2⟧", "⟦L1·row3⟧", "⟦L1·row4⟧"]
const LA_LINES = ["LA·status", "LA·❯ editor", "LA·footer"]
const LA_CURSOR = { row: 1, col: 5 }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// ----------------------------------------------------------------------------
// scenarios (lead input, markdown)
// ----------------------------------------------------------------------------
interface Scenario {
  name: string
  what: string
  md: string
  /** thinking path: every segment goes through faintThinkingChunk() (repl-live-area `thinkingOutput`) */
  faint?: boolean
  /** no formatter: the chunks go straight to writeStream (repl-live-area `thinkingChunk` fallback) */
  direct?: boolean
}

const LONG_PARA =
  "This is a deliberately long paragraph that wraps across several terminal rows at every width we test, " +
  "because the quick brown fox jumps over the lazy dog again and again, and it keeps going with **bold words** " +
  "and `inline code` until it finally ends here."
const THINK = (
  "Let me think about this carefully before answering. The request is small, so I should read the code first, " +
  "check the edge cases, and then pick the simplest design that still works and stays easy to test later on. "
)
  .repeat(2)
  .slice(0, 200)

export const SCENARIOS: Scenario[] = [
  { name: "para-short", what: "single short paragraph", md: "Hello **world**, this is a short paragraph with `code`." },
  { name: "para-long", what: "long paragraph, wraps at all widths", md: LONG_PARA },
  {
    name: "soft-break",
    what: "2-line soft-break paragraph + paragraph",
    md: "First line of one paragraph\nsecond line of the same paragraph.\n\nNext paragraph.",
  },
  { name: "bullets", what: "bullet list with bold", md: "- one\n- two with **bold**\n- three\n\nAfter the list." },
  { name: "numbered", what: "numbered list", md: "1. first step\n2. second **step**\n3. third step\n\nDone." },
  { name: "heading", what: "heading + paragraph", md: "## A heading\n\nBody text under the heading." },
  { name: "blockquote", what: "blockquote (2 lines)", md: "> quoted line one\n> quoted line two\n\nAfter the quote." },
  {
    name: "table3",
    what: "table with 3 body rows",
    md: "| name | qty |\n|---|---|\n| apple | 3 |\n| pear | 12 |\n| fig | 7 |\n\nAfter the table.",
  },
  {
    name: "fence-bash",
    what: "fenced bash block, 4 code lines",
    md: "Run this:\n\n```bash\ncd /tmp\nls -la\necho done\npwd\n```\n\nAfter the code.",
  },
  {
    name: "mixed",
    what: "heading, paragraph, list, table, fence, paragraph",
    md:
      "# Report\n\nIntro paragraph with **bold** and `code`.\n\n- item one\n- item **two**\n\n" +
      "| k | v |\n|---|---|\n| a | 1 |\n| b | 22 |\n\n```bash\nmake test\nmake build\n```\n\nClosing paragraph.",
  },
  {
    name: "thinking",
    what: "thinking via mdstream: faint, 200 chars, no newline, then newline",
    md: `${THINK}\n`,
    faint: true,
  },
  {
    name: "thinking-direct",
    what: "thinking without formatter: faint raw chunks, 200 chars, then newline",
    md: `${THINK}\n`,
    faint: true,
    direct: true,
  },
]

function chunkify(s: string): string[] {
  const out: string[] = []
  let i = 0
  let j = 0
  while (i < s.length) {
    const n = SIZES[j++ % SIZES.length]!
    out.push(s.slice(i, i + n))
    i += n
  }
  return out
}

// ----------------------------------------------------------------------------
// small utils
// ----------------------------------------------------------------------------
/** End index (exclusive) of the escape sequence starting at s[i] === ESC. */
function escapeEnd(s: string, i: number): number {
  const n = s[i + 1]
  if (n === "[") {
    let j = i + 2
    while (j < s.length) {
      const c = s.charCodeAt(j)
      j++
      if (c >= 0x40 && c <= 0x7e) return j
    }
    return s.length
  }
  if (n === "]") {
    let j = i + 2
    while (j < s.length) {
      if (s[j] === "\x07") return j + 1
      if (s[j] === "\x1b" && s[j + 1] === "\\") return j + 2
      j++
    }
    return s.length
  }
  return Math.min(i + 2, s.length)
}

/** Make control bytes visible. SGR becomes ‹m› (or is dropped when keepSgr=false). */
function vis(s: string, keepSgr = true): string {
  let out = ""
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if (ch === "\x1b") {
      const e = escapeEnd(s, i)
      const seq = s.slice(i, e)
      const m = /^\x1b\[([\d;?]*)([A-Za-z])$/.exec(seq)
      if (m) {
        const [, p, f] = m
        if (f === "m") {
          if (keepSgr) out += "‹m›"
        } else if (f === "K") out += p ? `<EL${p}>` : "<EL>"
        else if (f === "J") out += p ? `<ED${p}>` : "<ED>"
        else if (f === "A") out += `<UP${p || 1}>`
        else out += `<CSI${p}${f}>`
      } else out += "<ESC?>"
      i = e - 1
    } else if (ch === "\r") out += "<CR>"
    else if (ch === "\n") out += "<LF>"
    else out += ch
  }
  return out
}

function flagStr(args: string[], name: string, def: string): string {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : def
}
const flagNum = (args: string[], name: string, def: number) => Number(flagStr(args, name, String(def)))

const recPath = (name: string, w: number) => join(REC_DIR, `${name}@${w}.json`)
const suffix = (sink: string, prefill: number) => `${sink === "lead" ? ".lead" : ""}${prefill > 0 ? `.pf${prefill}` : ""}`
const resPath = (name: string, w: number, sink: string, prefill: number) =>
  join(RES_DIR, `${name}@${w}${suffix(sink, prefill)}.json`)

// ----------------------------------------------------------------------------
// phase 1: capture
// ----------------------------------------------------------------------------
interface Seg {
  /** input chunk index that had just been written when this output arrived; chunks.length = end() phase */
  chunk: number
  text: string
}
interface Recording {
  scenario: string
  width: number
  rows: number
  mdstream: string
  capturedAt: string
  idleMs: number
  chunks: string[]
  segments: Seg[]
}

async function captureOne(sc: Scenario, width: number, mdVersion: string): Promise<Recording> {
  const chunks = chunkify(sc.md)
  const segments: Seg[] = []
  if (sc.direct) {
    chunks.forEach((c, i) => segments.push({ chunk: i, text: c }))
  } else {
    let cur = -1
    let lastOut = performance.now()
    const dec = new TextDecoder()
    const sink = {
      columns: width,
      rows: ROWS,
      write: (s: string | Uint8Array) => {
        const text = typeof s === "string" ? s : dec.decode(s)
        if (text.length > 0) {
          segments.push({ chunk: cur, text })
          lastOut = performance.now()
        }
        return true
      },
    }
    // The real Formatter: its env gets COLUMNS=<width>, LINES=<rows> from the sink (see formatterEnv).
    const f = new Formatter([MDSTREAM], sink as never)
    f.start()
    await sleep(80) // process spawn + mdstream's initial LF (the Formatter drops it)
    for (let i = 0; i < chunks.length; i++) {
      cur = i
      const t = performance.now()
      f.write(chunks[i]!)
      for (;;) {
        await sleep(4)
        const now = performance.now()
        if (now - Math.max(t, lastOut) >= IDLE_MS) break
        if (now - t > 3000) break
      }
    }
    cur = chunks.length
    await f.end()
  }
  return {
    scenario: sc.name,
    width,
    rows: ROWS,
    mdstream: mdVersion,
    capturedAt: new Date().toISOString(),
    idleMs: IDLE_MS,
    chunks,
    segments,
  }
}

async function cmdCapture(args: string[]) {
  mkdirSync(REC_DIR, { recursive: true })
  const mdVersion = (await new Response(Bun.spawn([MDSTREAM, "--version"], { stdout: "pipe" }).stdout).text()).trim()
  const onlyName = args[0] && !args[0].startsWith("--") ? args[0] : null
  const onlyW = args[1] ? Number(args[1]) : null
  for (const sc of SCENARIOS) {
    if (onlyName && sc.name !== onlyName) continue
    for (const w of WIDTHS) {
      if (onlyW && w !== onlyW) continue
      const rec = await captureOne(sc, w, mdVersion)
      writeFileSync(recPath(sc.name, w), JSON.stringify(rec))
      const all = rec.segments.map((s) => s.text).join("")
      writeFileSync(join(REC_DIR, `${sc.name}@${w}.bin`), all)
      const lines = rec.segments.map((s) => `[c${String(s.chunk).padStart(3)}] ${vis(s.text, false)}`)
      writeFileSync(
        join(REC_DIR, `${sc.name}@${w}.vis.txt`),
        `# ${sc.name} @ ${w} cols, ${rec.chunks.length} input chunks, ${rec.segments.length} segments, ${Buffer.byteLength(all)} bytes (${mdVersion})\n` +
          `# input chunks: ${JSON.stringify(rec.chunks)}\n${lines.join("\n")}\n`,
      )
      console.log(
        `captured ${sc.name}@${w}: ${rec.chunks.length} chunks -> ${rec.segments.length} segments, ${Buffer.byteLength(all)} bytes`,
      )
    }
  }
}

// ----------------------------------------------------------------------------
// CSI inventory (is there any ESC[nA ?)
// ----------------------------------------------------------------------------
function csiInventory(text: string): Map<string, number> {
  const inv = new Map<string, number>()
  for (const m of text.matchAll(/\x1b\[([\d;?]*)([A-Za-z])/g)) {
    const key = m[2] === "m" ? "SGR(m)" : m[2]!
    inv.set(key, (inv.get(key) ?? 0) + 1)
  }
  return inv
}

function cmdScan() {
  const rows: string[] = []
  rows.push("| scenario | w | bytes | ESC[nA | ESC[K | ESC[J | other CSI (non-SGR) | CR | LF | other C0 |")
  rows.push("|---|---|---|---|---|---|---|---|---|---|")
  let totalUp = 0
  let totalOther = 0
  for (const sc of SCENARIOS) {
    if (sc.direct) continue
    for (const w of WIDTHS) {
      if (!existsSync(recPath(sc.name, w))) continue
      const rec = JSON.parse(readFileSync(recPath(sc.name, w), "utf8")) as Recording
      const text = rec.segments.map((s) => s.text).join("")
      const inv = csiInventory(text)
      const up = inv.get("A") ?? 0
      totalUp += up
      const other = [...inv.entries()].filter(([k]) => !["A", "K", "J", "SGR(m)"].includes(k))
      totalOther += other.reduce((a, [, v]) => a + v, 0)
      const c0 = (text.replace(/\x1b\[[\d;?]*[A-Za-z]/g, "").match(/[\x00-\x09\x0b\x0c\x0e-\x1f]/g) ?? []).filter((c) => c !== "\r")
      rows.push(
        `| ${sc.name} | ${w} | ${Buffer.byteLength(text)} | ${up} | ${inv.get("K") ?? 0} | ${inv.get("J") ?? 0} | ${
          other.map(([k, v]) => `${k}:${v}`).join(" ") || "-"
        } | ${(text.match(/\r/g) ?? []).length} | ${(text.match(/\n/g) ?? []).length} | ${c0.length} |`,
      )
    }
  }
  const fx = join(HERE, "../../../minimal-agent-cli/src/test-utils/fixtures/mdstream-redraw-80col.bin")
  if (existsSync(fx)) {
    const t = readFileSync(fx, "utf8")
    const inv = csiInventory(t)
    rows.push(
      `| (old fixture, mdstream 0.2.1) | 80 | ${Buffer.byteLength(t)} | ${inv.get("A") ?? 0} | ${inv.get("K") ?? 0} | ${inv.get("J") ?? 0} | - | ${(t.match(/\r/g) ?? []).length} | ${(t.match(/\n/g) ?? []).length} | 0 |`,
    )
  }
  rows.push("", `TOTAL ESC[nA over all 0.3.9 recordings: ${totalUp}; other non-SGR CSI: ${totalOther}`)
  mkdirSync(RES_DIR, { recursive: true })
  writeFileSync(join(RES_DIR, "csi-inventory.md"), `${rows.join("\n")}\n`)
  console.log(rows.join("\n"))
}

// ----------------------------------------------------------------------------
// phase 2 helpers: pipeline replay
// ----------------------------------------------------------------------------
interface Piece {
  text: string
  chunk: number
}

interface Cut {
  /** byte offset in the (transformed) output stream */
  k: number
  /** piece index; === pieces.length for the final cut (after everything) */
  seg: number
  /** string index inside that piece */
  idx: number
  /** input chunks the lead had written to the formatter: [lo, hi] (ambiguous at a piece boundary) */
  lo: number
  hi: number
  /** true when the cut sits on a piece boundary (a point between two writeStream calls) */
  boundary: boolean
  /** the last significant byte before the cut is `\r` (ignoring SGR): the row still shows stale text */
  cr: boolean
}

/** Model of repl-live-area.ts `writeFormatterChunk`: keep the 1st trailing \n with the body, hold the 2nd+ until the next write. */
function leadSink(raw: Piece[]): Piece[] {
  const out: Piece[] = []
  let held = ""
  for (const p of raw) {
    const s = p.text
    if (s.length === 0) continue
    let i = s.length
    while (i > 0 && s[i - 1] === "\n") i--
    const nl = s.length - i
    if (nl === 0) {
      if (held) out.push({ text: held, chunk: p.chunk })
      held = ""
      out.push({ text: s, chunk: p.chunk })
      continue
    }
    const body = s.slice(0, i + 1)
    const extra = s.slice(i + 1)
    if (held) out.push({ text: held, chunk: p.chunk })
    held = ""
    out.push({ text: body, chunk: p.chunk })
    held += extra
  }
  // textStop discards the held tail (pendingTrailingNewlines = "")
  return out
}

function pipelinePieces(rec: Recording, sc: Scenario, sink: string): Piece[] {
  let pieces: Piece[] = rec.segments.map((s) => ({ chunk: s.chunk, text: s.text }))
  if (sc.faint) {
    pieces = pieces.map((p) => ({ chunk: p.chunk, text: faintThinkingChunk(p.text) })).filter((p) => p.text.length > 0)
  } else if (sink === "lead") {
    pieces = leadSink(pieces)
  }
  return pieces
}

function enumerateCuts(pieces: Piece[], C: number): Cut[] {
  const cuts: Cut[] = []
  let byte = 0
  let last = "" // last significant unit: "\r", "\n", "EL", "ED", or a printable char; SGR ignored
  for (let j = 0; j < pieces.length; j++) {
    const s = pieces[j]!.text
    let i = 0
    while (i < s.length) {
      const hi = Math.min(pieces[j]!.chunk + 1, C)
      const lo = i === 0 ? (j === 0 ? 0 : Math.min(pieces[j - 1]!.chunk + 1, C)) : hi
      cuts.push({ k: byte, seg: j, idx: i, lo, hi, boundary: i === 0, cr: last === "\r" })
      let e: number
      if (s.charCodeAt(i) === 0x1b) {
        e = escapeEnd(s, i)
        const seq = s.slice(i, e)
        if (!/^\x1b\[[\d;]*m$/.test(seq)) last = /K$/.test(seq) ? "EL" : "ESC"
      } else {
        const cp = s.codePointAt(i)!
        e = i + (cp > 0xffff ? 2 : 1)
        last = s.slice(i, e)
      }
      byte += Buffer.byteLength(s.slice(i, e))
      i = e
    }
  }
  cuts.push({ k: byte, seg: pieces.length, idx: 0, lo: C, hi: C, boundary: true, cr: last === "\r" })
  return cuts
}

function fenceOpen(text: string): boolean {
  const lines = text.split("\n")
  lines.pop() // the partial line does not count until its newline arrives
  return lines.filter((l) => /^\s{0,3}```/.test(l)).length % 2 === 1
}
function tableOpen(text: string): boolean {
  const lines = text.split("\n")
  const partial = lines.pop() ?? ""
  if (partial.startsWith("|")) return true
  const last = lines[lines.length - 1]
  return last !== undefined && last.startsWith("|")
}
/** Input-side oracle: state after the first c chunks were fed to the formatter, c = 0..C. */
function oracles(chunks: string[]) {
  const fence: boolean[] = []
  const table: boolean[] = []
  let text = ""
  for (let c = 0; c <= chunks.length; c++) {
    if (c > 0) text += chunks[c - 1]
    fence.push(fenceOpen(text))
    table.push(tableOpen(text))
  }
  return { fence, table }
}

function makeCompositor(term: FakeTerminal) {
  return new Compositor({
    output: {
      isTTY: true,
      columns: term.cols,
      rows: term.rows,
      write: (s: string) => {
        term.feed(s)
        return true
      },
    } as never,
  })
}

interface Variant {
  id: string
  calls: 1 | 2
  lead: boolean
  /** bonus policy P4: wipe the scratch row (`\r ESC[K`) before the block */
  erase?: boolean
  /**
   * policy P5 (added by Daniel): ONE write = `\r ESC[K` + block + the partial row replayed.
   * The writer knows the lead's partial row (it saw every byte), so it can clear it, commit,
   * and put the row back. After `\r` (CR pending) the row is about to be rewritten, so no replay.
   */
  restore?: boolean
  /**
   * policy P7 (added by Daniel): what the uncommitted `Compositor.writeBlock` of Benjamin (f9288ce8)
   * does: if the stream cursor is past column 0, end the open row with one LF, then write the block.
   */
  endrow?: boolean
  /**
   * policy P10 (added by Daniel): the CURRENT working-tree `Compositor.writeBlock` of Benjamin (f9288ce8):
   * the block is queued and written when the stream's last visible byte is a line feed, and drained at flushStream().
   * Needs a Compositor that has `writeBlock`; the run is recorded with the sha of that file's diff.
   */
  writeblock?: boolean
}
const VARIANTS: Variant[] = [
  { id: "one-nolead", calls: 1, lead: false },
  { id: "one-lead", calls: 1, lead: true },
  { id: "two-nolead", calls: 2, lead: false },
  { id: "two-lead", calls: 2, lead: true },
  { id: "erase-one", calls: 1, lead: false, erase: true },
  { id: "restore-one", calls: 1, lead: false, restore: true },
  { id: "endrow-one", calls: 1, lead: false, endrow: true },
  { id: "writeblock-one", calls: 1, lead: false, writeblock: true },
]
const PRIMARY = "one-nolead"

/**
 * The row the lead has half-written, rebuilt from the bytes the writer saw.
 * Models the terminal for the only moves the formatter makes: CR, EL/ED, LF, SGR, text.
 * `crPending`: the last significant byte was a CR, so the row is about to be rewritten.
 * `unknown`: a CSI other than SGR/EL/ED was seen (cursor-up from an older mdstream): fail closed.
 */
function partialRow(pre: string): { row: string; crPending: boolean; unknown: boolean } {
  let row = ""
  let crPending = false
  let unknown = false
  let i = 0
  while (i < pre.length) {
    const ch = pre[i]!
    if (ch === "\x1b") {
      const e = escapeEnd(pre, i)
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

function inject(comp: Compositor, v: Variant, pre = "") {
  const lead = v.lead ? "\n" : ""
  if (v.restore) {
    const { row, crPending, unknown } = partialRow(pre)
    const block = MARKERS.map((m) => `${m}\n`).join("")
    const replay = !crPending && !unknown && row.length > 0 ? `${row}` : ""
    comp.writeStream(`\r\x1b[K${block}${replay}`)
    return
  }
  if (v.writeblock) {
    const wb = (comp as never as { writeBlock?: (t: string) => void }).writeBlock
    if (typeof wb !== "function") throw new Error("this Compositor has no writeBlock (run against the shared checkout working tree)")
    wb.call(comp, MARKERS.map((m) => `${m}\n`).join(""))
    return
  }
  if (v.endrow) {
    const open = (comp as never as { streamCol: number }).streamCol > 0
    comp.writeStream(`${open ? "\n" : ""}${MARKERS.map((m) => `${m}\n`).join("")}`)
    return
  }
  if (v.erase) comp.writeStream("\r\x1b[K")
  if (v.calls === 1) {
    comp.writeStream(lead + MARKERS.map((m) => `${m}\n`).join(""))
  } else {
    comp.writeStream(`${lead}${MARKERS[0]}\n${MARKERS[1]}\n`)
    comp.writeStream(`${MARKERS[2]}\n${MARKERS[3]}\n`)
  }
}

function runPipeline(
  width: number,
  pieces: Piece[],
  la: boolean,
  prefill: number,
  cut: Pick<Cut, "seg" | "idx"> | null,
  v: Variant | null,
  probe?: (c: Compositor, t: FakeTerminal) => void,
): FakeTerminal {
  const term = new FakeTerminal({ cols: width, rows: ROWS, scrollbackLimit: SCROLLBACK, elPreservesWrapPending: STRICT_WRAP })
  const comp = makeCompositor(term)
  comp.mount()
  for (let i = 0; i < prefill; i++) comp.writeStream(`prefill ${i}\n`)
  if (la) comp.setLiveArea(LA_LINES, LA_CURSOR)
  const cutSeg = cut ? cut.seg : -1
  let pre = ""
  for (let j = 0; j < pieces.length; j++) {
    const s = pieces[j]!.text
    if (j === cutSeg) {
      const a = s.slice(0, cut!.idx)
      const b = s.slice(cut!.idx)
      if (a) comp.writeStream(a)
      probe?.(comp, term)
      if (v) inject(comp, v, pre + a)
      if (b) comp.writeStream(b)
    } else comp.writeStream(s)
    pre += s
  }
  if (cut && cutSeg === pieces.length) {
    probe?.(comp, term)
    if (v) inject(comp, v, pre)
  }
  comp.flushStream()
  return term
}

/** All rows (scrollback + screen), trailing spaces trimmed, trailing blank rows removed. */
function rowsOf(term: FakeTerminal): string[] {
  const rows = term.fullText().split("\n").map((r) => r.replace(/\s+$/, ""))
  while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop()
  return rows
}

// ----------------------------------------------------------------------------
// corruption test
// ----------------------------------------------------------------------------
const BIT_BLOCK = 1 // marker rows missing / duplicated / garbled (text glued to them) / not contiguous
const BIT_EXTRA = 2 // lead rows that the golden run does not have (duplicates, raw copies, garbage)
const BIT_LOST = 4 // golden lead rows that are missing
const BIT_ORDER = 16 // same rows, different order
const BIT_INTERLEAVE = 8 // (not corruption) block sits between two rows that are adjacent in the golden render
const BIT_BLANK = 32 // (not corruption) text rows identical to golden, but blank rows differ once the 4 block rows are removed
const CORRUPT = BIT_BLOCK | BIT_EXTRA | BIT_LOST | BIT_ORDER

interface Analysis {
  code: number
  extra: string[]
  lost: string[]
  firstMarker: number
}

function analyze(rows: string[], golden: string[], hasBlock: boolean): Analysis {
  let code = 0
  let rest = rows
  let firstMarker = -1
  if (hasBlock) {
    const hits = MARKERS.map((m) => {
      const h: number[] = []
      rows.forEach((r, i) => {
        if (r.includes(m)) h.push(i)
      })
      return h
    })
    const once = hits.every((h, i) => h.length === 1 && rows[h[0]!]!.trim() === MARKERS[i])
    const contiguous = once && hits.every((h, i) => h[0] === hits[0]![0]! + i)
    if (!once || !contiguous) code |= BIT_BLOCK
    if (once) firstMarker = hits[0]![0]!
    rest = rows.filter((r) => !MARKERS.includes(r.trim()))
  }
  const a = rest.filter((r) => r.trim() !== "")
  const g = golden.filter((r) => r.trim() !== "")
  const extra: string[] = []
  const lost: string[] = []
  if (a.join("\n") !== g.join("\n")) {
    const count = new Map<string, number>()
    for (const r of g) count.set(r, (count.get(r) ?? 0) + 1)
    for (const r of a) {
      const n = count.get(r) ?? 0
      if (n > 0) count.set(r, n - 1)
      else extra.push(r)
    }
    for (const [r, n] of count) for (let i = 0; i < n; i++) lost.push(r)
    if (extra.length > 0) code |= BIT_EXTRA
    if (lost.length > 0) code |= BIT_LOST
    if (extra.length === 0 && lost.length === 0) code |= BIT_ORDER
  }
  if (hasBlock && (code & CORRUPT) === 0) {
    const trim = (xs: string[]) => {
      let a = 0
      let b = xs.length
      while (a < b && xs[a] === "") a++
      while (b > a && xs[b - 1] === "") b--
      return xs.slice(a, b)
    }
    if (trim(rest).join("\n") !== trim(golden).join("\n")) code |= BIT_BLANK
  }
  if (hasBlock && firstMarker >= 0 && (code & CORRUPT) === 0) {
    const above = rows[firstMarker - 1]
    const below = rows[firstMarker + MARKERS.length]
    if (above && below && above.trim() !== "" && below.trim() !== "") {
      for (let i = 0; i + 1 < golden.length; i++) {
        if (golden[i] === above && golden[i + 1] === below) {
          code |= BIT_INTERLEAVE
          break
        }
      }
    }
  }
  return { code, extra, lost, firstMarker }
}

/** blank rows directly above / below the block; below = -1 when nothing follows it. */
function blankAround(rows: string[], firstMarker: number): { above: number; below: number } {
  if (firstMarker < 0) return { above: -1, below: -1 }
  let above = 0
  for (let i = firstMarker - 1; i >= 0 && rows[i] === ""; i--) above++
  let below = 0
  let j = firstMarker + MARKERS.length
  while (j < rows.length && rows[j] === "") {
    below++
    j++
  }
  return { above, below: j >= rows.length ? -1 : below }
}

// ----------------------------------------------------------------------------
// phase 2: one unit (scenario x width)
// ----------------------------------------------------------------------------
interface LaResult {
  goldenRows: string[]
  /** compositor.streamCol at the cut */
  sc: number[]
  /** compositor.consecutiveNewlines at the cut */
  cn: number[]
  /** FakeTerminal cursor col at the cut (only meaningful without a live area) */
  cur: number[]
  /** 1 when the row under the cursor holds text at/after the cursor (stale raw echo) (no live area only) */
  dirty: number[]
  /** display width of the lead's partial row at the cut (from the bytes written so far); added for P5b */
  rw: number[]
  /** 1 when the bytes so far contain a CSI that the writer cannot model (cursor-up etc.); added for P5b */
  unk: number[]
  /** 1 when the open row starts with the clip ellipsis (mdstream shows `…` + the tail of a row wider than the terminal); added for P8 */
  ell: number[]
  codes: Record<string, number[]>
  /** blank rows above / below the block, for the one-call variants */
  blank: Record<string, { a: number[]; b: number[] }>
}
interface UnitResult {
  scenario: string
  width: number
  sink: string
  prefill: number
  stride: number
  nChunks: number
  N: number
  nCuts: number
  nAllCuts: number
  cuts: { k: number; seg: number; idx: number; lo: number; hi: number; boundary: boolean; cr: boolean }[]
  fence: number[]
  table: number[]
  la: Record<"0" | "1", LaResult>
}

function loadRec(name: string, width: number): Recording {
  return JSON.parse(readFileSync(recPath(name, width), "utf8")) as Recording
}

/** The bytes the lead has written before `cut` (what a writer in the compositor's process has seen). */
function preAt(pieces: Piece[], cut: Pick<Cut, "seg" | "idx">): string {
  let pre = ""
  for (let j = 0; j < pieces.length && j < cut.seg; j++) pre += pieces[j]!.text
  if (cut.seg < pieces.length) pre += pieces[cut.seg]!.text.slice(0, cut.idx)
  return pre
}

function cmdUnit(args: string[]) {
  const [name, wStr, ...rest] = args
  const width = Number(wStr)
  const stride = flagNum(rest, "--stride", 1)
  const sink = flagStr(rest, "--sink", "raw")
  const prefill = flagNum(rest, "--prefill", 0)
  const sc = SCENARIOS.find((s) => s.name === name)!
  const rec = loadRec(name!, width)
  const pieces = pipelinePieces(rec, sc, sink)
  const C = rec.chunks.length
  const all = enumerateCuts(pieces, C)
  const sel = all.filter((c, i) => stride <= 1 || c.boundary || i % stride === 0 || i === all.length - 1)
  const orc = oracles(rec.chunks)
  const out: UnitResult = {
    scenario: name!,
    width,
    sink,
    prefill,
    stride,
    nChunks: C,
    N: all[all.length - 1]!.k,
    nCuts: sel.length,
    nAllCuts: all.length,
    cuts: sel.map((c) => ({ k: c.k, seg: c.seg, idx: c.idx, lo: c.lo, hi: c.hi, boundary: c.boundary, cr: c.cr })),
    fence: sel.map((c) => (orc.fence[c.lo] || orc.fence[c.hi] ? 1 : 0)),
    table: sel.map((c) => (orc.table[c.lo] || orc.table[c.hi] ? 1 : 0)),
    la: { "0": null as never, "1": null as never },
  }
  for (const la of [false, true]) {
    const golden = rowsOf(runPipeline(width, pieces, la, prefill, null, null))
    const L: LaResult = { goldenRows: golden, sc: [], cn: [], cur: [], dirty: [], rw: [], unk: [], ell: [], codes: { control: [] }, blank: {} }
    for (const v of VARIANTS) L.codes[v.id] = []
    for (const v of VARIANTS.filter((x) => x.calls === 1 && !x.erase)) L.blank[v.id] = { a: [], b: [] }
    for (const cut of sel) {
      let st = { sc: -1, cn: -1, cur: -1, dirty: 0 }
      for (const v of VARIANTS) {
        const probe =
          v.id === PRIMARY
            ? (c: Compositor, t: FakeTerminal) => {
                const any = c as never as { streamCol: number; consecutiveNewlines: number }
                const cu = t.cursor()
                const rowText = la ? "" : (t.screen()[cu.row] ?? "")
                st = { sc: any.streamCol, cn: any.consecutiveNewlines, cur: cu.col, dirty: rowText.slice(cu.col).trim() !== "" ? 1 : 0 }
              }
            : undefined
        const term = runPipeline(width, pieces, la, prefill, cut, v, probe)
        const rows = rowsOf(term)
        const an = analyze(rows, golden, true)
        L.codes[v.id]!.push(an.code)
        if (L.blank[v.id]) {
          const b = blankAround(rows, an.firstMarker)
          L.blank[v.id]!.a.push(b.above)
          L.blank[v.id]!.b.push(b.below)
        }
      }
      const ctl = runPipeline(width, pieces, la, prefill, cut, null)
      L.codes.control!.push(analyze(rowsOf(ctl), golden, false).code)
      const pr = partialRow(preAt(pieces, cut))
      L.rw.push(displayWidth(pr.row))
      L.unk.push(pr.unknown ? 1 : 0)
      L.ell.push(pr.row.replace(/\x1b\[[\d;]*m/g, "").startsWith("…") ? 1 : 0)
      L.sc.push(st.sc)
      L.cn.push(st.cn)
      L.cur.push(st.cur)
      L.dirty.push(st.dirty)
    }
    out.la[la ? "1" : "0"] = L
  }
  mkdirSync(RES_DIR, { recursive: true })
  writeFileSync(resPath(name!, width, sink, prefill), JSON.stringify(out))
  const bad = (a: number[]) => a.filter((c) => (c & CORRUPT) !== 0).length
  console.log(
    `unit ${name}@${width} [${sink}${prefill ? ` pf${prefill}` : ""}] cuts=${sel.length}/${all.length} N=${out.N}B  D(one-nolead): noLA=${bad(out.la["0"].codes[PRIMARY]!)} LA=${bad(out.la["1"].codes[PRIMARY]!)}  control(no block): ${bad(out.la["0"].codes.control!)}/${bad(out.la["1"].codes.control!)}`,
  )
}

async function cmdSweep(args: string[]) {
  const jobs = flagNum(args, "--jobs", Math.max(1, cpus().length - 1))
  const stride = flagNum(args, "--stride", 1)
  const sink = flagStr(args, "--sink", "raw")
  const prefill = flagNum(args, "--prefill", 0)
  const only = flagStr(args, "--only", "")
  const widths = flagStr(args, "--widths", WIDTHS.join(",")).split(",").map(Number)
  const units: [string, number][] = []
  for (const sc of SCENARIOS) {
    if (only && !only.split(",").includes(sc.name)) continue
    for (const w of widths) units.push([sc.name, w])
  }
  const size = (u: [string, number]) => readFileSync(join(REC_DIR, `${u[0]}@${u[1]}.bin`)).length
  units.sort((a, b) => size(b) - size(a)) // biggest first keeps the pool balanced
  const t0 = performance.now()
  let next = 0
  const worker = async () => {
    while (next < units.length) {
      const [n, w] = units[next++]!
      const p = Bun.spawn(
        [process.execPath, import.meta.path, "unit", n, String(w), "--stride", String(stride), "--sink", sink, "--prefill", String(prefill)],
        { stdout: "pipe", stderr: "inherit" },
      )
      const text = await new Response(p.stdout).text()
      await p.exited
      process.stdout.write(text)
    }
  }
  await Promise.all(Array.from({ length: jobs }, worker))
  console.log(
    `sweep done in ${((performance.now() - t0) / 1000).toFixed(1)} s (${units.length} units, ${jobs} jobs, stride ${stride}, sink ${sink}, prefill ${prefill})`,
  )
}

// ----------------------------------------------------------------------------
// phase 3: aggregate
// ----------------------------------------------------------------------------
interface Metric {
  U: number // offsets in the universe
  D: number // dangerous offsets in the universe
  A: number // allowed offsets
  unsafe: number // allowed AND dangerous
  ugly: number // allowed AND (not corrupt) AND block splits two adjacent lead rows
  cosm: number // allowed AND (not corrupt) AND blank rows differ from golden
  safe: boolean
  cov: number
  gapB: number
  gapC: number
  waitB: number
  waitC: number
}

type PolicyId = "P0" | "P1" | "P1b" | "P2" | "P3" | "P4" | "P5" | "P5b" | "P6" | "P7" | "P8" | "P9" | "P10"
const POLICIES: PolicyId[] = ["P0", "P1", "P1b", "P2", "P3", "P4", "P5", "P5b", "P6", "P7", "P8", "P9", "P10"]

function metric(
  idxs: number[],
  allowed: (i: number) => boolean,
  codes: number[],
  k: number[],
  consumed: number[],
  N: number,
  C: number,
): Metric {
  const A = idxs.filter(allowed)
  const bad = (i: number) => (codes[i]! & CORRUPT) !== 0
  const ugly = (i: number) => (codes[i]! & CORRUPT) === 0 && (codes[i]! & BIT_INTERLEAVE) !== 0
  // longest gap between consecutive allowed offsets; stream start and stream end are anchors
  let gapB = 0
  let gapC = 0
  let prevK = 0
  let prevC = 0
  for (const i of A) {
    gapB = Math.max(gapB, k[i]! - prevK)
    gapC = Math.max(gapC, consumed[i]! - prevC)
    prevK = k[i]!
    prevC = consumed[i]!
  }
  gapB = Math.max(gapB, N - prevK)
  gapC = Math.max(gapC, C - prevC)
  // mean wait of a block that becomes ready at a uniformly random offset of the universe
  const aset = new Set(A)
  let wb = 0
  let wc = 0
  let nxt = -1
  const waits: [number, number][] = new Array(idxs.length)
  for (let t = idxs.length - 1; t >= 0; t--) {
    if (aset.has(idxs[t]!)) nxt = idxs[t]!
    const i = idxs[t]!
    waits[t] = nxt >= 0 ? [k[nxt]! - k[i]!, consumed[nxt]! - consumed[i]!] : [N - k[i]!, C - consumed[i]!]
  }
  for (const [b, c] of waits) {
    wb += b
    wc += c
  }
  return {
    U: idxs.length,
    D: idxs.filter(bad).length,
    A: A.length,
    unsafe: A.filter(bad).length,
    ugly: A.filter(ugly).length,
    cosm: A.filter((i) => (codes[i]! & CORRUPT) === 0 && (codes[i]! & BIT_BLANK) !== 0).length,
    safe: A.every((i) => !bad(i)),
    cov: A.length / Math.max(1, idxs.length),
    gapB,
    gapC,
    waitB: wb / Math.max(1, idxs.length),
    waitC: wc / Math.max(1, idxs.length),
  }
}

interface Row {
  scenario: string
  width: number
  la: 0 | 1
  universe: "all" | "boundary"
  variant: string
  m: Record<PolicyId, Metric>
}

function loadUnits(sink: string, prefill: number): UnitResult[] {
  const out: UnitResult[] = []
  for (const sc of SCENARIOS)
    for (const w of WIDTHS) {
      const p = resPath(sc.name, w, sink, prefill)
      if (existsSync(p)) out.push(JSON.parse(readFileSync(p, "utf8")) as UnitResult)
    }
  return out
}

function computeRows(units: UnitResult[]): Row[] {
  const rows: Row[] = []
  for (const u of units) {
    const k = u.cuts.map((c) => c.k)
    const consumed = u.cuts.map((c) => c.hi)
    const n = u.cuts.length
    for (const la of ["0", "1"] as const) {
      const L = u.la[la]
      for (const universe of ["all", "boundary"] as const) {
        const idxs: number[] = []
        for (let i = 0; i < n; i++) if (universe === "all" || u.cuts[i]!.boundary) idxs.push(i)
        for (const v of VARIANTS) {
          const codes = L.codes[v.id]!
          const sc0 = (i: number) => L.sc[i] === 0
          // P5b: clear-block-restore is allowed when the partial row did not wrap (it fits in one physical row)
          // or a CR is pending (the row is about to be rewritten, nothing to restore), and the writer can model every byte.
          const p8 = (i: number) => !L.unk?.[i] && !!L.ell?.[i] && (L.rw?.[i] ?? 0) === u.width
          const p5b = (i: number) => !L.unk?.[i] && (u.cuts[i]!.cr || (L.rw?.[i] ?? 1e9) < u.width)
          const p1b = (i: number) => sc0(i) && !u.cuts[i]!.cr
          const p2 = (i: number) => sc0(i) && !u.fence[i] && !u.table[i]
          const last = n - 1
          const mk = (f: (i: number) => boolean) => metric(idxs, f, codes, k, consumed, u.N, u.nChunks)
          rows.push({
            scenario: u.scenario,
            width: u.width,
            la: la === "1" ? 1 : 0,
            universe,
            variant: v.id,
            m: { P0: mk(() => true), P1: mk(sc0), P1b: mk(p1b), P2: mk(p2), P3: mk((i) => i === last), P4: mk(() => true), P5: mk(() => true), P5b: mk(p5b), P6: mk((i) => p5b(i) && !u.fence[i] && !u.table[i]), P7: mk(() => true),
              // P8: erase-only (variant erase-one) where the open row is a CLIPPED echo; it is the only state in which
              // restore is unsafe (row == width), and there every later chunk rewrites the whole row anyway.
              P8: mk(p8),
              // P9 (the proposal): restore where the row is < width (P5b), erase-only where it is a clipped echo (P8).
              // Its corruption is read from the variant that the write would really use at each cut.
              P10: mk(() => true),
              P9: metric(
                idxs,
                (i) => p5b(i) || p8(i),
                codes.map((c, i) => (p5b(i) ? L.codes["restore-one"]![i]! : p8(i) ? L.codes["erase-one"]![i]! : c)),
                k,
                consumed,
                u.N,
                u.nChunks,
              ) },
          })
        }
      }
    }
  }
  return rows
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`

function cell(m: Metric, gap = true): string {
  const s = m.safe ? "ok" : `**X${m.unsafe}**`
  return `${m.A} ${pct(m.cov)} ${s}${m.ugly ? ` u${m.ugly}` : ""}${gap ? ` ${m.gapB}B/${m.gapC}c` : ""}`
}

function mainTable(rows: Row[], universe: "all" | "boundary", variant: string): string[] {
  const out: string[] = []
  out.push("| scenario | w | LA | offs | D | P1 allowed cov safe [ugly] gapB/gapC | P1b | P2 | P3 gap |")
  out.push("|---|---|---|---|---|---|---|---|---|")
  for (const r of rows.filter((x) => x.universe === universe && x.variant === variant)) {
    const { P0, P1, P1b, P2, P3 } = r.m
    out.push(
      `| ${r.scenario} | ${r.width} | ${r.la ? "on" : "off"} | ${P0.U} | ${P0.D} | ${cell(P1)} | ${cell(P1b, false)} | ${cell(P2)} | ${P3.gapB}B/${P3.gapC}c${P3.safe ? "" : " **X**"} |`,
    )
  }
  return out
}

function variantTable(rows: Row[], universe: "all" | "boundary"): string[] {
  const out: string[] = []
  out.push("| variant | combos | sum D | P1 UNSAFE combos | P1b | P2 | P3 | P4 (erase then block, allowed everywhere) | P5 (clear, block, restore the row; allowed everywhere) | P5b (same, only when the row did not wrap) | sum P1 ugly | sum P2 ugly |")
  out.push("|---|---|---|---|---|---|---|---|---|---|---|---|")
  for (const v of VARIANTS) {
    const rs = rows.filter((x) => x.universe === universe && x.variant === v.id)
    const sum = (f: (r: Row) => number) => rs.reduce((a, r) => a + f(r), 0)
    const uns = (p: PolicyId) => rs.filter((r) => !r.m[p].safe).length
    out.push(
      `| ${v.id} | ${rs.length} | ${sum((r) => r.m.P0.D)} | ${uns("P1")} | ${uns("P1b")} | ${uns("P2")} | ${uns("P3")} | ${uns("P4")} | ${uns("P5")} | ${uns("P5b")} | ${sum((r) => r.m.P1.ugly)} | ${sum((r) => r.m.P2.ugly)} |`,
    )
  }
  return out
}

function cmdReport(args: string[]) {
  const sink = flagStr(args, "--sink", "raw")
  const prefill = flagNum(args, "--prefill", 0)
  const units = loadUnits(sink, prefill)
  if (units.length === 0) throw new Error("no results; run sweep first")
  const rows = computeRows(units)
  const md: string[] = []
  md.push(`# generated tables (sink=${sink}, prefill=${prefill}, units=${units.length}, stride=${[...new Set(units.map((u) => u.stride))].join(",")})`, "")
  md.push("Legend: cell = `allowed-offsets coverage safe [uN = allowed offsets that split two adjacent lead rows] longest-gap(bytes/input-chunks)`; safe = ok | **X<n>** (n allowed offsets are dangerous).", "")
  for (const universe of ["all", "boundary"] as const) {
    md.push(`## main table, variant one-nolead, universe=${universe}`, "", ...mainTable(rows, universe, PRIMARY), "")
    md.push(`## variants, universe=${universe}`, "", ...variantTable(rows, universe), "")
  }
  md.push("## rollup (variant one-nolead; P4 uses erase-one; P5, P5b, P6 use restore-one; P6 = P5b and not inside an open fence or table; P7 uses endrow-one = Benjamin's writeBlock: LF if the row is open, then the block)", "")
  md.push("| universe | LA | policy | combos | UNSAFE combos | sum unsafe offs | sum ugly offs | mean cov | max gap B | max gap chunks | mean wait B | mean wait chunks |")
  md.push("|---|---|---|---|---|---|---|---|---|---|---|---|")
  for (const universe of ["all", "boundary"] as const)
    for (const la of [0, 1] as const)
      for (const p of POLICIES) {
        const rs = rows.filter((r) => r.universe === universe && r.la === la && r.variant === (p === "P4" ? "erase-one" : p === "P5" || p === "P5b" || p === "P6" ? "restore-one" : p === "P7" ? "endrow-one" : p === "P8" ? "erase-one" : p === "P9" ? "restore-one" : p === "P10" ? "writeblock-one" : PRIMARY))
        const f = (g: (m: Metric) => number) => rs.reduce((a, r) => a + g(r.m[p]), 0)
        md.push(
          `| ${universe} | ${la ? "on" : "off"} | ${p} | ${rs.length} | ${rs.filter((r) => !r.m[p].safe).length} | ${f((m) => m.unsafe)} | ${f((m) => m.ugly)} | ${pct(f((m) => m.cov) / rs.length)} | ${Math.max(...rs.map((r) => r.m[p].gapB))} | ${Math.max(...rs.map((r) => r.m[p].gapC))} | ${(f((m) => m.waitB) / rs.length).toFixed(0)} | ${(f((m) => m.waitC) / rs.length).toFixed(1)} |`,
        )
      }
  md.push("")
  const ctl = rows.filter((r) => r.variant === PRIMARY && r.universe === "all")
  let ctlBad = 0
  for (const u of units) for (const la of ["0", "1"] as const) ctlBad += u.la[la].codes.control!.filter((c) => (c & CORRUPT) !== 0).length
  md.push(`## control: cuts where splitting the stream WITHOUT injecting a block already differs from golden: ${ctlBad} (over ${ctl.length} combos)`, "")

  // where is D ? classification of dangerous offsets of the primary variant
  md.push("## where is D? (variant one-nolead, universe=all). Classes are exclusive.", "")
  md.push("| LA | D | A: streamCol>0 | B: streamCol==0 and last byte is CR | C: streamCol==0, other | D at piece boundaries | D at boundaries with streamCol==0 |")
  md.push("|---|---|---|---|---|---|---|")
  for (const la of ["0", "1"] as const) {
    let d = 0
    let a = 0
    let b = 0
    let c = 0
    let db = 0
    let dbz = 0
    for (const u of units) {
      const L = u.la[la]
      const codes = L.codes[PRIMARY]!
      for (let i = 0; i < u.cuts.length; i++) {
        if ((codes[i]! & CORRUPT) === 0) continue
        d++
        if (L.sc[i]! > 0) a++
        else if (u.cuts[i]!.cr) b++
        else c++
        if (u.cuts[i]!.boundary) {
          db++
          if (L.sc[i] === 0) dbz++
        }
      }
    }
    md.push(`| ${la === "1" ? "on" : "off"} | ${d} | ${a} | ${b} | ${c} | ${db} | ${dbz} |`)
  }
  md.push("")

  // streamCol tracking vs the (fake) terminal cursor, no live area
  let trk = 0
  let trkBad = 0
  for (const u of units) {
    const L = u.la["0"]
    for (let i = 0; i < u.cuts.length; i++) {
      trk++
      if (L.sc[i] !== L.cur[i]) trkBad++
    }
  }
  md.push(`## streamCol vs FakeTerminal cursor col (no live area): ${trkBad} mismatches over ${trk} cuts`, "")

  // streamCol at the very end of the stream (is P3 clean?)
  const endRows = units.map((u) => `${u.scenario}@${u.width}: sc=${u.la["0"].sc[u.cuts.length - 1]} cn=${u.la["0"].cn[u.cuts.length - 1]}`)
  md.push(`## state at the end of every stream (P3 anchor): ${endRows.join("; ")}`, "")

  // blank-line behaviour (item 5): only cuts where the block lands cleanly (streamCol==0, row clean)
  md.push("## blank rows around the block (cuts with streamCol==0 and no CR pending; LA off / LA on)", "")
  md.push("| variant | LA | n | above: 0 | 1 | 2 | 3+ | below: 0 | 1 | 2 | 3+ | n/a |")
  md.push("|---|---|---|---|---|---|---|---|---|---|---|---|")
  for (const v of ["one-nolead", "one-lead"]) {
    for (const la of ["0", "1"] as const) {
      const ha = [0, 0, 0, 0]
      const hb = [0, 0, 0, 0]
      let na = 0
      let n = 0
      for (const u of units) {
        const L = u.la[la]
        const bl = L.blank[v]!
        for (let i = 0; i < u.cuts.length; i++) {
          if (L.sc[i] !== 0 || u.cuts[i]!.cr) continue
          if (((L.codes[v]![i]! as number) & CORRUPT) !== 0) continue
          n++
          ha[Math.min(3, Math.max(0, bl.a[i]!))]!++
          if (bl.b[i]! < 0) na++
          else hb[Math.min(3, bl.b[i]!)]!++
        }
      }
      md.push(`| ${v} | ${la === "1" ? "on" : "off"} | ${n} | ${ha.join(" | ")} | ${hb.join(" | ")} | ${na} |`)
    }
  }
  md.push("")
  const sfx = suffix(sink, prefill)
  writeFileSync(join(RES_DIR, `tables${sfx}.md`), `${md.join("\n")}\n`)
  writeFileSync(join(RES_DIR, `summary${sfx}.json`), JSON.stringify(rows))
  console.log(md.join("\n"))
}

// ----------------------------------------------------------------------------
// dump / find
// ----------------------------------------------------------------------------
function cmdDump(args: string[]) {
  const [name, wStr, laStr, idxStr, variantId = PRIMARY, ...rest] = args
  const sink = flagStr(rest, "--sink", "raw")
  const prefill = flagNum(rest, "--prefill", 0)
  const width = Number(wStr)
  const la = laStr === "1"
  const sc = SCENARIOS.find((s) => s.name === name)!
  const rec = loadRec(name!, width)
  const pieces = pipelinePieces(rec, sc, sink)
  const all = enumerateCuts(pieces, rec.chunks.length)
  const orc = oracles(rec.chunks)
  const cut = all[Number(idxStr)]!
  const v = VARIANTS.find((x) => x.id === variantId) ?? null
  const golden = rowsOf(runPipeline(width, pieces, la, prefill, null, null))
  let st = { sc: -1, cn: -1, cur: -1, dirty: false }
  const term = runPipeline(width, pieces, la, prefill, cut, v, (c, t) => {
    const any = c as never as { streamCol: number; consecutiveNewlines: number }
    const cu = t.cursor()
    st = { sc: any.streamCol, cn: any.consecutiveNewlines, cur: cu.col, dirty: !la && (t.screen()[cu.row] ?? "").slice(cu.col).trim() !== "" }
  })
  const rows = rowsOf(term)
  const an = analyze(rows, golden, true)
  const before = pieces.slice(0, cut.seg).map((p) => p.text).join("") + (pieces[cut.seg]?.text.slice(0, cut.idx) ?? "")
  const after = (pieces[cut.seg]?.text.slice(cut.idx) ?? "") + pieces.slice(cut.seg + 1).map((p) => p.text).join("")
  const lines: string[] = []
  lines.push(`scenario=${name} width=${width} LA=${la ? "on" : "off"} variant=${variantId} sink=${sink}${prefill ? ` prefill=${prefill}` : ""}`)
  lines.push(
    `cut #${idxStr}: byte offset k=${cut.k} of ${all[all.length - 1]!.k}; ${cut.boundary ? "on a write boundary" : `inside write #${cut.seg}`}; input chunks fed=${cut.lo === cut.hi ? cut.lo : `${cut.lo}..${cut.hi}`}/${rec.chunks.length}`,
  )
  lines.push(
    `gate state: streamCol=${st.sc} consecutiveNewlines=${st.cn} termCursorCol=${st.cur}${la ? "" : ` rowTextAtOrAfterCursor=${st.dirty}`} lastByteIsCR=${cut.cr} fenceOpen=${orc.fence[cut.lo] || orc.fence[cut.hi]} tableOpen=${orc.table[cut.lo] || orc.table[cut.hi]}`,
  )
  lines.push(`output bytes around the cut: ...${vis(before.slice(-70))} ▌BLOCK▐ ${vis(after.slice(0, 70))}...`)
  lines.push(`verdict: code=${an.code} (1=block broken, 2=extra lead rows, 4=lost lead rows, 16=reordered, 8=split-lead-block) corrupt=${(an.code & CORRUPT) !== 0}`)
  if (an.extra.length) lines.push(`  rows present but NOT in golden: ${JSON.stringify(an.extra)}`)
  if (an.lost.length) lines.push(`  golden rows MISSING:           ${JSON.stringify(an.lost)}`)
  lines.push("screen dump (FakeTerminal scrollback+screen, trailing blank rows trimmed):")
  rows.forEach((r, i) => lines.push(`  ${String(i).padStart(2)}| ${r}`))
  if (args.includes("--golden")) {
    lines.push("golden (no block):")
    golden.forEach((r, i) => lines.push(`  ${String(i).padStart(2)}| ${r}`))
  }
  console.log(lines.join("\n"))
}

function cmdFind(args: string[]) {
  const [name, wStr, laStr, cls, ...rest] = args
  const sink = flagStr(rest, "--sink", "raw")
  const prefill = flagNum(rest, "--prefill", 0)
  const u = JSON.parse(readFileSync(resPath(name!, Number(wStr), sink, prefill), "utf8")) as UnitResult
  const L = u.la[laStr === "1" ? "1" : "0"]
  const variant = flagStr(rest, "--variant", PRIMARY)
  const onlyBoundary = rest.includes("--boundary")
  const codes = L.codes[variant]!
  const out: string[] = []
  for (let i = 0; i < u.cuts.length; i++) {
    const c = u.cuts[i]!
    const d = (codes[i]! & CORRUPT) !== 0
    const ok =
      (cls === "D>0" && d && L.sc[i]! > 0) ||
      (cls === "D0cr" && d && L.sc[i] === 0 && c.cr) ||
      (cls === "D0" && d && L.sc[i] === 0 && !c.cr) ||
      (cls === "ugly1" && !d && (codes[i]! & BIT_INTERLEAVE) !== 0 && L.sc[i] === 0) ||
      (cls === "ok0" && !d && L.sc[i] === 0) ||
      (cls === "D" && d) ||
      (cls === "ok" && !d)
    if (ok && (!onlyBoundary || c.boundary)) out.push(`#${i} k=${c.k} seg=${c.seg} idx=${c.idx}${c.boundary ? " B" : ""} sc=${L.sc[i]} code=${codes[i]}`)
  }
  console.log(`${out.length} cuts of class ${cls}${out.length > 12 ? " (first 12)" : ""}\n${out.slice(0, 12).join("\n")}`)
}

// ----------------------------------------------------------------------------
// main
// ----------------------------------------------------------------------------
const [cmd, ...cmdArgs] = process.argv.slice(2)
switch (cmd) {
  case "capture":
    await cmdCapture(cmdArgs)
    break
  case "scan":
    cmdScan()
    break
  case "unit":
    cmdUnit(cmdArgs)
    break
  case "sweep":
    await cmdSweep(cmdArgs)
    break
  case "report":
    cmdReport(cmdArgs)
    break
  case "dump":
    cmdDump(cmdArgs)
    break
  case "find":
    cmdFind(cmdArgs)
    break
  default:
    console.log(
      "usage: gate-sweep.ts capture [scenario] [width] | scan | sweep [--jobs N] [--stride S] [--sink raw|lead] [--prefill P] [--only a,b] [--widths 40,80] | report [--sink raw|lead] [--prefill P] | dump <scenario> <width> <la> <cutIndex> [variant] [--sink raw|lead] [--prefill P] [--golden] | find <scenario> <width> <la> <D>0|D0cr|D0|ugly1|ok0>",
    )
}
