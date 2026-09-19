---
'stride': minor
---

A timed exercise has a clock in it.

A plank, a dead hang, a single-leg balance: the hold IS the number being logged, and the
phone lying on the mat is the only thing in the room that knows it. Until now the app asked
you to remember it and type it in afterwards.

An exercise measured in seconds now logs with a stopwatch above the fields. Start, hold,
Stop. The prescribed hold sits beside the clock, which turns green once you pass it and
buzzes once for somebody face-down and not looking at the screen. It counts up rather than
down, and it never stops you: if you drop at 0:38 of a prescribed 0:45 then 0:38 is what
gets logged, and holding longer is the point.

The running clock writes the time field on every tick, so tapping *Log set* mid-hold logs
what was actually held rather than the prescription — there is no state a forgotten Stop
can lose. It is device-local and transient, like the session clock and for the same reason:
what the gym keeps is the set, which arrives through the ordinary logging operation exactly
as a typed one does. No new table, no new operation, no new permission.
