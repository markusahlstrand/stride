---
'stride': minor
---

Phased programmes: a plan that walks someone through dated training days and rest days.

A standing workout repeats the same prescription on the same weekdays, which cannot say
"week two is harder", "rest on day three" or "test on day thirty". A phased plan can. It
has ordered phases, days within each phase (training or rest), up to four named workouts
per day, and per-set prescriptions that are either a fixed count or AMRAP with an optional
minimum, each with a rest interval in seconds. Ability tracks with explicit, non-overlapping
result ranges pick where someone starts; a phase can be scheduled or milestone-led.

Assigning one **snapshots** the whole plan into the programme, so editing the library plan
never rewrites anybody's training, and every day's prescription is frozen again when its
session begins. Days are dated in the programme's own timezone rather than the phone's.
Pause and resume shift only unstarted days, a skip is recorded as a skip, and reaching the
end date finishes nothing: completion stays an explicit act, and a goal is achieved only by
non-voided logged sets. A milestone advance checks results through the member's sharing, so
a downgraded coach sees neither the evidence nor the goal totals.

The phase/day/track editor, copy day and copy phase, a full-schedule preview and three
editable examples (push-up, pull-up, strength) are on Plans. Today shows the day's phase and
workout, and the programme screen gets pause/resume and a rest timer. The seven operations
are declared routes, so MCP gets the same schemas.

Migration `0011-phased-programmes` adds `train_plan_sequences`, `train_program_sequences`
and `train_program_days`, all Stride-owned and keyed by the engine's ids. No new permission
keys: the operations reuse the existing authoring, programme and result checks, narrowed per
entity. Existing workouts stay unphased and need nothing.
