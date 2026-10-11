import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { ScopeStub } from '@substrat-run/kernel';
import type { SqliteScopeHost } from '@substrat-run/adapter-sqlite';

import type { MeasurementRow, WhoAmI } from '../src/module.js';
import { buildStrideHost, seedStride, type StrideWorld } from '../src/seed.js';
import { withingsRoutes } from '../src/withings-routes.js';
import type { LinkStore, WithingsLink } from '../src/withings.js';

// ============================================================================
// THE WITHINGS FLOW, end to end through the real routes.
//
//   Connect  →  (Withings)  →  callback with a code  →  token exchange  →  first sync
//
// The worker cannot run under vitest, so the routes live in `withings-routes.ts`
// and take "who is asking" as one dependency. Here that is a header naming a
// seeded person; in production it is the session cookie and the identity DO. What
// is under test is everything between: the state cookie, the redirect URI, the
// exchange, the stored link, the rows that end up in Vera's Body.
//
// Only Withings is faked, and it is faked at the HTTP level so a refusal can look
// like what a refusal looks like: a 403 page, or a 200 whose body says `status: 293`.
// ============================================================================

const HOST = 'https://stride.test';
const CALLBACK = `${HOST}/api/withings/callback`;
const NOW = new Date('2026-10-11T08:00:00.000Z');
const epoch = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

/** One Withings account's worth of behaviour. Each field is how that endpoint answers. */
interface FakeWithings {
  token: () => Response;
  measure: () => Response;
  calls: { path: string; form: URLSearchParams; headers: Headers }[];
}

const ok = (body: unknown) => new Response(JSON.stringify({ status: 0, body }), { status: 200 });
const tokens = () =>
  ok({ userid: 42, access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 10_800, scope: 'user.metrics' });
/** Each test weighs in on its own day: the scope outlives the test, and a repeat of the same reading is deduped. */
let day = 0;
const dayOf = () => `2026-09-${String(10 + day).padStart(2, '0')}T06:30:00.000Z`;
const weighIns = () =>
  ok({
    updatetime: epoch(dayOf()),
    more: 0,
    measuregrps: [
      {
        grpid: 1,
        date: epoch(dayOf()),
        modified: epoch(dayOf()),
        category: 1,
        measures: [
          { value: 72400, type: 1, unit: -3 },
          { value: 185, type: 6, unit: -1 },
        ],
      },
    ],
  });

function fakeWithings(over: Partial<Pick<FakeWithings, 'token' | 'measure'>> = {}) {
  const w: FakeWithings = { token: tokens, measure: weighIns, calls: [], ...over };
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    w.calls.push({ path, form: new URLSearchParams(String(init?.body)), headers: new Headers(init?.headers) });
    return path === '/v2/oauth2' ? w.token() : w.measure();
  }) as typeof fetch;
  return { w, fn };
}

/** The cookie a browser would send back: `name=value` of the first Set-Cookie. */
const cookieFrom = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0]!;
const stateOf = (location: string) => new URL(location).searchParams.get('state')!;

