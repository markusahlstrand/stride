# Stride

A multi-tenant training app for a gym or physio clinic, built on
[Substrat](https://substrat.net). An **admin** curates a shared library of exercises and
program templates; a **coach** authors their own and works only with the trainees assigned
to them; a **trainee** logs their own sets — and keeps every exercise they have ever
performed, forever.

That last part is the point of the app, and it is a kernel-enforced entity edge rather
than a `WHERE` clause. See [`DESIGN.md`](DESIGN.md) §1.

**A coach is optional.** Train alone: say how often you train, pick how many workouts you
rotate, and the app books them — Mon-A, Wed-B, Fri-A — ready to log. A standing workout is
never "finished".

A coach invites trainees and a trainee invites a coach — hashed identifiers,
accept-required, non-enumerable. And **the trainee decides what each coach sees**: nothing,
just what they prescribe, everything from now on, or everything — as real kernel grants
they can withdraw.

Ships with a default library of **74 exercises** tagged with the equipment each needs, a
per-account record of what you actually have, searchable and filterable by type, and
**recurring schedules** — Mon/Wed/Fri for
a lifting block, "five times a week" for a rehab prescription.

Coach and trainee can talk: one thread per pair, opening when they connect and closing when
the relationship ends. Every screen is addressable — refresh, Back and deep links all work.

## Run it

```sh
pnpm install
pnpm dev          # API on :8871, mobile web on :5173
```

Open http://localhost:5173 and use the **dev principal picker** at the top to switch
between Astrid (admin), Nina and Ola (coaches), Vera and Björn (trainees), and Rutger —
an admin of a *different* gym who exists to be turned away.

> `x-principal` is a dev seam, not a login. It must be replaced with real auth before this
> is exposed to anyone.

## Deploying

```bash
pnpm deploy            # substrat push, from the project's own pinned CLI
pnpm deploy:preview    # a clean-room scope on its own URL
```

`@substrat-run/cli` is a **devDependency**, so these use `node_modules/.bin/substrat` and
need nothing on your `PATH`. A globally linked CLI works too, until a rebuild drops the
execute bit off its `dist/cli.js` and zsh answers `permission denied` — pinning it here
means the project never depends on that.

## The gates

```sh
pnpm test                        # 12 scenario tests, most of them denials
npx @substrat-run/boundary-lint  # the layer rules
pnpm typecheck                   # both packages
```

## Where things are

| | |
|---|---|
| [`DESIGN.md`](DESIGN.md) | why the app is shaped this way, and the approved permission table |
| [`AGENTS.md`](AGENTS.md) | the rules — including the two things you must not break |
| `src/manifest.ts` | permissions, entity edges, and the guard declaration |
| `src/module.ts` | the operations; `logSetOp` is where an exercise is earned |
| `src/catalogue.ts` | the default library — 31 equipment types, 74 exercises |
| `test/scenario.test.ts` | tests 4, 6, 9, 14 and 15 are the load-bearing ones |
| `app/` | Vite + React, mobile-first |
