# Building on Substrat — agent instructions

This project is a **Substrat vertical**: a multi-tenant business app built on the
Substrat kernel and its engines. This file is the always-on constitution — the rules
that hold no matter what you touch. It is read by every AI tool (Claude Code, Cursor,
opencode); do not duplicate it into tool-specific config.

The full build flow — interview, coverage map, scaffold, run, checkpoints — is a
**playbook**, not always-on context. Invoke it when you start or extend a vertical:

- **Claude Code**: `/substrat`
- **Cursor / opencode**: the `new-vertical` command, or read [`.substrat/playbook.md`](.substrat/playbook.md)

Read the playbook before scaffolding. This file is what a session already mid-build
must never violate.

## The mental model

Three layers. You only own the third.

1. **Kernel — free, always.** Tenancy (one scope = one isolated database; there is no
   cross-tenant API), permissions (roles, grants, and a proof path for every decision),
   events + audit (every mutation emits a kernel-stamped event you cannot mislabel),
   migrations (journaled per module, applied lazily per scope).
2. **Engines — compose or feed.** Headless, own invariants that cannot be violated
   (state machines that can't skip states, append-only entries). You either **compose**
   an engine (import it; its in-scope functions run in *your* transaction) or **feed** it
   (emit a fat event; it consumes — no import). Engines never import each other. Read an
   engine's real surface from `node_modules/@substrat-run/engine-*/dist/index.d.ts` —
   never guess at it.
3. **Your vertical — everything a user touches.** Vocabulary, price list, extra fields,
   roles, screens. If your core noun isn't something an engine already owns, this is most
   of the app — a normal, supported outcome.

## Project layout

The linter and tests expect this shape. `manifest`/`migrations`/`module` are **module
code** (the rules below bind them); `seed`/`server` are **harness** (exempt).

```
src/manifest.ts        moduleManifest.parse({…}) + PERM consts   ← module code
src/migrations.ts      the SqlMigration[]                         ← module code
src/module.ts          imports both; operations + registration    ← module code
src/seed.ts            host, tenants, roles, grants, seed world    ← harness
src/personas.ts        the dev cast: `sub` → the person             ← harness
src/server.ts          thin wrapper, one route per operation       ← harness
test/scenario.test.ts  the scenario — including the denials
```

## The rules (non-negotiable)

**Module code** = everything reachable from a `ModuleRegistration` (operations,
consumers). Rules 1–5 are enforced mechanically by `boundary-lint`.

1. **Data access is `ctx.sql` only.** Never import `better-sqlite3`, an adapter,
   `node:*`, or `cloudflare:workers` in module code. That last one is not a style rule:
   it exports an ambient `env`, so a single import hands module code every binding and
   secret your worker declares — including its own `SCOPE` Durable Object namespace,
   which reaches *another scope's* data. `ctx.sql` is closed over one scope and cannot.
   Capabilities arrive on `ctx`; `DurableObject` is imported in harness code
   (`worker.ts`, `*-do.ts`), never here.
2. **No `fetch` / network in module code.** It would hold the scope's transaction open on
   a third party. The sanctioned path is a **connector**: emit a fat event, register a
   handler that runs outside the transaction. An integration is never impossible because
   of this rule — it has an answer.
3. **Never write `_substrat_*` tables.** Reads are fine (timelines are projections);
   writes forge the audit spine.
4. **Another module's tables are private.** Never `SELECT` from `workorder_*` etc. — use
   the engine's exported in-scope functions. This is the rule with no runtime equivalent:
   the shortcut *works* and silently welds you to an engine's private schema forever. Need
   extra data on an engine entity? Add **your own side table keyed by the engine's id** —
   never a column upstream.
5. **Time comes from `ctx.now()`.** Module code has no other clock — `new Date()` and
   `Date.now()` are banned exactly like `node:*`. It is the same instant for the whole
   operation, so your rows and the events announcing them agree about when. Store it as
   ISO text, never an epoch integer. Because the host injects the clock, a scenario can
   test elapsed time (`manualClock` from `@substrat-run/kernel`) instead of sleeping or
   shrinking the window to zero — the workaround that proves nothing.
6. **Every operation checks a permission first.** `assertAllowed(await ctx.check(PERM))`
   is the first line.
7. **Every mutation emits a fat event** — a consumer must never need a cross-module read.
8. **Never fork an engine.** Extend by composition. If you must fork, the engine drew its
   line wrong — that's design feedback, not a coding problem.
9. **IDs are `ulid()`. Money is strings** via `@substrat-run/contracts` helpers
   (`moneyOf`, `mulMoney`, `addDecimal`, `compareDecimal`) — never floats.
10. **Web-standard APIs always** — `globalThis.crypto`, `TextEncoder`, `URL`. Never
    hand-roll a hash to dodge an import ban.
11. **Parse, don't trust.** Zod at every boundary — but import `z` from
    `@substrat-run/contracts`, **never from `zod`**. Zod schemas don't compose across
    copies or majors; composing a contracts schema into one built from a separate `zod`
    fails at *runtime* (`expected a Zod schema`) with an error pointing nowhere near the
    cause.

## Declare every link edge

`entityRelations` in the manifest must declare every edge you traverse — both your own
(`bike → customer`) and the ones an engine makes on your behalf (`workorder → bike`). The
adapter **rejects** a `ctx.link` for an undeclared edge, so a missing one fails loudly.
This is also what lets a portal permission-walk reach the owner.

## The gates — run them, believe them

```sh
npm test                        # the scenario, including the denials
npx @substrat-run/boundary-lint # the layer rules (1–5)
npm run typecheck
```

`boundary-lint` exits non-zero if it *couldn't do its job* (no module code found, no
engines resolvable) — a pass that checked nothing is worse than no linter. Never wave that
through; fix the setup until it can see your code.

