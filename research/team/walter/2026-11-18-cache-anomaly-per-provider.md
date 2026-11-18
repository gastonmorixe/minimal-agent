# Cache-anomaly rules per provider: design note

Author: Walter (1ccf094b).
Note on names (10:38): the cache research was written by Marcos (session 9635df5f). "Frank's session" means the session that was studied, 932e6ae3. Earlier versions of this note named Frank as the author by mistake. Date: 2026-11-18. Status: design, no code.
Asked by: Gaston (through Pablo). Related: the report and spec by Marcos (9635df5f), a study of Frank's (932e6ae3) session, in
`research/2026-11-18-session-932e6ae3-cache-anomalies/` (the core cause, `stripStaleThinking`).
Marcos's spec owns the core cause. This note owns the detector.

Code read: plugins main `6fb9e6c` (`ma-cache-plugin`, `ma-llm-anthropic-plugin`,
`ma-llm-openai-plugin`, `ma-llm-ollama-plugin`), core `plugin-api` (`canonical-events.ts`,
`provider-auth.ts` `RunContext`, `provider-plugin.ts`, `types/plugin.ts` capabilities),
core `src/llm/transport/stream-delta.ts`, `src/bus/plugin-events-port.ts`, `src/sdk/target-change.ts`,
cli `src/startup/live-target.ts`.

## 0. Problem in one paragraph

The cache plugin guesses. It reads raw Anthropic bytes through `network:observe`. It has no clock, no
target identity and no server miss reason. It resets on `target.didSwitch`, and only the CLI sends that.
Frank's session shows the result. The plugin printed "prefix likely changed" for a TTL expiry (485 s
gap), and "evicted (TTL expired)" for a miss with a 0.8 s gap. Then it went silent through 11
expensive misses (about 2.14 M tokens written), because it warns once per code. The provider adapter
has all the facts the plugin guesses: TTL, markers, the cache key, and the server's
`diagnostics.cache_miss_reason`.

## 1. Per provider: mechanism, and what the adapter knows

| Provider plugin | Mechanism | Adapter knows | Plugin guesses today |
|---|---|---|---|
| `ma-llm-anthropic-plugin` | Explicit `cache_control` markers, `ttl` 5m or 1h (`capabilities.ts` `CACHING_FULL`: `explicit:true, automatic:false, ttls:["5m","1h"]`; one model has only 5m) | Marker count and TTL (core sets them, `src/agent/cache.ts` `withRollingCacheBreakpoint`). Usage read/write in canonical usage (`plugin-api/llm/anthropic-stream.ts:294`). **The server's miss reason:** the adapter sends the `cache-diagnosis-2026-04-07` beta and `diagnostics.previous_message_id` (`cache-diagnosis.ts`, `adapter.ts:499-548`). The response `message_start.message.diagnostics.cache_miss_reason = {type, cache_missed_input_tokens}` comes back (23 rows of `messages_changed` in Marcos's evidence). **No code parses it today** (grep for `cache_miss_reason` in plugins and core: 0 hits). | Markers and prefix size from the request body. The cause of a miss. The TTL. The target. |
| `ma-llm-openai-plugin` (Responses + Chat) | Automatic prefix caching. Adapter sets `prompt_cache_key` (= session id when unset, `adapter.ts:149`) and an optional `prompt_cache_retention` (`responses/request-body.ts:287`). Caps: `CACHING_AUTO` (`explicit:false, automatic:true`). | Cache key, retention, `input_tokens_details.cached_tokens` (reads only, `responses/response-stream.ts:518`; Chat via `plugin-api/llm/openai-chat.ts`). No write count. Miss reason: **unknown** (I did not check the OpenAI docs; I know of no such field). Minimum prefix: **unknown** in code (not declared). | Nothing. The plugin ignores requests without `cache_control`, so OpenAI is not checked at all. |
| `ma-llm-ollama-plugin` | None reported. Caps say `reportsCacheHits:false`. Ollama keeps a KV cache in the server process (`keep_alive`), but the API reports only `prompt_eval_count`. | Nothing usable. | Nothing (no markers, ignored). Correct. |

