/**
 * Does the compositor lose the last glyph of a row that EXACTLY fills the terminal width?
 * No formatter: raw text, then a live-area repaint, then more text. Run inside a tty (tmux).
 *   bun run exact-width-probe.ts <width> <fill>     fill = number of cells of the first row (== width for the edge case)
 */
import { Compositor } from "../../../minimal-agent-cli/src/ui/compositor.ts"
const fill = Number(process.argv[3] ?? process.stdout.columns)
const comp = new Compositor({
  output: { isTTY: process.stdout.isTTY, get columns() { return process.stdout.columns }, get rows() { return process.stdout.rows }, write: (s: string) => process.stdout.write(s) } as never,
})
comp.mount()
for (let i = 0; i < 5; i++) comp.writeStream(`prefill ${i}\n`)
comp.setLiveArea(["LA·status", "LA·❯ editor", "LA·footer"], { row: 1, col: 5 })
comp.writeStream("0123456789".repeat(10).slice(0, fill))        // a raw row of `fill` cells, no newline
if (!process.env.NOREPAINT) comp.setLiveArea(["LA·status (repaint)", "LA·❯ editor", "LA·footer"], { row: 1, col: 5 }) // a live-area repaint (skipped with NOREPAINT=1)
comp.writeStream("<<NEXT>>\n")                                  // the stream continues
comp.flushStream()
comp.unmount()