A green scenario test does **not** mean the app works: the test calls operations directly
and never exercises `server.ts`, its routes, or the sign-in round trip. Before calling a
vertical done, boot the server and drive the real flow over HTTP as two personas — one who
should succeed and one who should be denied — and confirm the denial arrives as a denial
(not a generic error).

That is now a real sign-in rather than a header, so it actually proves something: `pnpm dev`
starts the dev issuer beside the API, and a persona is one `GET /api/auth/login` away. This
is exactly how the harness's error envelope was caught downgrading a 403 to a 400 — a bug
the old `x-principal` seam could not surface, because with it you were never signed out.

## Two human checkpoints — you may never self-approve

Present these and stop:

1. **Migration diff** — every new `SqlMigration`, verbatim. Migrations are append-only
   forever once shipped, so this is the last cheap moment to change your mind.
2. **Permission diff** — a table: key → description → which roles hold it → why. Walk the
   reviewer through it in their own vocabulary until they can answer *who can now see the
   money, and who can see other tenants' data?* A permission diff nobody understands is
   theater — it reproduces the exact failure Substrat exists to prevent.

---

# This vertical: `stride`

A multi-tenant training app for a gym / physio clinic. One model covers both:
a rehab exercise is just an exercise measured in seconds with a low target load,
and "3 × 12 at 4 kg" and "5 × 5 at 80 kg" are the same row. Full design and the
reasoning behind every choice: [`spec/concept.md`](spec/concept.md).

## Vocabulary

