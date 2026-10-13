import { useEffect, useId, useRef, useState } from 'react';
import { api, type HrZones, type Item, type ScheduledItem } from './api';

// ============================================================================
// THE HYBRID PIECES — cardio by time and zone, interval blocks, as-many-as-possible
// tests, the timers that go with them, and the heart-rate zones behind a wearable's four.
//
// Kept apart from screens.tsx (five thousand lines) because none of it needs anything
// from there: it is pure formatting, three small timers and two forms.
// ============================================================================

type Run = (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;

export const ZONE_NAMES = ['Light', 'Moderate', 'Intense', 'Maximal'] as const;

/** m:ss, always — what a time input is filled from and read back as. */
export const clockText = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** 2700 → "45 min", 90 → "1:30", 45 → "45 s". What a duration reads as in a sentence. */
export const durationText = (seconds: number): string => {
  if (seconds < 60) return `${seconds} s`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return clockText(seconds);
};

/** "45" → 45 minutes; "1:30" → 90 seconds as mm:ss. NaN for anything else — never a guess. */
export function parseMinutes(raw: string): number {
  const t = raw.trim();
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t) * 60);
  const m = /^(\d+):([0-5]?\d)$/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number.NaN;
}
/** "2:00" or "90" (seconds) → seconds. For an interval's work and rest. */
export function parseSeconds(raw: string): number {
  const t = raw.trim();
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(\d+):([0-5]?\d)$/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number.NaN;
}

// --- what a row asks for ------------------------------------------------------

export interface Shape {
  seconds: number | null;
  zone: number | null;
  hrMin: number | null;
  hrMax: number | null;
  work: number | null;
  rest: number | null;
  amrap: boolean;
}
export const shapeOfItem = (i: Item): Shape => ({
  seconds: i.target_seconds ?? null,
  zone: i.target_zone ?? null,
  hrMin: i.target_hr_min ?? null,
  hrMax: i.target_hr_max ?? null,
  work: i.work_seconds ?? null,
  rest: i.rest_seconds ?? null,
  amrap: i.amrap === 1,
});
export const shapeOfScheduled = (i: ScheduledItem): Shape => ({
  seconds: i.targetSeconds ?? null,
  zone: i.targetZone ?? null,
  hrMin: i.targetHrMin ?? null,
  hrMax: i.targetHrMax ?? null,
  work: i.workSeconds ?? null,
  rest: i.restSeconds ?? null,
  amrap: Boolean(i.amrap),
});
export const isPlain = (s: Shape): boolean =>
  s.seconds === null && s.work === null && !s.amrap && s.zone === null && s.hrMin === null;

/** "zone 2 · Intense (133–161 bpm)" — the bpm only when the maximum is known. */
export function zoneText(zone: number, zones: HrZones | null): string {
  const z = zones?.zones?.[zone];
  const name = ZONE_NAMES[zone] ?? '';
  if (!z) return `zone ${zone} · ${name}`;
  const range = z.minBpm === null ? `under ${z.maxBpm + 1}` : `${z.minBpm}–${z.maxBpm}`;
  return `zone ${zone} · ${name} (${range} bpm)`;
}

/**
 * The one-line target of a row that is not plain sets × reps, or null if it is plain.
 * `quantity` is how a distance or count reads in the row's own unit.
 */
export function describeShape(
  shape: Shape,
  sets: number,
  reps: number,
  quantity: (n: number) => string,
  zones: HrZones | null,
): string | null {
  if (isPlain(shape)) return null;
  if (shape.work !== null) {
    const rest = shape.rest ? ` / ${durationText(shape.rest)} off` : '';
    return `${sets} × ${durationText(shape.work)} on${rest}`;
  }
  if (shape.amrap) {
    const min = reps > 0 ? ` · at least ${reps}` : '';
    return `${sets > 1 ? `${sets} × ` : ''}as many as possible${min}`;
  }
  const parts: string[] = [];
  if (shape.seconds !== null) parts.push(`${sets > 1 ? `${sets} × ` : ''}${durationText(shape.seconds)}`);
  if (reps > 0) parts.push(quantity(reps));
  if (shape.zone !== null) parts.push(zoneText(shape.zone, zones));
  else if (shape.hrMin !== null && shape.hrMax !== null) parts.push(`${shape.hrMin}–${shape.hrMax} bpm`);
  return parts.join(' · ');
}

// --- the timers ---------------------------------------------------------------

/** One short buzz, for someone looking at a barbell and not at the screen. */
const buzz = (ms = 180) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* no haptics here; the clock is the real signal */
  }
};

