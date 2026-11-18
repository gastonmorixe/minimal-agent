/**
 * Deterministic reproduction of the suspected timer-chain growth in
 * `LiveAreaScheduler` (minimal-agent-cli/src/ui/status/live-area-scheduler.ts).
 *
 * Suspicion (found by reading): `scheduleNext(s)` assigns `s.timer = setT(...)`
 * and never clears the timer that is still pending. A `refreshOn` bus event
 * calls `fire(s)` while the periodic timer is pending. When that fire settles,
 * `handle()` calls `scheduleNext(s)`, which overwrites `s.timer` and ORPHANS
 * the old timer. The orphan still fires and re-arms itself. So every
 * event-driven fire adds one more self-re-arming chain.
 *
 * Method: the REAL scheduler class and the REAL EventBus, with injected
 * virtual timers (no real waiting). Each scenario runs twice: as the code is
 * today ("current"), and with the one-line fix applied to the class prototype
 * at runtime ("fixed": clear the pending timer before arming a new one). The
 * source file is never edited.
 *
 * Run (from the monorepo root):
 *   cd minimal-agent-cli && bun run ../research/2026-11-18-subagent-scrollback-view/experiments/scheduler-timer-leak.ts
 *
 * @module experiments/scheduler-timer-leak
 */

import { EventBus } from "../../../minimal-agent-core/src/host-public/event-bus.ts"
import { LiveAreaScheduler } from "../../../minimal-agent-cli/src/ui/status/live-area-scheduler.ts"
import {
  makeSink,
  makeSlot,
} from "../../../minimal-agent-cli/src/ui/status/live-area-scheduler.fixtures.ts"

// ---------------------------------------------------------------------------
// Virtual clock: binary min-heap on (when, id). Counts live timers per owner.
// ---------------------------------------------------------------------------

type Owner = "sched" | "handler"
interface VTimer {
  id: number
  when: number
  ms: number
  owner: Owner
  fn: () => void
  state: "live" | "cancelled" | "fired"
}

class VClock {
  now = 0
  private nextId = 1
  private heap: VTimer[] = []
  /** live timer counts: key `${owner}:${ms}` */
  private liveBy = new Map<string, number>()

  private less(a: VTimer, b: VTimer): boolean {
    return a.when < b.when || (a.when === b.when && a.id < b.id)
  }
  private push(t: VTimer): void {
    const h = this.heap
    h.push(t)
    let i = h.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!this.less(h[i]!, h[p]!)) break
      ;[h[i], h[p]] = [h[p]!, h[i]!]
      i = p
    }
  }
  private pop(): VTimer | undefined {
    const h = this.heap
    if (h.length === 0) return undefined
    const top = h[0]!
    const last = h.pop()!
    if (h.length > 0) {
      h[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < h.length && this.less(h[l]!, h[m]!)) m = l
        if (r < h.length && this.less(h[r]!, h[m]!)) m = r
        if (m === i) break
        ;[h[i], h[m]] = [h[m]!, h[i]!]
        i = m
      }
    }
    return top
  }
  private bump(owner: Owner, ms: number, d: number): void {
    const k = `${owner}:${ms}`
    this.liveBy.set(k, (this.liveBy.get(k) ?? 0) + d)
  }
  private make(owner: Owner) {
    return (fn: () => void, ms: number): unknown => {
      const t: VTimer = { id: this.nextId++, when: this.now + ms, ms, owner, fn, state: "live" }
      this.bump(owner, ms, 1)
      this.push(t)
      return t
    }
  }
  schedSet = this.make("sched")
  handlerSet = this.make("handler")
  clear = (h: unknown): void => {
    const t = h as VTimer | null | undefined
    if (!t || t.state !== "live") return
    t.state = "cancelled"
    this.bump(t.owner, t.ms, -1)
  }
  live(owner: Owner, ms: number): number {
    return this.liveBy.get(`${owner}:${ms}`) ?? 0
  }

  private async drain(): Promise<void> {
    for (let i = 0; i < 16; i++) await Promise.resolve()
  }

  async advance(ms: number): Promise<void> {
    const target = this.now + ms
    await this.drain()
    for (;;) {
      // skip cancelled entries lazily
      while (this.heap.length > 0 && this.heap[0]!.state !== "live") this.pop()
      const next = this.heap[0]
      if (!next || next.when > target) break
      this.pop()
      this.now = next.when
      next.state = "fired"
      this.bump(next.owner, next.ms, -1)
      next.fn()
      await this.drain()
    }
    this.now = target
    await this.drain()
  }
}

