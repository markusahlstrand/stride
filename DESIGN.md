# Stride — design (rev 11, as built)

A multi-tenant training app for a gym or physio clinic. An **admin** curates a shared
library of exercises and program templates for the whole organisation. A **coach** authors
their own private exercises and templates, and works **only with the trainees assigned to
them**. A **trainee** logs in, sees only their own results — and **keeps every exercise
they have ever performed, forever.**

Interview: gym/fitness **and** physio/rehab (one model covers both) · admin + coach +
trainee · **no money** · **no sign-off step**.

> rev 2 → rev 3: coaches are narrowed to their own trainees (a `trainee → coach` edge);
> admin reads the whole catalogue including coaches' private exercises; added the **guard**
> that closes the hole this narrowing opened in the engine's lifecycle operations.
>
> rev 3 → rev 4: **everyone can create their own exercises and their own programs.** A
> trainee is now an author, not only a subject — see §3a. Needs migration `0002-self-serve`
> and three new rows in the permission table.
>
> rev 4 → rev 5: a **default catalogue** of 62 exercises tagged with the equipment each
> needs; **per-account equipment**; and **recurring schedules** on a prescription — see §3b.
> Needs migration `0003-equipment-and-schedule` and one new permission key.
>
> rev 10 → rev 11: **the URL is the state** — every screen is addressable and a refresh
> lands you back on it — and a **conversation** between a trainee and a coach. See §3h.
> Needs migration `0008-messages` and two new permission keys.
>
> rev 9 → rev 10: **training alone is the default path**, not a degraded one — see §3g.
> No migration, no permission change; the model already fitted and the flow did not.
>
> rev 8 → rev 9: **booked training** — a programme is trained *Wednesdays at 11*, not just
> "three times a week" — and **one tap from due to logging**. See §3f. Needs migration
> `0007-training-slots`; no permission change.
>
> rev 7 → rev 8: **cardio as a first-class thing to log**, plus a **search bar** and a
> **type filter** on the exercise screen — see §3e. Needs migration `0006-cardio`; no
> permission change.
>
> rev 6 → rev 7: **sets and supersets** in a prescription, **onboarding**, and the exercise
> screen reworked from modes into filters — see §3d. Also a UI bug fixed: a trainee could
> not press Start on their own programme, though the kernel had always allowed it. Needs
> migration `0005-sets-supersets-onboarding` and one changed permission row.
>
> rev 5 → rev 6: **invitations** (composed from `engine-invites`) and
> **trainee-controlled sharing** — see §3c. This one is a REVERSAL: the permanent
> `trainee → coach` edge from rev 3 is gone, and what a coach may see is now the trainee's
> revocable decision. Needs migration `0004-sharing` and one new permission key.

---

## 1. The earned-exercise mechanic — read this part

> *"If you have made an exercise it's available to you, so if you did it once with a coach
> it's yours forever."*

This is not a `WHERE` clause. It is a **kernel-enforced entity edge**, and it is the reason
this app is worth building on Substrat.

An exercise can have parents. When a trainee performs a set of exercise E, the operation
records the edge `exercise E → trainee T`. The trainee holds one entity-narrowed grant of
`exercise:read` **on their own trainee record**, so from then on the permission evaluator
walks `E → T` and answers *allowed* — with a proof path, not a guess.

```
        Nina (coach)                         Vera (trainee)
             ▲                                     ▲
 authored-by │                          earned-by  │  ← minted the moment
             │                                     │     Vera performs a set
      ┌──────┴─────────  exercise  ────────────────┘
      │   "Nordic hamstring curl"  (private to Nina)
```

Consequences that fall out for free, each of them a test:

- Coach **Ola cannot read Nina's private exercise** — no edge, no grant, denied.
- Vera **cannot read it either** — until she performs it once. Then she can, permanently.
- An admin **retires** a shared exercise: it leaves the catalogue for everyone, but every
  trainee who ever performed it keeps it. The edge outlives the catalogue entry.

**Honest consequence 1 — "forever" is literal.** `ctx.link` is idempotent and module code
has no un-link. An earned exercise cannot be taken back from inside the app. Revocation
would be a control-plane operation, not a button.

**Honest consequence 2 — private is not absolute, and that's deliberate.** The walk is
`exercise → trainee → coach`, so once Vera has earned Nina's private exercise, **Vera's
coach can read it too**. If Vera transfers to Ola, Ola can now see Nina's exercise. That is
a requirement rather than a leak: Vera's running program *contains* that exercise, so a
coach taking her over who couldn't read it would see a program full of unresolvable ids.
The alternative — a per-trainee `library:` entity with no parent, which would hide earned
exercises from every coach — is one line different and available if you want it. Flagging
it because it is the least obvious thing in this document.

---

## 2. Coverage map — what exists, what you're building

### Tier 0 — the kernel. Free, always.

| | |
|---|---|
| **Tenancy** | One gym/clinic = one tenant = one isolated database. There is no cross-tenant API to forget to filter. |
| **Permissions** | Roles, **entity-narrowed grants**, and the **parent-edge walk** (depth ≤ 4) — the machinery both the earned-exercise mechanic and the coach narrowing are built from. Every decision carries a proof path. |
| **Events + audit** | Every mutation emits a kernel-stamped event: who logged that set, when, under which permission. |
| **Guards (K-17)** | A module can declare a predicate that runs **before another module's operation**, inside the same transaction, failing closed. This is what lets the vertical add a per-program check to the engine's own lifecycle operations — see §3. |
| **Migrations** | Journaled per module, applied lazily per scope. |

### Tier 1 — `engine-workorder`, composed

**An assigned program is a work order.** It's the thing that moves:

```
planned  →  in_progress  →  completed  →  closed
(assigned)   (running)      (finished)    (archived)
```

The engine owns that machine and it **cannot skip states**, plus the program's number, the
append-only spine, the `workorder.*` events, and the `program → trainee` edge the portal
walks. You write none of it.

*Friction, named up front:* `completeWorkOrder` takes a `billable[]` because it was built
for jobs that get invoiced. You have no money, so it gets `billable: []` and a `0 SEK`
total nobody reads.

