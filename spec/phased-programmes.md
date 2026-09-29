Status: design approved · Last updated: 2026-09-24 · Implementation and checkpoints pending

# Phased programmes and challenges

## What someone can do

Create a reusable plan that takes someone through a sequence of training days and
rest days. Give its phases names, set the exercises and prescriptions for each day,
and optionally give it a measurable goal. Start a personal copy, see today's session,
log sets with the existing logger, and see both training progress and progress through
the programme. Coaches can assign these plans within their existing reach; members
and enrolled admins can follow their own.

Examples this structure should support:

- A push-up progression towards 100 consecutive reps, following the kind of
  structure used by Hundred Pushups: entry assessment, ability tracks, weekly
  sessions and retests. The goal is not tied to an assumed 100-day deadline.
- A pull-up progression that changes movements and targets, includes rest days,
  and ends in an assessment.
- A strength block with multiple workouts in a week, changing prescriptions by
  week, and a lighter phase followed by a test.

These are capabilities, not a promise that a particular training outcome will happen
on a deadline. The user confirmed scheduled and milestone-led phases, authoring in Stride and
MCP, and example plans. Exact example prescriptions remain to be specified.

## What exists and what needs building

Stride already stores exercises, private/shared plans, personal workouts, booked
slots, prescribed sets, append-only performed sets, voids and progress curves. A plan
is copied on assignment, so later library edits do not change a person's workout.
The existing workout lifecycle and isolation remain in use.

The additions are phases, ordered programme days, day-specific prescriptions,
a personal schedule, session prescription snapshots, goal definitions, and the UI
and MCP operations to work with them. The current repeating weekday schedule cannot
express a 30-day sequence with varying rest intervals or different week-two targets.

The published Substrat engine inventory was checked. None of the listed engines
provides training progression. The existing work-order engine continues to own the
personal programme lifecycle; phase/day behaviour belongs in Stride. No new engine
or external integration is proposed for the first version.

## The user flow

1. In Plans, create a phased plan or customise an example. Add phases, then training
   and rest days within them. Copy a day or week and change its targets.
2. Preview the whole schedule before starting. A day can contain multiple named
   workouts, each with its own exercises, set prescriptions and notes.
3. Start a personal copy with a start date and timezone. Today shows the date,
   programme day, phase and the relevant workout; a rest day says Rest.
4. Log performed sets as today. A started session keeps the prescription it began
   with. Future edits cannot rewrite that session or its adherence denominator.
5. Inspect the full programme, reschedule an unstarted day, repeat a day or phase,
   or pause and resume. Skipping a day records a skip, never a completed workout.
6. Finish explicitly. Reaching the end date alone never means the training was done
   or the goal achieved. Progress distinguishes calendar position, completed work
   and the measured goal.

An entry assessment can recommend a starting phase and ability track. Retests can
recommend another track for future workouts. Show the reason and ask the member to
confirm before changing their schedule; preserve all earlier prescriptions. Selection
rules use explicit, non-overlapping result ranges rather than arbitrary formulas.

A prescribed set can be a fixed quantity or an AMRAP set with an optional minimum.
Store this distinction and the rest interval in seconds; do not hide them in notes.
The logger always records the actual count. An AMRAP result is not capped at its
minimum, and a minimum is not represented as a promised maximum. Goal tests count
one continuous set for the same exercise variant, never the sum of several sets.

Training plans can be authored and inspected through MCP as well as the UI, with
concrete argument schemas from the same declarations. An assistant can answer both
“What should I do today?” and “What did I actually do?” without confusing them.

## Scheduling rules — both modes requested

A fixed schedule advances its calendar position by local date, including rest days.
Missed workouts remain visible as missed; there is no automatic catch-up session.
Pause/resume shifts unstarted future days. History and performed timestamps stay put.
A repeat creates a new occurrence, rather than reopening or relabelling the old one.

For achievement-led phases, recommend a visible milestone and explicit confirmation
to advance. First-version checks cover a specified exercise's single-set quantity,
a daily quantity, or cumulative quantity from non-voided sets in this programme.
Do not use a calendar deadline as evidence of an achievement. A coach only sees
supporting result evidence that the member's sharing permits them to see.

Programme timezone determines day boundaries, including daylight-saving changes.
Client clocks do not decide progression. Existing unphased workouts retain their
current scheduling behaviour.

## Data to keep — migration preview, not approved SQL

- A reusable plan's ordered phases: name, position, notes and progression mode;
  optional milestone definition and source attribution/title/URL.
- Ordered days within each phase, with an explicit training/rest designation.
  Workout slots within a day have names and ordering, allowing two sessions in a day.
- Prescriptions under each workout slot: exercise, quantity, unit via the exercise,
  load, explicit set rows, laterality, supersets and notes, reusing current semantics;
  additionally a fixed/AMRAP target mode, optional AMRAP minimum and rest seconds.
- Named ability tracks with explicit assessment-result ranges, start-phase choices,
  and per-track prescriptions. Record the selected track and assessment evidence
  when the user confirms a choice; snapshot future assignments accordingly.
