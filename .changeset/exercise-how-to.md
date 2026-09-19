---
'stride': minor
---

Every exercise says what it is, how to do it, and what to watch for — and shows you.

The catalogue shipped with four descriptions out of 83. "Assisted arm raise" was a name, a
number of reps and a single sentence, and there was nowhere to tap to find out more. A
member meeting a shoulder-rehab week for the first time had no way to learn what they had
been asked to do.

Every one of the 83 now has a how-to, and the shape is fixed: the one-line summary a row
already showed, how to actually do it in the order your body does it, a `Watch for:` line
naming the mistake that makes it a different exercise, and a `Load:` line saying what goes
in the load box — a bar plus its plates, a pair of dumbbells added together, added weight
only on a bodyweight movement, nothing at all for a band. They are paragraphs of the same
`description` column split on blank lines, so there is no second column and no migration;
`ledeOf` is what a list row renders and `loadNoteOf` is what the set form reads.

**Tap an exercise's name and you get the movement drawn.** `app/src/moves.tsx` is 36
movement families, each drawn TWICE — where the rep starts, where it ends — with a mint
arrow between them. A single pose can only say "a person with weights"; a pair says the bar
goes from here to here, which is the thing somebody reading a name for the first time
actually needs. `moveFor` picks one off the exercise's NAME, exactly as `poseFor` does and
for the same reason. A list row shows the finish frame; the new exercise screen shows both,
each with a real caption under it — the drawings stay `aria-hidden` and the words carry the
fact, so nothing is only available to someone who can see it.

The screen is `#/exercises/:id`, reachable from the catalogue, from a workout and from
inside a running session, and Back comes straight back to where you were. It adds no
operation and no permission key: it is one row of the same `stride/exercises` the catalogue
screen reads, so if the kernel did not return it the screen says so rather than inventing a
narrower answer of its own.

**Notation that is obvious once you know it now explains itself.** A set pill reads
"1: 10 × 50" — set number, then the target in the exercise's own unit — and nothing said
so; RPE was three letters over an input box. Each carries a mint `?` that opens one plain
sentence in place, on the set pills (both the Prescription heading and the in-session
header), on RPE and on avg HR. The mark is never put inside a `<label>`: a button there
takes its accessible name from the label containing it and computes to nothing.

Fixed on the way: `install-starter-library` skips a slug the gym already has — correct,
because overwriting would destroy a gym's own edits — which meant a description the
catalogue GREW could never reach a gym that had already installed, and the first deployed
instance would have stayed on the old one line for ever. `stride/describe-exercise` (admin,
on the existing `library:publish`) is the top-up, and the test it applies is that nothing is
lost: the seed either fills an empty field or starts with exactly what is already stored.
A gym's own words are left alone, and so is anyone's private exercise — holding
`library:publish` is not a licence to rewrite what a coach or a member authored.

Also: `clockValue` is what a time input is filled from, always `m:ss`. `formatQuantity`
writes `45s` under a minute, which is right on a pill and unparseable in a box, so a
prescribed 45-second plank prefilled a field whose *Log set* was then quietly disabled.

No migration. One new operation on an existing permission key; no new keys, no role changes.
Guarded by test 36.
