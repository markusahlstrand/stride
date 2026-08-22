import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { PermissionDenied, type ScopeStub } from '@substrat-run/kernel';
import type { PrincipalId } from '@substrat-run/contracts';
import { mountOperations } from '@substrat-run/vertical-host';
import { knownOperations, operations } from './model.js';
import {
  buildStrideHost,
  drainPlatformRequests,
  seedStride,
  type StrideWorld,
} from './seed.js';

// ============================================================================
// A deliberately THIN dev API. Each route authenticates (a dev principal picker
// via the `x-principal` header — a real deployment swaps in a session), gets the
// scope, and invokes ONE operation. There is no business logic here: every rule
// lives in an operation, an engine, or the guard.
//
// `x-principal` is a DEV SEAM, NOT A LOGIN. It must be replaced with real auth
// before this is exposed to anyone: shipping it is a cross-tenant hole with a UI.
// ============================================================================

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '.data');
mkdirSync(dataDir, { recursive: true });

const host = buildStrideHost(dataDir);
const world: StrideWorld = await seedStride(host, dataDir);

/**
 * The dev cast, keyed by the `x-principal` header value. Every entry is a real
 * principal with real tuples — nothing here is a bypass. `role` is a LABEL for
 * the UI; it grants nothing.
 */
const CAST: Record<string, { name: string; role: string; principal: PrincipalId; subjectId?: string }> = {
  astrid: { name: 'Astrid Kihlberg', role: 'admin', principal: world.astrid },
  nina: { name: 'Nina Ljung', role: 'coach', principal: world.nina, subjectId: world.ninaId },
  ola: { name: 'Ola Sandgren', role: 'coach', principal: world.ola, subjectId: world.olaId },
  vera: { name: 'Vera Holm', role: 'trainee', principal: world.vera, subjectId: world.veraId },
  bjorn: { name: 'Björn Ek', role: 'trainee', principal: world.bjorn, subjectId: world.bjornId },
  rutger: { name: 'Rutger Palm — Sydpuls Gym', role: 'outsider', principal: world.rutger },
  // Nobody yet. Real principal, no records, no role — pick this one to accept an
  // invitation and watch someone become a member of the gym.
  newcomer: { name: 'Someone with an invitation', role: 'newcomer', principal: world.newcomer },
};

/**
 * FAIL CLOSED. The dev cast only exists when this process was started with
 * `STRIDE_DEV_AUTH=1`, which `pnpm dev` and the tests set and nothing else
 * does.
 *
 * Before, an unset variable meant "use the cast" — so this file deployed
 * anywhere was a cross-tenant hole with a UI: anyone could claim to be the
 * admin, or the attacker persona from the other gym. An unset variable now
 * means "there is no authentication here", and the server refuses every request
 * rather than serving one to whoever asks.
 *
 * This is a seam, not a login. `src/worker.ts` is where real auth goes.
 */
const DEV_AUTH = process.env.STRIDE_DEV_AUTH === '1';

function principalOf(c: Context): PrincipalId {
  if (!DEV_AUTH) {
    throw new PermissionDenied(
      'no authentication configured: this server is a dev harness and refuses to guess who you are (set STRIDE_DEV_AUTH=1 for local development)',
    );
  }
  const who = c.req.header('x-principal') ?? 'astrid';
  const entry = CAST[who];
  if (!entry) throw new PermissionDenied(`unknown principal: ${who}`);
  return entry.principal;
}

function stub(c: Context): Promise<ScopeStub> {
  return host.getScope(principalOf(c), world.t1, world.s1);
}

const body = (c: Context) => c.req.json<Record<string, unknown>>().catch(() => ({}));

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
  // A denial must arrive AS A DENIAL — never as a generic 500. This is the line
  // that makes the attack visible in the UI instead of looking like a bug.
  if (err instanceof PermissionDenied) return c.json({ error: message }, 403);
  if (/permission denied/.test(message)) return c.json({ error: message }, 403);
  if (/invalid transition|immutable|already/.test(message)) return c.json({ error: message }, 409);
  if (/not found|unknown scope|unknown operation/.test(message)) return c.json({ error: message }, 404);
  return c.json({ error: message }, 400);
});

// --- the dev principal picker -----------------------------------------------
// HARNESS ONLY. These two routes exist so a developer can switch personas; they
// have no counterpart in the deployed worker, which resolves identity from a
// verified session. Everything else the app calls comes from `mountApi`, the
// table BOTH runtimes mount.
app.get('/api/cast', (c) =>
  c.json(
    DEV_AUTH
      ? Object.entries(CAST).map(([key, v]) => ({
          key,
          name: v.name,
          role: v.role,
          subjectId: v.subjectId ?? null,
        }))
      : [],
  ),
);
app.get('/api/me', (c) => {
  const who = c.req.header('x-principal') ?? 'astrid';
  const entry = CAST[who];
  if (!entry) throw new PermissionDenied(`unknown principal: ${who}`);
  return c.json({ key: who, name: entry.name, role: entry.role, subjectId: entry.subjectId ?? null });
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
console.log(`Pick a principal with the "x-principal" header: ${Object.keys(CAST).join(', ')}`);
