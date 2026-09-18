---
'stride': minor
---

A pinned Stride is the runner, not a browser-drawn S.

The web app shipped with no icon and no manifest at all, so a phone that pinned it to the
home screen had nothing to draw but the first letter of the title. The mark is now one of
the cast: the `run` pose out of `figures.tsx` on a mint field — which is to say a
`FigureTile` at icon scale, not a new shape invented for the occasion. It says *stride*
without a letterform, and because the field carries the brand colour it still reads as
Stride at 16px, where the figure itself is a smudge.

Two things about it are deliberate. Its colours are **frozen**: a pinned icon cannot follow
the OS the way the app does, so it takes the mint-surface branch for ever — ink body in both
themes, head and headband paper-white. And the favicon is the `mini` weight, with a heavier
stroke and no eyes, hair or band, for exactly the reason the tab bar drops them at 28px.

`app/public/` holds three SVG masters, and every PNG beside them is generated from one of
the three. `icon.svg` is the full-bleed mark, and `apple-touch-icon.png`, `icon-192.png` and
`icon-512.png` come off it. `icon-maskable.svg` is the same runner pulled into the safe
circle Android crops to, and gives `icon-maskable-512.png`. `favicon.svg` is the `mini`
weight, and gives `favicon-32.png` for browsers that will not take an SVG tab icon. All
three carry the same five `rsvg-convert` lines in a comment at the top, because the PNGs are
derived and nothing else in the repo would say so.

The manifest names the app, starts it at `#/today` and paints the splash in paper. It
declares `display: "standalone"`, which is what makes a pinned icon open without browser
chrome — worth knowing because that also means the OIDC round trip runs in a webview with
its own cookie jar. If an older iOS bounces out to Safari mid-redirect, `"browser"` is the
whole fix.

Front end and assets only. No module code, no permissions, no migrations.
