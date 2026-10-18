import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { matchesOutboundHost } from '@substrat-run/contracts';
import type { ScopeStub } from '@substrat-run/kernel';
import type { SqliteScopeHost } from '@substrat-run/adapter-sqlite';

import type { MeasurementRow, WearableView } from '../src/module.js';
import { buildStrideHost, seedStride, type StrideWorld } from '../src/seed.js';
import {
  WITHINGS_API,
  WithingsError,
  activityKindOf,
  activityOfWorkout,
  daysOfActivity,
  hasActivityScope,
  sleepOfSummary,
  decimalOf,
  exchangeCode,
  readingsOf,
  syncWithings,
  withingsConsentUrl,
  type LinkStore,
  type WithingsLink,
  SYNC_COVERAGE,
} from '../src/withings.js';

// ============================================================================
// WITHINGS — the harness half, against a fake Withings and the REAL scope.
//
// The network is the only thing faked. Every reading goes through
// `stride/log-measurement` as the person syncing, so these tests also prove the
// integration needs no permission of its own: it can write exactly what that
// person could have typed.
// ============================================================================

const app = { clientId: 'cid', clientSecret: 'secret' };
const NOW = new Date('2026-10-11T08:00:00.000Z');
const epoch = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

const memoryStore = (): LinkStore & { link: WithingsLink | null; writes: number } => {
  const s = {
    link: null as WithingsLink | null,
    writes: 0,
    async get() {
      return s.link;
    },
    async set(_id: string, l: WithingsLink | null) {
      s.link = l;
      s.writes++;
    },
  };
  return s;
};

const freshLink = (over: Partial<WithingsLink> = {}): WithingsLink => ({
  userid: '42',
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: '2026-10-11T10:00:00.000Z',
  scope: 'user.metrics',
  connectedAt: '2026-10-01T08:00:00.000Z',
  lastUpdate: null,
  lastSyncAt: null,
  ...over,
});

/** A Withings that answers `/v2/oauth2` and `/measure`, and remembers what it was asked. */
function fakeWithings(groups: unknown[] | unknown[][]) {
  // An array of arrays is a paginated answer: each page says `more` and where the next one starts.
  const pages: unknown[][] = Array.isArray(groups[0]) ? (groups as unknown[][]) : [groups];
  const calls: { path: string; form: URLSearchParams; auth: string | null }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const form = new URLSearchParams(String(init?.body));
    const auth = new Headers(init?.headers).get('authorization');
    calls.push({ path, form, auth });
    const body =
      path === '/v2/oauth2'
        ? {
            userid: 42,
            access_token: 'access-2',
            refresh_token: 'refresh-2',
            expires_in: 10_800,
            scope: 'user.metrics',
          }
        : (() => {
            const i = Number(form.get('offset') ?? 0);
            return {
              updatetime: epoch('2026-10-11T07:59:00.000Z'),
              more: i < pages.length - 1 ? 1 : 0,
              offset: i + 1,
              measuregrps: pages[i] ?? [],
            };
          })();
    return new Response(JSON.stringify({ status: 0, body }), { status: 200 });
  }) as typeof fetch;
  return { fn, calls };
}

const weighIn = (iso: string, value: number, unit = -3, modified = epoch(iso)) => ({
  grpid: epoch(iso),
  date: epoch(iso),
  modified,
  category: 1,
  measures: [{ value, type: 1, unit }],
});

describe('the deployment declares the host it calls', () => {
  /**
   * A hosted vertical may `fetch` only what package.json `substrat.outbound` names; the platform's egress
   * worker answers anything else with a 403 that looks like Withings refusing. Nothing in the scenario can
   * see that, because tests call the code directly, so this is the one place the two are held together.
   */
  it('lists the host the token and measure calls go to', () => {
    const pkg = JSON.parse(String(readFileSync(join(process.cwd(), 'package.json')))) as {
      substrat: { outbound?: string[] };
    };
    expect(matchesOutboundHost(new URL(WITHINGS_API).hostname, pkg.substrat.outbound ?? [])).toBe(true);
  });
});

