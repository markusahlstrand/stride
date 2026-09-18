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

`app/public/` now holds the two SVG sources — the full-bleed mark and a maskable cut whose
figure pulls into the safe circle Android crops to — plus the derived PNGs for
`apple-touch-icon`, 192, 512, the maskable 512 and a 32px favicon fallback. `icon.svg`
carries the `rsvg-convert` lines that rebuild them in a comment, because the PNGs are
generated and nothing else in the repo would say so.

The manifest names the app, starts it at `#/today` and paints the splash in paper. It
declares `display: "standalone"`, which is what makes a pinned icon open without browser
chrome — worth knowing because that also means the OIDC round trip runs in a webview with
its own cookie jar. If an older iOS bounces out to Safari mid-redirect, `"browser"` is the
whole fix.

Front end and assets only. No module code, no permissions, no migrations.
