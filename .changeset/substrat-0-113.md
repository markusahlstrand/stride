---
'stride': minor
---

Upgrade to kernel 0.113, engine-workorder 0.11, engine-invites 0.7 and vertical-auth 0.14.

The repo had sat on 0.87 since the 0.85 upgrade while the platform moved on 26 minors, and
the 0.87 docs had already gone. `^0.87.0` on a pre-1.0 package admits 0.87.x only, so
`pnpm update` could not move the kernel — the version strings had to be rewritten, and the
docs pin follows the kernel it points at.

No module code changes. Typecheck, boundary-lint (now 0.4, with R6–R8) and the scenario
suite pass unchanged, and the real OIDC sign-in round trip was driven over HTTP as six
personas on the new packages: the admin installs the library, a coach and a trainee are
denied with a 403 naming the key, and a malformed body is a 400.

What the platform now does that this vertical does not yet use, each a follow-up of its own:

- `mountPlatformSurface` gained `ownerSeat` and `mintOwnerClaim`. Without them the
  dashboard's owner-seat card answers 501, and after the fifteen-minute first-sign-in window
  a fresh install has no one who can claim it. No local gate can see this.
- `instanceAuthFor` in vertical-auth does what the worker's hand-rolled `substrat:auth`
  parsing and the config DO's session secret do today.
- Errors are RFC 9457 problem+json with `code` and `reason`; the `error` field the harness
  emits and the app reads survives only for a migration window.
- `readTimeline` / `readHistory` replace selecting from `_substrat_outbox`, which gained
  drain-stamp columns.
- `calendarDate` is the contract for a day-valued field such as the agenda's `on`.