describe('decimals are exact', () => {
  it('turns value × 10^unit into a string without a float in sight', () => {
    expect(decimalOf(72400, -3)).toBe('72.4');
    expect(decimalOf(72456, -3)).toBe('72.456');
    expect(decimalOf(5, -3)).toBe('0.005');
    expect(decimalOf(18, 0)).toBe('18');
    expect(decimalOf(18, 2)).toBe('1800');
    expect(decimalOf(20000, -3)).toBe('20');
    expect(() => decimalOf(1.5, -1)).toThrow(WithingsError);
  });

  it('maps weight and fat ratio, and skips what it has no kind for, goals and nonsense', () => {
    const rows = readingsOf([
      {
        grpid: 1,
        date: epoch('2026-10-10T06:30:00.000Z'),
        category: 1,
        measures: [
          { value: 72400, type: 1, unit: -3 },
          { value: 185, type: 6, unit: -1 },
          { value: 61, type: 11, unit: 0 }, // a spot pulse: a kind of its own now
          { value: 7, type: 99999, unit: 0 }, // a type nobody has a kind for
        ],
      },
      { grpid: 2, date: 1, category: 2, measures: [{ value: 70000, type: 1, unit: -3 }] }, // a goal, not a reading
      { grpid: 3, date: 1, category: 1, measures: [{ value: 0, type: 1, unit: -3 }] }, // a scale glitch
    ]);
    expect(rows.map(({ kind, value, measuredAt, externalId }) => ({ kind, value, measuredAt, externalId }))).toEqual([
      { kind: 'weight', value: '72.4', measuredAt: '2026-10-10T06:30:00.000Z', externalId: '1:1' },
      { kind: 'body-fat', value: '18.5', measuredAt: '2026-10-10T06:30:00.000Z', externalId: '1:6' },
      { kind: 'pulse', value: '61', measuredAt: '2026-10-10T06:30:00.000Z', externalId: '1:11' },
    ]);
    // Each reading keeps what Withings said about it, so a field we did not map is not a field we lost.
    expect(rows[0]!.payload).toMatchObject({ grpid: 1, category: 1, measure: { value: 72400, type: 1, unit: -3 } });
  });

  it('knows a kind for every blood pressure, oxygen, temperature and body-composition type it asks for', () => {
    const types = [4, 5, 8, 9, 10, 11, 54, 71, 73, 76, 77, 88, 91, 123, 155, 168, 169, 170];
    const rows = readingsOf([
      { grpid: 7, date: 1, category: 1, measures: types.map((type) => ({ value: 5, type, unit: 0 })) },
    ]);
    expect(rows.map((r) => r.externalId)).toEqual(types.map((t) => `7:${t}`));
    expect(new Set(rows.map((r) => r.kind)).size).toBe(types.length);
  });
});

describe('the consent round', () => {
  it('builds the authorize URL with the state and the narrow scope', () => {
    const u = new URL(withingsConsentUrl({ clientId: 'cid', redirectUri: 'https://x.test/cb', state: 'nonce' }));
    expect(u.origin + u.pathname).toBe('https://account.withings.com/oauth2_user/authorize2');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'cid',
      redirect_uri: 'https://x.test/cb',
      scope: 'user.metrics,user.activity',
      state: 'nonce',
    });
  });

  it('exchanges the code for a link, and a refusal from Withings becomes an error, not a 200', async () => {
    const ok = fakeWithings([]);
    const link = await exchangeCode(app, { code: 'abc', redirectUri: 'https://x.test/cb' }, ok.fn, NOW);
    expect(link).toMatchObject({ userid: '42', accessToken: 'access-2', refreshToken: 'refresh-2' });
    expect(link.expiresAt).toBe('2026-10-11T11:00:00.000Z');
    expect(ok.calls[0]!.form.get('grant_type')).toBe('authorization_code');
    expect(ok.calls[0]!.form.get('redirect_uri')).toBe('https://x.test/cb');

    // Withings answers HTTP 200 with the failure in the body.
    const refused = (async () =>
      new Response(JSON.stringify({ status: 293, error: 'invalid code' }), { status: 200 })) as typeof fetch;
    await expect(exchangeCode(app, { code: 'bad', redirectUri: 'x' }, refused, NOW)).rejects.toMatchObject({
      status: 293,
    });
  });
});