Other providers: none are installed as plugins today. Bedrock, Vertex, Gemini and xAI: **unknown**, not read.

Consequence: only Anthropic has enough data for real rules. OpenAI could get one weak rule
("cached_tokens fell to 0 on a growing prompt with the same key, under a guessed TTL"). Ollama gets none.

## 2. Contract options, with costs

Common rule from Gaston: no feature code in core. Each option names its core exceptions.

### (a) Adapter reports normalized cache facts; the cache plugin turns them into diagnostics

Shape (plugin-api, optional fields, no behavior):

```ts
/** plugin-api/src/llm/canonical-events.ts, added to CanonicalUsage. */
cacheMiss?: { reason: string; missedTokens?: number } // provider's own words, e.g. "messages_changed"

/** plugin-api, new type: one per finished request. */
interface CacheFacts {
  provider: string; model: string; credentialId?: string; effort?: string // target identity
  mechanism: "explicit" | "automatic"
  ttlSeconds?: number            // from the markers the adapter sent (300 / 3600)
  markers?: number               // explicit only
  cacheKey?: string              // automatic only (OpenAI prompt_cache_key)
  read: number; write?: number   // write undefined when the provider does not report it
  promptTokens: number           // read + write + uncached
  cacheMiss?: { reason: string; missedTokens?: number }
  requestStartedAt: number; respondedAt: number // epoch ms
}
```

Flow: the adapter fills the new usage field (Anthropic only parses `diagnostics`), and returns its
request facts. Core emits one event `llm.cacheFacts` with `CacheFacts` through the per-run
`pluginEvents` port at a clean `message_stop`, beside `LLM_OUTPUT_DELTA` / `LLM_OUTPUT_END`
(precedent: `src/llm/transport/stream-delta.ts`). The cache plugin subscribes in its manifest `events[]`.

How the adapter hands request facts to core (pick one, both small):
- (a1) a new optional field on the canonical `message_start` event, `cache?: {mechanism, ttlSeconds, markers, cacheKey}`. Core copies it into the payload. **Preferred:** it rides the stream every adapter already produces.
- (a2) an optional `onCacheFacts` callback on `RunContext`. More plumbing in `canonical-send.ts`, no gain.

Costs:
- **Core (exceptions to name):** two optional plugin-api fields (`CanonicalUsage.cacheMiss`, `MessageStartEvent.cache`), one exported channel constant `LLM_CACHE_FACTS = "llm.cacheFacts"`, about 20 lines in the stream assembler to collect and emit once per request. Target identity and timestamps are already in core at send time. No rule logic in core. This is the same exception class as `LLM_OUTPUT_DELTA`.
- **Provider plugins:** Anthropic: parse `diagnostics.cache_miss_reason` in `message_start`, set `cache` on `message_start` (markers and ttl from the outgoing body). About 40 lines and fixtures. OpenAI: set `cache: {mechanism:"automatic", cacheKey}`. About 10 lines. Ollama: nothing.
- **Cache plugin:** a rewrite of `detector.ts` to read `CacheFacts`. `wire-watch.ts`, the gzip/SSE parsing, `start.ts` key logic and `on_target_switch.ts` go away (section 3).
- **TUI, ACP, web:** no change. They already render `cache.anomaly` diagnostics (chip, `diag-notices.ts`, Trace tab). Web gets correct per-session routing for free, because `pluginEvents` is per run. This closes the web `didSwitch` gap without a web change.

### (b) Each provider plugin exports its own rule module

A manifest field (e.g. `cacheRules: "./cache-rules.ts"`), and the cache plugin calls
`rules.judge(history, request, response)`.