### Tier 2 — nothing

`engine-invoicing` is **removed from the project** (no money — I took the dependency out
rather than leave it wired). No connectors; nothing talks to a third party.

Not included, each a clean later addition: **`engine-protocol`** (a signed health screening
before training may start), **`engine-booking`** (session timeslots with a capacity limit),
**`engine-invites`** (inviting a trainee to the portal by email rather than seeding them —
reach for it before hand-rolling an invite flow).

### Tier 3 — yours. The real app.

Trainees and coaches · the exercise catalogue with its shared/private split · program
templates · the prescription (target sets × reps × load) · sessions and the append-only
set-result ledger · adherence maths · the mobile screens.

### The honest limit on "everyone"

"Available to everyone" means **everyone in this tenant** — this gym, this clinic. A
catalogue shared across *all* tenants is not a thing Substrat has, by design: there is no
cross-tenant read. If every new gym should start with the same 200 exercises, that's a
**base catalogue seeded at provisioning** — each tenant gets its own editable copy. Same
felt result, different mechanism.

---

## 3. The narrowing, and the hole it opened

You chose: **a coach sees only the trainees assigned to them.** That's a `trainee → coach`
edge plus one entity-narrowed grant per coach on their **own coach record**. Everything
else follows by transitivity, which is why it's cheap:

```
exercise  ─┬─→ coach                     (authored by)
           └─→ trainee ──→ coach         (earned by / assigned to)
template  ───→ coach                     (authored by)
workorder ───→ trainee ──→ coach         (the program's subject; engine links the first hop)
session   ───→ workorder ──→ trainee ──→ coach          (depth 3 — the limit is 4)
```

One grant of `result:read` on `coach:Nina` therefore reaches Nina's trainees, their
programs, their sessions, and every set in them — and reaches nothing of Ola's.

**The hole.** `engine-workorder`'s own operations — `start`, `assign`, `report-time`,
`report-material` — check `workorder:report` / `:assign` at **node level**, not per entity.
That's correct for the workshop it was built for, where every technician is a peer. Here it
would mean any coach could start or report on any coach's program, as long as they knew its
id. They couldn't *list* those programs, but "you can't enumerate it" is not a security
boundary, and claiming otherwise is exactly the theater this framework exists to prevent.

**The fix, using a sanctioned seam.** The vertical declares a **guard** before each of those
operations and contributes the predicate:

```ts
guards: [
  { before: 'workorder/start',           predicate: 'stride/program-in-reach', config: {} },
  { before: 'workorder/assign',          predicate: 'stride/program-in-reach', config: {} },
  { before: 'workorder/report-time',     predicate: 'stride/program-in-reach', config: {} },
  { before: 'workorder/report-material', predicate: 'stride/program-in-reach', config: {} },
]
```

The predicate resolves `input.orderId` and re-checks `result:log` **against that program as
an entity**, so the parent walk decides. It runs inside the operation's own transaction,
before the handler, and a throw rolls the whole thing back. Two gates now have to pass: the
engine's node-level key, and the vertical's per-program check. A missing or misspelled
predicate **blocks** the operation rather than opening it — the kernel fails closed.

This is also honest design feedback for the engine: `workorder/start` checking node-level
only is the reason this guard has to exist.

---

## 3a. Self-serve — everyone is an author

*"Everyone should be able to create their own program and exercises."*

The good news is that this needed almost no new machinery: the second gate that already
existed for coaches turns out to be exactly the one that makes self-serve safe.

**Everyone holds `library:author`, `workorder:create`, `workorder:report` and
`workorder:complete` gym-wide** — including trainees. On its own that would be alarming.
It is not, because *every one of those paths is narrowed again before it does anything*:

| The gym-wide key | The second gate that decides |
|---|---|
| `workorder:create` | `assign-program` re-checks `result:log` **on the target trainee**. A trainee holds that only against their own record, so self-serve reaches exactly one person: themselves. |
| `workorder:report` | every engine operation using it sits behind `stride/program-in-reach` (§3). |
| `workorder:complete` | the same guard, plus a narrowed check in `complete-program`. |
| `library:author` | creates a **private** row hanging from *your* record. Publishing gym-wide is a different key (`library:publish`) and stays admin-only. |

Take away either gate and these rows become a hole. That is why tests 13 and 14 exist.

**Ownership generalises to "whichever record you are."** A coach's exercise hangs from
`coach:<id>`; a trainee's from `trainee:<id>` — deliberately the *same* edge their earned
exercises use, so **"mine" and "what I've done" are one walk and one grant.** Making an
exercise therefore also earns it, which is the behaviour you'd want anyway.

Two consequences worth stating plainly:

