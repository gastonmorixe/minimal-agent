// Spawn driver: run agent.ts, speak raw JSON-RPC over stdio, check stdout purity and cancel.
// Usage: bun run drive.ts            (expects PASS, exit 0)
//        bun run drive.ts --negative (runs a copy of the agent that prints one human line
//                                     to stdout. Expects the purity check to FAIL, exit 0 means
//                                     "the check caught it", exit 1 means the check is blind.)
const NEGATIVE = process.argv.includes("--negative")
let agentPath = `${import.meta.dir}/agent.ts`
if (NEGATIVE) {
  const src = await Bun.file(agentPath).text()
  agentPath = `${import.meta.dir}/.agent-negative.ts`
  await Bun.write(
    agentPath,
    src.replace('console.error("[spike] prompt received")', 'process.stdout.write("HUMAN RESUME HEADER\\n")'),
  )
}
const proc = Bun.spawn(["bun", "run", agentPath], {
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
})

const lines: string[] = []
const reader = proc.stdout.getReader()
const dec = new TextDecoder()
let buf = ""
;(async () => {
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value)
    let i: number
    while ((i = buf.indexOf("\n")) >= 0) {
      lines.push(buf.slice(0, i))
      buf = buf.slice(i + 1)
    }
  }
})()

const send = (m: unknown) => {
  proc.stdin.write(`${JSON.stringify(m)}\n`)
  proc.stdin.flush()
}
const waitFor = async (pred: (o: any) => boolean, ms = 4000) => {
  const t0 = Date.now()
  for (;;) {
    for (const l of lines) {
      let o: any
      try {
        o = JSON.parse(l)
      } catch {
        continue // a stray non-JSON line is counted by the purity check below
      }
      if (pred(o)) return o
    }
    if (Date.now() - t0 > ms) throw new Error("timeout waiting")
    await Bun.sleep(20)
  }
}

send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1, clientCapabilities: {} } })
const init = await waitFor((o) => o.id === 1)
send({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: process.cwd(), mcpServers: [] } })
const sess = await waitFor((o) => o.id === 2)
const sid = sess.result.sessionId

// Turn 1: full run
send({ jsonrpc: "2.0", id: 3, method: "session/prompt", params: { sessionId: sid, prompt: [{ type: "text", text: "hi" }] } })
const r3 = await waitFor((o) => o.id === 3)

// Turn 2: cancel mid-turn
send({ jsonrpc: "2.0", id: 4, method: "session/prompt", params: { sessionId: sid, prompt: [{ type: "text", text: "again" }] } })
await Bun.sleep(200)
send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: sid } })
const r4 = await waitFor((o) => o.id === 4)

proc.stdin.end()
await proc.exited
const err = await new Response(proc.stderr).text()

// Purity: every stdout line must be a JSON-RPC 2.0 message.
const bad = lines.filter((l) => {
  try {
    return JSON.parse(l).jsonrpc !== "2.0"
  } catch {
    return true
  }
})
const chunks = lines
  .map((l) => {
    try {
      return JSON.parse(l)
    } catch {
      return {}
    }
  })
  .filter((o) => o.method === "session/update")

console.log(
  JSON.stringify(
    {
      protocolVersion: init.result.protocolVersion,
      stopReasonTurn1: r3.result?.stopReason,
      stopReasonTurn2: r4.result?.stopReason,
      updateCount: chunks.length,
      stdoutLines: lines.length,
      nonJsonRpcStdoutLines: bad.length,
      stderrHasLogs: err.includes("[spike]"),
      exitCode: proc.exitCode,
    },
    null,
    2,
  ),
)
if (NEGATIVE) {
  await Bun.file(agentPath).delete()
  // The purity check must see the stray line. Exit 0 means "the check caught it".
  process.exit(bad.length > 0 ? 0 : 1)
}
process.exit(bad.length === 0 && r3.result?.stopReason === "end_turn" && r4.result?.stopReason === "cancelled" ? 0 : 1)
