---
'stride': minor
---

Notices are toasts: lower right, and they leave by themselves.

The banner used to sit sticky at the top of the column, where it pushed the screen
down and stayed until it was tapped. It floats in the lower right now — on a phone
that is the bottom of the screen, so it sits above the tab bar rather than over it —
and it goes away on its own: four seconds for a confirmation, nine for a refusal or
an error. The difference is deliberate. "Done" is read at a glance; a refusal names
the permission that was checked and says nothing changed, and it has to be READ.

Three things keep a disappearing refusal honest. The clock stops while the pointer or
keyboard focus is on it, so nobody loses one halfway through the permission key.
Tapping still dismisses it. And it is announced — `alert` for a refusal or an error,
`status` for a confirmation — because it no longer sits in the reading order where a
screen reader would have met it.

The timer is keyed on the notice object, which `run` mints fresh every time, so a
second identical refusal restarts the clock instead of inheriting what was left of the
first. It also depends on a STABLE dismiss callback: an inline arrow would be a new
function on every render of the shell, so the unread poll, a route change or the session
bar appearing would each quietly restart the clock.

It renders outside `<main>` now. A toast is not part of the column, and on desktop
`main > *` would have capped and centred it.

Front end only.
