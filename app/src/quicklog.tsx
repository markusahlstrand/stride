import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type QuickKind, type QuickLog, type QuickRecent } from './api';

// ============================================================================
// QUICK LOG — yoghurt with muesli; pull-up × 5. A line of a diary, not a workout: it
// prescribes nothing and earns no exercise. The list you repeat from is the person's own
// earlier lines, read back from the server, never a catalogue.
// ============================================================================

type Run = (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;

/** Midnight at the start of the local day, as an instant: "today" is the person's, not UTC's. */
const startOfLocalDay = (): string => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

const clockOf = (iso: string): string =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

const lineText = (l: Pick<QuickLog, 'label' | 'quantity'>): string =>
  l.quantity === null ? l.label : `${l.label} × ${l.quantity}`;

export function QuickLogCard({ traineeId, run }: { traineeId: string; run: Run }) {
  const [kind, setKind] = useState<QuickKind>('food');
  const [label, setLabel] = useState('');
  const [count, setCount] = useState(10);
  const [recents, setRecents] = useState<QuickRecent[]>([]);
  const [today, setToday] = useState<QuickLog[]>([]);
  const [busy, setBusy] = useState(false);

  // The latest request wins: toggling food/activity quickly must not let a slow answer for the
  // other kind land under the wrong toggle, where tapping a "recent" would save the wrong line.
  const latest = useRef(0);
  const reload = useCallback(() => {
    const ticket = ++latest.current;
    const fresh = <T,>(set: (v: T) => void, empty: T) => ({
      ok: (v: T) => ticket === latest.current && set(v),
      fail: () => ticket === latest.current && set(empty),
    });
    const r = fresh(setRecents, [] as QuickRecent[]);
    const t = fresh(setToday, [] as QuickLog[]);
    api.quickRecents(traineeId, kind).then(r.ok).catch(r.fail);
    api.quickLogs(traineeId, { since: startOfLocalDay() }).then(t.ok).catch(t.fail);
  }, [traineeId, kind]);
  useEffect(reload, [reload]);

  const save = async (b: { kind: QuickKind; label: string; quantity?: number }) => {
    if (busy) return;
    setBusy(true);
    const ok = await run(() => api.logQuick(traineeId, b), `Logged ${lineText({ label: b.label, quantity: b.quantity ?? null })}`);
    setBusy(false);
    if (ok) {
      setLabel('');
      reload();
    }
  };

  const clean = label.trim().replace(/\s+/g, ' ');
  const canLog = !busy && Boolean(clean) && (kind === 'food' || count >= 1);
  const submit = () => canLog && save({ kind, label: clean, ...(kind === 'activity' ? { quantity: count } : {}) });

  // Food repeats in one tap — the line is undoable right below. An activity needs its
  // number, so a tap loads it (with last time's count) and the stepper decides.
  const pick = (r: QuickRecent) => {
    if (r.kind === 'food') void save({ kind: 'food', label: r.label });
    else {
      setLabel(r.label);
      setCount(r.quantity ?? 10);
    }
  };

  const undo = (l: QuickLog) => run(() => api.voidQuickLog(l.id), 'Taken back').then((ok) => ok && reload());

  return (
    <div className="card" aria-label="Quick log">
      <div className="row center">
        <span className="title">Quick log</span>
      </div>
      <div className="side-toggle" role="radiogroup" aria-label="what to log" style={{ marginTop: 10 }}>
        {(['food', 'activity'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            className={`pill toggle${kind === k ? ' on' : ''}`}
            onClick={() => {
              setKind(k);
              setLabel('');
            }}
          >
            {k}
          </button>
        ))}
      </div>

      {recents.length > 0 && (
        <div className="sets" style={{ marginTop: 0, marginBottom: 10 }} aria-label="Earlier">
          {recents.map((r) => (
            <button
              key={r.label.toLowerCase()}
              type="button"
              className="pill toggle"
              disabled={busy}
              onClick={() => pick(r)}
            >
              {lineText(r)}
            </button>
          ))}
        </div>
      )}

      <label htmlFor="quick-label">{kind === 'food' ? 'what did you eat' : 'what did you do'}</label>
      <input
        id="quick-label"
        value={label}
        maxLength={80}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder={kind === 'food' ? 'Yoghurt with muesli' : 'Pull-up'}
      />
      {kind === 'activity' && (
        <>
          <label htmlFor="quick-count">how many times</label>
          <div className="row center" style={{ justifyContent: 'flex-start', gap: 8 }}>
            <button type="button" className="small" aria-label="One fewer" disabled={count <= 1} onClick={() => setCount(count - 1)}>
              −
            </button>
            <input
              id="quick-count"
              inputMode="numeric"
              style={{ width: 72, textAlign: 'center' }}
              value={count === 0 ? '' : count}
              placeholder="1"
              aria-invalid={count < 1}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value.replace(/\D/g, ''), 10);
                setCount(Number.isFinite(n) ? Math.min(n, 9999) : 0);
              }}
            />
            <button type="button" className="small" aria-label="One more" onClick={() => setCount(Math.min(count + 1, 9999))}>
              +
            </button>
          </div>
        </>
      )}
      <div className="actions">
        <button className="primary" disabled={!canLog} onClick={submit}>
          Log
        </button>
      </div>
      {kind === 'activity' && count < 1 && (
        <div className="sub" role="status">
          How many times? Log needs a number of 1 or more.
        </div>
      )}

      {today.length > 0 && (
        <>
          <div className="sub" style={{ marginTop: 14 }}>Today</div>
          <div className="sets">
            {today.map((l) => (
              <span key={l.id} className="pill done">
                {clockOf(l.logged_at)} {lineText(l)}
                <button type="button" className="undo" aria-label={`Take back ${lineText(l)}`} onClick={() => undo(l)}>
                  ×
                </button>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