- **A trainee's own exercise is visible to their coach**, through `exercise → trainee →
  coach`, exactly like an earned one. Same reasoning as §1: a coach who cannot see what
  their trainee is doing is no use. It is *not* visible to other coaches or other trainees.
- **A program no longer needs a template.** `assign-program` takes an optional `traineeId`
  (omit it and it means you) and an optional `templateId`; `add-program-item` builds the
  prescription directly. It is allowed while `planned` or `in_progress` and refused once
  completed — a finished prescription is what adherence was measured against and must not
  move afterwards.

## 3b. The catalogue, equipment, and recurring schedules

### The default catalogue

`src/catalogue.ts` is 25 pieces of equipment and **62 exercises** — barbell, dumbbell,
kettlebell, machines, bodyweight, cardio, mobility and rehab — each tagged with what it
needs. Seven need nothing at all.

It is **harness, not module code**: the seed feeds it through `stride/publish-equipment`
and `stride/publish-exercise` exactly as an admin would by hand. Nothing about it is
privileged, and a gym can edit or retire any of it afterwards.

The same caveat as §2 applies to the word "default": there is no cross-tenant read, so this
array is *seeded into each gym at provisioning* and that gym then owns its copy. It is a
starting point, not a shared table.

### Equipment is advice, never a permission

Two tables: what an **exercise needs**, and what an **account has**. No rows for an exercise
means bodyweight — nothing to own, so everyone can always do it.

**Equipment never hides an exercise you are allowed to see.** The kernel decides what you
may *read*; your kit decides what you can *lift*. `stride/exercises` returns `canDo` and
`missing` alongside every row, and the filtering happens in the UI. Conflating the two
would be a bug the day someone borrows a barbell — and it would put a second, weaker access
rule next to the real one, which is exactly the failure this framework exists to prevent.

`stride/set-my-equipment` is worth a look: **it takes no id saying whose account.** There
is no whose — it is resolved from `ctx.principal`. That is why the new `equipment:manage`
key can be held gym-wide by everyone with no narrowing check: the operation is *incapable*
of naming anyone else. That is a stronger guarantee than a permission, because it cannot be
loosened by editing a role.

### Recurring schedules

A prescription row carries **one** of two things, never both:

| | meaning | who says it |
|---|---|---|
| `recur_days` `'1,3,5'` | ISO weekdays, 1 = Monday | a lifting block: "Mon/Wed/Fri" |
| `recur_per_week` `5` | a count; the days are yours | a physio: "five times a week" |

Both at once is refused at the boundary — a row that said both would have two answers to
"is it due today". `stride/schedule` is a **walk** like every other listing: one
`ctx.check` per program, so a trainee sees their own plan, a coach their trainees', an
admin the gym, and a stranger an empty list.

Two limits, stated rather than hidden:

- **Weeks are ISO weeks in UTC.** The kernel has no timezone for a scope, so a late Sunday
  session near a date line can land in the neighbouring week. Fixing it properly means
  storing the gym's timezone, not guessing in the operation.
- **"Done" counts distinct days with at least one logged set, not sets.** Three sets on
  Monday is one of your five days, not three of them.

There is no background job and nothing is materialised — due-ness is computed on read from
the rule. `engine-booking` is still not involved: it owns capacity over intervals, which is
a different problem from "how often should I do this".

## 3c. Invitations, and who may see your training

### Invitations — composed, not hand-rolled

`engine-invites` owns the parts that are easy to get wrong, and the vertical composes it
in-scope:

- the identifier is **hashed with this scope's own salt** and never stored in the clear —
  a global salt would let the same address correlate across tenants;
- an invitation **confers nothing until accepted**, and the identifier is re-hashed on
  acceptance, so a leaked invitation id is not a bearer token;
- **non-enumerable**: the sender is told an invitation was recorded and *nothing else* —
  not whether that address is already here. `stride/invite` returns `{ id }` and the
  hash never leaves the engine.

The vertical adds direction, because "a coach invited me" and "I invited a coach" end in
different places: **a coach invites trainees, a trainee invites a coach**, an admin may do
either, and inviting sideways is refused.

**Why acceptance enqueues a platform intent.** `ctx.grant` delegates and never elevates —
so it re-checks that the caller holds the permission on that entity. Someone who joined
thirty milliseconds ago holds *nothing* on their own record to delegate. Their role and
their first grants are the platform's to mint, so `stride/accept-invite` records what it
decided and calls `ctx.requestPlatform`, atomic with its own transaction; the platform
executes it with `HostAdmin` authority and settles the row. Between the two they are a
record with no permissions — the correct intermediate state, and the test asserts it.

Locally the platform side is `drainPlatformRequests` in `src/seed.ts` (harness, so it may
hold admin authority), called by the server after every request.

### Sharing — the trainee decides, and can take it back

**The `trainee → coach` edge is gone.** It handed a coach that person's entire history, for
ever, with no way back — `ctx.link` has no un-link. What a coach sees is now grants the
trainee makes and withdraws.

| Mode | What the coach gets | How |
|---|---|---|
| **`none`** | nothing; they cannot even prescribe | every grant withdrawn |
| **`assigned`** *(default)* | may prescribe; sees the programmes **they** wrote | `result:log` on the trainee record + the `workorder → coach` edge |
| **`from-now`** | plus every session logged from this moment, on any programme | one grant per session **as it is created** |
| **`all`** | the whole history — programmes, sessions, sets, exercises | grants on the trainee record, which the walk reaches from everything |

Two keys doing two different jobs is what makes the middle row possible:
**`workorder:read`** is *may I see this programme exists and what it prescribes*;
**`result:read`** is *may I see what was actually done*. `get-program` gates on the first
and then **walks every session** with the second — so a `from-now` coach can open the
programme and still not read last month.

Nothing is retroactive and nothing is a `WHERE` clause. A downgrade genuinely withdraws:
`set-sharing` revokes first, every time, so it is idempotent and a narrower mode can never
sit on top of a wider grant left behind.

**Two honest limits, both asserted in the tests so nobody meets them by surprise:**

1. **A coach keeps the programmes they wrote for you.** That reach is the `workorder → coach`
   edge, and module code cannot un-link. Choosing `none` ends the relationship and their
   view of everything else; their own prescription record survives. The UI says so in those
   words rather than implying a clean slate.
2. **Only the trainee can open their own data.** `set-sharing` takes no id for whose sharing
   — it is the caller's. So when a *coach* accepts a trainee's invitation, nothing is
   shared: inventing a default there would be that decision taken by someone else.

## 3d. Sets, supersets, filters and onboarding

### The prescription can now say what it means

Two shapes, and the model keeps both rather than forcing one:

- **Uniform** — `3 × 5 @ 60`, on the item itself. Every row written before this migration.
- **Explicit** — a list of sets in `train_item_sets`, for when they *differ*: a ramp
  (10@40, 8@45, 6@50, 4@55), a drop set, a rehab ladder. A ramp copied as "4 sets of
  something" is a different session, so the snapshot copies the set list too.

`target_sets` is kept in step with the list, so adherence, the weekly schedule and the
progress badge — none of which know this table exists — keep reading the right number.

**Supersets** are a `group_key` on the item. Items sharing a key *consecutively* are one
superset: A1, A2, then rest. Consecutive matters — position is the running order, so a key
that reappears later is a second superset, not a continuation of the first. The UI draws
the group as one bracketed block, so "back to back" is shown rather than stated.

### Filters, not modes

The exercise screen used to make you choose between "Everything I can see" and "Mine,
forever". It now shows **everything you are allowed to see, by default**, and offers
filters that narrow it: **Private**, **My kit**, and an **Equipment** picker for choosing
specific kit. Bodyweight always survives an equipment filter — it needs none of it.

The filtering is deliberately client-side. The kernel already decided what may be *read*;
these controls decide what you want to *look at*. Making equipment hide rows server-side
would put a second, weaker access rule beside the real one (§3b).

### Onboarding

Two questions — what are you training for, and how many days a week can you train —
answered by the trainee about themselves. Like the other self-serve operations,
`stride/onboard` **takes no id for whose**. The answers PREFILL a schedule; they never
enforce one, because a week you missed is a fact to show, not an error to raise.

Björn is seeded without answers on purpose: the app has to work for someone who has not
been asked yet, which is everyone on day one.

## 3e. Cardio, search, and filtering by type

### Cardio needed one column, not a subsystem

The quantity was never the problem. An exercise carries a **unit** — `reps`, `seconds` or
`metres` — and a set's `reps` column is the count *in that unit*: rowing `5000` has always
meant 5000 metres. What was wrong was the **form**, which labelled the field "reps"
regardless, so logging a row read as typing five thousand repetitions.

Two changes:

1. **The logger is shaped by the unit.** The field is called what it is; time is entered as
   `mm:ss`; load is hidden where it means nothing and replaced by minutes and average heart
   rate.
2. **A set may carry how long it took.** A 5 km row is a distance *and* a duration, and one
   column cannot hold both — so `duration_seconds` and `avg_hr` are optional on every set.
   Every set, not a cardio-only table: a 90-second plank at 140 bpm is the same shape.

`total_seconds` joins the completion summary, because cardio carries no load and would
otherwise finish as `volume 0` — which reads as *nothing happened*.

The catalogue gained 12 more cardio entries (20 in all), including the outdoor ones —
run, walk, cycle, shuttle run — which need **no equipment**, and are the clearest argument
for tagging equipment in the first place.

### Search and type filters

The exercise screen now opens with a **search box** over name, slug, description and
modality, and a row of **type chips** — strength / cardio / mobility / rehab — alongside
the existing Private, My kit and Equipment filters. `Clear` resets all of them.

All of it is client-side, for the reason in §3b: the kernel decided what may be *read*;
these controls decide what you want to *look at*. A search that filtered server-side would
be a second access path to keep honest.

## 3f. The appointment, and getting into it

### Two schedules, because they are two questions

`recur_days` on an **item** says how often an exercise comes round: squat three times a
week. It cannot say *when you train*, and folding a time into it would mean every exercise
in a session carrying the same clock value — the same fact written five times, with five
chances to disagree.

So a programme gets **slots**: `train_program_slots` is `(weekday, time_of_day)`, several
per programme. Wednesday 11:00 and Saturday 09:00 are two rows. `train_program_slots` is
keyed by the engine's work-order id with **no foreign key** — a constraint into another
module's table would weld this schema to its private one (rule 4).

`stride/agenda` is a walk like every other listing, sorted by day then time, so *next up*
is the first row. Each entry carries whether a session already exists today, so the button
can say **Continue** rather than opening a second one.

*Time is local wall-clock `HH:MM` with no zone* — the same simplification the weekly rollup
makes. A gym timezone fixes both, and it is one field rather than a rewrite.

### `stride/begin` — one tap

A trainee had to do three things by hand: start the programme, open a session, find the
exercise. `begin` does the middle steps and is **idempotent** — press it twice on the same
day and you get the same session back, rather than a workout split in two.

What it deliberately does **not** do is start the programme for you. `workorder/start`
carries the manifest guard (§3); reaching around it with an in-scope shortcut would be
exactly the hole the guard exists to close. A `planned` programme is refused with a message
saying to start it, and the test pins that refusal.

## 3g. Training alone

A coach is **optional**, and the app should not read as though one is missing. Someone who
trains three times a week with a couple of workouts they rotate needs no coach, no
assignment and no completion ceremony — and until rev 10 they met all three.

Nothing in the model was wrong. What was wrong was the shape of the path through it:

| They think | They had to do |
|---|---|
| "I train Mon / Wed / Fri" | learn what a programme is |
| "I rotate two workouts" | assign one to themselves, twice |
| "just let me log it" | find each one, book it, start it |

**A standing workout is a programme you never complete.** That is not a workaround — a
work order is a thing with a lifecycle you may or may not close, and a lifter running the
same split for a year simply never closes it. The screen now says so out loud rather than
leaving a **Complete** button implying an unfinished job:

> A standing workout never has to be finished — keep logging into it week after week.
> Finishing is for when you close off a block and want the adherence number.

**Rotation needs no new concept.** Two workouts on alternating days *is* two sets of slots:
A on Monday and Friday, B on Wednesday. The setup flow deals the chosen days round the
chosen workouts and books each one as it creates it — `assign-program` now takes `slots`,
so "create it, find it, schedule it" collapses into one call.

`api.createRoutine` is **three calls, not one operation**, on purpose: `workorder/start`
carries the manifest guard, so the client does what a person would do with every gate
intact, rather than the server quietly starting things on their behalf.

The vocabulary follows the reader — a trainee sees **workouts**, staff see **programmes** —
and the sharing panel says plainly that nobody is the normal state:

> Nobody — and nobody has to be. Training alone is the default; a coach is something you
> add if you want one.

## 3h. Addressable state, and the conversation

### The URL is the state

Nothing that decides what you are looking at lives in React state any more. Refresh lands
you back where you were, Back works, and a workout is a link. Two places, on purpose:

| | |
|---|---|
| the **hash** | the route — `#/workouts/01J…`, `#/chat/<trainee>/<coach>`, `#/exercises?q=row&type=cardio`. A hash needs no server rewrite, so a deep link survives a static host, not just the dev server. |
| **`?as=`** | the dev principal. Deliberately *outside* the hash: it is not where you are, it is who you are pretending to be, and it should survive navigating. |

