---
'stride': minor
---

Sign in through a real OIDC issuer in dev, so there is one auth path instead of two.

The harness used to authenticate with an `x-principal` header naming its own principal. That
was a bad trade twice over: an impersonation bypass one environment variable away from being
live, and a FORK in the auth path — the login exercised all day was one no deployment ran, so
the real one was only ever tested in production. That is how a broken sign-in reaches a
deployed instance unnoticed.

`@substrat-run/dev-issuer` now runs a real OpenID Connect provider on :8879 whose only
shortcut is that `/authorize` lists people instead of asking for a password, and `server.ts`
is an ordinary relying party in front of it — running the SAME `oidcRpAuthProvider` that
`worker.ts` runs against the hosted issuer. The header, `/api/cast`, `/api/me`, the `?as=`
URL parameter and the app's `DEV` branch are gone with it; `/api/session` answers the same
shape in both runtimes, so the shell has one contract rather than a dev one and a real one.

`src/personas.ts` is read twice on purpose: the issuer renders it as the picker, and
`linkDevIdentities` binds each `sub` to a principal in the identity directory. `sub` is the
join, so the cast and the directory cannot drift. The pool is registered `central` because
`caller()` asks `listIdentityTenants`, which only a central pool can answer.

The scope now comes from the DIRECTORY rather than a constant, which changes one thing
deliberately: Rutger signs into his own gym, because that is where his login lives. The old
harness pinned every persona to t1 so he could be turned away on screen. The isolation he
demonstrated is proved against the kernel in tests 4 and 14, which call operations directly.

**A denial arrived as a 400.** `mountOperations` classifies a refused permission and re-throws
it as a 403 `HTTPException`, but the harness's `onError` read only the message and fell
through to its 400 default — so "not signed in" surfaced as *Rejected* rather than as a
denial. It honours the classified status first now. The old seam could not have exposed this:
with an impersonation header you were never signed out.

`changeOrigin` is off in the vite proxy, deliberately. The provider derives its redirect URI
from the request's own origin, so rewriting Host would send the browser to the API port after
sign-in and strand it outside the app.

First-party packages move to kernel/contracts/host/adapters 0.87 and vertical-auth 0.8, which
`dev-issuer` requires — a second copy of `contracts` would break branded types exactly as a
second copy of zod does.