| Noun | Where it lives |
|---|---|
| **exercise** | `train_exercises` — `shared` (published gym-wide by an admin) or `private` (authored by a coach **or a trainee**; exactly one owner column is set) |
| **template** | `train_templates` + `train_template_items` — a reusable prescription |
| **program** | the ENGINE's work order. `planned → in_progress → completed → closed` |
| **prescription** | `train_program_items` — **snapshot** from a template at assignment, never a reference. `add-program-item` builds one directly (no template), while `planned` or `in_progress` |
| **session** / **set result** | `train_sessions` / `train_set_results` — append-only; a correction is a new row |
| **adherence** | `train_program_summary` — prescribed vs performed, decimal strings only |
| **equipment** | `train_equipment` (vocabulary) · `train_exercise_equipment` (what it needs) · `train_account_equipment` (what a person has). No rows = bodyweight |
| **slot** | `train_program_slots` — `(weekday, time_of_day)`, several per programme. "I train Wednesdays at 11". Different question from an item's rhythm; keyed by the engine's id with **no foreign key** (rule 4) |
| **schedule** | `recur_days` `'1,3,5'` (ISO weekdays) **or** `recur_per_week`, never both, on template and program items |
| **quantity & unit** | a set's `reps` column is the count **in the exercise's own unit** (`reps` / `seconds` / `metres`). Rowing 5000 is 5000 metres — cardio needed no separate table, only a form that says what the field is |
| **cardio extras** | `duration_seconds` and `avg_hr`, optional on **every** set. A 5 km row is a distance *and* a duration; a 90-second plank at 140 bpm is the same shape |
| **prescription shape** | uniform (`target_sets × target_reps @ load` on the item) **or** explicit rows in `train_item_sets` when the sets differ. `target_sets` is kept in step with the list so adherence and the schedule stay right |
| **superset** | `group_key` on the item. Same key **and adjacent** = one superset; a key that reappears later is a second one |
| **onboarding** | `goal` + `days_per_week` on `train_trainees`. Prefills a schedule, never enforces one |
| **conversation** | `train_messages`, one thread per **(trainee, coach) pair** — no thread id, because two people have exactly one conversation. `message:read`/`message:post` are narrowed on the TRAINEE record and ride the sharing relationship |
| **sharing** | `train_sharing` — `none` / `assigned` / `from-now` / `all`. The table is the DECISION; kernel grants are the enforcement. If they disagree, the tuples win |
| **invitation** | `engine-invites`, composed. Hashed identifier, accept-required, non-enumerable. One org per scope, id = `ctx.scopeId` |

The default library a gym starts with is [`src/catalogue.ts`](src/catalogue.ts) — 25
equipment types, 62 exercises. It is **harness**: the seed feeds it through the normal
operations, exactly as an admin would by hand.

## The cast

- **`admin`** — publishes the shared library; manages coaches and trainees; reads
  everything, *including every coach's private exercises* (node-level `exercise:read`).
- **`coach`** — authors their own exercises and templates; works only with the trainees
  assigned to them. Holds almost nothing gym-wide: their reach is one entity-narrowed
  grant on their **own coach record**.
- **`trainee`** — browses the shared catalogue, and **creates their own exercises,
  templates and programs**. Holds `library:author`, `workorder:create`, `workorder:report`
  and `workorder:complete` gym-wide — safe *only* because each is narrowed again (see
  below). Everything personal is entity-narrowed to their own trainee record.

## The five things you must not break

**1. The earned exercise.** In `logSetOp`, performing a set calls
`ctx.link(exercise → trainee)`. That edge IS the permission — "yours forever" is a kernel
walk, never a `WHERE` clause. `ctx.link` has no un-link in module code, so it is literally
permanent; retiring an exercise removes it from the catalogue and **not** from the library
of anyone who performed it. Guarded by tests 6 and 9.

**2. The guard.** `engine-workorder` checks `workorder:report` / `:assign` at NODE level.
Everyone holds those keys gym-wide because there is no narrower binding to hold — they are
safe *only* because `manifest.ts` declares `stride/program-in-reach` before every one of
those operations, and the predicate re-checks `result:log` against the program as an
entity. **Delete the guard and both coach isolation and trainee isolation silently become
fiction.** Guarded by tests 4 and 14.

**3. The second gate on `workorder:create`.** `assign-program` holds a node-level
`workorder:create` check *and then* a narrowed `result:log` check on the target trainee.
The first is a formality everyone passes; the second is the entire reason a trainee cannot
create a program for someone else. If you ever "simplify" that operation down to one
check, every trainee in the gym can write into every other trainee's training. Guarded by
test 14 — which pins the denial to `result:log` specifically, because pinning it to
`/permission denied/` would have stayed green.

**4. Equipment is advice, not a permission.** `stride/exercises` returns `canDo` and
`missing`; the *filtering* happens in the UI. Never make equipment hide a row server-side —
the kernel decides what may be read, a barbell decides what can be lifted, and putting a
second weaker access rule beside the real one is precisely the failure this framework
exists to prevent. Guarded by test 15.

Related, and the reason `equipment:manage` and `share:manage` are safe to hold gym-wide:
`stride/set-my-equipment` and `stride/set-sharing` **take no id saying whose**. If you
ever add one, it needs a narrowed check the same day.

