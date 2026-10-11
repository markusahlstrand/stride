import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import {
  WithingsError,
  exchangeCode,
  syncWithings,
  withingsConsentUrl,
  hasActivityScope,
  type Invoker,
  type LinkStore,
  type WithingsApp,
} from './withings.js';

// ============================================================================
// THE WITHINGS ROUTES — harness code, kept out of `worker.ts` so a test can drive
// the real handlers.
//
// The worker cannot run under vitest (Durable Objects, `cloudflare:workers`), and
// a flow that only ever ran in production is how the first 403 got there. So the
// routes take everything runtime-specific as ONE dependency — who is asking, and
// what they may reach — and the worker and the test each supply their own.
// ============================================================================

const STATE_COOKIE = 'stride_withings_state';

/** What a route needs to know about the request, resolved by the host. */
export interface WithingsCall {
  /** The signed-in person's own scope: every write goes through the kernel as them. */
  scope: Invoker;
  /** Their trainee record, or null — Withings is about a body, so it needs one. */
  traineeId: string | null;
  store: LinkStore;
  /** The gym's Withings app, or null when it has not been given one. */
  app: WithingsApp | null;
}

export interface WithingsRouteDeps<E> {
  /** Throws `HTTPException(401)` when nobody is signed in, and `PermissionDenied` when they have no seat. */
  caller(req: Request, env: E): Promise<WithingsCall>;
  fetch?: typeof fetch;
  /** The clock is a dependency, like everything else here: the host supplies it, a test can hold it still. */
  now: () => Date;
}

/** Derived from the request, so it is whatever host the person is on: it must match what Withings has registered. */
const redirectUriOf = (req: Request) => `${new URL(req.url).origin}/api/withings/callback`;

const nonceOf = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export function withingsRoutes<E extends object>(deps: WithingsRouteDeps<E>): Hono<{ Bindings: E }> {
  const routes = new Hono<{ Bindings: E }>();
  const fetchFn: typeof fetch = (input, init) => (deps.fetch ?? globalThis.fetch)(input, init);
  const now = deps.now;

  const failure = (
    c: { json: (b: unknown, s: number) => Response; req: { header: (n: string) => string | undefined } },
    e: unknown,
  ) => {
    if (e instanceof WithingsError) {
      // cf-ray is what the platform's request log and Cloudflare's own both index on.
      const ray = c.req.header('cf-ray');
      console.warn(`withings: ${e.message}${ray ? ` (cf-ray ${ray})` : ''}`);
      return c.json({ error: e.message, ...(ray ? { requestId: ray } : {}) }, 502);
    }
    throw e;
  };

  routes.get('/api/withings/status', async (c) => {
    const { traineeId, store, app } = await deps.caller(c.req.raw, c.env);
    const link = traineeId ? await store.get(traineeId) : null;
    return c.json({
      configured: app !== null,
      traineeId,
      connected: link !== null,
      // A link made before the device's own data was asked for: it works for weight, and offers a reconnect.
      canReadActivity: link ? hasActivityScope(link) : false,
      connectedAt: link?.connectedAt ?? null,
      lastSyncAt: link?.lastSyncAt ?? null,
    });
  });

  /** Step 1: bind the round to this browser with a one-time nonce, then send them to Withings. */
  routes.get('/api/withings/connect', async (c) => {
    const { traineeId, app } = await deps.caller(c.req.raw, c.env);
    if (!app) return c.json({ error: 'Withings is not set up for this gym' }, 503);
    if (!traineeId) {
      return c.json({ error: 'make yourself a workout first: Withings needs a trainee record to write to' }, 409);
    }
    const nonce = nonceOf();
    setCookie(c, STATE_COOKIE, nonce, {
      httpOnly: true,
      secure: true,
      // Lax, not Strict: the return trip from account.withings.com is a cross-site navigation.
      sameSite: 'Lax',
      path: '/api/withings',
      maxAge: 600,
    });
    return c.redirect(
      withingsConsentUrl({ clientId: app.clientId, redirectUri: redirectUriOf(c.req.raw), state: nonce }),
      302,
    );
  });

  /**
   * Step 2: Withings sends the person back with a `code`. It is worth nothing without the nonce in THIS
   * browser's cookie AND a signed-in session, so a code planted by somebody else's link spends on nothing.
   */
  routes.get('/api/withings/callback', async (c) => {
    const url = new URL(c.req.url);
    const cookie = getCookie(c, STATE_COOKIE);
    deleteCookie(c, STATE_COOKIE, { path: '/api/withings' });
    if (url.searchParams.get('error')) {
      return c.json({ error: 'Withings did not authorize the connection' }, 400);
    }
    const code = url.searchParams.get('code');
    if (!code || !cookie || cookie !== url.searchParams.get('state')) {
      return c.json({ error: 'this connection attempt did not start here: try Connect again' }, 400);
    }

    const { scope, traineeId, store, app } = await deps.caller(c.req.raw, c.env);
    if (!app) return c.json({ error: 'Withings is not set up for this gym' }, 503);
    if (!traineeId) return c.json({ error: 'no trainee record to connect Withings to' }, 409);
    try {
      const link = await exchangeCode(app, { code, redirectUri: redirectUriOf(c.req.raw) }, fetchFn, now());
      await store.set(traineeId, link);
    } catch (e) {
      return failure(c, e);
    }
    // The first pull rides the same request, but a failure here must not undo the connection: it is
    // saved, and "Sync now" is one tap away.
    await syncWithings({ app, store, traineeId, scope, fetch: fetchFn, now: now() }).catch(() => undefined);
    return c.redirect('/#/progress', 302);
  });

  routes.post('/api/withings/sync', async (c) => {
    const { scope, traineeId, store, app } = await deps.caller(c.req.raw, c.env);
    if (!app) return c.json({ error: 'Withings is not set up for this gym' }, 503);
    if (!traineeId) return c.json({ error: 'no trainee record' }, 409);
    try {
      return c.json(await syncWithings({ app, store, traineeId, scope, fetch: fetchFn, now: now() }));
    } catch (e) {
      return failure(c, e);
    }
  });

  /** Forgets OUR copy of the tokens. The readings already kept stay: a history is the point. */
  routes.delete('/api/withings', async (c) => {
    const { traineeId, store } = await deps.caller(c.req.raw, c.env);
    if (traineeId) await store.set(traineeId, null);
    return c.json({ connected: false });
  });

  return routes;
}