Costs:
- **Core:** the loader must resolve a new manifest field and give the cache plugin the module of the provider that served each request. That is a new cross-plugin lookup (a feature in the loader), and the cache plugin needs to know which provider a wire request belongs to (today it does not; it would have to map the URL).
- **Provider plugins:** each writes rules plus tests. The rules still read raw bytes, so each provider re-parses its own wire format a second time (the adapter already parsed it).
- **Cache plugin:** becomes a dispatcher; keeps `network:observe`, keeps the `didSwitch` reset and its web gap.
- **TUI, ACP, web:** no change.
- Verdict: the most code, keeps every current weakness (no clock, no target, web gap). Not recommended.

### (c) The provider emits the diagnostic itself

Costs:
- **Core:** the adapter has no logger at send time (`RunContext` has `debug` and `onUsage` only; `ProviderSetupContext` has registrars, no log). Core must add a diagnostic sink on `RunContext`, routed to the run's session. Small, but it is a new port.
- **Provider plugins:** each holds per-session history state inside the adapter (turn list, last write, timestamps, warn throttling). That is detector code copied into each provider, and state in an adapter that is meant to be per call.
- **Cache plugin:** deleted. Shared rules (TTL gap, streak warnings, wording) are written N times.
- **TUI, ACP, web:** no change if the source stays `cache.anomaly`; else each must learn new sources.
- Verdict: simplest for one provider, wrong for three. Not recommended.

### (d) Zero core: the cache plugin reads the server reason from the bytes it already decodes

