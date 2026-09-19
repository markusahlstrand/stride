---
'stride': minor
---

A workout in session is one exercise at a time, with an overview of the rest.

Starting a workout used to land you on its management page: a "Finish this block" button, a
training-schedule editor, and the whole prescription with a logger on every card. That is the
right page for shaping a workout and the wrong one for doing it.

While a session is on, the screen is now the session. A header says *Exercise 3 of 16* with a
bar for sets done; one exercise is on screen with its instruction, last time's numbers and
the logger; logging the set that completes it moves you to the next unfinished one. Previous
and *Skip for now* move by hand, and the overview below ticks each row off and takes you to
any of them with a tap. After a one-sided set the logger comes back on the other arm with
that arm's numbers.

Everything else — schedule, finishing a block, adding exercises, session history — is behind
*Workout settings*. A baseline has no schedule to set, and ends on *Save it and see my
numbers*, which completes it and opens Progress.

A planned workout now has one button, *Start training*. It is still two requests on the wire
— `workorder/start`, then `stride/begin` — because the manifest guard rides the first.