/**
 * REST — counts down from `seconds`, can be lengthened or shortened by 15 or skipped, and
 * lets go of itself when it reaches zero. Device-local and transient, like every clock here.
 */
export function RestTimer({
  seconds,
  label = 'Rest',
  onChange,
  onDone,
}: {
  seconds: number;
  label?: string;
  /** The person's preferred rest, remembered by the caller. */
  onChange?: (seconds: number) => void;
  onDone: () => void;
}) {
  const [endsAt, setEndsAt] = useState(() => Date.now() + seconds * 1000);
  const [now, setNow] = useState(() => Date.now());
  const done = useRef(onDone);
  done.current = onDone;
  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    if (left > 0) return;
    buzz(300);
    const t = window.setTimeout(() => done.current(), 1200);
    return () => window.clearTimeout(t);
  }, [left]);
  // The length as adjusted so far: the prop is where it started, and each press builds on the last.
  const [length, setLength] = useState(seconds);
  const adjust = (delta: number) => {
    const next = Math.max(15, length + delta);
    setLength(next);
    setEndsAt((t) => t + delta * 1000);
    onChange?.(next);
  };
  return (
    <div className={`holdtimer resttimer${left === 0 ? ' hit' : ''}`}>
      <div className="hold-clock mono" role="timer" aria-label={`${label}, ${left} seconds left`}>
        {clockText(left)}
      </div>
      <div className="hold-target">{left === 0 ? 'go' : label}</div>
      <div className="rest-adjust">
        <button type="button" className="ghost small" onClick={() => adjust(-15)} aria-label="15 seconds less rest">
          −15
        </button>
        <button type="button" className="ghost small" onClick={() => adjust(15)} aria-label="15 seconds more rest">
          +15
        </button>
        <button type="button" className="tinted small" onClick={onDone}>
          Skip
        </button>
      </div>
    </div>
  );
}

/**
 * INTERVALS — rounds of work and rest from one item. Start it and it walks itself through:
 * work, rest, work… buzzing at each change. It keeps no record: the SET is what is kept, and
 * `onRound` (given only where a round's number is already known, i.e. an exercise measured
 * in seconds) is how a finished round gets logged without a tap.
 */