**5. Sharing is grants, and a downgrade must revoke.** There is no `trainee → coach` edge —
it was deleted in rev 6 because it handed a coach a whole history for ever. `setSharingOp`
**revokes everything first, every time**, then grants for the chosen mode: the relationship
key on the trainee record, per-session grants for `from-now`, record-level grants for
`all`. Forgetting one revoke is a silent leak — the per-programme `workorder:read` minted
by `from-now` was exactly that bug, caught by test 15. Two keys, two jobs:
`workorder:read` = this programme exists and prescribes X; `result:read` = what was done.
`getProgramOp` gates on the first and WALKS sessions with the second.

Also: `ctx.grant` delegates and never elevates, so it re-checks that the caller holds the
permission on that entity. A person who just accepted an invitation holds nothing on their
own record — that is why `acceptInviteOp` uses `ctx.requestPlatform` and the harness's
`drainPlatformRequests` mints their role and first grants. Don't "simplify" it back to a
`ctx.grant`; it cannot work.

## Edges (declared in `manifest.ts`; the adapter rejects an undeclared `ctx.link`)

```
exercise ─┬─→ coach              authored by a coach
          └─→ trainee ──→ coach  authored by a trainee, OR earned by performing it
template ─┬─→ coach
          └─→ trainee ──→ coach
workorder ──→ trainee ──→ coach     (the engine links the first hop)
session  ───→ workorder ──→ trainee ──→ coach     depth 3; the evaluator's limit is 4
```

**Authoring and earning are the same edge on purpose** — so "mine" and "what I've done"
are one walk and one grant, and making an exercise also earns it.

Consequence worth knowing before you "fix" it: because `exercise → trainee → coach`
resolves, a coach can read an exercise their own trainee earned from **another** coach.
That is deliberate — inheriting a trainee means inheriting the exercises in their running
program, which would otherwise render as unresolvable ids.

## Two doors, and when each applies

Shared library rows are reached by a **node-level key** (`exercise:read-shared`,
`template:read-shared`); everything else by the **entity walk** (`exercise:read`,
`template:read`). `canReadExercise` / `canReadTemplate` accept either.
`addTemplateItemOp` deliberately asserts the **narrowed key only** — browsing a shared
template is not permission to edit it.

## The tab bar follows the person, not the schema

Three tabs for a trainee — **Today · Workouts · Me** — and four for staff —
**Today · Programmes · Trainees · Me**. Me is last, where a profile always is.

Two things are deliberately NOT tabs:

- **Exercises.** Browsing the catalogue is something you do while building a workout, so
  it is reached from one; what is *yours* is something you own, so it lives on Me
  (`MyLibrary`). The `#/exercises` route still exists and deep links still work — it is
  simply not a destination.
- **Chat.** A conversation belongs to the person it is with: `MyCoaches` on Me for a
  trainee, the roster row on Trainees for staff. Unread is a **notification** — a count on
  the tab that leads there — not a tab of its own.

`tabOf(route, role)` in `router.ts` is what maps a route to the tab it lights.

**"My trainees" means the people who ENGAGED me**, not the people I happen to have written
something for. `traineesOp` therefore has three branches, and the one that is easy to miss
is `message:read` on the trainee record — the relationship. Without it a coach whose
trainee had just joined saw an empty roster with an unread message in it.

## Routes are DECLARED, never written

`src/model.ts` declares `http: { method, path }` for every operation.
`mountOperations` (from `@substrat-run/vertical-host`) derives the Hono table from
those declarations — sorting by path specificity, refusing two operations that would
dispatch identically, merging path params + query + body into the operation's input, and
mapping a thrown `PermissionDenied` to **403 rather than 500**.

**Do not hand-write a route.** Both runtimes mount the same declarations and differ only in
`resolveStub`. They used to be written twice — hand-rolled Hono in the harness, an
`/op/:operation` RPC endpoint in the worker — which is why the deployed vertical could not
serve the web app at all.

Two things to know when adding one:

- **`{var}` names an INPUT FIELD**, not a free variable. `/programs/{orderId}/start` binds
  the engine's `orderId`; naming it `{id}` would hand the operation a field it does not have.
- **Any operation whose input rides in the query OR the body must declare `input`.** With no
  path params and no declared input the mount invokes with no argument at all — the guard is
  `if (!op.input && params.length === 0) payload = undefined`, and it runs *after* the body is
  merged. So this bites POSTs hardest: a `POST /programs` with no `{param}` and no declared
  `input` silently discards its body and answers `400 expected object, received undefined`.
  The scenario suite cannot catch it — it calls operations directly and never crosses
  `server.ts`. Declaring the operation's own exported Zod schema is the fix; `model.ts`
  imports them from `module.ts` so the two cannot drift.