// ---------------------------------------------------------------------------
// The one-line fix, applied at runtime to the prototype (never to the file).
// ---------------------------------------------------------------------------

type SchedulerInternals = {
  scheduleNext(s: { timer: unknown }): void
  clearT(h: unknown): void
}
const proto = LiveAreaScheduler.prototype as unknown as SchedulerInternals
const originalScheduleNext = proto.scheduleNext

function applyFix(): void {
  proto.scheduleNext = function patched(this: SchedulerInternals, s: { timer: unknown }) {
    if (s.timer) {
      this.clearT(s.timer)
      s.timer = null
    }
    return originalScheduleNext.call(this, s)
  }
}
function removeFix(): void {
  proto.scheduleNext = originalScheduleNext
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const REFRESH_MS = 1000
const TIMEOUT_MS = 5000
const EVENT = "x.event"

interface Rig {
  clock: VClock
  bus: EventBus
  sched: LiveAreaScheduler
  invocations: number[] // virtual ms of each handler start
}

function makeRig(opts: { withRefreshOn: boolean; handlerMs: number }): Rig {
  const clock = new VClock()
  const bus = new EventBus(() => {})
  const invocations: number[] = []
  const slot = makeSlot({
    id: "probe",
    refreshMs: REFRESH_MS,
    timeoutMs: TIMEOUT_MS,
    invoke: () => {
      invocations.push(clock.now)
      if (opts.handlerMs <= 0) return Promise.resolve("row")
      return new Promise<string>((resolve) => {
        clock.handlerSet(() => resolve("row"), opts.handlerMs)
      })
    },
  })
  if (opts.withRefreshOn) slot.definition.refreshOn = [EVENT]
  const sched = new LiveAreaScheduler([slot], makeSink(), {
    bus,
    setTimeout: clock.schedSet,
    clearTimeout: clock.clear,
  })
  return { clock, bus, sched, invocations }
}

/** Handler invocations whose start lies in (from, to] virtual ms. */
function countIn(r: Rig, from: number, to: number): number {
  let n = 0
  for (const t of r.invocations) if (t > from && t <= to) n++
  return n
}

interface Row {
  scenario: string
  variant: string
  pendingPeriodicAtEnd: number
  invPerSecLast10s: number
  totalInvocations: number
  note?: string
}

async function scenarioA(): Promise<Row> {
  // control: no refreshOn
  const r = makeRig({ withRefreshOn: false, handlerMs: 0 })
  r.sched.start()
  await r.clock.advance(60_000)
  const row: Row = {
    scenario: "A  control, no refreshOn, 60 s",
    variant: "",
    pendingPeriodicAtEnd: r.clock.live("sched", REFRESH_MS),
    invPerSecLast10s: countIn(r, 50_000, 60_000) / 10,
    totalInvocations: r.invocations.length,
  }
  r.sched.stop()
  return row
}

async function scenarioB(events: number, gapMs: number, silenceMs: number, label: string): Promise<Row> {
  const r = makeRig({ withRefreshOn: true, handlerMs: 0 })
  r.sched.start()
  await r.clock.advance(10) // first fire settles
  for (let i = 0; i < events; i++) {
    r.bus.emit(EVENT, {})
    await r.clock.advance(gapMs)
  }
  const afterEvents = r.clock.live("sched", REFRESH_MS)
  await r.clock.advance(silenceMs)
  const end = r.clock.now
  const row: Row = {
    scenario: label,
    variant: "",
    pendingPeriodicAtEnd: r.clock.live("sched", REFRESH_MS),
    invPerSecLast10s: countIn(r, end - 10_000, end) / 10,
    totalInvocations: r.invocations.length,
    note: `pending periodic timers right after the events: ${afterEvents}`,
  }
  r.sched.stop()
  return row
}

async function scenarioC(): Promise<Row> {
  // slow handler (400 ms virtual), events every 50 ms for 5 s: most arrive in flight
  const r = makeRig({ withRefreshOn: true, handlerMs: 400 })
  r.sched.start()
  await r.clock.advance(10)
  for (let i = 0; i < 100; i++) {
    r.bus.emit(EVENT, {})
    await r.clock.advance(50)
  }
  await r.clock.advance(30_000)
  const end = r.clock.now
  const row: Row = {
    scenario: "C  slow handler 400 ms, 100 events @50 ms, then 30 s",
    variant: "",
    pendingPeriodicAtEnd: r.clock.live("sched", REFRESH_MS),
    invPerSecLast10s: countIn(r, end - 10_000, end) / 10,
    totalInvocations: r.invocations.length,
    note: "events that arrive while a tick is in flight take the early-return branch of fire()",
  }
  r.sched.stop()
  return row
}

async function scenarioD(): Promise<Row> {
  // stop() after 100 events: what stays pending, does a handler still run?
  const r = makeRig({ withRefreshOn: true, handlerMs: 0 })
  r.sched.start()
  await r.clock.advance(10)
  for (let i = 0; i < 100; i++) {
    r.bus.emit(EVENT, {})
    await r.clock.advance(100)
  }
  const beforeStop = r.invocations.length
  r.sched.stop()
  const pendingAfterStop = r.clock.live("sched", REFRESH_MS)
  await r.clock.advance(10_000)
  const row: Row = {
    scenario: "D  stop() after 100 events",
    variant: "",
    pendingPeriodicAtEnd: r.clock.live("sched", REFRESH_MS),
    invPerSecLast10s: 0,
    totalInvocations: r.invocations.length,
    note: `pending right after stop(): ${pendingAfterStop}; handler runs after stop(): ${r.invocations.length - beforeStop}`,
  }
  return row
}

async function scenarioE(): Promise<Row & { wallMsPerInvocationUs: number }> {
  // realistic: the tps slot refreshes on `llm.outputDelta`, which the host
  // emits at most every 250 ms while the model streams. 10 minutes of
  // streaming = 2400 events. Then the model is idle for 60 s.
  const r = makeRig({ withRefreshOn: true, handlerMs: 0 })
  r.sched.start()
  await r.clock.advance(10)
  for (let i = 0; i < 2400; i++) {
    r.bus.emit(EVENT, {})
    await r.clock.advance(250)
  }
  const afterStream = r.clock.live("sched", REFRESH_MS)
  const t0 = performance.now()
  const invBefore = r.invocations.length
  await r.clock.advance(60_000)
  const wall = performance.now() - t0
  const end = r.clock.now
  const inv = r.invocations.length - invBefore
  const row = {
    scenario: "E  tps-like: 2400 events @250 ms (10 min streaming), then 60 s idle",
    variant: "",
    pendingPeriodicAtEnd: r.clock.live("sched", REFRESH_MS),
    invPerSecLast10s: countIn(r, end - 10_000, end) / 10,
    totalInvocations: r.invocations.length,
    wallMsPerInvocationUs: inv > 0 ? (wall * 1000) / inv : 0,
    note: `pending periodic timers right after the stream: ${afterStream}`,
  }
  r.sched.stop()
  return row
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

async function runAll(variant: "current" | "fixed"): Promise<Array<Row & { wallMsPerInvocationUs?: number }>> {
  if (variant === "fixed") applyFix()
  else removeFix()
  try {
    const rows = [
      await scenarioA(),
      await scenarioB(100, 100, 50_000, "B  100 events @100 ms (10 s), then 50 s silence"),
      await scenarioC(),
      await scenarioD(),
      await scenarioE(),
    ]
    for (const r of rows) r.variant = variant
    return rows
  } finally {
    removeFix()
  }
}

const current = await runAll("current")
const fixed = await runAll("fixed")

console.log("# LiveAreaScheduler timer-chain probe (virtual time, real scheduler + real EventBus)")
console.log("")
console.log(
  "| scenario | variant | pending periodic timers at end | handler runs per s (last 10 s) | total runs | note |",
)
console.log("|---|---|---:|---:|---:|---|")
for (const rows of [current, fixed]) {
  for (const r of rows) {
    console.log(
      `| ${r.scenario} | ${r.variant} | ${r.pendingPeriodicAtEnd} | ${fmt(r.invPerSecLast10s)} | ${r.totalInvocations} | ${r.note ?? ""} |`,
    )
  }
}
const e = current.at(-1) as Row & { wallMsPerInvocationUs?: number }
console.log("")
console.log(
  `harness cost per handler run in scenario E (current): ${fmt(e.wallMsPerInvocationUs ?? 0)} µs (upper bound: includes virtual-clock and microtask overhead)`,
)
