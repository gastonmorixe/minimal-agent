/**
 * How often does the production compositor lose a glyph in a stream with NO formatter?
 * Streams `total` characters of position-coded text (4-char base-36 tokens, no spaces) in chunks of
 * realistic size, with a live area mounted. Run in a tty (tmux); the capture is then compared with
 * the expected text by `exact-width-rate.py`.
 *   bun run exact-width-rate.ts <total> <seed>
 */
import { Compositor } from "../../../minimal-agent-cli/src/ui/compositor.ts"

const total = Number(process.argv[2] ?? 3000)
let seed = Number(process.argv[3] ?? 1)
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
// chunk sizes like real text_delta: median 12, p95 26
const sizes = [12, 7, 26, 3, 15, 9, 20, 5, 12, 31, 8, 12, 17, 4, 12]
let text = ""
for (let i = 0; text.length < total; i++) text += i.toString(36).padStart(4, "0")
text = text.slice(0, total)

const comp = new Compositor({
  output: { isTTY: process.stdout.isTTY, get columns() { return process.stdout.columns }, get rows() { return process.stdout.rows }, write: (s: string) => process.stdout.write(s) } as never,
})
comp.mount()
for (let i = 0; i < 5; i++) comp.writeStream(`prefill ${i}\n`)
comp.setLiveArea(["LA·status", "LA·❯ editor", "LA·footer"], { row: 1, col: 5 })
let at = 0
let n = 0
while (at < text.length) {
  const size = sizes[(n++ + Math.floor(rnd() * 3)) % sizes.length]!
  comp.writeStream(text.slice(at, at + size))
  at += size
}
comp.writeStream("\n")
comp.flushStream()
comp.unmount()
require("node:fs").writeFileSync(`/tmp/rate-expected-${process.argv[4] ?? "x"}.txt`, text)