An engine declares no `http` and should not: it is entity-agnostic and does not own a URL
shape. The vertical binds the name (`workorder/start` → `/programs/{orderId}/start`), and
`knownOperations` turns a typo into a mount-time error instead of a 404 nobody hits.

## The URL is the state

Every screen is addressable — see `app/src/router.ts`. The **hash** holds the route
(`#/workouts/:id`, `#/chat/:trainee/:coach`, `#/exercises?q=&type=`). Filters `replaceState`,
navigation `pushState`; get that backwards and Back becomes "undo one character". Do not
reintroduce `useState` for what screen you are on.

There used to be a `?as=` parameter beside the hash holding the dev principal. It is gone
with the picker that fed it: identity lives in a session cookie in both runtimes, so who you
are is no longer something a URL can assert.

## Training alone is the default path

**Adding a workout lives on the workouts screen**, for both roles — one obvious place. It
used to be reachable only from the Me screen, which meant the answer to "how do I add a
workout?" was somewhere nobody had reason to look. `NewWorkout` adapts to the reader
(a trainee makes their own and starts it; staff pick whose it is and leave it `planned`)
rather than existing twice.

A coach is optional and the UI must not read as though one is missing. **A standing workout
is a programme that is never completed** — that is the normal case, not an unfinished one,
and `Finish this block` is an optional act that computes adherence. **Rotation is just
slots**: A on Mon/Fri, B on Wed. `assign-program` takes `slots` so setup is one call, and
`api.createRoutine` chains create → start on the CLIENT because `workorder/start` carries
the guard. Trainees read "workout", staff read "programme". Guarded by test 25.

## Two limits worth knowing before you "fix" them

- **Exercise slugs are unique per gym**, shared and private alike — you cannot author a
  private `back-squat` alongside the shared one. `insertExercise` turns the clash into a
  sentence rather than a raw SQLite error. Changing it means rethinking what a slug *is*.
- **`stride/begin` must never start a programme itself.** It opens or resumes today's
  session and nothing more. `workorder/start` carries the manifest guard, and an in-scope
  shortcut around it would be the hole the guard exists to close — a `planned` programme is
  refused with *start it first*. Guarded by test 24.
- **Search and type filters are client-side too**, same reason. A search that filtered
  server-side would be a second access path to keep honest.
- **The exercise screen filters client-side, on purpose.** Default is everything the kernel
  returned; Private / My kit / Equipment narrow it. Never move that into the operation —
  see rule 4.
- **The message keys ride the RELATIONSHIP, not the sharing mode.** They live in
  `RELATIONSHIP_KEYS`, so a coach on `assigned` can still talk to you — the conversation is
  not the training. Move them into `ALL_KEYS` and you silently make chat a premium of
  sharing everything. Guarded by test 26.
- **A coach keeps the programmes they wrote for you**, even at sharing `none` — that is the
  `workorder → coach` edge and `ctx.link` has no un-link. Say it plainly in any UI you add;
  do not imply a clean slate.
- **Schedule weeks are ISO weeks in UTC.** The kernel has no timezone per scope, so a late
  Sunday session near a date line can land in the neighbouring week. The real fix is
  storing the gym's timezone, not adjusting the arithmetic.