Filter changes `replaceState`, navigation `pushState` — otherwise Back becomes "undo one
character" while typing in the search box.

`?as=` is a dev seam like the `x-principal` header it feeds, and disappears with it when
real auth lands.

### The conversation

One thread per **(trainee, coach) pair** — keyed by the pair rather than by a thread id,
because there is exactly one conversation between two people and an id would let two exist.

Both keys are **entity-narrowed on the trainee record**, and both ride the sharing
relationship: granted when a trainee connects with a coach, withdrawn at `none`. So the
inbox and the permission model are the same thing rather than two rules to keep in step —
end the relationship and the conversation closes, which is the honest behaviour. A coach
you dismissed should not still be in your inbox.

Three consequences worth stating, each asserted:

- **A coach on the strictest sharing setting can still talk to you.** The message keys sit
  in the relationship, not in `ALL_KEYS` — the conversation is not the training.
- **Ending it closes the thread for both sides**, and reconnecting **reopens it with the
  history intact**. The messages were never deleted, only made unreachable — the same
  shape as a retired exercise someone has earned.
- **`message-posted` is `piiClass: 'direct'`** and carries a subject id. A person writing
  about their knee is writing about their body; an erasure has to be able to key on it.

## 4. The cast

| Persona | Role | What they hold |
|---|---|---|
| **Admin** | `admin` | Publishes shared exercises and templates. Manages coaches and trainees, and assigns trainees to coaches. Reads the **whole** catalogue, including every coach's private exercises. Full lifecycle on any program. |
| **Coach** | `coach` | Authors their own exercises and templates; uses the shared library. Assigns, runs and completes programs — **only for their own trainees**. Cannot publish to the organisation, cannot see another coach's private exercises or trainees. |
| **Trainee** | `trainee` | Browses the shared catalogue. Creates their own exercises, templates and programmes, and runs them start to finish. **Decides what each coach may see, and can withdraw it.** Invites coaches. Everything personal is **entity-narrowed to their own record**. |

