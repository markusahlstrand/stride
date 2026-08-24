---
'stride': minor
---

Show a running session everywhere: a start countdown, a sticky bar, and a finish.

Three moments, and nothing else in the app moves. A 3·2·1 countdown over the workout
when you begin; a bar docked above the tab bar on every screen carrying the workout,
how far in you are, and a live clock, which is one button back to the logging screen;
and a finish card with confetti, the session's stats and the "Yours forever" earn
folded in. The design's four keyframes are used verbatim — with the countdown and
confetti running ONCE rather than the canvas's `infinite`, which a canvas only does
because it has to loop.

Every one of them is skipped entirely under `prefers-reduced-motion`, not shortened.
A countdown you cannot opt out of is worse than no countdown. The pulse survives as a
held state, so the dot still reads "open" without moving.

**A session's end is DERIVED, never stored.** It ends when the last prescribed set is
logged: `target_sets` says what was asked for, the append-only results say what was
done, and `logged_at` says when. So the finish moment arrives on its own rather than
waiting to be asked for, and its duration is read from the data — the session opened
at `performed_at`, the last set landed at `logged_at` — not from the phone, so it says
the same thing on every device and survives a reload. A stored "finished" flag would
be a third source of truth that could disagree with the two that already answer.

Ending writes nothing. Every set was logged when it happened, so the card is a receipt
for rows that are already durable, not a save. What IS device-local is the live clock,
which is why it sits in `localStorage` and nowhere else; Pause and End session are the
manual exit for stopping short.

Not built: the interval/tabata screen. The handoff calls it "the same clock counting
down", but nothing in the domain describes rounds, work or rest — that is a domain
feature with its own design pass, not a UI job.
