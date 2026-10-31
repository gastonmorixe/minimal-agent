// Child: write N bytes to stdout (a pipe), then exit. Mode picks HOW it exits.
// bun run child.ts <bytes> <mode>   mode: exit | exitcode | cb-exit
const bytes = Number(process.argv[2] ?? 1_000_000)
const mode = process.argv[3] ?? "exit"
const line = `${"x".repeat(99)}\n` // 100 bytes per line
const lines = Math.ceil(bytes / 100)
let wrote = 0
const t0 = performance.now()
let lastOk = true
for (let i = 0; i < lines; i++) {
  lastOk = process.stdout.write(line)
  wrote += 100
}
console.error(`[child] wrote ${wrote} bytes in ${(performance.now() - t0).toFixed(1)}ms, last write returned ${lastOk}`)
if (mode === "exit") process.exit(0)
else if (mode === "exitcode") process.exitCode = 0 // natural exit, no process.exit
else if (mode === "cb-exit") process.stdout.write("", () => process.exit(0))
