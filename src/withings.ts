// ============================================================================
// WITHINGS — a HARNESS integration, not module code.
//
// Rule 2 keeps `fetch` out of operations, so the network half lives here and the
// DOMAIN half stays where it was: a sync is nothing more than a signed-in person
// calling `stride/log-measurement` for each reading, as themselves. The kernel
// still decides whether they may (narrowed `result:log` on their own trainee
// record), the audit spine still says who, and nothing in `module.ts` learned
// that Withings exists.
//
// This file speaks only Web-standard APIs and takes every effect — fetch, the
// token store, the operation invoker — as an argument, so the worker wires it to
// Durable Objects and a test wires it to a fake.
//
// Moving this into a platform connector later changes WHO holds the tokens and
// WHERE the callback lives. It does not change the operations it calls.
// ============================================================================

export const WITHINGS_AUTHORIZE_URL = 'https://account.withings.com/oauth2_user/authorize2';
export const WITHINGS_API = 'https://wbsapi.withings.net';
/**
 * `user.metrics` is body measurements (weight, fat ratio). `user.activity` is what the device itself records:
 * workouts, daily movement and sleep. A link made before `user.activity` was asked for carries only the first,
 * and `hasActivityScope` is how the app knows to offer a reconnect instead of failing.
 */
export const WITHINGS_SCOPE = 'user.metrics,user.activity';
/** How far back the FIRST sync reaches. Later ones are incremental. */
export const FIRST_SYNC_DAYS = 365;
/** Rows are tagged so a person can tell a scale's reading from one they typed. */
export const WITHINGS_NOTE = 'Withings';

/** Withings measure type → our controlled vocabulary. Types we have no kind for are skipped. */
const KIND_OF_TYPE: Record<number, 'weight' | 'body-fat'> = {
  1: 'weight', // kg
  6: 'body-fat', // %
};

export interface WithingsLink {
  /** Withings' id for the account — kept so a reconnect to a DIFFERENT account is visible. */
  userid: string;
  accessToken: string;
  /** Rotates on every refresh: the old one stops working, so persist the new one first. */
  refreshToken: string;
  /** ISO. Access tokens last three hours. */
  expiresAt: string;
  scope: string;
  connectedAt: string;
  /** The largest `modified` seen so far, for `lastupdate` next time. Epoch seconds. */
  lastUpdate: number | null;
  lastSyncAt: string | null;
  /** Per dataset, the largest `modified` seen: the next pull asks only for what changed after it. */
  cursors?: Partial<Record<'workouts' | 'sleep' | 'activity', number>>;
}

/** Whether this link was granted the scope the device's own data needs. */
export const hasActivityScope = (link: Pick<WithingsLink, 'scope'>) =>
  link.scope.split(',').map((x) => x.trim()).includes('user.activity');

export interface LinkStore {
  get(traineeId: string): Promise<WithingsLink | null>;
  /** `null` forgets the link. */
  set(traineeId: string, link: WithingsLink | null): Promise<void>;
}

export interface WithingsApp {
  clientId: string;
  clientSecret: string;
}

export class WithingsError extends Error {
  constructor(
    message: string,
    /** Withings' own `status` from the body — its HTTP status is 200 even on failure. */
    readonly status?: number,
  ) {
    super(message);
    this.name = 'WithingsError';
  }
}

export function withingsConsentUrl(a: { clientId: string; redirectUri: string; state: string }): string {
  const u = new URL(WITHINGS_AUTHORIZE_URL);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', a.clientId);
  u.searchParams.set('redirect_uri', a.redirectUri);
  u.searchParams.set('scope', WITHINGS_SCOPE);
  u.searchParams.set('state', a.state);
  return u.toString();
}

type Fetch = typeof fetch;