Two tenants are seeded on purpose. The second exists so its admin can attack the first and
be turned away — isolation proven, not claimed.

## 5. Data model (all prefixed `train_`)

```
train_coaches          id, principal_id, name, created_at
train_trainees         id, number, name, contact, coach_id, principal_id, created_at
train_exercises        id, slug, name, modality, unit, description,
                       visibility('shared'|'private'),
                       owner_coach_id, owner_trainee_id, active,
                       created_by, created_at
train_templates        id, name, description, visibility,
                       owner_coach_id, owner_trainee_id, created_at
train_template_items   id, template_id, exercise_id, position,
                       target_sets, target_reps, target_load, notes
train_program_items    id, program_id → workorder, exercise_id, position,
                       target_sets, target_reps, target_load, notes
train_sessions         id, program_id → workorder, trainee_id, performed_at, note,
                       logged_by, created_at
train_set_results      id, session_id, program_item_id, exercise_id, set_no,
                       reps, load, rpe, logged_by, logged_at        ← append-only
train_program_summary  program_id, prescribed_sets, performed_sets, total_reps,
                       total_volume, adherence_pct, computed_at

train_equipment          slug, name, category            ← the controlled vocabulary
train_exercise_equipment exercise_id, equipment_slug     ← what it NEEDS (none = bodyweight)
train_account_equipment  owner_type, owner_id, slug      ← what a PERSON has

train_template_items  + recur_days, recur_per_week       ← exactly one, or neither
train_program_items   + recur_days, recur_per_week

train_messages        trainee_id, coach_id, author, body   ← one thread per PAIR
train_thread_reads    trainee_id, coach_id, principal_id, last_read_at
train_program_slots   program_id, weekday, time_of_day   ← the appointment
train_item_sets       item_id, item_kind, set_no, target_reps, target_load, note
                      ← the explicit prescription, when the sets differ
train_template_items  + group_key       ← same key, adjacent = a SUPERSET
train_program_items   + group_key
train_trainees        + goal, days_per_week, onboarded_at   ← onboarding

train_sharing         trainee_id, coach_id, mode, since  ← the DECISION.
                      Kernel grants are the enforcement; if the two ever
                      disagree, the tuples win — they are what the evaluator reads.
```

ULIDs (TEXT), ISO-8601 TEXT timestamps, and every number that must be exact — load, volume,
adherence — is a **decimal string**. Never a float.

**Assigning a template snapshots it.** `train_template_items` are copied into
`train_program_items` at assignment, so editing a template never rewrites a program already
running. That matters clinically: a prescription in flight must not change under the
patient.

## 6. Operations

| Operation | Who |
|---|---|
| `stride/create-coach`, `stride/create-trainee`, `stride/assign-to-coach` | admin |
| `stride/publish-exercise`, `stride/publish-template` | **admin only** — the shared library |
| `stride/retire-exercise` | admin — leaves earned copies intact |
| `stride/author-exercise`, `stride/author-template` | admin, coach — private, linked to the author |
| `stride/equipment` | everyone — the vocabulary, flagged with what you have |
| `stride/set-my-equipment` | everyone — **takes no id for whose account** |
| `stride/publish-equipment` | admin — extend the vocabulary |
| `stride/set-exercise-equipment` | admin (shared rows) / author (own rows) — retag |
| `stride/schedule` | everyone — a walk: which exercises are due this week |
| `stride/agenda` | everyone — a walk: which trainings are booked, and when |
| `stride/set-program-slots` | whoever may log into that programme |
| `stride/begin` | whoever may log into it — start or resume today's session |
| `stride/invite` | coach → trainees · trainee → a coach · admin → either |
| `stride/invitations` / `stride/revoke-invite` | staff and trainees, for their own gym |
| `stride/accept-invite` | **no permission gate** — the invitation is the authorization |
| `stride/set-sharing` / `stride/my-sharing` | the trainee — **no id for whose** |
| `stride/threads` | everyone — a walk over the conversations you may be in |
| `stride/messages` / `stride/post-message` | both sides of a live relationship |
| `stride/set-item-sets` | whoever may write that item — an explicit set list |
| `stride/onboard` / `stride/me` | the trainee — **no id for whose** |
| `stride/exercises` | **everyone — three different correct answers** (below) |
| `stride/templates` | admin (all), coach (shared + own) |
| `stride/trainees` | admin (all), coach (own, by walk) |
| `stride/assign-program` | **everyone** — `traineeId` optional (omit = yourself), `templateId` optional; composes `createWorkOrder` |
| `stride/add-program-item` | **everyone** — build a prescription directly, while `planned` or `in_progress` |
| `stride/log-session`, `stride/log-set` | admin, coach, **owning trainee** — per-entity check |
| `stride/complete-program` | **everyone, for programs in reach** — adherence exact, then `completeWorkOrder(billable: [])` |
| `stride/my-programs`, `stride/my-exercises` | trainee — the portal walk |
| `stride/get-program`, `stride/timeline` | per-entity check |
| `workorder/start` `/assign` `/report-time` `/report-material` | the engine's own — **behind the guard** |