describe('the sync', () => {
  let dir: string;
  let host: SqliteScopeHost;
  let w: StrideWorld;
  let vera: ScopeStub;
  let bjorn: ScopeStub;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'substrat-withings-'));
    host = buildStrideHost(dir);
    w = await seedStride(host, dir);
    vera = await host.getScope(w.vera, w.t1, w.s1);
    bjorn = await host.getScope(w.bjorn, w.t1, w.s1);
  });

  afterAll(async () => {
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const rows = (s: ScopeStub, id: string) => s.invoke<MeasurementRow[]>('stride/measurements', { traineeId: id });

  it('writes each reading as Vera, tagged, and a second sync of the same data writes nothing', async () => {
    const store = memoryStore();
    store.link = freshLink();
    const withings = fakeWithings([weighIn('2026-10-10T06:30:00.000Z', 72400), weighIn('2026-10-09T06:30:00.000Z', 72900)]);
    const before = (await rows(vera, w.veraId)).length;

    const first = await syncWithings({ app, store, traineeId: w.veraId, scope: vera, fetch: withings.fn, now: NOW });
    expect(first).toEqual({ seen: 2, added: 2 });
    const kept = (await rows(vera, w.veraId)).filter((m) => m.note === 'Withings');
    expect(kept.map((m) => [m.kind, m.value, m.unit, m.measured_at]).sort()).toEqual([
      ['weight', '72.4', 'kg', '2026-10-10T06:30:00.000Z'],
      ['weight', '72.9', 'kg', '2026-10-09T06:30:00.000Z'],
    ]);
    expect(kept.every((m) => m.logged_by === w.vera)).toBe(true);
    expect((await rows(vera, w.veraId)).length).toBe(before + 2);

    // The pull is a first one: a bounded window, not "everything ever".
    const getmeas = withings.calls.find((c) => c.path === '/measure')!;
    expect(getmeas.auth).toBe('Bearer access-1');
    expect(getmeas.form.get('startdate')).toBe(String(epoch(NOW.toISOString()) - 365 * 86_400));
    expect(store.link!.lastSyncAt).toBe(NOW.toISOString());
    // The cursor is the newest `modified` actually read, not the response's own `updatetime`.
    expect(store.link!.lastUpdate).toBe(epoch('2026-10-10T06:30:00.000Z'));

    // Again, same data, incremental this time: nothing new, and it asks only for what changed.
    const again = await syncWithings({ app, store, traineeId: w.veraId, scope: vera, fetch: withings.fn, now: NOW });
    expect(again).toEqual({ seen: 2, added: 0 });
    expect((await rows(vera, w.veraId)).length).toBe(before + 2);
    const second = withings.calls.filter((c) => c.path === '/measure')[1]!;
    expect(second.form.get('lastupdate')).toBe(String(epoch('2026-10-10T06:30:00.000Z')));
    expect(second.form.has('startdate')).toBe(false);
  });

  it('refreshes an expiring token and keeps the NEW refresh token before using the new access one', async () => {
    const store = memoryStore();
    store.link = freshLink({ expiresAt: '2026-10-11T08:00:30.000Z' }); // inside the minute of grace
    const withings = fakeWithings([]);
    await syncWithings({ app, store, traineeId: w.veraId, scope: vera, fetch: withings.fn, now: NOW });

    expect(withings.calls.map((c) => c.path)).toEqual(['/v2/oauth2', '/measure']);
    expect(withings.calls[0]!.form.get('grant_type')).toBe('refresh_token');
    expect(withings.calls[0]!.form.get('refresh_token')).toBe('refresh-1');
    expect(withings.calls[1]!.auth).toBe('Bearer access-2');
    expect(store.link).toMatchObject({ accessToken: 'access-2', refreshToken: 'refresh-2' });
    // Once for the refresh, once for the sync's own bookkeeping.
    expect(store.writes).toBe(2);
  });

  it('follows Withings\' pages with the offset it gives, and reads all of them', async () => {
    const store = memoryStore();
    store.link = freshLink();
    const withings = fakeWithings([
      [weighIn('2026-10-10T06:30:00.000Z', 72400)],
      [weighIn('2026-10-09T06:30:00.000Z', 72900)],
      [weighIn('2026-10-08T06:30:00.000Z', 73300)],
    ]);
    const r = await syncWithings({ app, store, traineeId: w.veraId, scope: vera, fetch: withings.fn, now: NOW });
    expect(r.seen).toBe(3);
    expect(withings.calls.filter((c) => c.path === '/measure').map((c) => c.form.get('offset'))).toEqual([null, '1', '2']);
  });

  it('never saves a cursor off a pull that did not finish', async () => {
    const stuck = (extra: Record<string, unknown>) =>
      (async (input: string | URL | Request) =>
        new Response(
          JSON.stringify({
            status: 0,
            body: new URL(String(input)).pathname === '/measure' ? { more: 1, measuregrps: [weighIn('2026-10-10T06:30:00.000Z', 72400)], ...extra } : {},
          }),
          { status: 200 },
        )) as typeof fetch;
    const before = (await rows(vera, w.veraId)).length;

    // `more` with no offset would repeat page one for ever, or end one page short.
    const noOffset = memoryStore();
    noOffset.link = freshLink();
    await expect(
      syncWithings({ app, store: noOffset, traineeId: w.veraId, scope: vera, fetch: stuck({}), now: NOW }),
    ).rejects.toThrow(/no offset/);
    expect(noOffset.link.lastUpdate).toBeNull();

    // `more` for ever: the page limit throws instead of returning a partial answer as a whole one.
    const endless = memoryStore();
    endless.link = freshLink();
    await expect(
      syncWithings({ app, store: endless, traineeId: w.veraId, scope: vera, fetch: stuck({ offset: 1 }), now: NOW }),
    ).rejects.toThrow(/more than 50 pages/);
    expect(endless.link.lastUpdate).toBeNull();
    // And nothing was written: the whole pull happens before the first row.
    expect((await rows(vera, w.veraId)).length).toBe(before);
  });

  it('says plainly when nothing is connected', async () => {
    await expect(
      syncWithings({ app, store: memoryStore(), traineeId: w.veraId, scope: vera, fetch: fakeWithings([]).fn, now: NOW }),
    ).rejects.toThrow(/not connected/);
  });

  it('needs no permission of its own: syncing into somebody else\'s record is the kernel\'s refusal', async () => {
    const store = memoryStore();
    store.link = freshLink();
    const withings = fakeWithings([weighIn('2026-10-08T06:30:00.000Z', 80100)]);
    // Bjorn holds result:read/log on Bjorn's record, not on Vera's. The sync reads first, so it stops there.
    await expect(
      syncWithings({ app, store, traineeId: w.veraId, scope: bjorn, fetch: withings.fn, now: NOW }),
    ).rejects.toThrow(/result:read/);
    expect((await rows(vera, w.veraId)).some((m) => m.value === '80.1')).toBe(false);
  });
});


