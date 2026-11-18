/**
 * Which bytes does YOUR terminal send for Ctrl+G, Ctrl+O, Ctrl+T, Ctrl+R, Ctrl+V once the CLI has switched on its
 * keyboard protocol (kitty flag 1, `ESC[>1u`, and xterm modifyOtherKeys, exactly as `EditorController.start` does)?
 * The answer decides how "plugin chords" (spec S7) must be parsed: bare control byte (0x07), or CSI-u (`ESC[103;5u`).
 *
 *   bun run key-probe.ts            # inside the terminal you use for the CLI (not tmux, unless you use tmux)
 *   press: Ctrl+G  Ctrl+O  Ctrl+T  Ctrl+R  Ctrl+V  Ctrl+B  Ctrl+X  Shift+Enter  then  q  to quit
 *
 * Prints every input chunk as a visible string. Restores the terminal on exit. Writes nothing to disk.
 */
const out = process.stdout
const raw = process.stdin
if (!raw.isTTY) { console.error("run this in a terminal (stdin must be a TTY)"); process.exit(2) }
const ENABLE = "\x1b[>1u\x1b[>4;1f\x1b[>4;2m"   // same three as the CLI (input.ts KITTY / XTERM constants)
const DISABLE = "\x1b[<u\x1b[>4f\x1b[>4m"
const names: Record<string, string> = { "\x07": "Ctrl+G", "\x0f": "Ctrl+O", "\x14": "Ctrl+T", "\x12": "Ctrl+R", "\x16": "Ctrl+V", "\x02": "Ctrl+B", "\x18": "Ctrl+X" }
const vis = (s: string) => s.replace(/\x1b/g, "ESC").replace(/[\x00-\x1f\x7f]/g, (c) => `^${String.fromCharCode(c.charCodeAt(0) ^ 0x40)}`)
const kitty = (s: string) => { const m = /^\x1b\[(\d+)(?:;(\d+))?u$/.exec(s); return m ? `kitty CSI-u: code=${m[1]} (${String.fromCharCode(Number(m[1]))}) mods=${m[2] ?? 1}${(Number(m[2] ?? 1) - 1) & 4 ? " ctrl" : ""}` : "" }
const xt = (s: string) => { const m = /^\x1b\[27;(\d+);(\d+)~$/.exec(s); return m ? `xterm modifyOtherKeys: code=${m[2]} mods=${m[1]}` : "" }
raw.setRawMode(true); raw.resume(); raw.setEncoding("utf8")
out.write(ENABLE)
out.write("key-probe: press the keys; q quits\r\n")
const done = () => { out.write(DISABLE); raw.setRawMode(false); process.exit(0) }
process.on("SIGINT", done)
raw.on("data", (chunk: string) => {
  const form = names[chunk] ? `bare byte, ${names[chunk]}` : kitty(chunk) || xt(chunk) || "other"
  out.write(`  ${vis(chunk).padEnd(22)} bytes=[${[...chunk].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join(" ")}]  ${form}\r\n`)
  if (chunk === "q") done()
})
