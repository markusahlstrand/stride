---
'stride': minor
---

Lay the app out for desktop: the tab bar becomes a left nav rail.

"Desktop is the same app, not a new layout" — so this is one breakpoint, not a
second set of components. The bar becomes a 216px rail with the wordmark above and
the signed-in person at its foot, and the content keeps its 520px column beside it.
Nothing inside the column changes.

A VIEWPORT query, deliberately, never user-agent detection. What should decide the
layout is how much room there is: a half-width desktop window genuinely has a
phone's worth of space and now gets the phone's layout, while a tablet, a
desktop-mode browser, or someone dragging a window edge would each defeat a guess
about the device. 900px is the first width that fits the rail, the column and its
gutters with room to spare.

Identity returns here, and only here: on mobile there is no chrome to hold it so it
lives on Me, on desktop the rail holds it. Both now match the canvas.

Two details worth keeping: `changeOrigin` stays off in the vite proxy, because the
OIDC provider derives its redirect URI from the request's own origin and rewriting
Host would strand the browser on the API port after sign-in. And the rail is placed
with `order: -1` rather than by moving the `<nav>`, so the document still reads
content-then-nav and the tab key reaches the screen before the chrome.