// ---------------------------------------------------------------------------
// What the device itself recorded
// ---------------------------------------------------------------------------

describe('device data: the mapping', () => {
  it('names a workout in our words, and anything it does not know is other, never a refusal', () => {
    expect([2, 307, 498, 1, 6, 7, 16, 28, 36, 9999].map(activityKindOf)).toEqual([
      'run', 'run', 'run', 'walk', 'cycle', 'swim', 'weights', 'yoga', 'other', 'other',
    ]);
  });

  it('maps a workout exactly, and a pulse of 0 means "not measured", not "no pulse"', () => {
    expect(
      activityOfWorkout({
        id: 9001,
        category: 2,
        startdate: epoch('2026-10-09T06:00:00.000Z'),
        enddate: epoch('2026-10-09T06:45:00.000Z'),
        data: { distance: 8200, calories: 520.4, hr_average: 148, hr_min: 0, hr_max: 176, hr_zone_0: 300, hr_zone_3: 200 },
      }),
    ).toEqual({
      externalId: '9001',
      kind: 'run',
      startedAt: '2026-10-09T06:00:00.000Z',
      endedAt: '2026-10-09T06:45:00.000Z',
      durationSeconds: 2700,
      distanceM: '8200',
      calories: '520.4',
      hrAvg: 148,
      hrMax: 176,
      hrZone0Seconds: 300,
      hrZone3Seconds: 200,
      // The workout as Withings sent it: the mapped columns are a view of this, not a replacement.
      payload: expect.objectContaining({ id: 9001, category: 2, data: expect.objectContaining({ calories: 520.4 }) }),
    });
  });

  it('maps a night, with the efficiency as a decimal string and the stages in seconds', () => {
    expect(
      sleepOfSummary({
        id: 77,
        date: '2026-10-10',
        startdate: epoch('2026-10-09T22:10:00.000Z'),
        enddate: epoch('2026-10-10T05:50:00.000Z'),
        data: { total_timeinbed: 27600, total_sleep_time: 25200, deepsleepduration: 5400, sleep_efficiency: 0.913, sleep_score: 82, hr_average: 54 },
      }),
    ).toMatchObject({
      externalId: '77',
      night: '2026-10-10',
      inBedSeconds: 27600,
      asleepSeconds: 25200,
      deepSeconds: 5400,
      score: 82,
      efficiency: '0.91',
      hrAvg: 54,
    });
  });

  it('keeps one entry per day, the device that counted the most standing for it', () => {
    const days = daysOfActivity([
      { date: '2026-10-10', steps: 300 },
      { date: '2026-10-10', steps: 9120, distance: 6900.4, hr_average: 71 },
      { date: '2026-10-11', steps: 50 },
    ]);
    expect(days).toEqual([
      { day: '2026-10-10', steps: 9120, distanceM: '6900.4', hrAvg: 71, payload: expect.objectContaining({ steps: 9120 }) },
      { day: '2026-10-11', steps: 50, payload: expect.objectContaining({ steps: 50 }) },
    ]);
  });

  it('knows whether a link was granted the device\'s own data', () => {
    expect(hasActivityScope({ scope: 'user.metrics' })).toBe(false);
    expect(hasActivityScope({ scope: 'user.metrics,user.activity' })).toBe(true);
  });
});

