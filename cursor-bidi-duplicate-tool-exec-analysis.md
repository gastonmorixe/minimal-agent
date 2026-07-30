# Cursor Bidi Duplicate Tool Execution — Wire-Level Analysis

## The Double-Emission Bug

The same tool execution produces **two separate `tool_use_start`/`tool_use_stop` event pairs** because `CursorBidiEnvelopeTranslator.push()` routes the InteractionUpdate's `tool_call_started` and the `exec_server_message` through two independent code paths, each emitting its own tool_use block.

### Frame-by-frame data flow

**Frame 1: InteractionUpdate (field 1) containing ToolCallStartedUpdate (sub-field 2)**

1. `push()` calls `decodeAgentServerExec(frame.payload)` (line 122 of response-stream-bidi.ts)
   - This **only looks for field 2** (exec_server_message). Field 2 is absent → returns `undefined`.

2. Falls through to `handleServerPayload(frame.payload)` (line 130)
   - Calls `extractServerTextEvents(payload)` (agent-run.ts:183)
   - Finds field 1 → interaction_update → sub-field 2 (ToolCallStartedUpdate)
   - Calls `decodeToolCallUpdate(body)` (tool-call-decode.ts:115)
   - Which calls `decodeToolCallMessage` → finds field 15 (MCP oneof) → `decodeMcpArgs`
   - `decodeMcpArgs` reads: field 4 (providerIdentifier), field 5 (toolName), field 2 (map entries)
   - **Note: does NOT read toolCallId** — that comes from outer field 1 of ToolCallStartedUpdate wrapper

3. `handleMcpToolCall(call, "started")` (line 244):
   - Sets `pendingToolInput = call.input`
   - If input is non-empty, calls `emitToolUseStop()` IMMEDIATELY (line 260)
   - Returns `pause: false` — NO pause for tool_use
   - **Tool_use events emitted: tool_use_start(idx=N) + tool_use_input_delta + tool_use_stop(idx=N)**

**Frame 2: ExecServerMessage (field 2) containing mcp_args (field 11)**

4. `push()` calls `decodeAgentServerExec(frame.payload)` (line 122)
   - Finds field 2 → `decodeExecServerMessageBody(body)` → `decodeExecServerMcpArgs(body)`
   - Field 11 found → `decodeMcpArgsBody(inner)`
   - `decodeMcpArgsBody` reads: field 3 (toolCallId), field 4 (providerIdentifier), field 5 (toolName), field 2 (map entries)
   - Returns `DecodedExecMcpArgs` — **a non-null exec result**

5. Shortcut is taken (line 123-127): `emitExecMcpToolUse(execFromField2)`
   - Creates a **NEW** `tool_use_start` with a **NEW index** (this.blockIndex++)
   - Emits `tool_use_input_delta` + `tool_use_stop`
   - Calls `this.finish("tool_use")` which emits `message_stop`
   - **Returns at line 127. `handleServerPayload` is NEVER called for this frame.**

**Result: TWO separate tool_use events for the same underlying Cursor tool call.**

### Root cause

`push()` uses `decodeAgentServerExec` to gate whether the frame is an exec_server_message. When it is, the code takes a shortcut that bypasses `handleServerPayload` entirely. The shortcut emits its own tool_use events via `emitExecMcpToolUse`.

But the InteractionUpdate frame (with the same tool's tool_call_started) already emitted tool_use events via `handleMcpToolCall(call, "started")`.

The translator should either:
- Skip `handleMcpToolCall` for InteractionUpdate tool_call_started/Completed events when an exec_server_message will follow (bridge the two), OR
- Have the exec_server_message path suppress duplicate emission and instead correlate with the already-emitted tool_use by callId

### Field number analysis (InteractionUpdate vs ExecServerMessage)

Both decoders use **identical** field numbers within the MCP args body:

| Purpose | `decodeMcpArgs` (InteractionUpdate) | `decodeMcpArgsBody` (exec_server_message) |
|---|---|---|
| providerIdentifier | field 4 | field 4 |
| toolName | field 5 | field 5 |
| map entries (input) | field 2 | field 2 |
| toolCallId | **NOT read** (from wrapper) | field 3 |

The field numbers are the same. There is no field-number mismatch causing wrong decoding. The duplication is architectural, not a wire-format misinterpretation.

### Exec 0 (MCP path, field 11) — no decode bug

The debug output:
```
field=11 wire=2 str=
minimal-agent-Bash
commandwc -w README.md)
```

This is from the debug logging in `decodeExecServerMcpArgs` (line 197-200). The empty `str=` for field 11 is because field 11 is a nested MCP args message (wire type 2), and `fieldString(f)` returns null for non-string fields (wire type 2 containing a nested message). The subsequent values shown are from different fields (not shown in the snippet due to newline placement in `console.error`).

The actual decode path through `decodeMcpArgsBody` correctly reads:
- `toolCallId` from field 3
- `providerIdentifier` from field 4 → "minimal-agent"
- `toolName` from field 5 → "Bash"
- Map entries from repeated field 2 → `{command: "wc -w README.md", description: "Count words in README.md"}`

Then `mapMcpToolToMaName("minimal-agent", "Bash")` returns "Bash" because providerIdentifier === "minimal-agent".

### Exec 1 (Native exec, field 14 = shell_stream_args) — no decode bug

The raw bytes printed by debug logging as `str=` for field 14 show garbled text (like `"toolu_01WEeD2V36unfajTHtJwLgop"`, `"wc"`, `"B64"`). This is expected: `fieldString(f)` decodes the raw protobuf binary as UTF-8 text, mixing actual string data (`tool_call_id`, `command`) with binary varint/key/wire tags, producing garbage.

The ACTUAL decoder path for field 14 is in `decodeExecServerMessageBody` (line 168-185):
- `NATIVE_EXEC_FIELD_TO_MA_TOOL.get(14)` → "Bash"
- `fieldBytes(f)` → gets the raw ShellStreamArgs protobuf bytes
- `decodeNativeExecInput(14, argsBody)` → reads field 1 as `command`
- The `command` string is correctly extracted from the nested protobuf structure

The "garbage" is only from debug logging; the decode itself is correct.

### exec-mcp.ts decodeExecServerMcpRequest vs exec-server-decode.ts decodeExecServerMcpArgs

There are **two independent decoders** for exec_server_message data that produce different type shapes:

| | `decodeExecServerMcpRequest` (exec-mcp.ts) | `decodeExecServerMcpArgs` (exec-server-decode.ts) |
|---|---|---|
| Used by | `extractServerTextEvents` → `handleServerPayload` | `decodeAgentServerExec` → `push()` shortcut |
| Returns | `CursorMcpExecRequest` | `DecodedExecMcpArgs` |
| Field 1 interpretation | execId (varint) | id (varint) + fallback execId (string) |
| Field 15 | execSessionId | execId |
| Field 11 → | mcpBody (raw) | mcpArgs (decoded via decodeMcpArgsBody) |

Both correctly decode field 11's inner MCP args with the same field numbers (3=toolCallId, 4=providerIdentifier, 5=toolName, 2=map entries). The duplication of decode logic is a maintenance concern but not a correctness issue — both produce equivalent input maps.

### Summary

The bug is an **architectural double-emission**, not a wire-level decoding error:

1. InteractionUpdate's `tool_call_started` triggers `handleMcpToolCall` → emits tool_use events
2. ExecServerMessage's `mcp_args` triggers `emitExecMcpToolUse` → emits ANOTHER set of tool_use events

Both frames represent the same tool execution. The translator should correlate them by toolCallId and suppress the duplicate, rather than treating them as independent tool calls.
