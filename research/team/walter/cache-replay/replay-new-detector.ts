/**
 * Replay the NEW cache-plugin pipeline (branch feat/cache-facts-detector,
 * worktree /tmp/walter-cache) over net-dbg session folders. The clock is the
 * logged time: request start = req-meta timestamp, response end = that plus
 * the last timeline `t`.
 *
 * Usage: bun run replay-new-detector.ts <folder> [<folder> ...]
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import {
  type AnomalyCode,
  type CacheFacts,
  CacheAnomalyDetector,
} from "/tmp/walter-cache/ma-cache-plugin/detector.ts"
import { detectorKeyOf } from "/tmp/walter-cache/ma-cache-plugin/start.ts"
import { createWireWatch } from "/tmp/walter-cache/ma-cache-plugin/wire-watch.ts"

for (const folder of process.argv.slice(2)) {
  const out: { level: string; code: string; msg: string; at: number }[] = []
  let n = 0
  const counts = new Map<AnomalyCode, number>()
  class Rec extends CacheAnomalyDetector {
    override observe(f: CacheFacts): AnomalyCode[] {
      n++
      const c = super.observe(f)
      for (const x of c) counts.set(x, (counts.get(x) ?? 0) + 1)
      return c
    }
  }
  const sink = {
    warn: (_s: string, msg: string, sd?: Readonly<Record<string, unknown>>) =>
      out.push({ level: "WARN", code: String(sd?.code), msg, at: n }),
    info: (_s: string, msg: string, sd?: Readonly<Record<string, unknown>>) =>
      out.push({ level: "info", code: String(sd?.code), msg, at: n }),
  }
  // One history per session, model and origin, as in start.ts.
  const byKey = new Map<string, Rec>()
  let clock = 0
  const w = createWireWatch(
    (req, snap) => {
      const k = detectorKeyOf(req, snap)
      let d = byKey.get(k)
      if (!d) byKey.set(k, (d = new Rec({ sink })))
      return d
    },
    () => 0,
    () => clock,
  )
  const files = readdirSync(folder)
  const attempts = [
    ...new Set(files.map((f) => /attempt-(\d+)-/.exec(f)?.[1]).filter(Boolean) as string[]),
  ].sort()
  for (const a of attempts) {
    const get = (suffix: string) => files.find((f) => f.includes(`attempt-${a}-${suffix}`))
    const metaF = get("01-req-meta")
    const resF = get("03-res-meta")
    const bodyF = get("02-req-body")
    const resBodyF = get("04-res-body")
    if (!metaF || !resF || !bodyF || !resBodyF) continue
    const meta = JSON.parse(readFileSync(join(folder, metaF), "utf8"))
    const resMeta = JSON.parse(readFileSync(join(folder, resF), "utf8"))
    const tl = get("05-res-timeline")
    let endMs = 0
    if (tl) {
      for (const line of readFileSync(join(folder, tl), "utf8").split("\n")) {
        if (!line.trim()) continue
        try {
          endMs = Math.max(endMs, Number(JSON.parse(line).t) || 0)
        } catch {}
      }
    }
    const start = Date.parse(meta.timestamp)
    const req = {
      id: String(meta.requestId),
      method: "POST",
      url: meta.url,
      headers: meta.headers,
      body: readFileSync(join(folder, bodyF), "utf8"),
    }
    clock = start
    w.onRequest?.(req)
    w.onResponse?.(req, { status: resMeta.status, headers: resMeta.headers ?? {} })
    w.onChunk?.(req, new Uint8Array(readFileSync(join(folder, resBodyF))))
    clock = start + endMs
    w.onEnd?.(req)
  }
  const warns = out.filter((o) => o.level === "WARN").length
  console.log(`== ${folder.split("/").pop()?.slice(-36)}  requests=${n} warnings=${warns} infos=${out.length - warns}  codes=${JSON.stringify(Object.fromEntries(counts))}`)
  if (false) console.log(`== ${folder.split("/").pop()}  requests observed=${n}  codes=${JSON.stringify(Object.fromEntries(counts))}`)
  if (!process.env.QUIET) for (const o of out) console.log(`  #${o.at} ${o.level} [${o.code}] ${o.msg}`)
}
