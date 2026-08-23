---
'stride': patch
---

Centre the label in the sign-in and sign-out buttons.

The gate's buttons are `<a>`, not `<button>`, so nothing centres their label for free. They
asked for `line-height: 52px` to match their height and then set `font: 600 16px …` on the
next line — and the `font` shorthand RESETS line-height, so the centring was undone one
declaration after it was written. The label sat at the top of the box with a third of the
button empty beneath it.

Centred with flex instead, which cannot be silently reset and survives a label that wraps,
where a fixed line-height would have doubled the box. The same pairing was wrong in the
"Not a member here" button and in the header's sign-out, and is fixed in all three.
