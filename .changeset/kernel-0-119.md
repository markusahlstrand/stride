---
'stride': minor
---

Take 0.119, and write the log line the dashboard reads.

The first-party set goes 0.118 → 0.119 (kernel, contracts, vertical-host, both
adapters), vertical-auth to 0.15.1, both engines a patch, the CLI to 0.34.0 and
dev-issuer to 0.2.1. `.substrat/.docs-pin` follows the kernel to 0.119.0. A caret
pins the minor in this project, so every one of those is a hand edit rather than
something `pnpm update` would have done.

`mountMcp` used to refuse an `MCP-Protocol-Version` newer than its list with a
400, ahead of the resolver — so a current client was turned away on its first
request, never saw the `WWW-Authenticate` challenge, and could not discover how
to sign in at all (substrat#1711). 0.119 exempts the `initialize` handshake,
where nothing has been negotiated yet, and still refuses a pin on any later
request. Driven over HTTP on the booted harness: `initialize` at 2025-11-25 and
2026-06-01 answer 401 rather than 400, `tools/call` at an unnegotiated version is
refused exactly as before, and signed in, `tools/list` returns 54 tools.

The Logs view was empty despite live traffic, and it is the same deploy. The
platform shows the lines a vertical writes about itself — the router knows the
tenant but cannot label a log line it never sees, and a tenant read off an
unverified header would let a forger write onto someone else's dashboard. So
`invocationLog` is what writes them, and stride had never mounted it. It is
registered FIRST, deliberately: Hono composes in registration order, so anything
above it answers unlogged, and that silence renders as no traffic rather than as
a missing mount.

Both readers of the router's assertion now take their trust from one place,
`ROUTER_TRUST`. `nodeFor` has always accepted an unsigned assertion on an
instance holding no secret to check one against; handing the log only
`routerSecret` would have left it writing nothing there, which is the same empty
view this change set out to fix, one layer down.

Not addressed, because it is not this repo's to address: whether a deployed
instance is given a `ROUTER_SECRET` is the platform's call. Also worth an
upstream issue — the kernel's own doc comment promises
`pnpm lint:invocation-log` refuses a vertical that mounts nothing, and no such
check exists; `substrat push --check` passed this repo happily while it wrote no
lines at all.
