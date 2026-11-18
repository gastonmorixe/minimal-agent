/**
 * Does the production compositor LOSE a glyph when a streamed row exactly fills the terminal width
 * and the next write arrives? Only the Compositor and plain text: no formatter, no block, no gate.
 *
 *   bun run exact-width-loss.ts <first-write-length> [la:0|1]
 *
 * It writes `len` characters (a..z, repeated) with NO newline, then writes "|NEXT|\n", then unmounts.
 * Run it inside a tty of known width (tmux). If the compositor is right, the capture holds every
 * character of the first write, in order, followed by "|NEXT|".
 */
import { Compositor } from "../../../minimal-agent-cli/src/ui/compositor.ts"

const len = Number(process.argv[2] ?? process.stdout.columns)
const la = (process.argv[3] ?? "1") === "1"
const comp = new Compositor({
  output: {
    isTTY: process.stdout.isTTY,
    get columns() { return process.stdout.columns },
    get rows() { return process.stdout.rows },
    write: (s: string) => process.stdout.write(s),
  } as never,
})
comp.mount()
for (let i = 0; i < 5; i++) comp.writeStream(`prefill ${i}\n`)
if (la) comp.setLiveArea(["LA·status", "LA·❯ editor", "LA·footer"], { row: 1, col: 5 })
const alphabet = "abcdefghijklmnopqrstuvwxyz"
let text = ""
for (let i = 0; i < len; i++) text += alphabet[i % 26]
comp.writeStream(text)          // the row, no newline
comp.writeStream("|NEXT|\n")    // the stream goes on
comp.flushStream()
comp.unmount()
