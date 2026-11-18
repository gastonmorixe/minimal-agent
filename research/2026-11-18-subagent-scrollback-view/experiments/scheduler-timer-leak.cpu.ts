/**
 * What does one leaked timer chain cost in CPU, with REAL timers?
 *
 * Builds the real scheduler with REAL setTimeout (refreshMs = 1000 ms, the
 * 1 s floor), creates N chains by emitting N `refreshOn` events (each event
 * adds one chain in the current code), then measures process CPU time over a
 * real 6 s window. Reports CPU microseconds per handler run and the % of one
 * core that N chains cost at that rate.
 *
 * The handler is as cheap as the tps slot's (no I/O). The cost measured is
 * the scheduler's own `fire()` work: ctx build (env spread of process.env),
 * AbortController, a timeout timer, promise chain, repaint + dedup.
 *
 * Run:  cd minimal-agent-cli && bun run ../research/2026-11-18-subagent-scrollback-view/experiments/scheduler-timer-leak.cpu.ts [N=2000] [fixed]
 *
 * @module experiments/scheduler-timer-leak.cpu
 */

import { EventBus } from "../../../minimal-agent-core/src/host-public/event-bus.ts"
import { LiveAreaScheduler } from "../../../minimal-agent-cli/src/ui/status/live-area-scheduler.ts"
import {
  makeSink,
  makeSlot,
} from "../../../minimal-agent-cli/src/ui/status/live-area-scheduler.fixtures.ts"

const N = Number(process.argv[2] ?? 2000)
const fixed = process.argv.includes("fixed")

if (fixed) {
  type Internals = { scheduleNext(s: { timer: unknown }): void; clearT(h: unknown): void }
  const proto = LiveAreaScheduler.prototype as unknown as Internals
  const original = proto.scheduleNext
  proto.scheduleNext = function patched(this: Internals, s: { timer: unknown }) {
    if (s.timer) {
      this.clearT(s.timer)
      s.timer = null
    }
    return original.call(this, s)
  }
}

let runs = 0
const bus = new EventBus(() => {})
const slot = makeSlot({
  id: "probe",
  refreshMs: 1000,
  timeoutMs: 800,
  invoke: async () => {
    runs++
    return null // like the tps slot: always null
  },
})
slot.definition.refreshOn = ["x.event"]
const sched = new LiveAreaScheduler([slot], makeSink(), { bus })

sched.start()
await Bun.sleep(50)
// Create N chains: each settled event-driven fire adds one in the current code.
for (let i = 0; i < N; i++) {
  bus.emit("x.event", {})
  // let the bus microtask + the handler's promise chain settle before the next event,
  // so the event is not dropped by the in-flight guard
  for (let k = 0; k < 8; k++) await Promise.resolve()
}
await Bun.sleep(100)

// Align to just after a 1 s boundary so each chain fires about once per window second.
const runsBefore = runs
const cpu0 = process.cpuUsage()
const t0 = performance.now()
await Bun.sleep(6000)
const wallMs = performance.now() - t0
const cpu = process.cpuUsage(cpu0)
const cpuMs = (cpu.user + cpu.system) / 1000
const dRuns = runs - runsBefore

sched.stop()
const perRunUs = dRuns > 0 ? (cpuMs * 1000) / dRuns : 0
console.log(
  JSON.stringify(
    {
      variant: fixed ? "fixed" : "current",
      eventsEmitted: N,
      windowWallMs: Math.round(wallMs),
      handlerRunsInWindow: dRuns,
      runsPerSecond: +(dRuns / (wallMs / 1000)).toFixed(1),
      cpuMsInWindow: +cpuMs.toFixed(1),
      cpuPercentOfOneCore: +((cpuMs / wallMs) * 100).toFixed(2),
      cpuMicrosecondsPerRun: +perRunUs.toFixed(1),
    },
    null,
    2,
  ),
)
process.exit(0)
