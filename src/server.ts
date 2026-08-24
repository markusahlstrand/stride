import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Context } from 'hono';
import { PermissionDenied, ulid, type ScopeStub } from '@substrat-run/kernel';
import { platformActorId } from '@substrat-run/contracts';
import { mountOperations } from '@substrat-run/vertical-host';
import { devLogin } from '@substrat-run/dev-issuer';
import { knownOperations, operations } from './model.js';
import { DEV_PROVIDER } from './personas.js';
import {
  buildStrideHost,
  drainPlatformRequests,
  linkDevIdentities,
  seedStride,
  type StrideWorld,
} from './seed.js';

// ============================================================================
// A deliberately THIN dev API. Each route authenticates, gets the scope, and
// invokes ONE operation. There is no business logic here: every rule lives in
// an operation, an engine, or the guard.
//
// AUTHENTICATION IS REAL, and that is the change worth understanding. There
// used to be an `x-principal` header here — a dev seam that let the caller name
// its own principal. It was a bad trade twice over: an impersonation bypass one
// environment variable away from being live, and a FORK in the auth path, so
// the login exercised all day was one no deployment ran and the real one was
// only ever tested in production. That is exactly how a broken sign-in reaches
// a deployed instance unnoticed.
//
// Now `@substrat-run/dev-issuer` runs a real OpenID Connect provider on :8879
// whose only shortcut is that `/authorize` shows a list of people instead of a
// password field, and this file is an ordinary relying party in front of it —
// running the SAME `oidcRpAuthProvider` that `src/worker.ts` runs against the
// hosted issuer. One auth path, two issuers. Point `OIDC_ISSUER` at Auth0 or
// Keycloak and nothing in this file changes.
// ============================================================================

/**
 * FAIL CLOSED, at the door rather than per request.
 *
 * The issuer's signing key is public by design (it is checked into a public
 * repo, so anyone can mint a token it validates) and the session cookie is
 * signed with a well-known default secret. Both are the right posture for a
 * process bound to localhost and the wrong one for anything else, so this
 * harness refuses to boot unless someone said out loud that it is a dev run.
 * `pnpm dev` and `pnpm server` set it; nothing else does.
 *
 * This is a DEPLOYMENT guard, not an auth branch — there is no code path here
 * that authenticates anyone differently. `src/worker.ts` is what deploys.
 */
if (process.env.STRIDE_DEV_AUTH !== '1') {
  console.error(
    'refusing to start: this is a dev harness with a public-key issuer and it will not\n' +
      'guess that you meant to run it. Set STRIDE_DEV_AUTH=1 (pnpm dev does) — and never\n' +
      'expose this process. src/worker.ts is the deployed entry point.',
  );
  process.exit(1);
}

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '.data');
mkdirSync(dataDir, { recursive: true });

const host = buildStrideHost(dataDir);
const world: StrideWorld = await seedStride(host, dataDir);

// Bind each persona's `sub` to its principal. Runs on every boot, not just a
// fresh seed, so an existing `.data` dir picks up its identity links.
await linkDevIdentities(host, world);

/**
 * THE RELYING PARTY. `directory: host.admin` is the same identity directory the
 * platform writes into when it provisions a hosted instance — `caller()` asks
 * it which tenant this subject exists in and which principal they are there.
 *
 * Note what this means for the scope: it comes from the DIRECTORY, not from a
 * constant. Sign in as Rutger and you get Sydpuls Gym, because that is where his
 * login lives. The old harness pinned everyone to t1, which quietly made "which
 * gym am I in" a question the harness answered instead of the directory.
 */
const login = devLogin({
  directory: host.admin,
  actor: platformActorId.parse(ulid()),
  provider: DEV_PROVIDER,
});

async function stub(c: Context): Promise<ScopeStub> {
  const caller = await login.caller(c.req.raw.headers);
  // Not a 500 and not a redirect: the app asks `/api/session` whether anyone is
  // signed in, and every other route answers a denial as a denial.
  if (!caller) throw new PermissionDenied('not signed in');
  return host.getScope(caller.principal, caller.tenantId, caller.scopeId);
}

