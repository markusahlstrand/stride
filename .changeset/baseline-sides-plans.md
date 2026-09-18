---
'stride': minor
---

A whole-body baseline, left and right as two numbers, body measurements, running, and plans anyone can make and share.

Written for someone getting back in shape after a shoulder operation, whose left arm does
less than the right, who wants to know where they started and whether the gap is closing —
and who has no coach and should not need one.

**Sides.** An exercise is `bilateral` or `unilateral`, and on a unilateral one every set —
prescribed or performed — names `left` or `right`. A single-arm press logged without a side
would collapse two numbers into one, and a side on a barbell squat is a claim nothing can be
done with; both are refused at the boundary with a sentence. `target_sets` is per side, sets
are numbered per side, and adherence counts both arms. A prescription can now differ per arm
— left 8 @ 2 kg, right 8 @ 4 kg — which is how the next session gets adjusted once the gap
is known.

**The baseline** is a programme of kind `assessment` from a new starter plan: sixteen light
sets covering the whole body, ten of them per side, every one doable with dumbbells, a band
and a mat. You write down how many you managed and at what weight. It is the skippable third
step of onboarding and is always available from the new Progress screen.

**Progress** stores nothing: it folds the append-only results into one point per exercise,
side and session, and reports left against right as an exact percentage in integer
arithmetic. It walks sessions with `result:read`, so a coach sees exactly what was shared
with them and no more.

**Measurements** — weight, girths, grip, shoulder range of motion — are a new append-only
table, decimal strings, sided where a body is. No new permission keys: they ride
`result:log` / `result:read` on the trainee record.

**Running** needed no schema: metres plus a duration is pace. The logger takes `mm:ss` and
shows pace live, and a running base week joins the library.

**Plans.** A workout is one person's run of a plan; the plan is the reusable part. Anyone can
now author one, add and remove exercises, share it with the gym and withdraw it. Sharing is a
visibility flip read by the key everyone already holds; the author keeps the only right to
edit it. This surfaced that a trainee never held `template:read` on their own record, so
they could create a plan and never add an exercise to it — that entity grant is added.
Existing trainees on a deployed instance need it back-filled by the platform.

Migration `0009-sides-and-measurements` is additive. The starter-library installer now tops
up a library plan that already exists with rows a later revision added.