**`stride/exercises` is one operation that gives three different correct answers**, and
none of them is a hand-written filter. It returns the shared catalogue if you hold the
node-level key, then walks every non-shared exercise with a per-entity `ctx.check`:

- **admin** holds `exercise:read` at node level → everything.
- **coach** holds it narrowed to their coach record → shared + own + what their trainees earned.
- **trainee** holds it narrowed to their trainee record → shared + everything they've earned.

The kernel produces the difference. The operation never asks who is calling.

## 7. Permissions (the full diff is a checkpoint before anything ships)

| Key | Description | admin | coach | trainee |
|---|---|---|---|---|
| `trainee:manage` | Register coaches and trainees, assign trainees to a coach | ● | | |
| `library:publish` | Publish exercises and templates to the whole organisation | ● | | |
| `library:author` | Create your own exercises and templates | ● | ● | **●** |
| `exercise:read-shared` | Browse the shared exercise catalogue | ● | ● | ● |
| `exercise:read` | Read one exercise — own, or **earned** | ● node | ◐ own coach record | ◐ own trainee record |
| `template:read-shared` | Browse shared program templates | ● | ● | **●** |
| `template:read` | Read one template — own | ● node | ◐ own coach record | |
| `equipment:manage` | Record which equipment you have. **Safe gym-wide because the operation cannot name another account** | ● | ● | ● |
| `share:manage` | Decide what a coach may see of your training. Same shape: no id for whose | ● | | ● |
| `message:read` | Read the conversation about a trainee | ● | ◐ their own trainees | ◐ own record |
| `message:post` | Write in it. Held by both sides of a live relationship, withdrawn when it ends | ● | ◐ their own trainees | ◐ own record |
| `invites:send` / `:read` / `:revoke` | Invite someone; see and withdraw invitations | ● | ● | ●/● |
| `result:log` | Record sessions and set results; **the guard's key** | ● node | ◐ own coach record | ◐ own trainee record |
| `result:read` | See what was actually DONE — sessions and sets | ● node | ◐ what each trainee shared | ◐ own record |
| `workorder:read` | See a programme exists and what it prescribes | ● node | ◐ own coach record + shared programmes | ◐ own record |
| `workorder:create` | Create a program — **narrowed again** by `result:log` on the subject | ● | ● | **●** |
| `workorder:report` / `:complete` | Run a program — **always behind the guard** | ● | ● | **●** |
| `workorder:assign` / `:close` | Assign a technician, archive | ● | ● | |

● held by the role · ◐ **entity-narrowed** — held only against that person's own record

There is no money, so nobody can see it. Nobody can see another tenant's data, because
there is no API that crosses a tenant. The two lines to look hardest at:

1. **`exercise:read` for admin is node-level** — an admin reads every coach's private
   exercises. You chose this; it's what makes moderating and promoting possible.
2. **`workorder:create`, `:report` and `:complete` are held gym-wide by everyone,
   trainees included** — and are *only* safe because of the second gate in each path
   (§3a). If the guard or the narrowed `result:log` check is ever removed, those three
   rows become a hole that reaches every trainee in the gym.

## 8. What the test proves

1. **Happy path** — admin publishes a catalogue and a template; coach authors a private
   exercise; assigns a program; sessions; set results; completion with adherence exact to
   the rep.
2. **Earned forever** — Vera denied on Nina's private exercise → performs one set → allowed,
   permanently. **Paired control: Ola still denied.**
3. **Retire ≠ erase** — admin retires a shared exercise; it leaves the catalogue; the
   trainee who performed it keeps it.
4. **Coach isolation, reads** — Ola denied on Nina's trainee, program and private exercise;
   control: Ola reads the shared catalogue and his own trainees fine.
5. **Coach isolation, writes — the guard** — Ola, knowing the id, is denied
   `workorder/start` and `workorder/report-time` on Nina's trainee's program; control: the
   same calls succeed on his own trainee's program. *This is the test that would fail
   without §3.*
6. **Publishing is admin-only** — coach denied `library:publish`; control: `library:author`
   succeeds.
7. **Portal isolation** — trainee A sees her program; trainee B sees nothing (an empty room,
   not an error).
8. **Trainee A denied logging a set into trainee B's session** — the entity-narrowed *write*.
9. **Cross-tenant admin** — wrong (tenant, scope) pair → `unknown scope`; right pair, no
   tuples → `permission denied`; portal walk → empty.
10. **The state machine** — a `planned` program can't be completed; a `completed` one can't
    take another set.

11. **Self-serve, end to end** — Björn authors his own exercise, creates his own program
    with no coach and no template, adds an exercise to it, starts it, logs sets and
    completes it, with adherence exact. Making it also earned it.
12. **Self-serve is still narrowed** — Björn denied creating a program *for Vera*
    (`result:log`, not `workorder:create` — he holds that one); denied publishing
    gym-wide; his exercise invisible to Vera and to Nina, visible to Ola who coaches him.

13. **The catalogue arrives tagged** — 62 exercises; the same `back-squat` row is `canDo:
    true` for Nina in a full gym and `canDo: false, missing: [barbell, plates, squat-rack]`
    for Björn in a garage — **and both can still read it**. An unknown equipment slug is
    refused; setting your own kit leaves everyone else's untouched.
