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
/** `user.metrics` is body measurements: weight, fat ratio, pulse. Nothing about sleep or activity. */
export const WITHINGS_SCOPE = 'user.metrics';
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
}

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
}

/** What makes two readings the same one: the same kind, at the same instant, with the same value. */
const keyOf = (kind: string, measuredAt: string, value: string) => `${kind}|${measuredAt}|${value}`;

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

  await store.set(traineeId, {
    ...link,
    lastUpdate: cursor,
    lastSyncAt: now.toISOString(),
  });
  return { seen: readings.length, added };
}
