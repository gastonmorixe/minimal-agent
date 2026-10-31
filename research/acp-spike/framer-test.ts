// Framer abuse test: spawn agent.ts and attack the size guard. Run: bun run framer-test.ts
// Cases:
//   A. one chunk, NO newline, above the limit  -> exactly one -32600, then the agent still answers
//   B. a line above the limit that ends with a newline in a later chunk -> one -32600, next line works
//   C. a normal request split across two chunks -> answered once
//   D. malformed JSON line -> -32700 with id null, agent still alive
const LIMIT = 8 * 1024 * 1024
const proc = Bun.spawn(["bun", "run", `${import.meta.dir}/agent.ts`], { stdin: "pipe", stdout: "pipe", stderr: "ignore" })
const out: any[] = []
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
      try {
        out.push(JSON.parse(buf.slice(0, i)))
      } catch {
        out.push({ __bad: buf.slice(0, i) })
      }
      buf = buf.slice(i + 1)
    }
  }
})()
const raw = (s: string | Uint8Array) => {
  proc.stdin.write(s)
  proc.stdin.flush()
}
const wait = async (pred: (o: any) => boolean, ms = 5000) => {
  const t0 = Date.now()
  for (;;) {
    const hit = out.find(pred)
    if (hit) return hit
    if (Date.now() - t0 > ms) throw new Error("timeout")
    await Bun.sleep(20)
  }
}
const req = (id: number | string, method: string, params: unknown = {}) =>
  `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`

const results: Record<string, boolean> = {}
let heapBefore = process.memoryUsage().rss

// A. one huge chunk, NO newline. NDJSON semantics: everything up to the next newline belongs to the
// same (oversize) line and is dropped. A request that is sent next on that same line is DROPPED too
// (this is correct, not a bug). Only after a newline ends the line does the stream recover.
raw("x".repeat(LIMIT + 1024))
await wait((o) => o.error?.code === -32600 && o.id === null)
results.A_oversize_error_sent_once_per_line = out.filter((o) => o.error?.code === -32600 && o.id === null).length === 1

// A2. the oversize line is ended by a newline: the whole line is dropped, NOT parsed (no -32700),
// and exactly one oversize error was sent for the whole line
const parseErrorsBefore = out.filter((o) => o.error?.code === -32700).length
raw(`${"y".repeat(100)}\n`)
raw(req(1, "initialize", { protocolVersion: 1, clientCapabilities: {} }))
results.A2_recovered_after_newline = !!(await wait((o) => o.id === 1 && o.result?.protocolVersion === 1))
results.A2_dropped_line_not_parsed = out.filter((o) => o.error?.code === -32700).length === parseErrorsBefore
results.A2_still_one_oversize_error = out.filter((o) => o.error?.code === -32600 && o.id === null).length === 1
raw(req(2, "session/new", { cwd: "/", mcpServers: [] }))
results.A2_session_new_ok = !!(await wait((o) => o.id === 2 && o.result?.sessionId))

// B. oversize line spread over two chunks, newline in the second
raw("z".repeat(LIMIT))
raw(`${"z".repeat(10)}\n`)
raw(req(3, "initialize", { protocolVersion: 1, clientCapabilities: {} }))
results.B_two_chunk_oversize_then_ok = !!(await wait((o) => o.id === 3 && o.result))
results.B_second_oversize_error = out.filter((o) => o.error?.code === -32600 && o.id === null).length === 2

// C. normal request split mid-JSON over two chunks
const full = req("c-1", "initialize", { protocolVersion: 1, clientCapabilities: {} })
raw(full.slice(0, 20))
await Bun.sleep(30)
raw(full.slice(20))
results.C_split_request_answered_once =
  !!(await wait((o) => o.id === "c-1")) && out.filter((o) => o.id === "c-1").length === 1
results.C_string_id_echoed_as_string = out.find((o) => o.id === "c-1")?.id === "c-1"

// D. malformed JSON
raw("{not json\n")
results.D_parse_error_id_null = !!(await wait((o) => o.error?.code === -32700 && o.id === null))
raw(req(4, "initialize", { protocolVersion: 1, clientCapabilities: {} }))
results.D_alive_after_parse_error = !!(await wait((o) => o.id === 4 && o.result))

const grewMb = (process.memoryUsage().rss - heapBefore) / 1e6
proc.stdin.end()
await proc.exited
const stray = out.filter((o) => o.__bad !== undefined)
results.no_stray_stdout = stray.length === 0
console.log(JSON.stringify({ results, driverRssGrowthMB: Math.round(grewMb), exit: proc.exitCode }, null, 2))
process.exit(Object.values(results).every(Boolean) ? 0 : 1)
