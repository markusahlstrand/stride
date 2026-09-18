---
'stride': minor
---

Stock a deployed gym, let its admin train in it, and reshape a workout before starting it.

**The starter library is an operation.** The default catalogue used to be published by the
local seed only, so the first deployed gym came up with no equipment, no exercises and no
templates. `stride/install-starter-library` installs it through the ordinary publish
operations, attributed to the admin who pressed the button, idempotent by slug and by name.
The seed calls the same operation, so the scenario exercises it on every run.

**An admin can enrol themselves** with `stride/train-myself`. It mints no grants — an admin
already holds what a trainee needs at node level. `whoami` now asks for the admin key first
and reports `traineeId` beside `role`, so making yourself a workout no longer demotes the
person who runs the gym to a trainee.

**Creating never starts.** Every path leaves a new workout `planned` and opens it, because a
workout built from a template is almost never right first time. The item editor rewrites a
row through `set-item-sets` and drops one through the new `remove-program-item`, both gated
on the narrowed `result:log` for that programme and neither offered once the block is
completed.

Adding a workout lives on the workouts screen for both roles, and "for whom" is asked only
when there is more than one answer.
