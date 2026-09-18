---
'stride': minor
---

A new look: ink & mint, and a cast of stick figures training around the pages.

The app becomes a gym notebook — warm dotted paper, thick ink outlines, hard sticker
shadows, and one accent. Bricolage Grotesque says words, DM Mono says numbers, and
Caveat Brush is the pencil in the margin. Paper is now the default and the dark theme
is a chalkboard, still resolved from the OS with no toggle.

The mint is a FILL, never text. `#7fd08a` on paper is about 1.7:1, so there are two
accent tokens now: `--accent` fills things and carries `--on-accent`, and `--accent-ink`
is the deep green that may be set as text. On the chalkboard the two meet.

The figures are one stick figure in fourteen poses (`app/src/figures.tsx`): ink for the
body, mint for the kit, so they follow the theme like everything else. They are
decoration and always `aria-hidden` — a figure never carries a fact the text beside it
does not already say. `poseFor` picks a pose off an exercise's NAME, because that is the
one thing every row carries; a wrong guess costs nothing.

Where they turn up: the tab icons (a runner, a lifter, somebody cheering, a wave); a
figure standing on the button of the mint "up next" card, doing whatever is first on
today's list; a tile beside every exercise on Today, in a workout and in the catalogue;
somebody lying down in all seventeen empty states, and sitting it out in the two that
are refusals; a runner on the session's progress track; a cheer where the finish tick
and the earned tick used to be; left and right facing each other on the symmetry card;
a wave on Me and on the sign-in gate.

Two small things are new rather than restyled. Today gets a week strip — the days you
train inked in, a runner on today — read off the booked slots, so it is the plan for
the week and never claims a past day was done. And the logging screen gets the runner
track, read off the same `done`/`total` the session bar reports, so the two cannot
disagree.

Fixed on the way: on desktop the line under four screen titles sat in the gutter,
because an inline `margin` shorthand zeroed the auto side margins that centre the
column.

Front end only. No module code, no migration, no permission changes.