export function IntervalTimer({
  work,
  rest,
  rounds,
  startRound = 1,
  onRound,
}: {
  work: number;
  rest: number;
  rounds: number;
  /** The first round still to do — rounds already logged are not repeated. */
  startRound?: number;
  onRound?: (round: number) => void | Promise<void>;
}) {
  type Phase = { kind: 'idle' } | { kind: 'work' | 'rest'; round: number; endsAt: number } | { kind: 'over' };
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [now, setNow] = useState(() => Date.now());
  const roundCb = useRef(onRound);
  roundCb.current = onRound;
  useEffect(() => {
    if (phase.kind === 'idle' || phase.kind === 'over') return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [phase.kind]);
  useEffect(() => {
    if (phase.kind !== 'work' && phase.kind !== 'rest') return;
    if (now < phase.endsAt) return;
    buzz(phase.kind === 'work' ? 400 : 180);
    if (phase.kind === 'work') {
      void roundCb.current?.(phase.round);
      if (phase.round >= rounds) setPhase({ kind: 'over' });
      else if (rest > 0) setPhase({ kind: 'rest', round: phase.round, endsAt: phase.endsAt + rest * 1000 });
      else setPhase({ kind: 'work', round: phase.round + 1, endsAt: phase.endsAt + work * 1000 });
    } else {
      setPhase({ kind: 'work', round: phase.round + 1, endsAt: phase.endsAt + work * 1000 });
    }
  }, [now, phase, rounds, rest, work]);

  const running = phase.kind === 'work' || phase.kind === 'rest';
  const left = running ? Math.max(0, Math.ceil((phase.endsAt - now) / 1000)) : work;
  const label =
    phase.kind === 'over'
      ? 'all rounds done'
      : phase.kind === 'idle'
        ? `${rounds} × ${durationText(work)} on${rest ? ` / ${durationText(rest)} off` : ''}`
        : `${phase.kind === 'work' ? 'work' : 'rest'} · round ${phase.round} of ${rounds}`;
  return (
    <div className={`holdtimer intervaltimer${phase.kind === 'work' ? ' running' : ''}${phase.kind === 'rest' ? ' hit' : ''}`}>
      <div className="hold-clock mono" role="timer" aria-label={label}>
        {clockText(left)}
      </div>
      <div className="hold-target">{label}</div>
      <button
        type="button"
        className="tinted hold-go"
        onClick={() => {
          const t = Date.now();
          setNow(t);
          setPhase(running ? { kind: 'idle' } : { kind: 'work', round: Math.min(Math.max(startRound, 1), rounds), endsAt: t + work * 1000 });
        }}
      >
        {running ? 'Stop' : phase.kind === 'over' ? 'Again' : 'Start'}
      </button>
    </div>
  );
}

// --- the prescription form ----------------------------------------------------

export type ShapeMode = 'sets' | 'timed' | 'interval' | 'amrap';
export interface TargetForm {
  mode: ShapeMode;
  sets: string;
  reps: string;
  load: string;
  /** Minutes ("45") or m:ss, for a timed row. */
  time: string;
  /** What to hold: nothing, a zone, or a bpm range. */
  hold: 'none' | 'zone' | 'range';
  zone: string;
  hrMin: string;
  hrMax: string;
  work: string;
  rest: string;
}
export const emptyTarget = (): TargetForm => ({
  mode: 'sets', sets: '3', reps: '10', load: '', time: '', hold: 'none', zone: '2', hrMin: '', hrMax: '', work: '2:00', rest: '2:00',
});

/** Can this form be sent? A message when not, so the button can say why. */
export function targetProblem(f: TargetForm): string | null {
  const sets = Number(f.sets);
  if (!Number.isInteger(sets) || sets < 1) return f.mode === 'interval' ? 'How many rounds?' : 'How many sets?';
  if (f.mode === 'sets' && !(Number(f.reps) >= 1)) return 'How many?';
  if (f.mode === 'timed') {
    if (!(parseMinutes(f.time) > 0)) return 'How long? Minutes, like 45, or 1:30.';
    if (f.hold === 'range') {
      const lo = Number(f.hrMin);
      const hi = Number(f.hrMax);
      if (!(lo >= 30 && hi > lo && hi <= 240)) return 'A bpm range, low then high.';
    }
  }
  if (f.mode === 'interval') {
    if (!(parseSeconds(f.work) > 0)) return 'How long is the work?';
    if (f.rest.trim() && !(parseSeconds(f.rest) >= 0)) return 'How long is the rest?';
  }
  return null;
}

/** The body the server takes, for a row built with this form. Call only when `targetProblem` is null. */
export function targetBody(f: TargetForm, unit?: string): Record<string, unknown> {
  const sets = Number(f.sets);
  if (f.mode === 'interval') {
    return { targetSets: sets, workSeconds: parseSeconds(f.work), restSeconds: f.rest.trim() ? parseSeconds(f.rest) : 0 };
  }
  if (f.mode === 'timed') {
    return {
      targetSets: sets,
      targetSeconds: parseMinutes(f.time),
      // A hold measured in seconds has its count in `targetSeconds`: the server derives the reps from it.
      ...(unit !== 'seconds' && Number(f.reps) > 0 ? { targetReps: Number(f.reps) } : {}),
      ...(f.hold === 'zone' ? { targetZone: Number(f.zone) } : {}),
      ...(f.hold === 'range' ? { targetHrMin: Number(f.hrMin), targetHrMax: Number(f.hrMax) } : {}),
    };
  }
  return {
    targetSets: sets,
    targetReps: f.mode === 'amrap' ? Number(f.reps) || 0 : Number(f.reps),
    ...(f.mode === 'amrap' ? { amrap: true } : {}),
    ...(f.load.trim() ? { targetLoad: f.load.trim() } : {}),
  };
}

const MODES: { mode: ShapeMode; label: string }[] = [
  { mode: 'sets', label: 'Sets × reps' },
  { mode: 'timed', label: 'Time & zone' },
  { mode: 'interval', label: 'Intervals' },
  { mode: 'amrap', label: 'As many as possible' },
];

/**
 * What a row asks for — the same form on a workout and on a plan. A segmented choice first,
 * because "3 × 10" and "45 minutes in zone 2" are different questions, then only the fields
 * that answer the one picked.
 */
export function TargetFields({
  value,
  onChange,
  unit,
  unilateral,
  zones,
}: {
  value: TargetForm;
  onChange: (next: TargetForm) => void;
  unit: string;
  unilateral?: boolean;
  zones?: HrZones | null;
}) {
  const id = useId();
  const set = (patch: Partial<TargetForm>) => onChange({ ...value, ...patch });
  const quantity = unit === 'metres' ? 'distance (m)' : unit === 'seconds' ? 'seconds' : 'reps';
  const zoneNumber = Number(value.zone);
  return (
    <div className="target-fields">
      <div className="side-toggle" role="radiogroup" aria-label="how this is prescribed">
        {MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            role="radio"
            aria-checked={value.mode === m.mode}
            className={`pill toggle${value.mode === m.mode ? ' on' : ''}`}
            onClick={() =>
              set({
                mode: m.mode,
                ...(m.mode === 'amrap' && value.mode !== 'amrap' ? { sets: '1', reps: '' } : {}),
                ...(value.mode === 'amrap' && m.mode !== 'amrap' ? { sets: '3', reps: '10' } : {}),
                // The sets-mode default of 10 reps means nothing on a timed row; going back to sets restores it.
                ...(m.mode === 'timed' && value.mode !== 'timed' ? { reps: '' } : {}),
                ...(value.mode === 'timed' && m.mode === 'sets' && !value.reps.trim() ? { reps: '10' } : {}),
              })
            }
          >
            {m.label}
          </button>
        ))}
      </div>

      {value.mode === 'sets' && (
        <div className="setgrid">
          <div>
            <label htmlFor={`${id}-sets`}>sets{unilateral ? ' / side' : ''}</label>
            <input id={`${id}-sets`} inputMode="numeric" value={value.sets} onChange={(e) => set({ sets: e.target.value })} />
          </div>
          <div>
            <label htmlFor={`${id}-reps`}>{quantity}</label>
            <input id={`${id}-reps`} inputMode="numeric" value={value.reps} onChange={(e) => set({ reps: e.target.value })} />
          </div>
          <div>
            <label htmlFor={`${id}-load`}>load</label>
            <input id={`${id}-load`} inputMode="decimal" value={value.load} onChange={(e) => set({ load: e.target.value })} />
          </div>
        </div>
      )}

      {value.mode === 'amrap' && (
        <>
          <div className="setgrid">
            <div>
              <label htmlFor={`${id}-sets`}>attempts</label>
              <input id={`${id}-sets`} inputMode="numeric" value={value.sets} onChange={(e) => set({ sets: e.target.value })} />
            </div>
            <div>
              <label htmlFor={`${id}-reps`}>at least ({quantity})</label>
              <input id={`${id}-reps`} inputMode="numeric" placeholder="none" value={value.reps} onChange={(e) => set({ reps: e.target.value })} />
            </div>
            <div>
              <label htmlFor={`${id}-load`}>load</label>
              <input id={`${id}-load`} inputMode="decimal" value={value.load} onChange={(e) => set({ load: e.target.value })} />
            </div>
          </div>
          <div className="sub">
            Log whatever you reach — there is no ceiling and no target to miss. A good place for a pull-up test.
          </div>
        </>
      )}

      {value.mode === 'timed' && (
        <>
          <div className="setgrid">
            <div>
              <label htmlFor={`${id}-time`}>duration (min)</label>
              <input id={`${id}-time`} inputMode="text" placeholder="45" value={value.time} onChange={(e) => set({ time: e.target.value })} />
            </div>
            <div>
              <label htmlFor={`${id}-sets`}>times</label>
              <input id={`${id}-sets`} inputMode="numeric" value={value.sets} onChange={(e) => set({ sets: e.target.value })} />
            </div>
            {unit !== 'seconds' && (
              <div>
                <label htmlFor={`${id}-reps`}>{unit === 'metres' ? 'distance (m)' : 'reps'}, if any</label>
                <input id={`${id}-reps`} inputMode="numeric" placeholder="none" value={value.reps} onChange={(e) => set({ reps: e.target.value })} />
              </div>
            )}
          </div>
          <label>hold</label>
          <div className="side-toggle" role="radiogroup" aria-label="heart rate target">
            {(['none', 'zone', 'range'] as const).map((h) => (
              <button
                key={h}
                type="button"
                role="radio"
                aria-checked={value.hold === h}
                className={`pill toggle${value.hold === h ? ' on' : ''}`}
                onClick={() => set({ hold: h })}
              >
                {h === 'none' ? 'Any effort' : h === 'zone' ? 'A zone' : 'A bpm range'}
              </button>
            ))}
          </div>
          {value.hold === 'zone' && (
            <>
              <div className="sets">
                {[0, 1, 2, 3].map((z) => (
                  <button
                    key={z}
                    type="button"
                    className={`pill toggle${zoneNumber === z ? ' on' : ''}`}
                    aria-pressed={zoneNumber === z}
                    onClick={() => set({ zone: String(z) })}
                  >
                    {z} · {ZONE_NAMES[z]}
                  </button>
                ))}
              </div>
              <div className="sub">
                {zones?.zones
                  ? `For ${zones.source === 'set' ? 'their' : 'an estimated'} maximum of ${zones.maxHr}: ${zoneText(zoneNumber, zones)}.`
                  : 'Set a maximum heart rate (on Progress) and this shows the bpm behind the zone.'}
              </div>
            </>
          )}
          {value.hold === 'range' && (
            <div className="setgrid">
              <div>
                <label htmlFor={`${id}-lo`}>from (bpm)</label>
                <input id={`${id}-lo`} inputMode="numeric" value={value.hrMin} onChange={(e) => set({ hrMin: e.target.value })} />
              </div>
              <div>
                <label htmlFor={`${id}-hi`}>to (bpm)</label>
                <input id={`${id}-hi`} inputMode="numeric" value={value.hrMax} onChange={(e) => set({ hrMax: e.target.value })} />
              </div>
            </div>
          )}
        </>
      )}

      {value.mode === 'interval' && (
        <>
          <div className="setgrid">
            <div>
              <label htmlFor={`${id}-sets`}>rounds</label>
              <input id={`${id}-sets`} inputMode="numeric" value={value.sets} onChange={(e) => set({ sets: e.target.value })} />
            </div>
            <div>
              <label htmlFor={`${id}-work`}>work (m:ss)</label>
              <input id={`${id}-work`} inputMode="text" value={value.work} onChange={(e) => set({ work: e.target.value })} />
            </div>
            <div>
              <label htmlFor={`${id}-rest`}>rest (m:ss)</label>
              <input id={`${id}-rest`} inputMode="text" value={value.rest} onChange={(e) => set({ rest: e.target.value })} />
            </div>
          </div>
          <div className="sub">One item, with a timer: 6 rounds of 2:00 on and 2:00 off is a single row.</div>
        </>
      )}
    </div>
  );
}