- A personal copy of the complete plan on assignment, including names, phases,
  days, workout slots, goals and prescriptions. It is owned by the existing personal
  programme, not a live reference to a library plan.
- Personal schedule information: timezone, start date and dated occurrences, with
  explicit pause, reschedule, repeat, skip and phase-advance history.
- Each session's occurrence reference and immutable prescription snapshot, so
  changing next week's target does not change last week's plan or results.
- Goal definitions with an exercise and measurement scope. Achievement is derived
  from live logged sets; voiding a set recomputes it. An earlier phase advancement
  remains an audited decision, not an invisible rollback.

All new storage is Stride-owned. Existing programmes require no user action and
remain unphased. Exact migration SQL and link edges need a separate review after
this design is agreed. Historical aggregate adherence for phased programmes must
use scheduled occurrences and frozen session prescriptions, never multiply the
current phase's prescription across the whole past programme.

## Who may see or change it

| Person | Access |
|---|---|
| Member | Create private plans, share their plans under existing sharing rules, start and manage their own programme, read and log their own results. |
| Coach | Author their own plans and assign/manage programmes only where existing narrowed permissions allow it. Results remain limited by the member's sharing. |
| Admin | Curate the gym library, manage its programmes and read results within that gym, including their own training if enrolled. |
| Another gym | No access to these plans, schedules or results. |

A gym-wide shared plan contains instructions, never the author's logged results.
Programme read permission does not imply permission to read performed sets, milestone
evidence or goal totals. Those reads must walk visible sessions, including in MCP.
Sharing downgrades must remove this new access just as they remove current access.
There is no money, billing or clinical sign-off in this addition.

The intended implementation reuses existing authoring, programme and result permissions.
That is a proposal, not a claim that node-level authoring alone permits editing a
particular plan. Every new operation needs the relevant entity-narrowed check, every
new traversed edge must be declared, and the exact permission diff remains a checkpoint.

## First-version boundaries

Include a phase/day editor, copy-day/week actions, personal scheduling and manual
rescheduling, logging and progress, plus corresponding MCP operations. Existing
single-workout plans remain the simple default. Phased plans are available from Plans
and Workouts/Programmes; no new top-level navigation destination is required.

Use explicit prescriptions first. A percentage-of-max calculator, arbitrary spreadsheet
formulas, automatic load increases after success/failure, and importing arbitrary URLs
or spreadsheets are later extensions. A programme may be represented with explicit
loads without claiming that its spreadsheet's adaptive logic has been implemented.
Source links can be retained now. Example plans must be previewable before assignment;
no programme will be enrolled or started on the user's behalf during development.

## Proof before release

- Build a multi-phase plan with different day prescriptions, rest days and a test.
  Assign it, change the reusable plan, and prove the personal copy is unchanged.
- Log sessions on either side of a phase boundary and verify exercise names, set
  targets, actual sets, historical adherence and cross-phase progress.
- Cover timezone/daylight-saving boundaries with an injected clock, plus pause,
  resume, skip, repeat, duplicate begin/advance requests and multiple daily workouts.
- Verify entry-test track selection, boundary values in selection ranges, retests,
  confirmed track changes, and AMRAP sets with and without a minimum. Fixed-count
  sets retain their existing behaviour. Rest intervals survive assignment and reads.
- Prove voided sets no longer count towards goals, and a calendar deadline alone
  never completes a programme or marks its goal achieved.
- Prove owner access, unrelated member/coach denials, sharing downgrade and
  cross-tenant isolation. Do not leak goal totals through schedule summaries.
- Call schema discovery, programme reads, next-session and progress through MCP;
  missing fields must produce useful errors. Exercise the UI and real signed-in HTTP
  flow as both an allowed and a denied person.

## References and review questions

Garage Gym Reviews' supplied article URL returned 404 during this review. Its
[30-day pull-up plan PDF](https://www.garagegymreviews.com/wp-content/uploads/30-Day-Pull-Up-Plan.pdf)
provides the concrete pattern of changing prescriptions, rest days and a final test.
[Lift Vault's strength programme collection](https://liftvault.com/programs/strength/)
shows why week-specific workouts and future support for calculated loads matter.
Neither reference is being copied into the shipped catalogue by this draft.

[Hundred Pushups](https://hundredpushups.com/) establishes the consecutive-rep goal.
Its [first week](https://hundredpushups.com/week1.html) and
[second week](https://hundredpushups.com/week2.html) illustrate starting levels,
rest intervals, AMRAP sets and reassessment. Build support for that structure and
ship original, editable examples with source inspiration noted; do not reproduce
the site's complete programme tables in the shared catalogue.

User decisions received:

- Push-up example: a progression towards 100 consecutive reps, like Hundred Pushups.
- Support scheduled phases and achievement milestones.
- First version: create programmes in Stride and via MCP, with example plans.

Design approval requested: does the flow above cover the intended first version,
including assessment-based tracks, rest intervals, AMRAP sets, and explicit
confirmation before milestone advancement or a track change? Access stays confined
to the same gym and the member's existing sharing permissions. No money is involved.
