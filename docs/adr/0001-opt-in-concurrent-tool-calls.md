---
status: accepted
---

# Tool calls overlap only when the tool opts in, and results stay in call order

The loop ran the tool calls of one round one after another. A batch of 10 Fetch calls took 151 s, and the slowest call took 34 s. We now run each wave of consecutive concurrency-safe tool calls at the same time, up to the concurrency cap. A tool must opt in. A serial call is a barrier: it starts after all earlier calls end, and no later call starts before it ends. Admission runs one call at a time in call order. Saved records, the next model request and all SDK events stay in call order, so the history, restore and the frozen JSON routes are the same as in a serial run. Only the live REPL ports show a result when its call ends.

## Considered options

- **Concurrent by default, tools opt out.** Rejected. Plugin tools share files, a browser, a screen and stores. The file lock does not stop two writers in one process (`file-lock.ts` same-session branch). An error here is a lost update, and it is hard to find.
- **Start a call while the model still streams.** Rejected for now. The model needed 11 s to write 10 calls, so the gain is small. Retry, salvage and crash repair would need new rules, and chat-style streams give no early signal.
- **SDK events in end order.** Rejected. The JSON and stream-json routes are a frozen contract. End order would change the order of their lines.

## Consequences

- `maxConcurrentToolCalls` with the value `1` gives exactly the serial loop.
- Web, ACP, print mode and sub-agent lanes get no live gain inside a wave, because their events keep call order.
- The one-slot displays (web status line, print mode, lane `inFlight`) stay as they are. A fix needs a new field and is a separate change.
