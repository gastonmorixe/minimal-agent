# 21 — `LiveAreaScheduler` leaks one timer chain per `refreshOn` event (REPRODUCED)

Author: Daniel (7075489f) · 2026-11-18 · reproduces a suspicion that Erik (652070b6) found by reading
(`research/2026-11-18-mission-control/PLAN.md`, phase 0). The worker I first gave this to (A3) timed
out; I did it myself. Product source was **not edited**.

> **Status update, 10:55: fixed on main.** Erik (652070b6) applied the one-line fix and my 3 regression tests (plus a 4th for events dropped while a tick is in flight): cli commit `152ace3` "fix(cli): keep one live-area slot timer per slot", tests in `src/ui/status/live-area-scheduler.timers.test.ts`. His local cli gate was green (4,535 pass, 0 fail). The experiment scripts below still reproduce the problem when the prototype patch is removed, so they are kept as the "before" evidence.

## Verdict

**Reproduced.** Every `refreshOn` event adds one more self-re-arming timer chain to the slot, and the
chains never go away until `stop()` (and `stop()` clears only the newest). Events that arrive while a
tick is in flight (and are "dropped") add a chain too. A one-line fix removes all of it.

## The code

`minimal-agent-cli/src/ui/status/live-area-scheduler.ts` (line numbers as of ac51c8c):

```
:356   bus.on(evt, () => { …; this.fire(s) })                 // refreshOn event -> fire
:400   private fire(s) {
:402     if (s.inFlight) { this.scheduleNext(s); return }     // "dropped" event still arms a timer
:510     this.repaint(); this.scheduleNext(s)                 // every settle arms a timer
:570   private scheduleNext(s) {
:573     s.timer = this.setT(() => { s.timer = null; this.fire(s) }, refreshMs)   // overwrites s.timer, never clears
:378   stop(): if (s.timer) this.clearT(s.timer)              // clears only the newest timer
```

The periodic timer is pending when the event arrives. `fire` runs, settles, and `scheduleNext`
overwrites `s.timer`. The old timer is orphaned, fires later, calls `fire`, settles, and arms again.
Two chains now run; each further event adds one.

## Method

Three scripts in `experiments/` (all use the REAL `LiveAreaScheduler` and the REAL `EventBus`):

| Script | What it does |
|--------|--------------|
| `scheduler-timer-leak.ts` | virtual clock (min-heap), scenarios A to E, run as the code is today and with the fix patched onto the prototype at runtime |
| `scheduler-timer-leak.regression.test.ts` | 3 `bun:test` tests using the repo's own `FakeClock` / `makeSlot` / `makeSink`. Fails today, passes with `APPLY_FIX=1`. Can move into `src/ui/status/` unchanged |
| `scheduler-timer-leak.cpu.ts` | REAL timers: N chains, then 6 s of measured process CPU |

The fix is the same in every script: in `scheduleNext`, `if (s.timer) { clearT(s.timer); s.timer = null }`
before arming.

## Results (virtual time; 1 s refresh, 1 slot)

| Scenario | current: pending timers | current: handler runs/s (last 10 s) | fixed: pending | fixed: runs/s |
|----------|------------------------:|------------------------------------:|---------------:|--------------:|
| A control, no `refreshOn`, 60 s | 1 | 1 | 1 | 1 |
| B 100 events @100 ms, then 50 s silence | **101** | **101** | 1 | 1 |
| C slow handler (400 ms), 100 events @50 ms, then 30 s | **100** | 2.2 | 1 | 0.7 |
| D `stop()` after 100 events: pending right after | **100** | 0 afterwards | 0 | 0 |
| E tps-like: 2,400 events @250 ms (10 min of streaming), then 60 s idle | **2,401** | **2,401** | 1 | 1 |

Reading it:

- B: 101 chains after 100 events, still all running 50 s after the last event. Runs per second grow
  with the number of events ever received, and never shrink.
- C: the in-flight branch leaks too (about 87 of the 100 events were "dropped", all 100 still added a
  chain).
- D: after `stop()` the orphans fire once and die (`fire` checks `stopped`), so no handler runs after
  stop. The cost is only the delayed cleanup.
- E: 10 minutes of model streaming leaves 2,401 chains that run **2,401 times per second** until the
  process exits.

Scenario E is not artificial. `ma-tps-plugin` declares `"refreshOn": ["llm.outputDelta","llm.outputEnd"]`
with `refreshMs: 1000` (`ma-tps-plugin/manifest.json`), and the host emits `llm.outputDelta` about every
250 ms while the model streams (`BATCH_MS = 250`, `minimal-agent-core/src/llm/transport/stream-delta.ts:62`).
`ma-quota-status-plugin` declares `refreshOn: ["quota.headersReceived","terminal.resize"]` with
`refreshMs: 300000`. **A resize drag adds one chain per `terminal.resize` event** (coalescing happens
in the editor, not on this bus), and each API response adds one.

## Cost, measured with real timers (`scheduler-timer-leak.cpu.ts`, Bun 1.4.4)

| chains | handler runs/s | CPU (% of one core) | CPU per run |
|-------:|---------------:|--------------------:|------------:|
| 1 (no leak) | 1 | 0.15 | n/a (idle noise) |
| 500 | 501 | 0.49 | 9.8 µs |
| 2,000 | 2,001 | 1.62 | 8.1 µs |
| 2,000, with fix | 1 | 0.13 | n/a |

So the leak is **real but cheap per chain**: about 8 µs of scheduler work per run (ctx build,
`process.env` spread, an `AbortController`, a timeout timer, promise chain, `repaint()` dedup).

I looked at the machine too: two CLI sessions that have run 14 to 16 hours use 6% CPU while their
transcripts are idle (12 s sample), against 0.4% for 42-minute-old sessions. **I did not show that this
is the leak.** At 8 µs per run the leak would need about 7,500 chains to cost 6%, and I cannot read the
chain count of a running process. It is a hypothesis to check, not a finding. The cheap way to check:
a one-line debug counter of `fire()` calls per second in a long-lived session.

## What this means for the follow feature

1. **Do not build the lane ticker on `refreshOn`.** Every lane event would add a chain.
2. The leak does not harm correctness (the handlers are idempotent). It makes output
   **wasteful and unbounded**. For a slot with a slow handler (reading a file, like a fleet probe)
   it multiplies I/O by the number of chains.
3. The fix is one line plus the regression test in `experiments/`. It belongs in the CLI repo and is
   independent of this feature. It also removes an assumption that Erik's `terminal.resize` plan relies on.

## What I did not verify

- That the long-lived real sessions hold many chains (cannot introspect them).
- That any user-visible symptom exists today. There is no crash or wrong output in these runs.
- Behavior on Node (all runs are Bun 1.4.4).
- Whether Bun's real `setTimeout` coalesces equal-delay timers (it did not change the measured CPU).

## Re-run

```sh
cd minimal-agent-cli
bun run ../research/2026-11-18-subagent-scrollback-view/experiments/scheduler-timer-leak.ts
bun test ../research/2026-11-18-subagent-scrollback-view/experiments/scheduler-timer-leak.regression.test.ts          # 3 fail today
APPLY_FIX=1 bun test ../research/2026-11-18-subagent-scrollback-view/experiments/scheduler-timer-leak.regression.test.ts   # 3 pass
bun run ../research/2026-11-18-subagent-scrollback-view/experiments/scheduler-timer-leak.cpu.ts 2000          # real timers
```