/** Withings answers 200 with `{ status, body }` and puts the failure in `status`. */
async function wbs<T>(fetchFn: Fetch, path: string, form: Record<string, string>, bearer?: string): Promise<T> {
  const res = await fetchFn(`${WITHINGS_API}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
      'user-agent': 'stride/1.0 (+https://stride.ahlstrand.es)',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: new URLSearchParams(form).toString(),
  });
  if (!res.ok) {
    // A bare status hides who said no: Withings itself, or a WAF in front of it.
    const said = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
    const rid = res.headers.get('x-request-id');
    throw new WithingsError(`Withings answered HTTP ${res.status}${said ? `: ${said}` : ''}${rid ? ` (withings request ${rid})` : ''}`);
  }
  const json = (await res.json()) as { status?: number; body?: T; error?: string };
  if (json.status !== 0 || json.body === undefined) {
    throw new WithingsError(json.error ?? `Withings refused (status ${json.status})`, json.status);
  }
  return json.body;
}

interface TokenBody {
  userid: string | number;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}

/** A token response as our stored link; a refresh keeps what the response does not carry. */
const linkFromTokens = (t: TokenBody, now: Date, prev?: WithingsLink): WithingsLink => ({
  userid: String(t.userid),
  accessToken: t.access_token,
  refreshToken: t.refresh_token,
  expiresAt: new Date(now.getTime() + t.expires_in * 1000).toISOString(),
  scope: t.scope,
  connectedAt: prev?.connectedAt ?? now.toISOString(),
  lastUpdate: prev?.lastUpdate ?? null,
  lastSyncAt: prev?.lastSyncAt ?? null,
});

/** The consent code → tokens. `redirectUri` must be the registered one, character for character. */
export async function exchangeCode(
  app: WithingsApp,
  a: { code: string; redirectUri: string },
  fetchFn: Fetch,
  now: Date,
): Promise<WithingsLink> {
  const body = await wbs<TokenBody>(fetchFn, '/v2/oauth2', {
    action: 'requesttoken',
    grant_type: 'authorization_code',
    client_id: app.clientId,
    client_secret: app.clientSecret,
    code: a.code,
    redirect_uri: a.redirectUri,
  });
  return linkFromTokens(body, now);
}

/** A new access token from the refresh token. Withings rotates the refresh token too, so the caller must save the result. */
async function refresh(app: WithingsApp, link: WithingsLink, fetchFn: Fetch, now: Date): Promise<WithingsLink> {
  const body = await wbs<TokenBody>(fetchFn, '/v2/oauth2', {
    action: 'requesttoken',
    grant_type: 'refresh_token',
    client_id: app.clientId,
    client_secret: app.clientSecret,
    refresh_token: link.refreshToken,
  });
  return linkFromTokens(body, now, link);
}

// ---------------------------------------------------------------------------
// Reading → measurement
// ---------------------------------------------------------------------------

/**
 * `value × 10^unit` as an exact decimal string. Withings sends 72400 with unit -3
 * for 72.4 kg; a float round trip is how 72.400000000000006 gets into a column,
 * so this is string arithmetic and nothing else (rule 9).
 */
export function decimalOf(value: number, unit: number): string {
  if (!Number.isInteger(value) || !Number.isInteger(unit)) {
    throw new WithingsError(`not an integer measure: ${value}e${unit}`);
  }
  const neg = value < 0;
  const digits = String(Math.abs(value));
  let out: string;
  if (unit >= 0) {
    out = digits + '0'.repeat(unit);
  } else {
    const places = -unit;
    const padded = digits.padStart(places + 1, '0');
    const int = padded.slice(0, padded.length - places);
    const frac = padded.slice(padded.length - places).replace(/0+$/, '');
    out = frac ? `${int}.${frac}` : int;
  }
  return neg ? `-${out}` : out;
}

export interface WithingsReading {
  kind: 'weight' | 'body-fat';
  value: string;
  measuredAt: string;
}

interface MeasureGroup {
  grpid: number;
  /** Epoch seconds of the measurement itself. */
  date: number;
  /** Epoch seconds it was last created or changed at Withings: the cursor for the next pull. */
  modified?: number;
  category: number;
  measures: { value: number; type: number; unit: number }[];
}

/** Real measurements only (category 1 — Withings also stores user objectives), mapped and exact. */
export function readingsOf(groups: MeasureGroup[]): WithingsReading[] {
  const out: WithingsReading[] = [];
  for (const g of groups) {
    if (g.category !== 1) continue;
    for (const m of g.measures) {
      const kind = KIND_OF_TYPE[m.type];
      if (!kind) continue;
      const value = decimalOf(m.value, m.unit);
      // `log-measurement` refuses anything not above zero; a scale glitch is not worth a failed sync.
      if (value.startsWith('-') || /^0(\.0+)?$/.test(value)) continue;
      out.push({ kind, value, measuredAt: new Date(g.date * 1000).toISOString() });
    }
  }
  return out;
}

interface MeasBody {
  more: number;
  offset?: number;
  measuregrps: MeasureGroup[];
}

/** More pages than a person's body measurements can plausibly fill: past this, something is wrong. */
const MAX_PAGES = 50;

/**
 * Every group in the window, following Withings' own `more` / `offset` pagination.
 *
 * It returns ONLY a complete pull. An incomplete one throws, because the caller saves a cursor off the
 * result: a cursor advanced past pages that were never read would exclude those readings for good.
 */
async function pullGroups(
  fetchFn: Fetch,
  accessToken: string,
  window: { lastUpdate: number } | { startdate: number; enddate: number },
): Promise<MeasureGroup[]> {
  const groups: MeasureGroup[] = [];
  let offset: number | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const form: Record<string, string> = {
      action: 'getmeas',
      meastypes: Object.keys(KIND_OF_TYPE).join(','),
      category: '1',
      ...('lastUpdate' in window
        ? { lastupdate: String(window.lastUpdate) }
        : { startdate: String(window.startdate), enddate: String(window.enddate) }),
      ...(offset !== undefined ? { offset: String(offset) } : {}),
    };
    const body = await wbs<MeasBody>(fetchFn, '/measure', form, accessToken);
    groups.push(...body.measuregrps);
    if (!body.more) return groups;
    // `more` without an `offset` would repeat the first page for ever, or end quietly one page short.
    if (body.offset === undefined) throw new WithingsError('Withings said there is more but gave no offset');
    offset = body.offset;
  }
  throw new WithingsError(`Withings returned more than ${MAX_PAGES} pages of measurements`);
}

// ---------------------------------------------------------------------------
// The sync
// ---------------------------------------------------------------------------

/** Just the operations a sync needs, as the signed-in person. */
export interface Invoker {
  invoke<T = unknown>(operation: string, input?: unknown): Promise<T>;
}

export interface SyncResult {
  /** Readings Withings returned that we know a kind for. */
  seen: number;
  /** Rows actually written — a second sync of the same data writes none. */
  added: number;
  /** What the device itself recorded, if this link may read it. Counts are rows created or revised. */
  wearable?: { activities: number; sleep: number; days: number };
  /** Datasets Withings refused or could not give. One failing never costs the others. */
  problems?: string[];
}

/** What makes two readings the same one: the same kind, at the same instant, with the same value. */
const keyOf = (kind: string, measuredAt: string, value: string) => `${kind}|${measuredAt}|${value}`;

// ---------------------------------------------------------------------------
// What the device itself recorded: workouts, nights, days
// ---------------------------------------------------------------------------

/** Withings' workout category → our words. Anything not listed is `other`, never a refusal. */
const ACTIVITY_OF_CATEGORY: Record<number, string> = {
  1: 'walk', 306: 'walk',
  2: 'run', 307: 'run', 498: 'run',
  3: 'hike',
  6: 'cycle', 308: 'cycle',
  7: 'swim',
  16: 'weights',
  17: 'fitness',
  28: 'yoga',
  19: 'pilates',
  187: 'rowing',
  18: 'elliptical',
  195: 'climbing',
  34: 'ski', 35: 'ski',
  12: 'tennis', 14: 'tennis', 456: 'tennis',
  21: 'football', 22: 'football',
  29: 'dance',
  30: 'boxing',
};
export const activityKindOf = (category: number): string => ACTIVITY_OF_CATEGORY[category] ?? 'other';

/** A number from Withings as a decimal string: whole numbers as they are, anything else to two places. */
const decimalFromNumber = (n: number): string =>
  Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');

const optNum = (n: number | undefined | null): number | undefined => (typeof n === 'number' && Number.isFinite(n) ? n : undefined);
const optDec = (n: number | undefined | null): string | undefined => {
  const v = optNum(n);
  return v === undefined || v < 0 ? undefined : decimalFromNumber(v);
};
const optInt = (n: number | undefined | null): number | undefined => {
  const v = optNum(n);
  return v === undefined || v < 0 ? undefined : Math.round(v);
};
/** A heart rate the device did not measure comes back as 0 or absent; both mean "no reading", not "no pulse". */
const optBpm = (n: number | undefined | null): number | undefined => {
  const v = optInt(n);
  return v !== undefined && v >= 20 ? v : undefined;
};
const iso = (epochSeconds: number) => new Date(epochSeconds * 1000).toISOString();

interface WorkoutObject {
  id: number;
  category: number;
  startdate: number;
  enddate: number;
  modified?: number;
  data?: Record<string, number | undefined>;
}
interface SleepObject {
  id: number;
  date: string;
  startdate: number;
  enddate: number;
  modified?: number;
  data?: Record<string, number | undefined>;
}
interface ActivityObject {
  date: string;
  modified?: number;
  steps?: number;
  distance?: number;
  calories?: number;
  totalcalories?: number;
  active?: number;
  hr_average?: number;
  hr_min?: number;
  hr_max?: number;
}

/** A `stride/record-wearable` entry, undefined fields left out so the operation's own schema sees only what Withings said. */
const compact = <T extends Record<string, unknown>>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

export const activityOfWorkout = (w: WorkoutObject) => {
  const d = w.data ?? {};
  return compact({
    externalId: String(w.id),
    kind: activityKindOf(w.category),
    startedAt: iso(w.startdate),
    endedAt: iso(w.enddate),
    durationSeconds: Math.max(0, w.enddate - w.startdate),
    distanceM: optDec(d.distance),
    calories: optDec(d.calories),
    steps: optInt(d.steps),
    elevationM: optDec(d.elevation),
    hrAvg: optBpm(d.hr_average),
    hrMin: optBpm(d.hr_min),
    hrMax: optBpm(d.hr_max),
    hrZone0Seconds: optInt(d.hr_zone_0),
    hrZone1Seconds: optInt(d.hr_zone_1),
    hrZone2Seconds: optInt(d.hr_zone_2),
    hrZone3Seconds: optInt(d.hr_zone_3),
  });
};

export const sleepOfSummary = (n: SleepObject) => {
  const d = n.data ?? {};
  const eff = optNum(d.sleep_efficiency);
  return compact({
    externalId: String(n.id),
    // `date` is the day the night belongs to, in the person's own timezone.
    night: n.date,
    startedAt: iso(n.startdate),
    endedAt: iso(n.enddate),
    inBedSeconds: optInt(d.total_timeinbed),
    asleepSeconds: optInt(d.total_sleep_time ?? d.asleepduration),
    lightSeconds: optInt(d.lightsleepduration),
    deepSeconds: optInt(d.deepsleepduration),
    remSeconds: optInt(d.remsleepduration),
    awakeSeconds: optInt(d.wakeupduration),
    score: optInt(d.sleep_score),
    efficiency: eff === undefined || eff < 0 ? undefined : eff.toFixed(2),
    hrAvg: optBpm(d.hr_average),
    hrMin: optBpm(d.hr_min),
    hrMax: optBpm(d.hr_max),
    rrAvg: optInt(d.rr_average),
  });
};

/**
 * One entry per calendar day. Withings can send a day once per device that tracked it; the row is a day, so
 * the entry that counted the most steps stands for it rather than two devices overwriting each other.
 */
export const daysOfActivity = (items: ActivityObject[]) => {
  const best = new Map<string, ActivityObject>();
  for (const a of items) {
    const kept = best.get(a.date);
    if (!kept || (a.steps ?? 0) > (kept.steps ?? 0)) best.set(a.date, a);
  }
  return [...best.values()].map((a) =>
    compact({
      day: a.date,
      steps: optInt(a.steps),
      distanceM: optDec(a.distance),
      calories: optDec(a.calories),
      totalCalories: optDec(a.totalcalories),
      activeSeconds: optInt(a.active),
      hrAvg: optBpm(a.hr_average),
      hrMin: optBpm(a.hr_min),
      hrMax: optBpm(a.hr_max),
    }),
  );
};

const WORKOUT_FIELDS =
  'calories,distance,elevation,steps,hr_average,hr_min,hr_max,hr_zone_0,hr_zone_1,hr_zone_2,hr_zone_3';
const SLEEP_FIELDS =
  'total_timeinbed,total_sleep_time,lightsleepduration,deepsleepduration,remsleepduration,wakeupduration,sleep_efficiency,sleep_score,hr_average,hr_min,hr_max,rr_average';
const ACTIVITY_FIELDS = 'steps,distance,calories,totalcalories,active,hr_average,hr_min,hr_max';

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Every item of one dataset, following `more` / `offset`. Complete or it throws, for the reason `pullGroups`
 * gives: a cursor saved off a partial pull would skip what was never read.
 */
async function pullDataset<T extends { modified?: number }>(
  fetchFn: Fetch,
  accessToken: string,
  path: string,
  form: Record<string, string>,
  pick: (body: Record<string, unknown>) => T[],
): Promise<T[]> {
  const items: T[] = [];
  let offset: number | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await wbs<Record<string, unknown> & { more?: boolean | number; offset?: number }>(
      fetchFn,
      path,
      { ...form, ...(offset !== undefined ? { offset: String(offset) } : {}) },
      accessToken,
    );
    items.push(...pick(body));
    if (!body.more) return items;
    if (body.offset === undefined) throw new WithingsError('Withings said there is more but gave no offset');
    offset = body.offset;
  }
  throw new WithingsError(`Withings returned more than ${MAX_PAGES} pages of ${path}`);
}

const newestModified = (items: { modified?: number }[], was: number | undefined): number | undefined =>
  items.reduce<number | undefined>(
    (max, i) => (i.modified !== undefined && (max === undefined || i.modified > max) ? i.modified : max),
    was,
  );

/** First pull: a bounded window. After that: only what changed since the cursor, less a minute of overlap. */
const windowFor = (cursor: number | undefined, now: Date): Record<string, string> =>
  cursor !== undefined
    ? { lastupdate: String(Math.max(0, cursor - 60)) }
    : {
        startdateymd: ymd(new Date(now.getTime() - FIRST_SYNC_DAYS * 86_400_000)),
        // Inclusive of the whole of today, in whatever timezone the person is in.
        enddateymd: ymd(new Date(now.getTime() + 86_400_000)),
      };

const chunk = <T,>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

interface Recorded {
  activities: { created: number; updated: number };
  sleep: { created: number; updated: number };
  days: { created: number; updated: number };
}

async function syncWearables(a: {
  link: WithingsLink;
  traineeId: string;
  scope: Invoker;
  fetch: Fetch;
  now: Date;
}): Promise<{ counts: { activities: number; sleep: number; days: number }; cursors: NonNullable<WithingsLink['cursors']>; problems: string[] }> {
  const { link, traineeId, scope, fetch: fetchFn, now } = a;
  const cursors = { ...(link.cursors ?? {}) };
  const counts = { activities: 0, sleep: 0, days: 0 };
  const problems: string[] = [];

  const record = async (part: 'activities' | 'sleep' | 'days', rows: unknown[], size: number) => {
    for (const batch of chunk(rows, size)) {
      const r = await scope.invoke<Recorded>('stride/record-wearable', {
        traineeId,
        source: 'withings',
        [part]: batch,
      });
      const c = r[part];
      counts[part] += c.created + c.updated;
    }
  };

  // Each dataset on its own: a person with a watch and no sleep tracker has nothing to give for sleep, and
  // that must not cost them their workouts. The cursor only moves when its dataset was read in full AND kept.
  const run = async (name: string, go: () => Promise<void>) => {
    try {
      await go();
    } catch (e) {
      if (!(e instanceof WithingsError)) throw e;
      problems.push(`${name}: ${e.message}`);
    }
  };

  await run('workouts', async () => {
    const items = await pullDataset<WorkoutObject>(
      fetchFn,
      link.accessToken,
      '/v2/measure',
      { action: 'getworkouts', data_fields: WORKOUT_FIELDS, ...windowFor(cursors.workouts, now) },
      (b) => (b.series as WorkoutObject[] | undefined) ?? [],
    );
    await record('activities', items.map(activityOfWorkout), 200);
    const next = newestModified(items, cursors.workouts);
    if (next !== undefined) cursors.workouts = next;
  });

  await run('sleep', async () => {
    const items = await pullDataset<SleepObject>(
      fetchFn,
      link.accessToken,
      '/v2/sleep',
      { action: 'getsummary', data_fields: SLEEP_FIELDS, ...windowFor(cursors.sleep, now) },
      (b) => (b.series as SleepObject[] | undefined) ?? [],
    );
    await record('sleep', items.map(sleepOfSummary), 200);
    const next = newestModified(items, cursors.sleep);
    if (next !== undefined) cursors.sleep = next;
  });

  await run('daily activity', async () => {
    const items = await pullDataset<ActivityObject>(
      fetchFn,
      link.accessToken,
      '/v2/measure',
      { action: 'getactivity', data_fields: ACTIVITY_FIELDS, ...windowFor(cursors.activity, now) },
      (b) => (b.activities as ActivityObject[] | undefined) ?? [],
    );
    await record('days', daysOfActivity(items), 300);
    const next = newestModified(items, cursors.activity);
    if (next !== undefined) cursors.activity = next;
  });

  return { counts, cursors, problems };
}

export async function syncWithings(a: {
  app: WithingsApp;
  store: LinkStore;
  traineeId: string;
  scope: Invoker;
  fetch: Fetch;
  now: Date;
}): Promise<SyncResult> {
  const { app, store, traineeId, scope, fetch: fetchFn, now } = a;
  let link = await store.get(traineeId);
  if (!link) throw new WithingsError('Withings is not connected');

  // Refresh a minute early. The new refresh token is saved BEFORE it is used: the old one is dead the
  // moment Withings issues it, so losing the new one here would strand the connection.
  if (new Date(link.expiresAt).getTime() - 60_000 <= now.getTime()) {
    link = await refresh(app, link, fetchFn, now);
    await store.set(traineeId, link);
  }

  const window = link.lastUpdate
    ? { lastUpdate: link.lastUpdate }
    : {
        startdate: Math.floor(now.getTime() / 1000) - FIRST_SYNC_DAYS * 86_400,
        enddate: Math.floor(now.getTime() / 1000),
      };
  const groups = await pullGroups(fetchFn, link.accessToken, window);
  // Withings' own advice: the largest `modified` actually processed, over EVERY group returned (also the
  // ones we have no kind for), so a change we skipped is not fetched again for ever. Nothing returned
  // leaves the cursor where it was.
  const cursor = groups.reduce<number | null>(
    (max, g) => (g.modified !== undefined && (max === null || g.modified > max) ? g.modified : max),
    link.lastUpdate,
  );
  const readings = readingsOf(groups);

  // Read first, through the operation: the dedupe is whatever the kernel will let this person see.
  const existing = await scope.invoke<{ kind: string; measured_at: string; value: string }[]>(
    'stride/measurements',
    { traineeId },
  );
  const have = new Set(existing.map((m) => keyOf(m.kind, m.measured_at, m.value)));

  let added = 0;
  for (const r of readings) {
    const key = keyOf(r.kind, r.measuredAt, r.value);
    if (have.has(key)) continue;
    await scope.invoke('stride/log-measurement', {
      traineeId,
      kind: r.kind,
      value: r.value,
      measuredAt: r.measuredAt,
      note: WITHINGS_NOTE,
    });
    have.add(key);
    added++;
  }

  // What the device itself recorded — only if this link was granted it. An older link has not been, and
  // says so in `problems` rather than failing: the weight above is still good.
  let wearable: SyncResult['wearable'];
  let cursors = link.cursors;
  const problems: string[] = [];
  if (hasActivityScope(link)) {
    const w = await syncWearables({ link, traineeId, scope, fetch: fetchFn, now });
    wearable = w.counts;
    cursors = w.cursors;
    problems.push(...w.problems);
  }

  await store.set(traineeId, {
    ...link,
    lastUpdate: cursor,
    ...(cursors ? { cursors } : {}),
    lastSyncAt: now.toISOString(),
  });
  return { seen: readings.length, added, ...(wearable ? { wearable } : {}), ...(problems.length ? { problems } : {}) };
}