- **`allOrders` drains a page walk, and that is not the end state.** `listOrders` became
  `listOrders(ctx, page): Page<WorkOrder>` in engine-workorder 0.8 (#811). Five walks need
  the WHOLE set to be correct — the schedule has to see every programme before it can say
  what this week looks like, and `setSharingOp` has to revoke against every one of a
  trainee's programmes or the leak it closes reopens — so `allOrders` drains the pages
  explicitly. The three reads that feed a SCREEN (`my-programs`, `schedule`, `agenda`)
  should eventually page with `pageVisible` and hand the app a cursor; that changes the
  HTTP surface and the React app, so it is a design decision, not a version upgrade.
  One programme by id is `getWorkOrder(ctx, id)` — never a list you `.find` through.

## Per-instance config, and the session secret

`mountPlatformSurface`'s built-in `/internal/configure` answers **501 for the life of every
version** unless the vertical supplies `onConfigure` — "this vertical stores no per-instance
config". That is not a warning anywhere; it surfaces as an install failure
(*"cannot receive auth settings while running"*), and the running worker then reports
"authentication is not configured" forever, because the choice never reached it.

`src/config-do.ts` is the store. It is **harness, not module code**: config is not domain
data and must survive a scope-DO storage wipe, so it lives in its own DO — one per
**tenant**, rows keyed by scope, table `scope_config (scope_id, key, value)`. That shape
matches `IdentityDO` in `@substrat-run/vertical-auth` exactly, so it can be swapped for the
full identity DO later without migrating a row.

**Never add a `SESSION_SECRET` env var.** The platform delivers no such thing, and a worker
binding is shared by every install of this serving script — one tenant's cookie would
verify against another's. The secret is minted inside the config DO on first use, with Web
Crypto, and never leaves it.

**Parse the delivered `substrat:auth` leniently.** Absent or malformed means "nothing
delivered", never a throw: a bad delivery must look like an unconfigured instance the
dashboard can fix, not one locked out of its own login.

## Two runtimes, one module set

`src/modules.ts` holds `MODULES`, `ROLES`, `ENTITY_GRANTS` and the `definePermissions`
export. It imports engines and this vertical and **NO adapter** — the moment it reaches for
one, the other runtime cannot bundle.

- `src/seed.ts` + `src/server.ts` — the local harness, on SQLite. Not deployed.
- `src/worker.ts` — the deployed entry, on Durable Objects. **Never import `seed.ts` from
  it**: that drags `better-sqlite3` into a Worker bundle, which is how this was found.

A vertical declares only the stores it owns (`ScopeDO`/`SCOPE`). `CONTROL_PLANE` is the
platform's directory and is injected; declaring it is refused.

## Running it

```sh
pnpm dev          # dev issuer on :8879, API on :8871 (API_PORT), web on :5173 (WEB_PORT)
pnpm test         # the scenario, including every denial
pnpm typecheck    # both packages
npx @substrat-run/boundary-lint
```

The web app is `app/` — Vite + React, mobile-first. A denial surfaces as the **"Denied by
the kernel"** banner; that banner is a feature, not an error state.

## One auth path, two issuers

There is **no dev-only auth branch**, and re-introducing one would undo the point.
`@substrat-run/dev-issuer` runs a real OpenID Connect provider on :8879 whose only shortcut
is that `/authorize` lists people instead of asking for a password. `src/server.ts` is an
ordinary relying party in front of it, running the SAME `oidcRpAuthProvider` that
`src/worker.ts` runs against the hosted issuer. Sign in locally and you are exercising the
deployment's login.

- **`src/personas.ts` is read twice**, and that is the point: the issuer renders it as the
  picker, and `linkDevIdentities` in `seed.ts` binds each `sub` to a principal. `sub` is the
  join, so the two cannot drift. Change the cast in one place.
- **The pool is `central`.** `devLogin.caller()` asks `listIdentityTenants`, which is only
  answerable on a central pool — one issuer serving both gyms, one Rutger.
- **The scope comes from the DIRECTORY, not a constant.** Sign in as Rutger and you get
  Sydpuls Gym, because that is where his login lives. The old harness pinned every persona
  to t1 so he could be turned away on screen; the isolation he demonstrated is proved
  against the kernel in tests 4 and 14, which call operations directly.
- **`changeOrigin` is off in `app/vite.config.ts`, deliberately.** The provider derives its
  redirect URI from the request's own origin, so rewriting Host would send the browser to
  :8871 after sign-in and strand it outside the app.
- **Switching person is a sign-out and a sign-in.** The issuer keeps no SSO cookie, so the
  picker appears on every `/authorize` and it costs one click — no logout dance.

**Both auth paths fail closed.** The harness refuses to **boot** without `STRIDE_DEV_AUTH=1`
(`pnpm dev` sets it) — a deployment guard, not an auth branch, because the issuer's signing
key is public by design and the session cookie uses a well-known default secret. The
worker's `authFor` throws unless the instance has real OIDC config. An unset variable means
"there is no authentication here", never "let them in".
