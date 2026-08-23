# Changesets

This vertical is a **private** package — it is never published to npm, but its version is
what `substrat push --version` sends to the registry. `privatePackages: { version: true,
tag: false }` is what makes changesets version it anyway and skip the git tag.

`stride-app` is ignored: the web app ships inside the vertical's own deploy and has no
version anyone reads.

Add one with `pnpm changeset`, describing the change in the words a reader of the
changelog would want — not the file names.