describe('device data: the sync', () => {
  let dir: string;
  let host: SqliteScopeHost;
  let w: StrideWorld;
  let vera: ScopeStub;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'substrat-withings-device-'));
    host = buildStrideHost(dir);
    w = await seedStride(host, dir);
    vera = await host.getScope(w.vera, w.t1, w.s1);
  });
  afterAll(async () => {
    await host.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Answers each Withings endpoint by `path?action`, and remembers what it was asked. */
  const device = (answers: Record<string, () => Response>) => {
    const calls: { key: string; form: URLSearchParams }[] = [];
    const fn = (async (input: string | URL | Request, init?: RequestInit) => {
      const form = new URLSearchParams(String(init?.body));
      const key = `${new URL(String(input)).pathname}?${form.get('action')}`;
      calls.push({ key, form });
      return (answers[key] ?? (() => new Response(JSON.stringify({ status: 0, body: { measuregrps: [], more: 0 } }), { status: 200 })))();
    }) as typeof fetch;
    return { fn, calls };
  };
  const body = (b: unknown) => () => new Response(JSON.stringify({ status: 0, body: b }), { status: 200 });
  const t = (iso: string) => epoch(iso);

  const answers = (over: Record<string, () => Response> = {}) => ({
    '/v2/measure?getworkouts': body({
      more: false,
      series: [
        {
          id: 9001, category: 2, startdate: t('2026-10-09T06:00:00.000Z'), enddate: t('2026-10-09T06:45:00.000Z'),
          modified: t('2026-10-09T07:00:00.000Z'), data: { distance: 8200, hr_average: 148, hr_max: 176 },
        },
      ],
    }),
    '/v2/sleep?getsummary': body({
      more: false,
      series: [
        {
          id: 77, date: '2026-10-10', startdate: t('2026-10-09T22:10:00.000Z'), enddate: t('2026-10-10T05:50:00.000Z'),
          modified: t('2026-10-10T06:00:00.000Z'), data: { total_sleep_time: 25200, sleep_score: 82 },
        },
      ],
    }),
    '/v2/measure?getactivity': body({
      more: false,
      activities: [{ date: '2026-10-10', modified: t('2026-10-10T23:00:00.000Z'), steps: 9120, distance: 6900 }],
    }),
    ...over,
  });

  const link = (over: Partial<WithingsLink> = {}) => memoryStoreWith(freshLink({ scope: 'user.metrics,user.activity', ...over }));
  const memoryStoreWith = (l: WithingsLink) => {
    const s = memoryStore();
    s.link = l;
    return s;
  };
  const sync = (store: ReturnType<typeof memoryStore>, fn: typeof fetch) =>
    syncWithings({ app, store, traineeId: w.veraId, scope: vera, fetch: fn, now: NOW });
  const mine = () => vera.invoke<WearableView>('stride/wearable', { traineeId: w.veraId, days: 730 });

  it('writes workouts, nights and days through the operation, and a second sync changes nothing', async () => {
    const store = link();
    const fake = device(answers());
    const first = await sync(store, fake.fn);
    expect(first.wearable).toEqual({ activities: 1, sleep: 1, days: 1 });
    expect(first.problems).toBeUndefined();

    const got = await mine();
    expect(got.activities.find((a) => a.external_id === '9001')).toMatchObject({ kind: 'run', distance_m: '8200', hr_avg: 148, hr_max: 176 });
    expect(got.sleep.find((n) => n.external_id === '77')).toMatchObject({ night: '2026-10-10', score: 82 });
    expect(got.days.find((d) => d.day === '2026-10-10')).toMatchObject({ steps: 9120 });

    // A first pull is a bounded window of dates; the asks carry the fields we map.
    const workouts = fake.calls.find((c) => c.key === '/v2/measure?getworkouts')!;
    expect(workouts.form.get('startdateymd')).toBe('2025-10-11');
    expect(workouts.form.get('data_fields')).toContain('hr_zone_3');

    // Each dataset has its own cursor: the newest `modified` it actually read.
    expect(store.link!.cursors).toEqual({
      workouts: t('2026-10-09T07:00:00.000Z'),
      sleep: t('2026-10-10T06:00:00.000Z'),
      activity: t('2026-10-10T23:00:00.000Z'),
    });

    // Again: only what changed since the cursor is asked for, and nothing is written.
    const fake2 = device(answers());
    const second = await sync(store, fake2.fn);
    expect(second.wearable).toEqual({ activities: 0, sleep: 0, days: 0 });
    const asked = fake2.calls.find((c) => c.key === '/v2/measure?getworkouts')!;
    expect(asked.form.has('startdateymd')).toBe(false);
    expect(asked.form.get('lastupdate')).toBe(String(t('2026-10-09T07:00:00.000Z') - 60));
  });

  it('a link synced for less than we ask for now re-reads the first window once, then goes back to the cursor', async () => {
    // Coverage 1 with a cursor: the old sync never fetched blood pressure, so "nothing changed since" is a lie.
    const store = link({ userid: '46', lastUpdate: t('2026-10-10T00:00:00.000Z'), cursors: { workouts: t('2026-10-09T07:00:00.000Z') } });
    const fake = device(answers());
    await sync(store, fake.fn);
    const meas = fake.calls.find((c) => c.key === '/measure?getmeas')!;
    expect(meas.form.has('lastupdate')).toBe(false);
    expect(meas.form.get('startdate')).toBeTruthy();
    expect(meas.form.get('meastypes')!.split(',')).toEqual(expect.arrayContaining(['9', '10', '54', '76']));
    expect(fake.calls.find((c) => c.key === '/v2/measure?getworkouts')!.form.has('startdateymd')).toBe(true);
    expect(store.link!.covered).toEqual({ measures: SYNC_COVERAGE, workouts: SYNC_COVERAGE, sleep: SYNC_COVERAGE, activity: SYNC_COVERAGE });

    const next = device(answers());
    await sync(store, next.fn);
    expect(next.calls.find((c) => c.key === '/v2/measure?getworkouts')!.form.has('startdateymd')).toBe(false);
  });

  it('a token refresh is not a reconnect: the cursors and the coverage survive it', async () => {
    const cursors = { workouts: t('2026-10-09T07:00:00.000Z'), sleep: t('2026-10-10T06:00:00.000Z'), activity: t('2026-10-10T23:00:00.000Z') };
    const store = link({
      userid: '49', expiresAt: '2026-10-11T08:00:30.000Z', covered: { measures: SYNC_COVERAGE, workouts: SYNC_COVERAGE, sleep: SYNC_COVERAGE, activity: SYNC_COVERAGE }, cursors, lastUpdate: t('2026-10-10T00:00:00.000Z'),
    });
    const fake = device(answers({
      '/v2/oauth2?requesttoken': body({ userid: 49, access_token: 'a2', refresh_token: 'r2', expires_in: 10_800, scope: 'user.metrics,user.activity' }),
    }));
    await sync(store, fake.fn);
    expect(store.link!.accessToken).toBe('a2');
    expect(fake.calls.find((c) => c.key === '/v2/measure?getworkouts')!.form.has('startdateymd')).toBe(false);
    expect(store.link!.covered?.workouts).toBe(SYNC_COVERAGE);
  });

  it('a dataset that fails is not counted as covered, and does not make the others repeat their backfill', async () => {
    const store = link({ userid: '47' });
    const failing = () => device(answers({ '/v2/sleep?getsummary': () => new Response(JSON.stringify({ status: 2554, error: 'no sleep device' }), { status: 200 }) }));
    await sync(store, failing().fn);
    expect(store.link!.covered).toEqual({ measures: SYNC_COVERAGE, workouts: SYNC_COVERAGE, activity: SYNC_COVERAGE });

    const again = failing();
    await sync(store, again.fn);
    const asked = (key: string) => again.calls.find((c) => c.key === key)!.form;
    expect(asked('/v2/sleep?getsummary').has('startdateymd')).toBe(true); // still owed its first window
    expect(asked('/v2/measure?getworkouts').has('startdateymd')).toBe(false); // already done: only what changed
    expect(asked('/v2/measure?getactivity').has('startdateymd')).toBe(false);
  });

  it('a dataset that came back empty still gets a cursor, so the next sync is incremental', async () => {
    const store = link({ userid: '47' });
    const noSleep = () => device(answers({ '/v2/sleep?getsummary': body({ more: false, series: [] }) }));
    await sync(store, noSleep().fn);
    expect(store.link!.cursors!.sleep).toBe(Math.floor(NOW.getTime() / 1000));

    const again = noSleep();
    await sync(store, again.fn);
    const asked = again.calls.find((c) => c.key === '/v2/sleep?getsummary')!.form;
    expect(asked.has('startdateymd')).toBe(false);
    expect(asked.get('lastupdate')).toBe(String(Math.floor(NOW.getTime() / 1000) - 60));
  });

  it('keeps two providers\' identical readings apart, and does not log the same Withings reading twice', async () => {
    const store = link({ userid: '50' });
    const same = answers({
      '/measure?getmeas': body({
        more: 0,
        measuregrps: [{ grpid: 777, date: t('2026-10-10T07:00:00.000Z'), modified: t('2026-10-10T07:01:00.000Z'), category: 1, hash_deviceid: 'h', modelid: 51, measures: [{ value: 70100, type: 1, unit: -3 }] }],
      }),
    });
    // Garmin already reported exactly this number at exactly this instant.
    await vera.invoke('stride/log-measurement', { traineeId: w.veraId, kind: 'weight', value: '70.1', measuredAt: '2026-10-10T07:00:00.000Z', source: 'garmin', externalId: 'g-9' });
    await sync(store, device(same).fn);
    await sync(store, device(same).fn); // and again: nothing new
    const rows = await vera.invoke<{ source: string; payload?: Record<string, unknown> }[]>(
      'stride/measurements', { traineeId: w.veraId, kind: 'weight', days: 3650, payload: true },
    );
    const at = rows.filter((r) => (r as unknown as { measured_at: string }).measured_at === '2026-10-10T07:00:00.000Z');
    expect(at.map((r) => r.source).sort()).toEqual(['garmin', 'withings']);
    // Fields the group carried that we never named are still there.
    expect(at.find((r) => r.source === 'withings')!.payload).toMatchObject({ grpid: 777, hash_deviceid: 'h', modelid: 51 });
  });

  it('writes every kind it knows from one weigh-in, tagged with where it came from and what was said', async () => {
    const store = link({ userid: '48' });
    const fake = device(answers({
      '/measure?getmeas': body({
        more: 0,
        measuregrps: [{ grpid: 555, date: t('2026-10-10T06:30:00.000Z'), modified: t('2026-10-10T06:31:00.000Z'), category: 1, deviceid: 'dev-1', measures: [
          { value: 72400, type: 1, unit: -3 }, { value: 118, type: 10, unit: 0 }, { value: 76, type: 9, unit: 0 }, { value: 97, type: 54, unit: 0 },
        ] }],
      }),
    }));
    await sync(store, fake.fn);
    const rows = await vera.invoke<{ kind: string; value: string; source: string | null; external_id: string | null; payload?: unknown }[]>(
      'stride/measurements', { traineeId: w.veraId, source: 'withings', days: 3650, payload: true },
    );
    const byKind = Object.fromEntries(rows.filter((r) => r.external_id?.startsWith('555:')).map((r) => [r.kind, r]));
    expect(Object.keys(byKind).sort()).toEqual(['diastolic-bp', 'spo2', 'systolic-bp', 'weight']);
    expect(byKind['systolic-bp']).toMatchObject({ value: '118', source: 'withings', external_id: '555:10' });
    expect(byKind['weight']!.payload).toMatchObject({ grpid: 555, deviceid: 'dev-1', measure: { type: 1 } });

    const onlyBp = await vera.invoke<{ kind: string }[]>('stride/measurements', { traineeId: w.veraId, kind: 'systolic-bp' });
    expect(onlyBp.every((r) => r.kind === 'systolic-bp')).toBe(true);
  });

  it('a dataset Withings cannot give does not cost the others: sleep fails, workouts and steps are kept', async () => {
    const store = link({ userid: '43' });
    const fake = device(answers({ '/v2/sleep?getsummary': () => new Response(JSON.stringify({ status: 2554, error: 'no sleep device' }), { status: 200 }) }));
    const r = await sync(store, fake.fn);
    expect(r.wearable).toMatchObject({ sleep: 0 });
    expect(r.problems).toEqual(['sleep: no sleep device']);
    // The failed dataset's cursor did not move; the others' did.
    expect(store.link!.cursors?.sleep).toBeUndefined();
    expect(store.link!.cursors?.workouts).toBeDefined();
  });

  it('a link from before the device scope was asked for syncs weight only, and reads no device data', async () => {
    const store = link({ scope: 'user.metrics' });
    const fake = device(answers());
    const r = await sync(store, fake.fn);
    expect(r.wearable).toBeUndefined();
    expect(fake.calls.map((c) => c.key).filter((k) => /getworkouts|getsummary|getactivity/.test(k))).toEqual([]);
  });

  it('one bad row from the device is skipped and said so, and does not cost the weight or the rest', async () => {
    const store = link({ userid: '45' });
    const bad = answers({
      '/v2/measure?getworkouts': body({
        more: false,
        series: [
          { id: 9101, category: 2, startdate: t('2026-10-09T07:00:00.000Z'), enddate: t('2026-10-09T06:00:00.000Z'), modified: 1 },
          { id: 9102, category: 2, startdate: t('2026-10-08T06:00:00.000Z'), enddate: t('2026-10-08T06:30:00.000Z'), modified: 2 },
        ],
      }),
    });
    const r = await sync(store, device(bad).fn); // resolves: it does not throw
    expect(r.wearable?.activities).toBe(1);
    expect(r.problems).toEqual(['workouts: skipped 1 that end before they start']);
    const ids = (await mine()).activities.map((a) => a.external_id);
    expect(ids).toContain('9102');
    expect(ids).not.toContain('9101');
    // The sync still completed, so the link carries its bookkeeping.
    expect(store.link!.lastSyncAt).toBe(NOW.toISOString());
  });

  it('never saves a cursor off an incomplete pull of a dataset', async () => {
    const store = link({ userid: '44' });
    const stuck = answers({ '/v2/measure?getworkouts': body({ more: true, series: [{ id: 1, category: 2, startdate: 1, enddate: 2, modified: 5 }] }) });
    const r = await sync(store, device(stuck).fn);
    expect(r.problems?.[0]).toMatch(/workouts: Withings said there is more but gave no offset/);
    expect(store.link!.cursors?.workouts).toBeUndefined();
  });
});