const app = new Hono();

/**
 * The PLATFORM SIDE, standing in for the control plane.
 *
 * An operation that needs a privileged act — assigning a role, minting a new
 * person's first grants — enqueues an intent with `ctx.requestPlatform` instead
 * of doing it, because module code holds no `HostAdmin` authority. Here that
 * drain runs after every request; hosted, the control plane does it. Draining
 * AFTER `next()` matters: the intent must have committed before we execute it.
 */
app.use('*', async (c, next) => {
  await next();
  try {
    await drainPlatformRequests(host, world.t1, world.s1);
  } catch (err) {
    console.error('platform drain failed', err);
  }
});

app.onError((err, c) => {
  const message = err instanceof Error ? err.message : String(err);
  // A denial must arrive AS A DENIAL — never as a generic 500, and never as a
  // generic 400 either.
  //
  // `mountOperations` has ALREADY classified what the kernel names — a refused
  // permission, an input that failed to parse, a runtime fault — and re-thrown it
  // as an HTTPException carrying the right status. Honour that first. Matching on
  // the message alone silently downgraded "not signed in" from the 403 it was
  // classified as to a 400, which the app renders as "Rejected" instead of as a
  // denial. The patterns below stay for this harness's own domain vocabulary.
  if (err instanceof HTTPException) return c.json({ error: message }, err.status);
  if (err instanceof PermissionDenied) return c.json({ error: message }, 403);
  if (/permission denied/.test(message)) return c.json({ error: message }, 403);
  if (/invalid transition|immutable|already/.test(message)) return c.json({ error: message }, 409);
  if (/not found|unknown scope|unknown operation/.test(message)) return c.json({ error: message }, 404);
  return c.json({ error: message }, 400);
});

/**
 * Sign-in, callback, sign-out — the Authorization-Code + PKCE round trip. Not
 * one line of it is written here or in `src/worker.ts`: both hand the request to
 * the same provider, which is the entire point of moving the user picker out of
 * the vertical and into an issuer.
 *
 * The redirect URI is derived from the request's own origin, so the vite proxy
 * must NOT rewrite Host (`changeOrigin` is off in `app/vite.config.ts`) — with
 * it on, the browser is sent to the API port and walks out of the app.
 */
app.on(['GET', 'POST'], '/api/auth/*', (c) => login.handle(c.req.raw));

/**
 * WHO AM I — the app shell's first call, and the only route that answers while
 * signed out. Deliberately the SAME shape the worker's `/api/session` returns,
 * so the app has one contract rather than a dev one and a real one.
 *
 * `needsSetup` is always false locally: the seed already owns the gym. Signed in
 * but not seated is a real state here too — a subject the directory has no link
 * for gets the "not a member" gate, the same answer the hosted instance gives.
 */
app.get('/api/session', async (c) => {
  const headers = c.req.raw.headers;
  const subject = await login.subject(headers).catch(() => null);
  const caller = subject ? await login.caller(headers).catch(() => null) : null;
  return c.json({
    signedIn: subject !== null,
    seated: caller !== null,
    needsSetup: false,
    principal: caller?.principal ?? null,
    email: subject?.email ?? null,
    name: subject?.name ?? null,
  });
});

// THE REAL SURFACE, DERIVED. Not one route written here: `mountOperations` reads
// the `http` declarations in `src/model.ts` and builds the table. The deployed
// worker mounts the same declarations with a different `resolveStub`, so the two
// runtimes cannot drift — there is only one description to drift from.
const mounted = mountOperations(app, operations, stub, {
  basePath: '/api',
  knownOperations,
});
console.log(`${mounted.length} routes derived from the model`);

const PORT = Number(process.env.API_PORT ?? 8871);
serve({ fetch: app.fetch, port: PORT });
console.log(`Stride API on http://localhost:${PORT} — data in ${dataDir}`);
console.log(`Signing in against ${login.issuer} — pick a persona there, no password`);
