---
'stride': minor
---

Take the identity bar off the top of every screen; identity lives on Me.

The design puts nothing above a screen's own title — every artboard is status bar,
then "Today" or "Me", then content — and identity belongs to the profile card on
Me, which the app already rendered. The bar was duplicating it.

It was there for a reason that had expired. `.who` existed to hold the DEV PERSONA
PICKER, and "SIGNED IN · Sign out" was only the other half of that ternary; when the
picker went, so should the strip around it. Its CSS comment still read
`/* the persona bar: the dev principal picker */`.

Two things quietly depended on it and move with it: the safe-area top inset, now on
`main`, without which content runs under the notch; and the notice banner's sticky
offset, which was `top: 64px` — the bar's own height — and is now the safe-area inset.

Sign out moves to the foot of Me. The canvas draws no sign-out on any signed-in
screen, which is a gap rather than a decision, so it follows the one precedent the
design does set: the "Not a member here" gate signs you out with the OUTLINE
treatment, never the accent fill. Leaving is a way back, not the thing to do.