14. **Recurring schedules** — Mon/Wed/Fri is due on a Wednesday and not on a Tuesday; a
    5×/week item is due until the count is met; both-at-once is refused; logging three sets
    in one session advances the week by **one day, not three**; and the schedule is a walk,
    so Ola and the outsider see nothing of Vera's plan.

15. **Sharing** — on the floor, Nina cannot open a programme Vera made herself; `from-now`
    shows the session logged after the switch and **not** the one before; `all` opens the
    past; downgrading back **genuinely revokes**; `none` stops her prescribing. Vera sees
    all of her own throughout — this is a share, not a deletion.
16. **Sharing is yours alone** — a coach holds no `share:manage` at all, and one trainee's
    choice reveals nothing of another's.
17. **Invites** — the reply is `{ id }` and nothing more; the hash never leaves the engine;
    a wrong identifier is refused, the right one (case- and space-normalised) is accepted;
    accepting twice is refused; the new trainee has **no permissions until the platform
    drains the intent**, and afterwards is a member her inviter may prescribe to and other
    coaches may not.
18. **Direction** — a coach cannot invite a coach, a trainee cannot invite a trainee, an
    outsider cannot invite at all; a coach accepting a trainee's invitation shares nothing.

19. **Sets and supersets** — a ramp survives the snapshot set for set, `target_sets` agrees
    with it, the superset key is carried and adjacent; rewriting your own sets is yours to
    do and Björn's are not, even knowing the item id; a completed programme refuses new
    sets. Also asserts Vera can **start her own programme**, which the UI used to hide.
20. **Onboarding** — seeded for Vera, absent for Björn; answering changes only your own;
    a coach is refused at `share:manage`, not at a record lookup; out-of-range answers are
    refused at the boundary.

21. **Cardio** — 20 cardio exercises, the outdoor ones needing nothing; a 5000 m row logged
    with its duration and heart rate; the summary reports `volume 0` **and** 22 minutes of
    work, so a conditioning block does not complete as though nothing happened; an
    implausible heart rate is refused at the boundary, a plausible one accepted.

22. **Booked training** — Wednesday 11:00 is due on a Wednesday and Saturday is not; the
    agenda is sorted; `begin` opens a session and then **resumes** it rather than opening a
    second; a `planned` programme is refused with *start it first* rather than started
    behind the guard's back; Björn can neither book nor begin Vera's training; a duplicate
    slot is quietly deduped and a malformed time refused.

23. **Training alone** — Björn ends his coaching relationship outright, builds two booked
    workouts in one call each, and the agenda deals them Mon-A / Wed-B / Fri-A. He trains
    one and it stays `in_progress` — a standing workout a month old is the normal case, not
    a half-finished one — and neither coach can reach any of it.

24. **Chat** — reading marks read for the reader only; Ola, a legitimate coach, cannot read
    or write a word of Vera's thread and it never appears in Björn's inbox; a coach on the
    strictest sharing setting can still write; ending the relationship closes the thread for
    both sides; reconnecting reopens it with all four messages intact.

Every denial is pinned **to the specific permission key**, not just to the words "permission
denied", and paired with a control proving a neighbouring door is still open. That matters
here: after rev 4 a trainee *does* hold `workorder:create`, so a test that only matched
/permission denied/ would have stayed green while testing something else entirely.

## 8a. Navigation — the bar follows the person

Five tabs was the schema leaking into the UI. Now: **Today · Workouts · Me** for a trainee,
**Today · Programmes · Trainees · Me** for staff, with Me last.

**Exercises are not a destination.** Browsing the catalogue happens while building a
workout; the personal library — earned and authored, the "yours forever" set — belongs on
Me. `#/exercises` remains a route, so links and filters still work.

**Chat is not a tab either.** A conversation belongs to the person it is with: your coaches
on Me, the roster row on Trainees. Unread rides the tab that leads there as a count.

This surfaced a real bug: the roster was defined as *people whose programmes I can see*, so
a coach whose trainee had just joined — sharing row, live conversation, no programme yet —
saw an empty list with an unread message in it. `stride/trainees` now has a third branch,
`message:read` on the trainee record: the relationship itself, still a `ctx.check` rather
than a filter.

## 9. Mobile

Vite + React under `app/`, mobile-first: single column, thumb-reachable targets, a
number-pad set logger (reps / load / RPE) as the primary screen, and a dev principal picker
to switch between admin, the two coaches and the trainees. Same thin HTTP routes.

**`x-principal` is a dev seam, not a login.** It must be replaced with real auth before this
is exposed to anyone — shipping it as-is is a cross-tenant hole with a UI.


---

## 10. Checkpoint approval

Both human checkpoints were presented and **approved on 2026-08-22**:

- **Migration `stride/0001-init`** — approved. It is now append-only: change the schema
  by adding `0002-*`, never by editing `0001-init`.
- **The permission table in §7** — approved, including the three rows called out
  explicitly: node-level `exercise:read` for admin, gym-wide `workorder:*` for coaches
  (safe only because of the guard in §3), and a coach's reach into exercises their own
  trainee earned from another coach.

**rev 4 through 11 — approved 2026-08-22**, acknowledged on promotion with
`--ack-permissions --ack-migrations`. Migrations `0002`–`0008` are append-only from here.
Previously listed as awaiting approval: Migrations `0002-self-serve`, `0003-equipment-and-schedule`
`0004-sharing` and
`0005-sets-supersets-onboarding`; the new keys `equipment:manage`, `share:manage` and the three
`invites:*`; the trainee rows added in rev 4; and — in rev 6 — the **removal** of the
permanent `trainee → coach` edge in favour of revocable sharing; and in rev 7
`template:read-shared` for trainees. Presented but **not yet approved**.

## 10a. Deployed

Pushed to workspace **Markus** (`t-5ra4yxscep`) and promoted to `prod`:

```
VERSION  ADMISSION  CHANNELS  ID
0.0.0    admitted   prod      01M0MTVFEN06BZB9AH7CWMESDF
```

`src/worker.ts` is the deployed entry — `defineScopeDO(MODULES)`, the platform's
`/internal/*` surface, an OIDC relying party on `/api/auth/*`, and one `/op/:operation`
route. `src/server.ts` remains a local SQLite harness and is not deployed.