describe('the Withings flow, through the routes', () => {
  let dir: string;
  let host: SqliteScopeHost;
  let w: StrideWorld;
  let people: Record<string, ScopeStub>;

  /** The link store the "identity DO" would be: one map, reset per test. */
  let links: Map<string, WithingsLink>;
  let configured: boolean;
  let withings: ReturnType<typeof fakeWithings>;
  let app: Hono;

  const store: LinkStore = {
    async get(id) {
      return links.get(id) ?? null;
    },
    async set(id, link) {
      if (link) links.set(id, link);
      else links.delete(id);
    },
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'substrat-withings-flow-'));
    host = buildStrideHost(dir);
    w = await seedStride(host, dir);
    people = {
      vera: await host.getScope(w.vera, w.t1, w.s1),
      bjorn: await host.getScope(w.bjorn, w.t1, w.s1),
      astrid: await host.getScope(w.astrid, w.t1, w.s1), // the admin: no trainee record of her own
    };
  });

  afterAll(async () => {
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    day++;
    links = new Map();
    configured = true;
    withings = fakeWithings();
    app = new Hono().route(
      '/',
      withingsRoutes<object>({
        fetch: (...a) => withings.fn(...a),
        now: () => NOW,
        async caller(req) {
          const as = req.headers.get('x-test-as');
          const scope = as ? people[as] : undefined;
          // What the worker does for a request with no session at all.
          if (!scope) throw new HTTPException(401, { message: 'not signed in' });
          const me = await scope.invoke<WhoAmI>('stride/whoami');
          return {
            scope,
            traineeId: me.traineeId,
            store,
            app: configured ? { clientId: 'cid', clientSecret: 'secret' } : null,
          };
        },
      }),
    );
  });

  const get = (path: string, as?: string, cookie?: string) =>
    app.request(`${HOST}${path}`, {
      headers: { ...(as ? { 'x-test-as': as } : {}), ...(cookie ? { cookie } : {}) },
      redirect: 'manual',
    });
  const verasRows = () => people.vera!.invoke<MeasurementRow[]>('stride/measurements', { traineeId: w.veraId });
  const fromWithings = async () =>
    (await verasRows()).filter((m) => m.note === 'Withings' && m.measured_at === dayOf());

  /** Press Connect, return what the browser would carry to Withings and back. */
  async function connect(as = 'vera') {
    const res = await get('/api/withings/connect', as);
    return { res, location: res.headers.get('location')!, cookie: cookieFrom(res) };
  }

  it('Connect sends the person to Withings with a nonce bound to this browser', async () => {
    const { res, location, cookie } = await connect();
    expect(res.status).toBe(302);
    const u = new URL(location);
    expect(u.origin + u.pathname).toBe('https://account.withings.com/oauth2_user/authorize2');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: 'cid',
      // The host the person is on, character for character what Withings has registered.
      redirect_uri: CALLBACK,
      scope: 'user.metrics,user.activity',
    });

    // The state is the cookie's value, and the cookie cannot be read by a script or sent cross-site.
    expect(stateOf(location)).toBe(cookie.split('=')[1]);
    const header = res.headers.get('set-cookie')!;
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/Secure/i);
    expect(header).toMatch(/SameSite=Lax/i);
    expect(header).toMatch(/Path=\/api\/withings/);
  });

  it('the whole round trip: callback exchanges the code, keeps the link, and the first sync fills Body', async () => {
    const before = (await verasRows()).length;
    const { location, cookie } = await connect();

    const back = await get(`/api/withings/callback?code=abc123&state=${stateOf(location)}`, 'vera', cookie);
    expect(back.status).toBe(302);
    expect(back.headers.get('location')).toBe('/#/progress');
    // The nonce is spent either way: the response clears it.
    expect(back.headers.get('set-cookie')).toMatch(/stride_withings_state=;/);

    // The exchange: the code, the SAME redirect URI as the consent URL, and the app's own credentials.
    const exchange = withings.w.calls.find((c) => c.path === '/v2/oauth2')!;
    expect(Object.fromEntries(exchange.form)).toEqual({
      action: 'requesttoken',
      grant_type: 'authorization_code',
      client_id: 'cid',
      client_secret: 'secret',
      code: 'abc123',
      redirect_uri: CALLBACK,
    });
    // A bare datacentre request with no identity is what a WAF turns away.
    expect(exchange.headers.get('user-agent')).toMatch(/stride/);

    // Kept for her record, and used: the weigh-in and the fat ratio are in her Body, as hers.
    expect(links.get(w.veraId)).toMatchObject({ userid: '42', accessToken: 'access-1', refreshToken: 'refresh-1' });
    expect((await fromWithings()).map((m) => [m.kind, m.value, m.unit]).sort()).toEqual([
      ['body-fat', '18.5', '%'],
      ['weight', '72.4', 'kg'],
    ]);
    expect((await verasRows()).length).toBe(before + 2);

    const status = await (await get('/api/withings/status', 'vera')).json();
    expect(status).toMatchObject({ configured: true, connected: true, lastSyncAt: NOW.toISOString() });
  });

  it('a callback that did not start here spends nothing: no cookie, wrong state, or no session', async () => {
    const { location, cookie } = await connect();
    const state = stateOf(location);
    const refused = async (res: Response, status: number) => {
      expect(res.status).toBe(status);
      expect(withings.w.calls).toEqual([]); // the code was never offered to Withings
      expect(links.size).toBe(0);
    };

    await refused(await get(`/api/withings/callback?code=abc&state=${state}`, 'vera'), 400); // no cookie
    await refused(await get('/api/withings/callback?code=abc&state=forged', 'vera', cookie), 400); // wrong state
    await refused(await get(`/api/withings/callback?state=${state}`, 'vera', cookie), 400); // no code
    // A right cookie and state, but nobody signed in: a 401, not a quiet success.
    await refused(await get(`/api/withings/callback?code=abc&state=${state}`, undefined, cookie), 401);
    // The person declined at Withings.
    await refused(await get(`/api/withings/callback?error=access_denied&state=${state}`, 'vera', cookie), 400);
  });

  it('a Withings 403 becomes a 502 that says what Withings said, and keeps nothing', async () => {
    withings = fakeWithings({
      token: () => new Response('<html>Forbidden: request blocked</html>', { status: 403, headers: { 'x-request-id': 'wr-9' } }),
    });
    const { location, cookie } = await connect();
    const res = await get(`/api/withings/callback?code=abc&state=${stateOf(location)}`, 'vera', cookie);

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('HTTP 403');
    expect(body.error).toContain('request blocked');
    expect(body.error).toContain('wr-9');
    expect(links.size).toBe(0);
    expect(await fromWithings()).toEqual([]);
  });

  it('Withings refusing inside a 200 (an invalid or reused code) is told apart from a 403', async () => {
    withings = fakeWithings({
      token: () => new Response(JSON.stringify({ status: 293, error: 'invalid_code' }), { status: 200 }),
    });
    const { location, cookie } = await connect();
    const res = await get(`/api/withings/callback?code=reused&state=${stateOf(location)}`, 'vera', cookie);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_code');
    expect(links.size).toBe(0);
  });

  it('a first sync that fails does not undo the connection: it is saved and Sync now is one tap away', async () => {
    withings = fakeWithings({ measure: () => new Response('boom', { status: 500 }) });
    const { location, cookie } = await connect();
    const res = await get(`/api/withings/callback?code=abc&state=${stateOf(location)}`, 'vera', cookie);

    expect(res.status).toBe(302);
    expect(links.get(w.veraId)).toBeTruthy();
    expect(await fromWithings()).toEqual([]);

    // Withings recovers; the same person syncs by hand.
    withings = fakeWithings();
    const sync = await app.request(`${HOST}/api/withings/sync`, { method: 'POST', headers: { 'x-test-as': 'vera' } });
    expect(await sync.json()).toEqual({ seen: 2, added: 2 });
  });

  it('Sync now is idempotent, and Disconnect forgets the tokens but keeps the history', async () => {
    const { location, cookie } = await connect();
    await get(`/api/withings/callback?code=abc&state=${stateOf(location)}`, 'vera', cookie);
    const kept = (await fromWithings()).length;

    const again = await app.request(`${HOST}/api/withings/sync`, { method: 'POST', headers: { 'x-test-as': 'vera' } });
    expect(await again.json()).toEqual({ seen: 2, added: 0 });
    expect((await fromWithings()).length).toBe(kept);

    const gone = await app.request(`${HOST}/api/withings`, { method: 'DELETE', headers: { 'x-test-as': 'vera' } });
    expect(await gone.json()).toEqual({ connected: false });
    expect(links.size).toBe(0);
    expect((await fromWithings()).length).toBe(kept);
    expect(await (await get('/api/withings/status', 'vera')).json()).toMatchObject({ connected: false });
  });

  it('a gym with no Withings app has no integration: status says so, Connect and Sync answer 503', async () => {
    configured = false;
    expect(await (await get('/api/withings/status', 'vera')).json()).toMatchObject({ configured: false, connected: false });
    expect((await get('/api/withings/connect', 'vera')).status).toBe(503);
    const sync = await app.request(`${HOST}/api/withings/sync`, { method: 'POST', headers: { 'x-test-as': 'vera' } });
    expect(sync.status).toBe(503);
    expect(withings.w.calls).toEqual([]);
  });

  it('is about the signed-in person only: an admin with no trainee record is told so, and nobody can reach Vera\'s', async () => {
    // Astrid runs the gym and has no body of her own to write to.
    expect((await get('/api/withings/connect', 'astrid')).status).toBe(409);

    // Bjorn connecting writes to Bjorn. Vera's Body is untouched.
    const before = (await verasRows()).length;
    const { location, cookie } = await connect('bjorn');
    const back = await get(`/api/withings/callback?code=abc&state=${stateOf(location)}`, 'bjorn', cookie);
    expect(back.status).toBe(302);
    expect([...links.keys()]).toEqual([w.bjornId]);
    expect((await verasRows()).length).toBe(before);
  });
});
