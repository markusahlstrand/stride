---
'stride': minor
---

Upgrade to kernel 0.85 and engine-workorder 0.8.

`listOrders` is paged now, so the three reads that must see every programme — the schedule,
the week's agenda, and the revoke that `set-sharing` performs — drain the pages explicitly.
A first page is not an answer to "what does this week look like", and it is not an answer to
"which programmes must I revoke" either: that one would reopen the leak it exists to close.
One programme by id is `getWorkOrder`, never a list walked with `.find`.

Module code takes its clock from `ctx.now()`, so a row and the event announcing it agree
about when, and elapsed time can be tested with a manual clock instead of a sleep.

The design document moved to `spec/concept.md`.