**Three things the deploy taught us**, each a real fix rather than a config tweak:

1. **The worker must not import the harness.** `worker.ts` pulled `MODULES` from `seed.ts`,
   which speaks SQLite — so the bundle tried to put `better-sqlite3` inside a Durable
   Object. The module set, role table and grant shapes moved to `src/modules.ts`, which
   imports engines and this vertical and **no adapter**. That is what makes "what runs in
   production is what the tests exercised" literally true: one array, registered twice.
2. **The permission surface is declared in code**, not restated in config.
   `modules.ts` exports `definePermissions({ modules, roles, entityGrants })` and
   `package.json` points at it, so what a reviewer acknowledges and what the platform
   enforces are derived from the same function.
3. **`CONTROL_PLANE` is the platform's, not ours.** A vertical declares only the stores it
   owns — one Durable Object per scope. Declaring the directory would have stood up a
   second, private one beside the real one, and the platform refuses it.

**Not yet live to a person.** Nothing is installed against a hostname, and the OIDC
instance config (`OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `SESSION_SECRET`)
is unset — `authFor` throws rather than defaulting, so an unconfigured instance refuses
every request instead of serving one to whoever asks.

## 10b. The HTTP surface is declared, not written

The routes were hand-written twice: Hono handlers in the dev harness, and a single
`/op/:operation` RPC endpoint in the deployed worker. Two descriptions of one surface, in
two shapes — and the second one meant **the deployed vertical could not serve the web app
at all**, because the app talks REST.

`src/model.ts` now declares `http: { method, path }` per operation and
`mountOperations` derives the table. 43 routes, the exact count that had been written by
hand, and now written nowhere. Both runtimes mount the same declarations; they differ only
in how a request becomes a scope stub.

What the derivation does that hand-written routes were quietly not doing:

- sorts by **path specificity**, so `/exercises/publish` beats `/exercises/{id}`;
- **refuses at mount** two operations that would dispatch identically, instead of silently
  making one unreachable;
- maps a thrown `PermissionDenied` to **403 rather than 500** — in a permissioned system
  that is the difference between "you may not" and "we broke";
- validates every binding against `knownOperations`, so a typo fails at boot with a message
  naming it rather than as a 404 nobody calls.

One path changed shape in the move: a timeline is asked for **by entity**, so it is
`/timeline/{entityType}/{entityId}` rather than hanging off a programme — a programme is
only one kind of entity that has one.

## 10c. Identity is delivered, not bound

The first install failed:

> identity setup failed: the 't-5ra4yxscep/stride' app cannot receive auth settings while
> running (its deployment answered: this vertical stores no per-instance config).

`mountPlatformSurface` ships an `/internal/configure` route that **501s unless the vertical
supplies `onConfigure`**, so the scope's identity choice never reached the worker — and the
worker, reading OIDC settings from env vars that nothing populates, answered "authentication
is not configured" to every request. Two halves of one missing seam.

`src/config-do.ts` closes it. One Durable Object per **tenant**, rows keyed by scope, table
`scope_config (scope_id, key, value)` — the same shape as `vertical-auth`'s `IdentityDO`, so
it can be swapped for the real thing later without migrating a row. It is **harness**, not
module code: config is not domain data, and it has to outlive a scope-DO wipe.

**The session secret is minted in the DO, not bound.** An env var would be shared by every
install of this serving script, so one tenant's session cookie would verify against
another's. It is generated with Web Crypto on first use and never leaves the object — it
appears in no binding, no env spec, no config entry. The `envSpec` block this vertical used
to declare is gone.

Observable on the live preview after the fix:

```
/internal/configure   403  not a platform call        ← gate intact, no longer 501
/api/auth/login       503  no identity provider configured — deliver substrat:auth
```

That 503 is the new code path reading the config DO, replacing the old message about
missing env vars.

**One thing the brief asked for that this path cannot express.** It called for a new
wrangler migration tag (`v2`) for `ConfigDO` rather than appending to a shipped `v1`. The
CLI's `runtimeNeeds` path emits exactly one tag — `migrations: [{ tag: 'v1',
new_sqlite_classes: <every store> }]` — and ignores a hand-authored `wrangler.jsonc`
entirely ("note: substrat.runtimeNeeds is set — wrangler.jsonc is ignored for this push").
The push was accepted regardless, because every version is its own script
(`deploymentRef` carries the version id), so tags start fresh per script. Worth confirming
that holds for the stable serving script a promote points at.

## 11. Deltas discovered while building

Recorded here because a design document that quietly diverges from the code is worse than
none.

1. **The scaffold's version pins were stale.** It pinned `@substrat-run/kernel@^0.29` while
   the current `engine-workorder` needs `^0.67`, so two incompatible copies of the kernel
   installed and nothing typechecked. Everything is now on `0.83.x` / `engine-workorder
   0.7.3`, `better-sqlite3` is on a single version (13.x), and the pnpm build allowlist
   moved to `pnpm-workspace.yaml` where pnpm 11 actually reads it.
2. **The kernel demands a `subjectId` on every person-linked event**, for `pseudonymous`
   as well as `direct` — crypto-shredding has to be able to key an erasure. Every
   `stride.*` event about a person now carries the trainee's or coach's id.
3. **A coach could not assign the gym's own shared template.** The first version of
   `assign-program` asserted the entity-narrowed `template:read`, which a coach holds only
   against their own coach record. Shared templates arrive through the node-level key
   instead, so both operations now go through `canReadTemplate`. Caught by test 4.
   `add-template-item` still asserts the narrowed key only, on purpose.
4. **`stride/coaches`** was added — a walk, so an admin sees the roster and a coach sees
   themselves. The People screen needed it.
5. **`API_PORT`, not `PORT`.** A dev harness that launches the web app sets `PORT` for the
   web server; both processes binding it is a race with no winner. The API reads
   `API_PORT` (8871), Vite reads `WEB_PORT`/`PORT` (5173).
6. **`get-program` returns the trainee's name**, so the detail screen does not have to
   cross-reference the roster it may not be allowed to read.
