// Parent: spawn child with a PIPE for stdout, read SLOWLY to force back pressure,
// count bytes received. If bytes < expected, process.exit lost data.
// bun run run.ts
const sizes = [10_000, 70_000, 1_000_000, 8_000_000]
const modes = ["exit", "exitcode", "cb-exit"]
const RUNS = 5

async function once(bytes: number, mode: string, slowMs: number) {
  const p = Bun.spawn(["bun", "run", `${import.meta.dir}/child.ts`, String(bytes), mode], {
    stdout: "pipe",
    stderr: "ignore",
  })
  const reader = p.stdout.getReader()
  let got = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    got += value.byteLength
    if (slowMs) await Bun.sleep(slowMs) // slow consumer
  }
  await p.exited
  return got
}

const rows: string[] = []
let anyLoss = false
for (const mode of modes) {
  for (const bytes of sizes) {
    const expected = Math.ceil(bytes / 100) * 100
    for (const slowMs of [0, 5]) {
      let lost = 0
      for (let r = 0; r < RUNS; r++) {
        const got = await once(bytes, mode, slowMs)
        if (got !== expected) lost++
      }
      if (lost) anyLoss = true
      rows.push(`${mode.padEnd(9)} ${String(bytes).padStart(9)}B slow=${slowMs}ms  lossy runs: ${lost}/${RUNS}`)
    }
  }
}
console.log(rows.join("\n"))
console.log(anyLoss ? "RESULT: DATA LOSS SEEN" : "RESULT: no loss in any run")
process.exit(0)
