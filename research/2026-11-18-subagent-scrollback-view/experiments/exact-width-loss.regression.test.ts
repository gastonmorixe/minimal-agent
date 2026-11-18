/**
 * Regression test (FAILS today): the production Compositor erases the last glyph of a streamed row that ends
 * EXACTLY at the terminal width when a later write arrives.
 *
 * Mechanism: `updateStreamCol` returns `streamCol == cols` for an exact fill; `eraseLiveSeq` then emits
 * `ESC[<streamCol>C` followed by `ESC[J`. Real terminals clamp CUF at column `cols - 1`, so `ESC[J` erases the
 * glyph in the last column, and the next chunk starts on that cell. The repo's FakeTerminal lets the cursor sit
 * at column == cols, which is why no test sees it. `fake-terminal.clamped.ts` (this folder) clamps like a real one.
 *
 * Run:  cd minimal-agent-cli && bun test ../research/2026-11-18-subagent-scrollback-view/experiments/exact-width-loss.regression.test.ts
 * Expected today: the two "exact width" tests FAIL with the clamped terminal and PASS with the repo's FakeTerminal
 * (the control tests show that the repo's emulator hides the bug). After a fix all pass.
 *
 * @module experiments/exact-width-loss.regression.test
 */
import { describe, expect, it } from "bun:test"

import { FakeTerminal as LenientTerminal } from "../../../minimal-agent-cli/src/test-utils/fake-terminal.ts"
import { Compositor } from "../../../minimal-agent-cli/src/ui/compositor.ts"
import { FakeTerminal as ClampedTerminal } from "./fake-terminal.clamped.ts"

const COLS = 30
const ALPHABET = "abcdefghijklmnopqrstuvwxyz"
const text = (n: number) => Array.from({ length: n }, (_, i) => ALPHABET[i % 26]).join("")

type Term = { feed(s: string | Uint8Array): void; fullText(): string }

function run(term: Term, firstWrite: string, liveArea: boolean, chunks: string[] = ["|NEXT|\n"]): string[] {
  const c = new Compositor({
    output: {
      isTTY: true,
      columns: COLS,
      rows: 30,
      write: (s: string) => {
        term.feed(s)
        return true
      },
    } as never,
  })
  c.mount()
  for (let i = 0; i < 5; i++) c.writeStream(`prefill ${i}\n`)
  if (liveArea) c.setLiveArea(["LA·status", "LA·❯ editor", "LA·footer"], { row: 1, col: 5 })
  c.writeStream(firstWrite)
  for (const ch of chunks) c.writeStream(ch)
  c.flushStream()
  const rows = term.fullText().split("\n").map((r) => r.replace(/\s+$/, ""))
  return rows.slice(5)
}
const joined = (rows: string[]) => rows.filter((r) => /^[a-z|NEXT]/.test(r) || r.includes("|NEXT|")).join("")

describe("exact-width row, clamped CUF (real terminals)", () => {
  it("control: one cell short of the width keeps every glyph", () => {
    const rows = run(new ClampedTerminal({ cols: COLS, rows: 30, scrollbackLimit: 100 }), text(COLS - 1), true)
    expect(joined(rows)).toBe(`${text(COLS - 1)}|NEXT|`)
  })
  it("a row of exactly the width keeps its last glyph, live area on", () => {
    const rows = run(new ClampedTerminal({ cols: COLS, rows: 30, scrollbackLimit: 100 }), text(COLS), true)
    expect(joined(rows)).toBe(`${text(COLS)}|NEXT|`)
  })
  it("a row of exactly the width keeps its last glyph when more text follows in several chunks", () => {
    const rows = run(new ClampedTerminal({ cols: COLS, rows: 30, scrollbackLimit: 100 }), text(COLS), true, ["abc", "def", "\n"])
    expect(joined(rows)).toBe(`${text(COLS)}abcdef`)
  })
  it("two full rows (60 cells) keep every glyph", () => {
    const rows = run(new ClampedTerminal({ cols: COLS, rows: 30, scrollbackLimit: 100 }), text(2 * COLS), true)
    expect(joined(rows)).toBe(`${text(2 * COLS)}|NEXT|`)
  })
})

describe("the repo's FakeTerminal hides the bug (why no existing test fails)", () => {
  it("lenient emulator: the same exact-width run looks fine", () => {
    const rows = run(new LenientTerminal({ cols: COLS, rows: 30, scrollbackLimit: 100 }), text(COLS), true)
    expect(joined(rows)).toBe(`${text(COLS)}|NEXT|`)
  })
})
