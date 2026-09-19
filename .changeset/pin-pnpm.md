---
'stride': patch
---

Pin pnpm, so the supply-chain policy runs on the laptop too.

`main` went red on `pnpm install --frozen-lockfile` and the prod deploy stopped:
`@cloudflare/workers-types@5.20260919.1` and `@types/node@26.6.2` were both published
within the 24h `minimumReleaseAge` window that `pnpm-workspace.yaml` deliberately leaves
covering third-party packages. Nothing was wrong with the code — the quarantine did its job
on two devDependencies that `pnpm -r update --latest` had swept up alongside the kernel bump
the exemption exists for.

It was invisible locally because there was no `packageManager` field: the `pnpm` on PATH is a
corepack shim, corepack fell back to its own default of 9.15.0, and `minimumReleaseAge` does
not exist before pnpm 11. CI meanwhile downloaded 12.4.2. The check simply never ran on the
machine where the lockfile was written.

`packageManager: pnpm@12.4.2` closes that gap — the same resolver in both places, so the
policy fails on the laptop where it is cheap instead of in CI where main is already red. The
two ranges come down one release to versions that clear the window; the lockfile was rebuilt
from a fresh resolution and nothing else moved (0 added, 0 removed, the other diffs are peer
hashes that embed those two).

Worth knowing for the next upgrade: `pnpm update --latest` never updates pnpm itself, because
pnpm is not a dependency of this project — the `packageManager` field is now the one place its
version is stated.
