# Minimal Agent

An agent that sends a user's request to a model and runs the tools that the model asks for, until the model stops. This glossary names the parts of that loop and the way tool calls are scheduled.

## Language

### Loop

**Run**:
Everything from one user message to the final stop of the agent. A run is made of one or more rounds.
_Avoid_: turn

**Round**:
One model response and the tool calls it asked for.
_Avoid_: turn, step, iteration

**Tool call**:
One use of a tool that the model asked for, from its request to its result.
_Avoid_: tool round

**Admission**:
The checks a tool call must pass before it starts: its input, the active mode and the policy hooks. A call that fails is refused and gets an error result.
_Avoid_: gate

### Tool scheduling

**Batch**:
All the tool calls of one round.

**Wave**:
All the consecutive concurrency-safe tool calls of one batch with no other call between them. Its calls overlap in time, at most the concurrency cap at once.

**Concurrency-safe**:
Describes a tool call that may overlap with other concurrency-safe calls. A tool must opt in, and may decide for each call from its input; the default is not safe.
_Avoid_: parallel-safe

**Serial call**:
A tool call that is not concurrency-safe. It starts only after all earlier calls of its batch have ended, and no later call starts before it ends.
_Avoid_: barrier, exclusive call

**Concurrency cap**:
The largest number of tool calls that run at the same time in a wave.