// --- heart-rate zones ---------------------------------------------------------

/**
 * The bpm behind a wearable's four zones, for one person — and where the maximum comes from.
 * Setting it is the whole point: until then the zones are cut from the highest rate a device
 * ever saw, which is usually under the real one.
 */
export function HeartRateZones({
  traineeId,
  canEdit,
  run,
  onChanged,
}: {
  traineeId: string;
  /** May this reader set the maximum? The server decides; this only decides whether to offer. */
  canEdit: boolean;
  run: Run;
  onChanged?: () => void;
}) {
  const [zones, setZones] = useState<HrZones | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const fieldId = useId();
  useEffect(() => {
    let live = true;
    api.hrZones(traineeId).then((z) => live && setZones(z)).catch(() => live && setZones(null));
    return () => {
      live = false;
    };
  }, [traineeId]);
  if (!zones) return null;
  const save = async (maxHr: number | null) => {
    let next: HrZones | null = null;
    const ok = await run(async () => {
      next = await api.setMaxHr(traineeId, maxHr);
    }, maxHr === null ? 'Maximum cleared' : 'Zones updated');
    if (ok && next) {
      setZones(next);
      setEditing(false);
      onChanged?.();
    }
  };
  const bpm = Number(draft);
  return (
    <div className="card">
      <div className="row center">
        <span className="title">Heart-rate zones</span>
        {canEdit && !editing && (
          <button className="ghost small" onClick={() => { setDraft(zones.source === 'set' ? String(zones.maxHr) : ''); setEditing(true); }}>
            {zones.source === 'set' ? 'Change max' : 'Set max HR'}
          </button>
        )}
      </div>
      {zones.zones ? (
        <>
          <div className="sub">
            Cut from a maximum of <b className="mono">{zones.maxHr} bpm</b>
            {zones.source === 'observed' ? ' — the highest your watch has seen. Set your real one for accurate zones.' : '.'}
          </div>
          <div className="zonelist">
            {zones.zones.map((z) => (
              <div key={z.zone} className={`zonerow z${z.zone}`}>
                <span className="mono">Zone {z.zone}</span>
                <span>{z.name}</span>
                <span className="mono">{z.minBpm === null ? `< ${z.maxBpm + 1}` : `${z.minBpm}–${z.maxBpm}`} bpm</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="sub">
          No maximum yet, and no workout with a heart rate to estimate one from. Set it to see the bpm behind each zone.
        </div>
      )}
      {editing && (
        <>
          <label htmlFor={fieldId}>maximum heart rate (bpm)</label>
          <input id={fieldId} inputMode="numeric" value={draft} placeholder="e.g. 188" onChange={(e) => setDraft(e.target.value)} />
          <div className="sub">Best measured — an all-out hill or a lab test. 220 minus your age can be 10–15 bpm off.</div>
          <div className="actions">
            <button className="primary" disabled={!(bpm >= 100 && bpm <= 240)} onClick={() => save(Math.round(bpm))}>
              Save
            </button>
            {zones.source === 'set' && (
              <button className="ghost" onClick={() => save(null)}>
                Clear
              </button>
            )}
            <button className="ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
