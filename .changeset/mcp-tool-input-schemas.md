---
'stride': minor
---

Let an MCP client fill in the fields a tool actually takes.

Twenty-two of the 54 tools published `{"type":"object","properties":{}}` — no
fields at all — so a client had nothing to send, sent nothing, and the operation's
own `parse` refused the `undefined` it was handed. The tool could not be called at
all, with arguments or without. `stride/get-program`, `stride/log-set`,
`stride/begin`, `stride/messages`, `stride/post-message`, `stride/progress`,
`stride/timeline` and the measurement pair were all in that state, as was the
engine's `workorder/start`.

Nothing was wrong with the schemas themselves: every one of them is a flat
`z.object` that converts cleanly. They simply were not DECLARED. An operation whose
input rides in the path works over HTTP regardless, because `mountOperations` merges
the path params in — which is why every gate in this repo stayed green — but an MCP
call has no path and no query string, so the whole input has to arrive as
`arguments`, and `mcpToolsOf` publishes exactly what `input` says. Each of the
twenty-three now declares the schema its handler already parses, so there is one
statement of what a call takes rather than two.

`stride/log-set` keeps the shape the rule needs: `side` is an optional enum in the
published schema, because only the exercise knows whether it is unilateral, and the
handler is what refuses — *"Ankle dorsiflexion is done one side at a time — say
which: left or right"*. The fields an agent cannot guess now carry a `describe`:
that `reps` is the count in the exercise's own unit (rowing 5000 is 5000 metres),
and that `load` on a bodyweight movement is the ADDED weight only.

Two tests hold it. One is structural: a `{var}` in a path IS an input field by
declaration, so the published schema must name every one of them and mark it
required. The other proves it — every tool invoked against a real seeded scope the
way `mountMcp` invokes it, asserting no call ever comes back with `invalid_type` at
the ROOT, the refusal that means the operation was handed nothing and no argument
could have helped. Both fail if a declaration is dropped again.

Driven over the real endpoint on the booted harness rather than inferred:
`tools/list` shows 54 tools with 13 empty schemas, all of them genuine no-input
reads. `get-program`, `progress`, `timeline`, `measurements`, `add-program-item`,
`add-template-item`, `set-item-sets`, `set-program-slots`, `log-measurement` and
`log-set` all answer; `log-set` without a side on a unilateral exercise refuses with
the sentence above; and a trainee calling `create-trainee` still gets
*permission denied: trainee:manage*.

`STRIDE_DATA_DIR` points the harness at a different world, so a proof like that one
runs against a throwaway scope instead of logging test sets into the `.data` you
have been training in all week.

The regression suite now also sends JSON-RPC `tools/list` and `tools/call` requests
through the mounted MCP endpoint. An enrolled admin follows `whoami` and
`my-programs` to a workout with logged sets, reads its exercise and set details,
and gets progress with the matching quantities and volume. Missing ids and an
incorrect `input` wrapper produce field-level errors; another trainee cannot read
the workout or its training history. The id schemas describe where clients obtain
each id. Arguments are flat: `{ "programId": "…" }` for `stride_get-program` and
`{ "traineeId": "…" }` for `stride_progress`, using the names returned by
`tools/list`.
