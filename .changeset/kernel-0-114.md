---
'stride': minor
---

Move to kernel 0.114, and the engines that came with it.

The first-party set goes 0.87 → 0.114 (kernel, contracts, vertical-host, both
adapters), engine-workorder 0.8 → 0.11, engine-invites 0.4 → 0.7, vertical-auth
0.8 → 0.14, boundary-lint 0.1 → 0.4 and the CLI 0.25 → 0.32. Twenty-seven minors
on a pre-1.0 kernel, and nothing in the vertical had to move: typecheck, the
thirty-six scenario tests and the layer rules all hold as written, and the
sign-in round trip, the reads and the two denials that matter were driven over
HTTP against the new build rather than inferred from a green suite.

Two things the upgrade brings that are worth knowing rather than discovering.

`boundary-lint` now enforces R1–R8 where it used to stop at five. The clock rule
is mechanical now — module code reading `new Date()` fails the gate rather than
review — and R7 is new: module code must not catch an engine error outside
`ctx.atomic`. Stride passes both already. R8 (`no SELECT *`) binds engines, not
verticals.

`substrat push --check` is the local gate: the layer rules and the derived
permission surface, with the digest that promotion compares, and no network. It
belongs in CI. Note that `push` has no `--help`; an unknown flag is still a push.

`.substrat/.docs-pin` follows the kernel to 0.114.0.
