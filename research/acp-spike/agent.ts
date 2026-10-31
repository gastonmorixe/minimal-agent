// Spike: hand-rolled ACP v1 agent over stdio. Zero dependencies, Bun built-ins only.
// Rule under test: stdout carries ONLY ACP messages. Logs go to stderr.

type Id = number | string
interface Req { jsonrpc: "2.0"; id: Id; method: string; params?: any }
interface Note { jsonrpc: "2.0"; method: string; params?: any }

const MAX_LINE_BYTES = 8 * 1024 * 1024
const E = { parse: -32700, invalid: -32600, method: -32601, params: -32602, internal: -32603 } as const

// One writer. Single place that touches stdout.
const write = (msg: unknown) => {
  process.stdout.write(`${JSON.stringify(msg)}\n`)
}
const ok = (id: Id, result: unknown) => write({ jsonrpc: "2.0", id, result })
const fail = (id: Id | null, code: number, message: string) =>
  write({ jsonrpc: "2.0", id, error: { code, message } })
const notify = (method: string, params: unknown) => write({ jsonrpc: "2.0", method, params })

const aborts = new Map<string, AbortController>()

const handlers: Record<string, (p: any) => unknown | Promise<unknown>> = {
  initialize: () => ({
    protocolVersion: 1,
    agentCapabilities: { loadSession: false, promptCapabilities: {} },
    agentInfo: { name: "acp-spike", version: "0.0.0" },
    authMethods: [],
  }),
  "session/new": () => {
    const sessionId = `sess_${crypto.randomUUID()}`
    aborts.set(sessionId, new AbortController())
    return { sessionId }
  },
  "session/prompt": async (p) => {
    const ac = aborts.get(p?.sessionId)
    if (!ac) throw Object.assign(new Error("unknown session"), { code: E.params })
    console.error("[spike] prompt received") // stderr only
    for (const word of ["hello", " ", "world"]) {
      if (ac.signal.aborted) return finish(p.sessionId, "cancelled")
      notify("session/update", {
        sessionId: p.sessionId,
        update: { sessionUpdate: "agent_message_chunk", messageId: "msg_1", content: { type: "text", text: word } },
      })
      await Bun.sleep(150)
    }
    return finish(p.sessionId, ac.signal.aborted ? "cancelled" : "end_turn")
  },
}
// A cancelled turn must answer "cancelled" (not an error), then the session accepts a new turn.
const finish = (sessionId: string, stopReason: string) => {
  if (stopReason === "cancelled") aborts.set(sessionId, new AbortController())
  return { stopReason }
}
const notifications: Record<string, (p: any) => void> = {
  "session/cancel": (p) => aborts.get(p?.sessionId)?.abort(),
}

async function dispatch(line: string) {
  let msg: any
  try {
    msg = JSON.parse(line)
  } catch {
    return fail(null, E.parse, "parse error")
  }
  if (msg?.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return msg?.id !== undefined ? fail(msg.id, E.invalid, "invalid request") : undefined
  }
  const isRequest = msg.id !== undefined
  if (!isRequest) return void notifications[msg.method]?.(msg.params)
  const h = handlers[msg.method]
  if (!h) return fail(msg.id, E.method, `method not found: ${msg.method}`)
  try {
    ok(msg.id, await h(msg.params))
  } catch (e: any) {
    fail(msg.id, typeof e?.code === "number" ? e.code : E.internal, String(e?.message ?? e))
  }
}

// console.log would corrupt stdout. Route it to stderr for the whole process.
console.log = (...a: unknown[]) => console.error(...a)

// NDJSON framer: split on "\n", guard line size, never block the read loop on a handler.
// The size guard is bounded PER CHUNK: a client may send one huge chunk with no newline, so the
// check must run before the buffer grows past the limit (review: Emma, 2026-10-31).
let buf = ""
let discarding = false // true while skipping the rest of an oversize line
const dec = new TextDecoder()
for await (const chunk of Bun.stdin.stream()) {
  let text = dec.decode(chunk, { stream: true })
  while (text.length > 0) {
    const nl = text.indexOf("\n")
    const piece = nl >= 0 ? text.slice(0, nl) : text
    if (!discarding) {
      if (buf.length + piece.length > MAX_LINE_BYTES) {
        fail(null, E.invalid, "message too large")
        buf = ""
        discarding = true // drop everything until the next newline
      } else {
        buf += piece
      }
    }
    if (nl < 0) break // no newline yet, wait for the next chunk
    if (!discarding) {
      const line = buf.trim()
      if (line) void dispatch(line)
    }
    buf = ""
    discarding = false
    text = text.slice(nl + 1)
  }
}
