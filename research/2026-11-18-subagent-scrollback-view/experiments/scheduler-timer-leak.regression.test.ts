/**
 * Regression test for the LiveAreaScheduler timer-chain growth, written with
 * the repo's OWN fixtures (`FakeClock`, `makeSlot`, `makeSink`) so it can move
 * into `minimal-agent-cli/src/ui/status/` as-is once the fix lands.
 *
 * Today (unfixed) it FAILS: after N `refreshOn` events the clock holds N + 1
 * pending periodic timers. With the one-line fix in `scheduleNext` it passes.
 *
 * Run:  cd minimal-agent-cli && bun test ../research/2026-11-18-subagent-scrollback-view/experiments/scheduler-timer-leak.regression.test.ts
 *
 * @module experiments/scheduler-timer-leak.regression.test
 */

import { describe, expect, it } from "bun:test"

import { EventBus } from "../../../minimal-agent-core/src/host-public/event-bus.ts"
import { LiveAreaScheduler } from "../../../minimal-agent-cli/src/ui/status/live-area-scheduler.ts"
import {
  FakeClock,
  makeSink,
  makeSlot,
} from "../../../minimal-agent-cli/src/ui/status/live-area-scheduler.fixtures.ts"

// APPLY_FIX=1 patches the prototype at runtime with the proposed one-line fix
// (clear the pending timer before arming a new one). The source file is never
// edited. Without it the tests run against the code as it is today.
if (process.env.APPLY_FIX === "1") {
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

function rig(handlerRuns: { n: number }) {
  const clock = new FakeClock()
  const bus = new EventBus(() => {})
  const slot = makeSlot({
    id: "probe",
    refreshMs: 1000,
    invoke: async () => {
      handlerRuns.n++
      return "row"
    },
  })
  slot.definition.refreshOn = ["x.event"]
  const sched = new LiveAreaScheduler([slot], makeSink(), {
    bus,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  })
  return { clock, bus, sched }
}

describe("LiveAreaScheduler: one pending timer per slot", () => {
  it("keeps exactly one pending timer after refreshOn events", async () => {
    const runs = { n: 0 }
    const { clock, bus, sched } = rig(runs)
    sched.start()
    await clock.tick(10)
    expect(clock.pendingCount()).toBe(1)

    for (let i = 0; i < 50; i++) {
      bus.emit("x.event", {})
      await clock.tick(100)
    }
    // 1 periodic timer, no orphaned chains.
    expect(clock.pendingCount()).toBe(1)
    sched.stop()
  })

  it("runs the handler once per second when idle, no matter how many events came before", async () => {
    const runs = { n: 0 }
    const { clock, bus, sched } = rig(runs)
    sched.start()
    await clock.tick(10)
    for (let i = 0; i < 50; i++) {
      bus.emit("x.event", {})
      await clock.tick(100)
    }
    const before = runs.n
    await clock.tick(10_000)
    expect(runs.n - before).toBeLessThanOrEqual(11) // ~10 periodic runs, not 51 chains x 10
    sched.stop()
  })

  it("leaves no pending timer after stop()", async () => {
    const runs = { n: 0 }
    const { clock, bus, sched } = rig(runs)
    sched.start()
    await clock.tick(10)
    for (let i = 0; i < 20; i++) {
      bus.emit("x.event", {})
      await clock.tick(100)
    }
    sched.stop()
    expect(clock.pendingCount()).toBe(0)
  })
})