Added 10:35 at Pablo's request. `wire-watch.ts` already decodes the response and keeps the `usage`
of `message_start` and `message_delta`. The server's `diagnostics` object is in the same
`message_start.message` (seen in Marcos's evidence: `..."usage":{...},"input_transformations":[],"diagnostics":{"cache_miss_reason":{"type":"messages_changed","cache_missed_input_tokens":155827}}`).
The plugin can read it there, and take timestamps from its own clock (`onRequest` / `onEnd`).

Costs:
- **Core:** none. **Provider plugins:** none. **TUI, ACP, web:** none.
- **Against "each provider decides":** Anthropic wire knowledge stays in the cache plugin. OpenAI needs a second parser there (`input_tokens_details.cached_tokens`, `prompt_cache_key` from the body).
- **TTL:** the plugin must read `cache_control.ttl` from the request body itself (easy, it already walks the body).
- **Target identity:** the plugin still knows only session, model and URL. A credential or effort change is invisible on the wire, so the `didSwitch` reset stays, and the web gap stays (see the evidence check below).

Evidence check (Marcos's `evidence/04-all-sessions-rows.jsonl`, 1880 requests, 25 sessions):

| Case | Server `cache_miss_reason` |
|---|---|
| all requests | none 961, `messages_changed` 904, `previous_message_not_found` 14, `model_changed` 1 |
| model switch inside a session (2 real cases) | `previous_message_not_found` both times, read 0 |
| intact prefix, idle above 300 s (TTL expiry) | none 48, `messages_changed` 11, `previous_message_not_found` 4 |
| credential change | **unknown**: the rows hold no credential field, so no case can be found |

So the server reason does NOT name a TTL expiry (mostly none). The plugin still needs its own clock for
that. After a model switch the server says `previous_message_not_found`, which the plugin could map to
"expected miss" with no reset. Whether it says the same after a credential or effort switch is unknown,
so (d) does not close the web gap on evidence today.

Verdict: (d) is a good **interim** step and needs no approval. It is not the end state, because the
target identity is not on the wire.

### Recommendation

**(a) with (a1).** Facts are per provider; judgment is shared. The adapter states what it knows;
the cache plugin owns the rules. A provider can still add a provider-only rule through data (the
`cacheMiss.reason` string, and `caching` caps it already declares), so a code module per provider
(option b) is not needed now. If it is needed later, it can be added as an optional module on top of (a).

Detector rules on `CacheFacts` (this fixes the 5 problems in Marcos's report, section 3):

| Code | Rule |
|---|---|
| `server_miss` | `cacheMiss` present: print the provider's reason and `missedTokens`. Trusted over guesses. |
| `ttl_expired` (info, not warn) | read 0 after a write, and `requestStartedAt - prev.respondedAt > ttlSeconds`. Expected; say so. |
| `prefix_changed` | read 0 after a write within the TTL, no server reason. Replaces `no_read_after_write`. |
| `markers_ignored_cold`, `below_min_block_size` | unchanged (explicit only). |
| `cache_evicted` | removed. With a clock it is either `ttl_expired` or `prefix_changed`. |
| streak | warn again after 3 misses in a row, with the running count of tokens written. Not once per session. |
| target change | history key = provider + model + credentialId + effort from the payload. No reset event needed. Expected miss after a switch (Marcos's note: `discardThinking` breaks the prefix) is reported as info. |

Turn numbers: a separate monotonic counter (fixes the "turn 4" bug).

## 3. The wire-observer path and the `didSwitch` reset

- Keep both until the Anthropic facts path is on main and has run one day of real sessions with the same or better catches (compare on Marcos's replay: `scripts/04_replay_detector.ts` can feed `CacheFacts` built from the logged bytes).
- While both exist, the facts path wins: when a run has emitted `llm.cacheFacts`, the wire watcher skips requests of that session (one flag per session key). No double warnings.
- Then remove, in one push: `wire-watch.ts`, `snapshotRequest`, `extractUsage`, `on_target_switch.ts`, `resetAllDetectors`, the manifest `network:observe` capability and the `target.didSwitch` subscription of the cache plugin. The CLI keeps sending `target.didSwitch` (other plugins may use it); it stops being a cache concern.
- README "Limits" shrinks to: OpenAI has no write count and no miss reason; Ollama is not checked.

## 4. Rollout (one small push each, PR pre-check before each merge)

0. **plugins, now, no core (option d as interim):** `detector.ts` takes a `CacheFacts`-shaped input;
   `wire-watch.ts` builds it from the bytes (server reason, TTL from the body, timestamps from its own
   clock). New rules from section 2. The later core event feeds the same detector. Started 10:35.
1. **core:** plugin-api optional fields + `LLM_CACHE_FACTS` constant + the emit in the stream assembler, with a unit test that a fake adapter's facts arrive once per clean `message_stop` and never on error or abort. No consumer yet: inert.
2. **plugins, Anthropic adapter:** parse `diagnostics.cache_miss_reason`; set `message_start.cache`. Fixture test from Marcos's evidence (`messages_changed`, 155827).
3. **plugins, cache plugin:** new detector on facts, behind the "facts win" switch; old path stays. Tests: request R2 of Frank's session (485 s → `ttl_expired`), R16 to R26 (`server_miss` with reason, streak re-warn), a switch (no false warning, two sessions isolated).
4. **plugins, OpenAI adapter:** `cache: {mechanism:"automatic", cacheKey}`; cache plugin adds the one automatic rule (read fell to 0 with the same key within the retention). Open: the retention window value (unknown, needs the docs).
5. **plugins, cleanup:** remove the wire path and the reset (section 3), after one day on main.

Steps 1 and 2 touch core and plugins in separate repos, so step 1 must land and be pinned first.

## 5. Open points

- Gaston to confirm the core exception: two optional plugin-api fields, one channel constant, one emit. No rule logic in core.
- OpenAI cache docs (retention values, minimum prefix, any miss field): not read. Marked unknown above.
- Marcos's spec may add a second breakpoint (his suggestion 1). Then `markers` is 2 per request; the rules above do not depend on the count.
- Whether `ttl_expired` should show at all in the TUI, or only in the web Trace tab. Proposal: info severity, so the TUI chip filters it.
