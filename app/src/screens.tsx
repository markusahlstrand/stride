import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionSummary } from './session';
import {
  elapsedMs,
  finishSession,
  formatClock,
  pauseSession,
  reportProgress,
  resumeSession,
  startSession,
  useActiveSession,
  useElapsed,
} from './session';
import {
  api,
  type CastMember,
  type Coach,
  type Equipment,
  type AgendaEntry,
  type Exercise,
  type Goal,
  type Invitation,
  type Measurement,
  type MeasurementKind,
  MEASUREMENT_KINDS,
  type Message,
  type ExerciseProgress,
  type Progress,
  type ProgressPoint,
  type SetResult,
  type Side,
  type Thread,
  type Me as TraineeMe,
  type ScheduledItem,
  type Sharing,
  type SharingMode,
  type ProgramCard,
  type ProgramDetail,
  type Template,
  type Summary,
  type Trainee,
} from './api';
import { SendIcon } from './icons';
import { Figure, FigureTile, poseFor, type Pose } from './figures';

type Run = (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;
export type ExerciseFilters = {
  name: 'exercises';
  q: string;
  types: string[];
  privateOnly: boolean;
  myKit: boolean;
  equipment: string[];
};
interface ScreenProps {
  me: CastMember | null;
  run: Run;
}

const isStaff = (me: CastMember | null) => me?.role === 'admin' || me?.role === 'coach';

const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** '1,3,5' → 'Mon · Wed · Fri'; a count → '5× a week'. */
function recurrenceLabel(days: string | null, perWeek: number | null): string | null {
  if (days) return days.split(',').map((d) => DAY_NAMES[Number(d)]).join(' · ');
  if (perWeek) return `${perWeek}× a week`;
  return null;
}

/**
 * Consecutive items sharing a group key are one superset. Consecutive matters:
 * position is the coach's running order, so a key that reappears later is a
 * second superset, not a continuation of the first.
 */
function groupItems<T extends { group_key: string | null }>(items: T[]): { key: string | null; items: T[] }[] {
  const out: { key: string | null; items: T[] }[] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (item.group_key && last && last.key === item.group_key) last.items.push(item);
    else out.push({ key: item.group_key, items: [item] });
  }
  return out;
}

/**
 * Equipment is ADVICE, not a permission: a piece of kit you do not have dims to
 * 45% and stays on the row. Hiding it would be a second, weaker access rule
 * sitting beside the real one — the exact failure this app exists to avoid.
 */
function EquipmentChips({ e }: { e: Exercise }) {
  if (e.equipment.length === 0) {
    return <span className="chip">bodyweight</span>;
  }
  return (
    <>
      {e.equipment.map((slug) => (
        <span key={slug} className={`chip${e.missing.includes(slug) ? ' missing' : ''}`}>
          {slug.replace(/-/g, ' ')}
        </span>
      ))}
    </>
  );
}

/** Initials for an avatar. Two letters, because a roster is scanned, not read. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

/** "2" in accent over "/4" in muted — the counter reads at arm's length. */
function Counter({ done, total }: { done: number; total: number }) {
  return (
    <span className="counter">
      <b>{done}</b>/{total}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Today — what the recurring schedule says you owe this week
// ---------------------------------------------------------------------------

export function TodayScreen({
  me,
  run,
  onOpen,
  onSetup,
}: ScreenProps & { onOpen: (id: string) => void; onSetup: () => void }) {
  const [items] = useList<ScheduledItem>(() => api.schedule(), [me?.key]);
  const [agenda, reloadAgenda] = useList<AgendaEntry>(() => api.agenda(), [me?.key]);
  const due = items.filter((i) => i.dueToday);
  const rest = items.filter((i) => !i.dueToday);
  const booked = agenda.filter((a) => a.dueToday);
  const upcoming = agenda.filter((a) => !a.dueToday);

  /** One tap: reuse today's session if there is one, open one if not, go log. */
  const begin = async (entry: AgendaEntry) => {
    const ok = await run(
      () => api.begin(entry.programId),
      entry.sessionToday ? 'Back to it' : 'Session started',
    );
    reloadAgenda();
    if (ok) {
      // The clock is device-local: the server opened (or reused) the session,
      // this starts the one on your phone. Resuming skips the countdown.
      startSession(entry.programId, entry.programTitle, Boolean(entry.sessionToday));
      onOpen(entry.programId);
    }
  };

  const row = (i: ScheduledItem) => (
    <button
      key={i.itemId}
      type="button"
      className="card tappable with-fig"
      onClick={() => onOpen(i.programId)}
    >
      <FigureTile pose={poseFor(i.exerciseName, i.unit)} size={62} />
      <div className="grow">
        <div className="row center">
          <span className="title">{i.exerciseName}</span>
          <span className={`badge mono${i.doneThisWeek >= i.targetThisWeek ? ' earned' : ''}`}>
            {i.doneThisWeek}/{i.targetThisWeek} this week
          </span>
        </div>
        {/* The quantity gets its own line and its own typeface: it is the thing
            you came to read, and mono keeps a column of them aligned. */}
        <div className="quantity">
          {i.targetSets} × {i.targetReps} {i.unit}
          {i.targetLoad ? ` @ ${i.targetLoad}` : ''}
          {i.laterality === 'unilateral' ? ' · each side' : ''}
        </div>
        <div className="sub">
          {recurrenceLabel(i.recurDays, i.recurPerWeek)} · {i.programTitle}
        </div>
      </div>
    </button>
  );

  // Which days of this week have something booked — the plan, not a record.
  const bookedDays = new Set(agenda.map((a) => a.weekday));
  // ISO weekday, Monday = 1, to match the slots.
  const todayIso = ((new Date().getDay() + 6) % 7) + 1;
  // The hero's figure does whatever is first on today's list.
  const heroPose: Pose = due[0] ? poseFor(due[0].exerciseName, due[0].unit) : 'press';

  return (
    <>
      <h1>Today</h1>
      {/* Top and bottom only, here and under every other title: a `margin`
          shorthand zeroes the auto side margins that centre the column on
          desktop, and strands the line in the gutter. */}
      <div className="sub" style={{ marginTop: -6, marginBottom: 16, paddingLeft: 2 }}>
        {new Date().toLocaleDateString(undefined, {
          weekday: 'long',
          day: 'numeric',
          month: 'short',
        })}
      </div>

      {/* The week at a glance: the days you train are inked in, and a runner
          stands on today. Only drawn once something is booked — seven empty
          dots say nothing the empty state below does not say better. */}
      {agenda.length > 0 && (
        <div className="week" aria-hidden="true">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((letter, idx) => {
            const iso = idx + 1;
            const isToday = iso === todayIso;
            return (
              <div key={iso} className="week-day">
                {isToday ? <Figure pose="run" size={42} /> : <span className="week-letter">{letter}</span>}
                <span
                  className={`week-dot${bookedDays.has(iso) ? ' booked' : ''}${isToday ? ' today' : ''}`}
                >
                  {isToday ? letter : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* WHAT'S NEXT is the one mint card; everything below it is reference.
          The first of them gets a figure standing on its button. */}
      {booked.map((a, idx) => (
        <div key={`${a.programId}-${a.time}`} className={`card hero${idx === 0 ? ' has-fig' : ''}`}>
          {idx === 0 && (
            <Figure
              pose={heroPose}
              size={180}
              className="hero-fig"
              style={{ '--s': '180px' } as React.CSSProperties}
            />
          )}
          <div className="hero-text">
            <div className="hero-meta">
              <span className="badge time">{a.time}</span>
              <span className="hero-label">Up next</span>
            </div>
            <span className="title big">{a.programTitle}</span>
            <div className="sub mono">
              {a.traineeName ? `${a.traineeName} · ` : ''}
              {a.exercises} exercises
              {a.setsToday > 0 ? ` · ${a.setsToday} logged today` : ''}
            </div>
          </div>
          <div className="actions">
            <button className="primary wide" onClick={() => begin(a)}>
              {a.sessionToday ? 'Continue' : a.status === 'planned' ? 'Start programme first' : 'Start training'}
            </button>
          </div>
        </div>
      ))}

      {upcoming.length > 0 && <h2>Booked this week</h2>}
      {upcoming.length > 0 && (
        <div className="list">
          {upcoming.map((a) => (
            <button
              key={`${a.programId}-${a.weekday}-${a.time}`}
              type="button"
              className="rowbtn"
              onClick={() => onOpen(a.programId)}
            >
              <span>
                <span className="name">{a.programTitle}</span>
                <span className="sub">
                  {a.traineeName ? `${a.traineeName} · ` : ''}
                  {a.exercises} exercises
                </span>
              </span>
              <span className="right">
                <span className="when">
                  {DAY_NAMES[a.weekday]} {a.time}
                </span>
                <span className="chev">›</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {items.length === 0 && agenda.length === 0 && (
        <div className="empty">
          <Figure pose="rest" size={132} />
          <span className="head">Nothing booked.</span>
          {me?.role === 'trainee' ? (
            <>
              Me → <b>Set up my training</b> picks your days and builds the workouts.
              <div className="actions" style={{ justifyContent: 'center' }}>
                <button className="tinted" onClick={onSetup}>
                  Set up my training
                </button>
              </div>
            </>
          ) : (
            'Book a time on a programme, or give an exercise a weekly rhythm.'
          )}
        </div>
      )}
      {due.length > 0 && <h2>Exercises due today</h2>}
      {due.map(row)}
      {rest.length > 0 && <h2>Also this week</h2>}
      {rest.map(row)}
    </>
  );
}

/** Every list here is what the KERNEL returned for this principal — the client
 *  filters nothing. An empty list is an open door onto an empty room. */
function useList<T>(load: () => Promise<T[]>, deps: unknown[] = []): [T[], () => void] {
  const [rows, setRows] = useState<T[]>([]);
  const reload = useCallback(() => {
    load()
      .then(setRows)
      .catch(() => setRows([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(reload, [reload]);
  return [rows, reload];
}

// ---------------------------------------------------------------------------
// Programs
// ---------------------------------------------------------------------------

export function ProgramsScreen({
  me,
  run,
  onOpen,
  onPlans,
}: ScreenProps & { onOpen: (id: string) => void; onPlans: () => void }) {
  const [programs, reload] = useList<ProgramCard>(() => api.programs(), [me?.key]);
  const solo = me?.role === 'trainee';

  return (
    <>
      <h1>{solo ? 'My workouts' : 'Programmes'}</h1>

      {/* The obvious place to add one is the list of them. It used to live only
          on the Me screen, which meant the answer to "how do I add a workout?"
          was somewhere you had no reason to look. */}
      <NewWorkout me={me} run={run} onOpen={onOpen} onCreated={reload} />
      {/* A workout is one person's run of a PLAN. The plans themselves — tied
          to nobody, shareable — live one screen over. */}
      <div className="actions" style={{ marginTop: -6, marginBottom: 14 }}>
        <button className="accent-text" onClick={onPlans}>
          Plans — make one, share one ›
        </button>
      </div>

      {programs.length === 0 && (
        <div className="empty">
          <Figure pose="rest" size={132} />
          {solo ? (
            <>
              <span className="head">No workouts yet.</span>
              Add one above, or Me → <b>Set up my training</b> to build a week of them at once.
            </>
          ) : (
            <>
              {/* Staff, and the copy has to be true of a gym of one: an admin
                  who has not enrolled themselves reaches nothing because there
                  is nothing, not because they were refused. It must also not
                  point at a button — a coach with no trainees yet does not have
                  one. */}
              <span className="head">Nothing here yet.</span>
              Programmes you write for a trainee, and workouts of your own, both land here.
              Nothing is hidden from you; the permission walk simply reaches nothing.
            </>
          )}
        </div>
      )}
      {programs.map((p) => (
        <button key={p.id} type="button" className="card tappable" onClick={() => onOpen(p.id)}>
          <div className="row">
            <span className="title">{p.title}</span>
            <span className={`badge ${p.status}`}>{p.status.replace('_', ' ')}</span>
          </div>
          <div className="sub">
            #{p.number} · {p.kind}
            {p.traineeName ? ` · ${p.traineeName}` : ''} · {p.setsLogged} set
            {p.setsLogged === 1 ? '' : 's'} logged
          </div>
        </button>
      ))}
    </>
  );
}

/**
 * Add one workout — the single-item sibling of `RoutineSetup`, which builds a
 * whole week. Adapts to who is asking rather than existing twice.
 *
 * WHO IT IS FOR is a question only when there is more than one answer. A gym of
 * one person — which is what every gym is on its first day — has exactly one:
 * you. So the picker appears only when somebody else is actually in the roster,
 * and the rest of the time the workout is simply yours. It used to be shown to
 * all staff unconditionally, which meant the admin of a new gym met an empty
 * "for whom" with no option but their own name missing from it.
 *
 * "You" needs a trainee record to hang from, because role is not a column — you
 * are a trainee because a trainee record carries your principal. An admin who
 * has never enrolled gets one on the way through, from `train-myself`; it is
 * idempotent, so this costs nothing on every later workout.
 *
 * Nothing here STARTS what it creates. That is the next screen's job, with the
 * prescription in front of you.
 */
function NewWorkout({
  me,
  run,
  onOpen,
  onCreated,
}: ScreenProps & { onOpen: (id: string) => void; onCreated: () => void }) {
  const [templates] = useList<Template>(() => api.templates(), [me?.key]);
  const [trainees] = useList<Trainee>(() => api.trainees(), [me?.key]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /** '' means ME. Anything else is that trainee's id. */
  const [f, setF] = useState({ title: '', kind: 'strength', templateId: '', traineeId: '' });
  const [days, setDays] = useState<number[]>([]);
  const [time, setTime] = useState('18:00');

  if (!me || me.role === 'outsider') return null;

  // Everyone in the roster who is not me. A staff member who has enrolled
  // themselves appears in their own `trainees` list, and offering them twice —
  // once as "Me" and once by name — would be two names for one person.
  const others = trainees.filter((t) => t.id !== me.traineeId);
  /** Can this person train here at all? An admin can always enrol themselves. */
  const canTrainMyself = Boolean(me.traineeId) || me.role === 'admin';
  const forMe = f.traineeId === '';
  const solo = me.role === 'trainee';

  const create = async () => {
    setBusy(true);
    let id = '';
    const slots = days.map((d) => ({ weekday: d, time }));
    const ok = await run(async () => {
      if (forMe) {
        // Idempotent, and a no-op for anyone who already has a record — which is
        // everyone but an admin on their first workout.
        if (!me.traineeId) await api.trainMyself(me.name);
        const p = await api.createRoutine({
          title: f.title,
          kind: f.kind,
          ...(f.templateId ? { templateId: f.templateId } : {}),
          slots,
        });
        id = p.id;
      } else {
        const res = await api.assignProgram({
          traineeId: f.traineeId,
          title: f.title,
          kind: f.kind,
          ...(f.templateId ? { templateId: f.templateId } : {}),
          ...(slots.length ? { slots } : {}),
        });
        id = res.program.id;
      }
    }, 'Created — check it over, then start it');
    setBusy(false);
    if (!ok) return;
    setOpen(false);
    setF({ title: '', kind: 'strength', templateId: '', traineeId: '' });
    setDays([]);
    onCreated();
    if (id) onOpen(id);
  };

  if (!open) {
    // A coach with no trainees and no record of their own has nobody to write
    // for. Say that, rather than opening a form whose every path is a denial.
    if (!canTrainMyself && others.length === 0) {
      return (
        <div className="empty">
          <Figure pose="rest" size={132} />
          <span className="head">Nobody to write a programme for yet.</span>
          Invite a trainee from the Trainees screen; their first workout starts there.
        </div>
      );
    }
    return (
      <div className="actions" style={{ marginBottom: 14 }}>
        <button className="primary wide" onClick={() => setOpen(true)}>
          + {solo ? 'New workout' : 'New programme'}
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      {others.length > 0 && (
        <>
          <label>for whom</label>
          <select value={f.traineeId} onChange={(e) => setF({ ...f, traineeId: e.target.value })}>
            {canTrainMyself && <option value="">Me</option>}
            {!canTrainMyself && <option value="">choose…</option>}
            {others.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </>
      )}

      <label>name</label>
      <input
        value={f.title}
        onChange={(e) => setF({ ...f, title: e.target.value })}
        placeholder={forMe ? 'Workout A' : 'Block 1'}
      />

      <label>kind</label>
      <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
        {['strength', 'rehab', 'conditioning', 'assessment'].map((k) => (
          <option key={k} value={k}>
            {k === 'assessment' ? 'assessment — a baseline, not a workout' : k}
          </option>
        ))}
      </select>

      <label>start from a plan?</label>
      <select
        value={f.templateId}
        onChange={(e) => {
          const chosen = templates.find((t) => t.id === e.target.value);
          // A baseline template IS an assessment: picking it says so, and names
          // the thing, so the two do not have to be set by hand to agree.
          const baseline = Boolean(chosen?.name.startsWith('Baseline'));
          setF({
            ...f,
            templateId: e.target.value,
            ...(baseline ? { kind: 'assessment', title: f.title || 'Baseline' } : {}),
          });
        }}
      >
        <option value="">empty — add exercises after</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} ({t.items.length} exercises{t.mine ? ', yours' : t.ownerName ? `, by ${t.ownerName}` : ''})
          </option>
        ))}
      </select>
      {templates.length === 0 && (
        <div className="sub">
          No plans in this gym yet — an empty workout is the normal way to start, you can
          make a plan of your own on the Plans screen, and an admin can install the gym&apos;s
          default library from Me.
        </div>
      )}

      <label>book it (optional)</label>
      <div className="sets">
        {[1, 2, 3, 4, 5, 6, 7].map((d) => (
          <button
            key={d}
            className={`pill toggle${days.includes(d) ? ' on' : ''}`}
            onClick={() => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort())}
          >
            {DAY_NAMES[d]}
          </button>
        ))}
      </div>
      {days.length > 0 && (
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      )}

      <div className="actions">
        <button
          className="primary"
          disabled={busy || !f.title || (!forMe && !f.traineeId) || (forMe && !canTrainMyself)}
          onClick={create}
        >
          Create
        </button>
        <button className="ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <div className="sub" style={{ marginTop: 8 }}>
        {forMe
          ? 'Yours alone unless you share it. '
          : 'Theirs to run when they are ready. '}
        It opens next so you can swap exercises and set the reps — starting it is a
        separate, deliberate tap. Booking is optional.
      </div>
    </div>
  );
}

/**
 * RESHAPE ONE PRESCRIPTION ROW — change the sets, change the reps, change the
 * load, or take the exercise out altogether.
 *
 * The whole flow leans on this existing: creating a workout no longer starts it,
 * precisely so there is a moment to come in here and make it yours. A template
 * is somebody's guess at your numbers, and an empty workout is a list you are
 * still building.
 *
 * It always writes an EXPLICIT set list, even when you leave every row the same.
 * That is `set-item-sets`, which is also how a ramp is stored — and it keeps
 * `target_sets` / `target_reps` in step, so adherence, the schedule and the card
 * all still read the uniform columns and get the truth. Editing 3 × 5 down to
 * 3 × 3 therefore turns it into three listed sets; the pills say the same thing
 * the one-line target said, just row by row.
 *
 * Removing is NOT undoing. Sets you already logged stay logged, and an exercise
 * you have performed stays in your library — the edge that earned it is
 * permanent and nothing here touches it.
 */
function ItemEditor({
  item,
  unit,
  unilateral,
  run,
  onDone,
  onCancel,
}: {
  item: ProgramDetail['items'][number];
  unit: string;
  /** One side at a time: every row carries a side, and the two can differ. */
  unilateral: boolean;
  run: ScreenProps['run'];
  onDone: () => void;
  onCancel: () => void;
}) {
  type Row = { reps: string; load: string; side: Side | null };
  const uniform = (side: Side | null): Row[] =>
    Array.from({ length: Math.max(1, item.target_sets) }, () => ({
      reps: String(item.target_reps),
      load: item.target_load ?? '',
      side,
    }));
  const initial: Row[] =
    item.sets.length > 0
      ? item.sets.map((s) => ({ reps: String(s.target_reps), load: s.target_load ?? '', side: s.side }))
      : unilateral
        ? [...uniform('left'), ...uniform('right')]
        : uniform(null);
  const [sets, setSets] = useState(initial);
  const [busy, setBusy] = useState(false);

  const patch = (i: number, next: Partial<Row>) =>
    setSets(sets.map((s, j) => (i === j ? { ...s, ...next } : s)));

  const save = async () => {
    setBusy(true);
    const ok = await run(
      () =>
        api.setItemSets(
          item.id,
          sets.map((s) => ({
            reps: Number.parseInt(s.reps, 10) || 1,
            ...(s.load.trim() ? { load: s.load.trim() } : {}),
            ...(s.side ? { side: s.side } : {}),
          })),
        ),
      'Prescription updated',
    );
    setBusy(false);
    if (ok) onDone();
  };

  const remove = async () => {
    setBusy(true);
    const ok = await run(() => api.removeProgramItem(item.id), 'Taken out of this workout');
    setBusy(false);
    if (ok) onDone();
  };

  const quantity = unit === 'metres' ? 'metres' : unit === 'seconds' ? 'seconds' : 'reps';

  /** Row numbers count per side, the way the server numbers them. */
  const numberOf = (i: number) => sets.slice(0, i + 1).filter((s) => s.side === sets[i]!.side).length;

  return (
    <div className="item-editor">
      <label>
        each set — {quantity}, and load in kg if it takes one
        {unilateral ? '. Left and right can differ.' : ''}
      </label>
      {sets.map((s, i) => (
        <div key={i} className={`editor-row${unilateral ? ' sided' : ''}`}>
          {unilateral ? (
            <button
              type="button"
              className={`side-pick ${s.side ?? ''}`}
              aria-label={`set ${numberOf(i)} side: ${s.side ?? 'unset'}`}
              onClick={() => patch(i, { side: s.side === 'left' ? 'right' : 'left' })}
            >
              {s.side === 'right' ? 'R' : 'L'}
              <small>{numberOf(i)}</small>
            </button>
          ) : (
            <span className="editor-no mono">{i + 1}</span>
          )}
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={s.reps}
            aria-label={`set ${i + 1} ${quantity}`}
            onChange={(e) => patch(i, { reps: e.target.value })}
          />
          <input
            type="text"
            inputMode="decimal"
            placeholder="kg"
            value={s.load}
            aria-label={`set ${i + 1} load`}
            onChange={(e) => patch(i, { load: e.target.value })}
          />
          <button
            className="ghost"
            aria-label={`remove set ${i + 1}`}
            disabled={sets.length === 1}
            onClick={() => setSets(sets.filter((_, j) => j !== i))}
          >
            −
          </button>
        </div>
      ))}
      <div className="actions">
        <button
          className="ghost"
          onClick={() =>
            setSets([
              ...sets,
              sets[sets.length - 1] ?? { reps: '8', load: '', side: unilateral ? 'left' : null },
            ])
          }
        >
          + set
        </button>
        <button className="primary" disabled={busy} onClick={save}>
          Save
        </button>
        <button className="ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <div className="actions">
        <button className="danger" disabled={busy} onClick={remove}>
          Remove this exercise
        </button>
      </div>
      <div className="sub">
        Anything already logged against it stays logged, and an exercise you have
        performed stays in your library for good.
        {unilateral &&
          ' Tap L/R to move a set to the other side — a weaker arm can get its own load and its own reps.'}
      </div>
    </div>
  );
}

/** How many sets a prescription row asks for in total — per side on a
 *  unilateral exercise, so "3 × 10 each arm" is six. Mirrors the server. */
function prescribedTotal(item: ProgramDetail['items'][number]): number {
  if (item.sets.length > 0) return item.sets.length;
  return item.target_sets * (item.exercise?.laterality === 'unilateral' ? 2 : 1);
}

/** "L 6 × 4 · R 12 × 4" — one line summarising a set of results per side. */
function sideSummary(sets: SetResult[], unit: string): string {
  const part = (side: Side | null) => {
    const own = sets.filter((s) => s.side === side);
    if (own.length === 0) return null;
    const best = own.reduce((a, b) => (b.reps > a.reps ? b : a));
    const label = side === 'left' ? 'L ' : side === 'right' ? 'R ' : '';
    return `${label}${formatQuantity(best.reps, unit)}${best.load ? ` × ${best.load}` : ''}`;
  };
  return [part('left'), part('right'), part(null)].filter(Boolean).join(' · ');
}

/** The open session on a programme, if it has one. */
function openSessionOf(detail: ProgramDetail) {
  return detail.program.status === 'in_progress'
    ? detail.sessions[detail.sessions.length - 1]
    : undefined;
}

/**
 * IS THE SESSION OVER? Derived, never stored — a session ends when every
 * prescribed exercise has its target sets logged. `target_sets` says what was
 * asked for and the append-only results say what was done, so the answer is a
 * projection of two things that already exist. A stored flag would be a third
 * source of truth that could disagree with both.
 */
function isSessionComplete(detail: ProgramDetail): boolean {
  const sets = openSessionOf(detail)?.sets ?? [];
  if (detail.items.length === 0 || sets.length === 0) return false;
  return detail.items.every(
    (i) => sets.filter((s) => s.program_item_id === i.id).length >= prescribedTotal(i),
  );
}

/**
 * The receipt. Its duration comes from the DATA — the session opened at
 * `performed_at`, the last set landed at `logged_at` — not from the phone's
 * clock, so it reads the same on every device and survives a reload. The device
 * clock is only the fallback for a session that ended with nothing logged.
 */
function summaryOf(detail: ProgramDetail, earned: string | null, fallbackMs: number): SessionSummary {
  const open = openSessionOf(detail);
  const sets = open?.sets ?? [];
  const volume = sets.reduce(
    (n, x) => n + (x.load ? Number.parseFloat(x.load) || 0 : 0) * x.reps,
    0,
  );
  const last = sets.reduce((t, x) => Math.max(t, Date.parse(x.logged_at)), 0);
  const started = open ? Date.parse(open.performed_at) : 0;
  return {
    name: detail.program.title,
    ms: last && started && last > started ? last - started : fallbackMs,
    sets: sets.length,
    done: new Set(sets.map((x) => x.program_item_id)).size,
    total: detail.items.length,
    volume: volume > 0 ? Math.round(volume).toLocaleString('sv-SE') : null,
    earned,
  };
}

export function ProgramDetailScreen({
  programId,
  me,
  run,
  onBack,
  onProgress,
}: ScreenProps & { programId: string; onBack: () => void; onProgress?: () => void }) {
  const [detail, setDetail] = useState<ProgramDetail | null>(null);
  const [earned, setEarned] = useState<string | null>(null);
  /** Which prescription row is open for editing, if any. One at a time. */
  const [editing, setEditing] = useState<string | null>(null);
  /**
   * TWO VIEWS OF ONE WORKOUT. While a session is on, the screen is the SESSION:
   * one exercise at a time and an overview of the rest. Everything about
   * managing the workout — its schedule, finishing a block, adding exercises —
   * is the other view, one tap away. They used to be one long page, which meant
   * someone who had just pressed "start" was looking at a schedule editor.
   */
  const [view, setView] = useState<'session' | 'manage'>('session');
  /** The exercise on screen. Null means "the first one not finished yet". */
  const [cursor, setCursor] = useState<string | null>(null);
  /** The row a set was just logged on — so finishing it moves you along. */
  const advance = useRef<string | null>(null);

  const reload = useCallback(() => {
    api
      .program(programId)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [programId]);
  useEffect(reload, [reload]);

  // The session bar's counts come from HERE — the one screen that already knows
  // them. Reporting beats fetching: the shell would otherwise have to pull a
  // whole programme just to render a subline, and it would lag every logged set.
  const active = useActiveSession();
  const live = active?.programId === programId ? active : null;
  useEffect(() => {
    if (!detail) return;
    const open =
      detail.program.status === 'in_progress' ? detail.sessions[detail.sessions.length - 1] : undefined;
    const logged = new Set((open?.sets ?? []).map((x) => x.program_item_id));
    reportProgress(programId, logged.size, detail.items.length);
  }, [detail, programId]);

  // THE NATURAL END. A session is over when the last prescribed set is logged,
  // so the finish moment arrives on its own rather than waiting to be asked for.
  // Firing needs a live session, and finishing clears it — so this runs exactly
  // once, and reopening a finished workout later does not replay the confetti.
  useEffect(() => {
    if (!detail || !live) return;
    if (isSessionComplete(detail)) finishSession(summaryOf(detail, earned, elapsedMs(live)));
  }, [detail, live, earned]);

  // MOVE ALONG. When the set just logged completes its row, let go of the
  // cursor so the screen falls to the next unfinished exercise. Only after a
  // log: tapping a finished row in the overview to look at it must not bounce.
  useEffect(() => {
    if (!detail || !advance.current) return;
    const id = advance.current;
    advance.current = null;
    const item = detail.items.find((i) => i.id === id);
    const logged = (openSessionOf(detail)?.sets ?? []).filter((x) => x.program_item_id === id).length;
    if (item && logged >= prescribedTotal(item)) setCursor(null);
  }, [detail]);

  if (!detail) return <div className="empty">
          <Figure pose="rest" size={132} />Not visible to {me?.name ?? 'you'}.</div>;

  const { program, items, sessions, summary, slots } = detail;
  const openSession = program.status === 'in_progress' ? sessions[sessions.length - 1] : undefined;

  const setsFor = (itemId: string) => openSession?.sets.filter((s) => s.program_item_id === itemId) ?? [];

  // A session is ON when the clock is running here, or the latest session is
  // today's. Last week's session is history, not something you are in.
  const inSession =
    Boolean(openSession) &&
    (Boolean(live) || new Date(openSession!.performed_at).toDateString() === new Date().toDateString());
  const assessment = program.kind === 'assessment';
  const isDone = (item: ProgramDetail['items'][number]) => setsFor(item.id).length >= prescribedTotal(item);
  const firstOpen = items.find((i) => !isDone(i));
  const current = (cursor ? items.find((i) => i.id === cursor) : undefined) ?? firstOpen ?? null;
  const allDone = items.length > 0 && !firstOpen;
  const totalSets = items.reduce((n, i) => n + prescribedTotal(i), 0);
  const doneSets = items.reduce((n, i) => n + Math.min(setsFor(i.id).length, prescribedTotal(i)), 0);

  /**
   * START TRAINING — two calls from the client, on purpose. `workorder/start`
   * carries the manifest guard and stays its own deliberate request; `begin`
   * then opens (or resumes) today's session. Neither is folded into the other.
   */
  const startTraining = async () => {
    const ok = await run(async () => {
      if (program.status === 'planned') await api.startProgram(program.id);
      await api.begin(program.id);
    }, assessment ? 'Baseline started' : 'Session started');
    if (ok) {
      startSession(program.id, program.title, false);
      setView('session');
      setCursor(null);
    }
    reload();
  };

  /**
   * End the session by hand — the early exit, for when you stop before the end.
   * The natural end fires on its own (see the effect above): a session is over
   * when the last prescribed set is logged.
   *
   * Either way this writes NOTHING. Every set was logged when it happened, so
   * the card is a receipt for rows that are already durable.
   */
  const endNow = () => finishSession(summaryOf(detail, earned, live ? elapsedMs(live) : 0));

  /** One prescription row. `tag` is the superset position (A1, A2) or null. */
  const itemCard = (
    item: ProgramDetail['items'][number],
    tag: string | null,
  ) => {
    const done = setsFor(item.id);
    const unit = item.exercise?.unit ?? 'reps';
    const unilateral = item.exercise?.laterality === 'unilateral';
    // One side at a time means two rows of pills, L and R, each numbered from 1
    // — the way the server numbers both the prescription and the results.
    const sides: (Side | null)[] = unilateral ? ['left', 'right'] : [null];
    // A uniform prescription and an explicit ramp are the same list once you
    // expand the first — so the pills below never have to know which it was.
    const prescribedFor = (side: Side | null) =>
      item.sets.length > 0
        ? item.sets
            .filter((s) => s.side === side)
            .map((s) => ({ no: s.set_no, reps: s.target_reps, load: s.target_load, note: s.note }))
        : Array.from({ length: item.target_sets }, (_, i) => ({
            no: i + 1,
            reps: item.target_reps,
            load: item.target_load,
            note: null as string | null,
          }));
    // One row of pills, not two: a performed set REPLACES its target in place,
    // filled and ticked, so "where am I" is one glance rather than a comparison.
    const showPills = Boolean(openSession) || item.sets.length > 0;
    // LAST TIME — the most recent earlier session with sets on this row. This
    // is the moment the baseline pays off: the number from a month ago sits
    // right under the field you are about to fill in, per arm.
    const previous = [...sessions]
      .reverse()
      .find((s) => s.id !== openSession?.id && s.sets.some((x) => x.program_item_id === item.id));
    const lastTime = previous
      ? sideSummary(previous.sets.filter((x) => x.program_item_id === item.id), unit)
      : null;
    // The side to offer next: the one with fewer sets logged, left first.
    const nextSide: Side | undefined = unilateral
      ? done.filter((s) => s.side === 'left').length <= done.filter((s) => s.side === 'right').length
        ? 'left'
        : 'right'
      : undefined;

    // Reshaping is for a plan, not for a record: once a block is completed or
    // closed the prescription is what was asked for, and rewriting it would make
    // the adherence number a comparison against something that never happened.
    const editable = program.status === 'planned' || program.status === 'in_progress';

    return (
      <div key={item.id} className={`card${openSession ? ' raised' : ''}`}>
        <div className="row center">
          <span className="title with-fig">
            <FigureTile pose={poseFor(item.exercise?.name, unit)} size={46} />
            <span>
              {tag && <span className="tag" style={{ marginRight: 8 }}>{tag}</span>}
              {item.exercise?.name ?? 'Unknown exercise'}
            </span>
          </span>
          {editable && editing !== item.id && (
            <button
              className="ghost small"
              onClick={() => setEditing(item.id)}
              aria-label={`edit ${item.exercise?.name ?? 'exercise'}`}
            >
              Edit
            </button>
          )}
          <Counter done={done.length} total={prescribedTotal(item)} />
        </div>
        {item.notes && <div className="sub">{item.notes}</div>}
        {editing === item.id && (
          <ItemEditor
            item={item}
            unit={unit}
            unilateral={unilateral}
            run={run}
            onDone={() => {
              setEditing(null);
              reload();
            }}
            onCancel={() => setEditing(null)}
          />
        )}
        {showPills ? (
          sides.map((side) => {
            const prescribed = prescribedFor(side);
            const onSide = done.filter((s) => s.side === side);
            const total = Math.max(prescribed.length, onSide.length);
            return (
              <div key={side ?? 'both'} className="sets">
                {side && <span className={`side-label ${side}`}>{side === 'left' ? 'L' : 'R'}</span>}
                {Array.from({ length: total }, (_, i) => {
                  const no = i + 1;
                  const performed = onSide.find((s) => s.set_no === no);
                  if (performed) {
                    return (
                      <span key={performed.id} className="pill done">
                        {no}: {formatAmount(performed.reps, unit)}
                        {performed.load ? ` × ${performed.load}` : ''}
                        {performed.duration_seconds
                          ? ` · ${formatQuantity(performed.duration_seconds, 'seconds')}`
                          : ''}
                        {performed.avg_hr ? ` · ${performed.avg_hr} bpm` : ''}
                        {performed.rpe ? ` · RPE ${performed.rpe}` : ''} ✓
                      </span>
                    );
                  }
                  const target = prescribed[i];
                  if (!target) return null;
                  return (
                    <span key={`t${no}`} className="pill">
                      {no}: {formatAmount(target.reps, unit)}
                      {target.load ? ` × ${target.load}` : ''}
                      {target.note ? ` · ${target.note}` : ''}
                    </span>
                  );
                })}
              </div>
            );
          })
        ) : (
          <div className="sub mono">
            target {item.target_sets} × {formatQuantity(item.target_reps, unit)}{' '}
            {unit === 'reps' ? 'reps' : unit === 'metres' ? 'm' : ''}
            {item.target_load ? ` @ ${item.target_load}` : ''}
            {unilateral ? ' · each side' : ''}
          </div>
        )}
        {lastTime && (
          <div className="sub last-time">
            Last time · {lastTime}
            {previous ? ` · ${new Date(previous.performed_at).toLocaleDateString()}` : ''}
          </div>
        )}
        {recurrenceLabel(item.recur_days, item.recur_per_week) && (
          <div className="sub">{recurrenceLabel(item.recur_days, item.recur_per_week)}</div>
        )}
        {openSession && (
          <SetLogger
            // Remounts after every logged set, so it comes back on the OTHER arm
            // with that arm's numbers rather than still showing the last one.
            key={`${item.id}:${done.length}`}
            unit={item.exercise?.unit ?? 'reps'}
            modality={item.exercise?.modality ?? 'strength'}
            defaultSide={nextSide}
            // The next prescribed set ON THAT SIDE is the default — so after the
            // baseline, the left arm is offered its own lighter load.
            defaultFor={(side) => {
              const onSide = done.filter((s) => s.side === (side ?? null)).length;
              const target = prescribedFor(side ?? null)[onSide];
              // The prescription wins; failing that, the weight you just used.
              const lastLoad = done[done.length - 1]?.load ?? null;
              return {
                reps: target?.reps ?? item.target_reps,
                load: target?.load ?? lastLoad ?? item.target_load,
              };
            }}
            onLog={async (bodyInput) => {
              let gotEarned = false;
              await run(async () => {
                const res = await api.logSet(openSession.id, {
                  programItemId: item.id,
                  ...bodyInput,
                });
                gotEarned = res.earned;
              });
              if (gotEarned) setEarned(item.exercise?.name ?? 'That exercise');
              advance.current = item.id;
              reload();
            }}
          />
        )}
      </div>
    );
  };

  // -------------------------------------------------------------------------
  // THE SESSION VIEW — one exercise at a time, and where you are in the whole.
  // -------------------------------------------------------------------------
  if (inSession && view === 'session') {
    const index = current ? items.findIndex((i) => i.id === current.id) : -1;
    const step = (dir: 1 | -1) => {
      if (items.length === 0) return;
      const from = index < 0 ? 0 : index;
      // Skip lands on the next UNFINISHED row; Previous is simply the row before.
      if (dir === 1) {
        const ahead = [...items.slice(from + 1), ...items.slice(0, from)].find((i) => !isDone(i));
        setCursor((ahead ?? items[(from + 1) % items.length]!).id);
      } else {
        setCursor(items[(from - 1 + items.length) % items.length]!.id);
      }
      setEditing(null);
    };
    return (
      <>
        <button className="back" onClick={onBack}>
          ‹ Workouts
        </button>
        <div className="row center" style={{ marginTop: 2 }}>
          <h1 style={{ margin: 0 }}>{program.title}</h1>
          <span className="badge in_progress">{assessment ? 'baseline' : 'in session'}</span>
        </div>
        {live && <SessionClock session={live} onEnd={endNow} />}

        <div className="card session-progress">
          <div className="row center">
            <span className="title">
              {allDone ? 'All done' : `Exercise ${index + 1} of ${items.length}`}
            </span>
            <span className="sub mono" style={{ marginTop: 0 }}>
              {doneSets}/{totalSets} sets
            </span>
          </div>
          <div className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={totalSets} aria-valuenow={doneSets}>
            <i style={{ width: `${totalSets ? (doneSets / totalSets) * 100 : 0}%` }} />
          </div>
        </div>

        {allDone ? (
          <div className="card raised accent">
            <div className="title big">{assessment ? 'That is your baseline.' : 'Every set is logged.'}</div>
            <div className="sub">
              {assessment
                ? 'Save it and it becomes the first point on every curve — and the left/right gap as a number.'
                : 'Nothing more to do here today. Everything was saved as you went.'}
            </div>
            <div className="actions">
              {assessment ? (
                <button
                  className="primary wide"
                  onClick={async () => {
                    const ok = await run(() => api.completeProgram(program.id), 'Baseline saved');
                    reload();
                    if (ok) onProgress?.();
                  }}
                >
                  Save it and see my numbers
                </button>
              ) : (
                <button className="primary wide" onClick={onBack}>
                  Back to my workouts
                </button>
              )}
            </div>
          </div>
        ) : (
          current && itemCard(current, null)
        )}

        {!allDone && items.length > 1 && (
          <div className="actions session-nav">
            <button onClick={() => step(-1)}>‹ Previous</button>
            <button onClick={() => step(1)}>Skip for now ›</button>
          </div>
        )}

        {earned && (
          <div className="earned-card" onClick={() => setEarned(null)}>
            <Figure pose="cheer" size={120} />
            <div className="head">Yours forever</div>
            <div className="what">{earned} · earned</div>
            <div className="why">
              Performing it once earned it into your library. Nobody can take it out of the
              catalogue from under you.
            </div>
          </div>
        )}

        <h2>This session</h2>
        <div className="list">
          {items.map((i, n) => {
            const logged = setsFor(i.id);
            const done = isDone(i);
            return (
              <button
                key={i.id}
                type="button"
                className={`rowbtn${current?.id === i.id && !allDone ? ' current' : ''}`}
                onClick={() => {
                  setCursor(i.id);
                  setEditing(null);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              >
                <span className="person">
                  <span className={`step${done ? ' done' : logged.length > 0 ? ' part' : ''}`}>
                    {done ? '✓' : n + 1}
                  </span>
                  <span>
                    <span className="name">{i.exercise?.name ?? 'Exercise'}</span>
                    <span className="sub mono">
                      {logged.length > 0
                        ? sideSummary(logged, i.exercise?.unit ?? 'reps')
                        : `${i.target_sets} × ${formatAmount(i.target_reps, i.exercise?.unit ?? 'reps')}${
                            i.target_load ? ` @ ${i.target_load}` : ''
                          }${i.exercise?.laterality === 'unilateral' ? ' each side' : ''}`}
                    </span>
                  </span>
                </span>
                <span className="right">
                  <Counter done={Math.min(logged.length, prescribedTotal(i))} total={prescribedTotal(i)} />
                </span>
              </button>
            );
          })}
        </div>

        <div className="actions" style={{ marginTop: 14 }}>
          {!allDone && <button onClick={endNow}>End the session early</button>}
          <button className="ghost" onClick={() => setView('manage')}>
            Workout settings
          </button>
        </div>
        <div className="sub">Every set is saved the moment you log it. Leaving loses nothing.</div>
      </>
    );
  }

  return (
    <>
      <button className="back" onClick={onBack}>
        ‹ Workouts
      </button>
      {inSession && (
        <div className="actions" style={{ marginBottom: 10 }}>
          <button className="primary wide" onClick={() => setView('session')}>
            ‹ Back to the session
          </button>
        </div>
      )}
      {/* Title and state on one line, the identifiers beneath it in mono — the
          header answers "which one, and where is it" before anything else. */}
      <div className="row center" style={{ marginTop: 2 }}>
        <h1 style={{ margin: 0 }}>{program.title}</h1>
        <span className={`badge ${program.status}`}>{program.status.replace('_', ' ')}</span>
      </div>
      <div className="sub mono" style={{ marginTop: 6, marginBottom: 14 }}>
        #{program.number} · {program.kind}
        {program.traineeName ? ` · ${program.traineeName}` : ''}
      </div>
      {live && <SessionClock session={live} onEnd={endNow} />}
      <div className="card">
        {program.status === 'planned' && (
          <div className="sub" style={{ marginTop: 0 }}>
            {assessment
              ? 'Look it over, warm up, then start. You do one exercise at a time and write down what you managed.'
              : 'Look it over and change anything that is not right for you, then start.'}
          </div>
        )}
        {program.status === 'in_progress' && !assessment && (
          <div className="sub" style={{ marginTop: 0 }}>
            A standing workout never has to be finished — keep logging into it week after
            week. Finishing is for when you close off a block and want the adherence number.
          </div>
        )}
        <div className="actions">
          {/* NOT gated on being staff. A trainee holds `workorder:report` and the
              guard passes on their own programme, so this was the UI refusing
              something the kernel allows — the exact inversion this app is
              supposed to avoid. Let the kernel decide; a refusal lands in the
              banner like any other. */}
          {program.status === 'planned' && (
            <button className="primary" onClick={startTraining}>
              {assessment ? 'Start the baseline' : 'Start training'}
            </button>
          )}
          {program.status === 'in_progress' && !inSession && (
            <button className="primary" onClick={startTraining}>
              {assessment ? 'Continue the baseline' : "Start today's session"}
            </button>
          )}
          {program.status === 'in_progress' && (
            // A DEFAULT button, deliberately not the primary one: finishing is
            // optional, and never finishing is the normal shape of a standing
            // workout.
            <button
              onClick={() =>
                run(() => api.completeProgram(program.id), 'Finished — adherence computed').then(
                  reload,
                )
              }
            >
              {assessment ? 'Save the baseline as it is' : 'Finish this block'}
            </button>
          )}
        </div>
      </div>

      {summary && <AdherenceCard summary={summary} />}

      {/* A baseline is taken, not booked: no weekly schedule to set. */}
      {!assessment && (program.status === 'planned' || program.status === 'in_progress') && (
        <ScheduleEditor programId={program.id} slots={slots} run={run} onSaved={reload} />
      )}

      <h2>Prescription</h2>
      {groupItems(items).map((group) =>
        group.key ? (
          <div key={group.key} className="superset">
            <div className="superset-label">
              Superset {group.key} · {group.items.length} exercises, back to back
            </div>
            {group.items.map((item, i) => itemCard(item, `${group.key}${i + 1}`))}
          </div>
        ) : (
          <div key={group.items[0]!.id}>{group.items.map((item) => itemCard(item, null))}</div>
        ),
      )}
      {earned && (
        <div className="earned-card" onClick={() => setEarned(null)}>
          <Figure pose="cheer" size={120} />
          <div className="head">Yours forever</div>
          <div className="what">{earned} · earned</div>
          <div className="why">
            Performing it once earned it into your library. Nobody can take it out of the
            catalogue from under you.
          </div>
        </div>
      )}

      {(program.status === 'planned' || program.status === 'in_progress') && (
        <AddProgramItem programId={program.id} run={run} onAdded={reload} />
      )}

      <h2>Sessions</h2>
      {sessions.length === 0 && (
        <div className="empty">
          <Figure pose="rest" size={132} />
          <span className="head">No sessions yet.</span>
          Every set you log lands in one — and a correction is a new row, never an edit.
        </div>
      )}
      {sessions.length > 0 && (
        <div className="list">
          {sessions.map((s) => (
            <div key={s.id} className="rowbtn" style={{ cursor: 'default' }}>
              <span>
                <span className="name">{new Date(s.performed_at).toLocaleString()}</span>
                {s.note && <span className="sub">{s.note}</span>}
              </span>
              <span className="when">
                {s.sets.length} set{s.sets.length === 1 ? '' : 's'}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Adherence — prescribed against performed, as a ring rather than a percentage
 * in a corner. It is the one number worth a whole card, and it appears only
 * once the block is finished: a standing workout that never ends is the normal
 * case, not an unfinished one.
 */
function AdherenceCard({ summary }: { summary: Summary }) {
  const pct = Math.max(0, Math.min(100, Number(summary.adherence_pct) || 0));
  const r = 54;
  const circumference = 2 * Math.PI * r;
  return (
    <div className="card raised">
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <div className="ring">
          <svg width="124" height="124" viewBox="0 0 124 124">
            <circle cx="62" cy="62" r={r} fill="none" stroke="var(--line)" strokeWidth="8" />
            <circle
              cx="62"
              cy="62"
              r={r}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${(circumference * pct) / 100} ${circumference}`}
            />
          </svg>
          <div className="value">
            {Math.round(pct)}
            <small>%</small>
          </div>
        </div>
        <div className="stats">
          <div className="stat">
            {summary.performed_sets}
            <span> / {summary.prescribed_sets}</span>
            <span className="label">sets performed</span>
          </div>
          {summary.total_volume !== '0' && (
            <div className="stat">
              {summary.total_volume}
              <small> kg</small>
              <span className="label">total volume</span>
            </div>
          )}
          {summary.total_seconds > 0 && (
            <div className="stat">
              {formatQuantity(summary.total_seconds, 'seconds')}
              <span className="label">of work</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Build the workout as you go — the self-serve path. Shown to everyone; the
 * kernel decides whether the call lands, and a refusal surfaces in the banner
 * like any other.
 */
function AddProgramItem({
  programId,
  run,
  onAdded,
}: {
  programId: string;
  run: Run;
  onAdded: () => void;
}) {
  const [exercises] = useList<Exercise>(() => api.exercises(), [programId]);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ exerciseId: '', sets: '3', reps: '10', load: '' });
  const [days, setDays] = useState<number[]>([]);
  const [perWeek, setPerWeek] = useState('');

  if (!open) {
    return (
      <div className="actions" style={{ marginTop: 4 }}>
        <button className="wide" onClick={() => setOpen(true)}>
          + Add an exercise
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <label>exercise</label>
      <select value={f.exerciseId} onChange={(e) => setF({ ...f, exerciseId: e.target.value })}>
        <option value="">choose…</option>
        {exercises.map((e) => (
          <option key={e.id} value={e.id}>
            {e.canDo ? '' : '⚠ '}
            {e.name}
            {e.equipment.length ? ` — ${e.equipment.join(', ')}` : ' — bodyweight'}
          </option>
        ))}
      </select>
      <div className="setgrid" style={{ marginTop: 10 }}>
        <div>
          <label>sets</label>
          <input inputMode="numeric" value={f.sets} onChange={(e) => setF({ ...f, sets: e.target.value })} />
        </div>
        <div>
          <label>reps</label>
          <input inputMode="numeric" value={f.reps} onChange={(e) => setF({ ...f, reps: e.target.value })} />
        </div>
        <div>
          <label>load</label>
          <input inputMode="decimal" value={f.load} onChange={(e) => setF({ ...f, load: e.target.value })} />
        </div>
      </div>
      <label>repeat</label>
      <div className="sets">
        {[1, 2, 3, 4, 5, 6, 7].map((d) => (
          <button
            key={d}
            className={`pill toggle${days.includes(d) ? ' on' : ''}`}
            disabled={perWeek !== ''}
            onClick={() => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d])}
          >
            {DAY_NAMES[d]}
          </button>
        ))}
      </div>
      <label>…or just a count per week</label>
      <input
        inputMode="numeric"
        placeholder="e.g. 5"
        value={perWeek}
        disabled={days.length > 0}
        onChange={(e) => setPerWeek(e.target.value)}
      />
      <div className="sub" style={{ marginTop: 6 }}>
        Named days or a count — never both. A lifting block says Mon/Wed/Fri; a rehab
        prescription says five times a week and lets you pick the days.
      </div>
      <div className="actions">
        <button
          className="primary"
          disabled={!f.exerciseId}
          onClick={async () => {
            await run(
              () =>
                api.addProgramItem(programId, {
                  exerciseId: f.exerciseId,
                  targetSets: Number(f.sets),
                  targetReps: Number(f.reps),
                  ...(f.load ? { targetLoad: f.load } : {}),
                  ...(days.length > 0 ? { recurDays: [...days].sort().join(',') } : {}),
                  ...(days.length === 0 && perWeek ? { recurPerWeek: Number(perWeek) } : {}),
                }),
              'Added',
            );
            setF({ ...f, exerciseId: '', load: '' });
            setDays([]);
            setPerWeek('');
            onAdded();
          }}
        >
          Add
        </button>
        <button className="ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}


/**
 * When this programme is trained. "Wednesdays at 11" is a different question
 * from "this exercise three times a week", so it gets its own control rather
 * than being folded into the per-exercise rhythm.
 */
function ScheduleEditor({
  programId,
  slots,
  run,
  onSaved,
}: {
  programId: string;
  slots: ProgramDetail['slots'];
  run: Run;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(3);
  const [time, setTime] = useState('11:00');

  const save = (next: { weekday: number; time: string }[]) =>
    run(() => api.setSlots(programId, next), 'Schedule saved').then(() => {
      onSaved();
      setOpen(false);
    });
  const current = slots.map((s) => ({ weekday: s.weekday, time: s.time_of_day }));

  return (
    <div className="card">
      <div className="row">
        <span className="title">Training schedule</span>
        {slots.length === 0 && <span className="badge">not booked</span>}
      </div>
      {slots.length > 0 && (
        <div className="sets" style={{ marginTop: 8 }}>
          {slots.map((s) => (
            <span key={s.id} className="pill">
              {DAY_NAMES[s.weekday]} {s.time_of_day}
            </span>
          ))}
        </div>
      )}
      <div className="actions">
        <button onClick={() => setOpen(!open)}>{open ? 'Done' : slots.length ? 'Change' : 'Book a time'}</button>
      </div>
      {open && (
        <>
          <label>day</label>
          <div className="sets">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <button
                key={d}
                className={`pill toggle${d === day ? ' on' : ''}`}
                onClick={() => setDay(d)}
              >
                {DAY_NAMES[d]}
              </button>
            ))}
          </div>
          <label>time</label>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          <div className="actions">
            <button
              className="primary"
              onClick={() => save([...current, { weekday: day, time }])}
            >
              Add {DAY_NAMES[day]} {time}
            </button>
            {slots.length > 0 && (
              <button className="ghost danger" onClick={() => save([])}>
                Clear all
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** mm:ss for anything measured in time; plain numbers otherwise. */
function formatQuantity(value: number, unit: string): string {
  if (unit !== 'seconds') return String(value);
  const m = Math.floor(value / 60);
  const sec = value % 60;
  return m > 0 ? `${m}:${String(sec).padStart(2, '0')}` : `${sec}s`;
}

const UNIT_LABEL: Record<string, string> = { reps: 'reps', seconds: 'time', metres: 'metres' };

/** A quantity with its unit where one is needed on the pill: "5 km", "800 m", "1:30", "12". */
function formatAmount(value: number, unit: string): string {
  if (unit === 'metres') return value >= 1000 ? `${(value / 1000).toFixed(value % 1000 ? 1 : 0)} km` : `${value} m`;
  return formatQuantity(value, unit);
}

/** 340 → "5:40 /km". Running's number, derived from distance and time. */
function formatPace(secondsPerKm: number): string {
  return `${Math.floor(secondsPerKm / 60)}:${String(secondsPerKm % 60).padStart(2, '0')} /km`;
}

/**
 * The thumb-sized set logger, shaped by what the exercise is MEASURED IN.
 *
 * The quantity column has always been unit-agnostic — 8 reps, 45 seconds, 5000
 * metres are all just a number plus the exercise's unit — but the form used to
 * label it "reps" regardless, so logging a row read as typing 5000 reps. Now the
 * field says what it is, time is entered as mm:ss, and cardio gets the second
 * number it actually needs: how long it took, and what the heart was doing.
 * Load is hidden where it means nothing.
 */
function SetLogger({
  unit,
  modality,
  defaultSide,
  defaultFor,
  onLog,
}: {
  unit: string;
  modality: string;
  /** Set on a unilateral exercise: the side to offer first. Undefined = bilateral. */
  defaultSide: Side | undefined;
  /** The next prescribed set for a side — its reps and load prefill the fields. */
  defaultFor: (side: Side | undefined) => { reps: number; load: string | null };
  onLog: (body: {
    reps: number;
    load?: string;
    rpe?: string;
    durationSeconds?: number;
    avgHr?: number;
    side?: Side;
  }) => Promise<void>;
}) {
  const isTime = unit === 'seconds';
  const isDistance = unit === 'metres';
  const isCardio = modality === 'cardio';
  const [side, setSide] = useState<Side | undefined>(defaultSide);
  const initial = defaultFor(side);
  const [amount, setAmount] = useState(isTime ? formatQuantity(initial.reps, unit) : String(initial.reps));
  const [load, setLoad] = useState(initial.load ?? '');
  const [rpe, setRpe] = useState('');
  const [mins, setMins] = useState('');
  const [hr, setHr] = useState('');
  const [busy, setBusy] = useState(false);

  /** Switching arm re-prefills from THAT arm's prescription — which may differ. */
  const pick = (next: Side) => {
    setSide(next);
    const d = defaultFor(next);
    setAmount(isTime ? formatQuantity(d.reps, unit) : String(d.reps));
    setLoad(d.load ?? '');
  };

  /** '2:30' → 150, '45' → 45. Time is the one field people write two ways. */
  const parseClock = (raw: string): number => {
    if (!raw.includes(':')) return Number(raw);
    const [m, sec] = raw.split(':');
    return Number(m) * 60 + Number(sec || 0);
  };
  const quantity = isTime ? parseClock(amount) : Number(amount);
  // Minutes accept "22" and "22:30" alike — a run is timed in both.
  const seconds = mins.trim() ? Math.round(mins.includes(':') ? parseClock(mins) : Number(mins) * 60) : 0;
  const pace = isDistance && quantity > 0 && seconds > 0 ? Math.round((seconds * 1000) / quantity) : null;

  return (
    <div style={{ marginTop: 12 }}>
      {defaultSide && (
        <div className="side-toggle" role="radiogroup" aria-label="which side">
          {(['left', 'right'] as const).map((x) => (
            <button
              key={x}
              type="button"
              role="radio"
              aria-checked={side === x}
              className={`pill toggle ${x}${side === x ? ' on' : ''}`}
              onClick={() => pick(x)}
            >
              {x}
            </button>
          ))}
        </div>
      )}
      <div className="setgrid">
        <div>
          <label>{UNIT_LABEL[unit] ?? unit}</label>
          <input
            inputMode={isTime ? 'text' : 'numeric'}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={isTime ? 'mm:ss' : ''}
          />
        </div>
        {isCardio ? (
          <div>
            <label>time</label>
            <input
              inputMode="text"
              placeholder="mm:ss"
              value={mins}
              onChange={(e) => setMins(e.target.value)}
            />
          </div>
        ) : (
          <div>
            <label>load</label>
            <input inputMode="decimal" value={load} onChange={(e) => setLoad(e.target.value)} />
          </div>
        )}
        <div>
          <label>{isCardio ? 'avg HR' : 'RPE'}</label>
          <input
            inputMode="numeric"
            value={isCardio ? hr : rpe}
            onChange={(e) => (isCardio ? setHr(e.target.value) : setRpe(e.target.value))}
          />
        </div>
      </div>
      {(pace !== null || (isDistance && quantity >= 1000)) && (
        <div className="sub mono" style={{ textAlign: 'center' }}>
          {isDistance && quantity >= 1000 ? formatAmount(quantity, unit) : ''}
          {pace !== null ? ` · ${formatPace(pace)}` : ''}
        </div>
      )}
      <div className="actions">
        <button
          className="primary wide"
          disabled={busy || !Number.isFinite(quantity) || quantity <= 0}
          onClick={async () => {
            setBusy(true);
            await onLog({
              reps: Math.round(quantity),
              ...(!isCardio && load ? { load } : {}),
              ...(!isCardio && rpe ? { rpe } : {}),
              ...(isCardio && seconds > 0 ? { durationSeconds: seconds } : {}),
              ...(isCardio && hr ? { avgHr: Number(hr) } : {}),
              ...(side ? { side } : {}),
            });
            setBusy(false);
          }}
        >
          Log {isCardio ? 'it' : side ? `${side} set` : 'set'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Library — the same operation, three different correct answers
// ---------------------------------------------------------------------------

export function LibraryScreen({
  me,
  run,
  filters,
  onFilters,
}: ScreenProps & {
  filters: ExerciseFilters;
  onFilters: (next: ExerciseFilters) => void;
}) {
  const [all, reload] = useList<Exercise>(() => api.exercises(), [me?.key]);
  const [equipment] = useList<Equipment>(() => api.equipment(), [me?.key]);
  // FILTERS, not modes, and they live in the URL — so a filtered view is a link,
  // and a refresh keeps it. The default is everything you are allowed to see;
  // each control NARROWS that. Nothing here is an access decision — the kernel
  // already made those, and `all` is exactly what it returned.
  const { q: query, types: modalities, privateOnly: onlyPrivate, myKit: onlyMyKit } = filters;
  const pickedKit = filters.equipment;
  const patch = (next: Partial<ExerciseFilters>) => onFilters({ ...filters, ...next });
  const [kitOpen, setKitOpen] = useState(pickedKit.length > 0);
  const [form, setForm] = useState({ slug: '', name: '', modality: 'strength', unit: 'reps' });

  const needle = query.trim().toLowerCase();
  const rows = all.filter((e) => {
    if (
      needle &&
      !`${e.name} ${e.slug} ${e.description ?? ''} ${e.modality}`.toLowerCase().includes(needle)
    ) {
      return false;
    }
    if (modalities.length > 0 && !modalities.includes(e.modality)) return false;
    if (onlyPrivate && e.visibility !== 'private') return false;
    if (onlyMyKit && !e.canDo) return false;
    if (pickedKit.length > 0) {
      // Bodyweight always survives an equipment filter: it needs none of it.
      if (e.equipment.length > 0 && !e.equipment.every((s) => pickedKit.includes(s))) return false;
    }
    return true;
  });
  const filtered =
    Boolean(needle) || modalities.length > 0 || onlyPrivate || onlyMyKit || pickedKit.length > 0;

  const badge = (e: Exercise) => {
    if (e.active === 0) return <span className="badge retired">retired</span>;
    if (e.visibility === 'shared') return <span className="badge shared">shared</span>;
    if (e.access === 'granted' && me?.role === 'trainee')
      return <span className="badge earned">earned</span>;
    return <span className="badge private">private</span>;
  };

  return (
    <>
      <h1>Exercises</h1>

      <input
        className="search"
        type="search"
        inputMode="search"
        autoCapitalize="off"
        value={query}
        onChange={(e) => patch({ q: e.target.value })}
        placeholder="Search exercises…"
      />

      <div className="sets" style={{ marginTop: 10, marginBottom: 10 }}>
        {['strength', 'cardio', 'mobility', 'rehab'].map((m) => (
          <button
            key={m}
            className={`pill toggle${modalities.includes(m) ? ' on' : ''}`}
            onClick={() =>
              patch({
                types: modalities.includes(m)
                  ? modalities.filter((x) => x !== m)
                  : [...modalities, m],
              })
            }
          >
            {modalities.includes(m) ? '✓ ' : ''}
            {m}
          </button>
        ))}
      </div>

      {/* Selected looks the same here as it does on the modality pills above —
          one treatment for "on", wherever it appears. */}
      <div className="filters">
        <button className={onlyPrivate ? 'on' : ''} onClick={() => patch({ privateOnly: !onlyPrivate })}>
          {onlyPrivate ? '✓ ' : ''}Private
        </button>
        <button className={onlyMyKit ? 'on' : ''} onClick={() => patch({ myKit: !onlyMyKit })}>
          {onlyMyKit ? '✓ ' : ''}My kit
        </button>
        <button className={pickedKit.length ? 'on' : ''} onClick={() => setKitOpen(!kitOpen)}>
          Equipment
          {pickedKit.length ? <span className="mono"> ({pickedKit.length})</span> : ''}
        </button>
        {filtered && (
          <button
            className="ghost"
            onClick={() =>
              onFilters({
                name: 'exercises',
                q: '',
                types: [],
                privateOnly: false,
                myKit: false,
                equipment: [],
              })
            }
          >
            Clear
          </button>
        )}
        <span className="count">
          {filtered ? `${rows.length} of ${all.length}` : `${all.length} exercises`}
        </span>
      </div>

      {kitOpen && (
        <div className="card">
          <div className="sub">
            Show only exercises that need nothing beyond what you pick. Bodyweight always shows.
          </div>
          <div className="sets" style={{ marginTop: 10 }}>
            {equipment.map((eq) => (
              <button
                key={eq.slug}
                className={`pill toggle${pickedKit.includes(eq.slug) ? ' on' : ''}`}
                onClick={() =>
                  patch({
                    equipment: pickedKit.includes(eq.slug)
                      ? pickedKit.filter((s) => s !== eq.slug)
                      : [...pickedKit, eq.slug],
                  })
                }
              >
                {pickedKit.includes(eq.slug) ? '✓ ' : ''}
                {eq.name}
                {eq.available ? '' : ' ·'}
              </button>
            ))}
          </div>
          <div className="actions">
            <button
              onClick={() =>
                patch({ equipment: equipment.filter((e) => e.available).map((e) => e.slug) })
              }
            >
              Everything I own
            </button>
            <button className="ghost" onClick={() => patch({ equipment: [] })}>
              None
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 && (
        <div className="empty">
          <Figure pose="rest" size={132} />
          <span className="head">Nothing matches those filters.</span>
          Clear them to see every exercise available to you.
        </div>
      )}
      {rows.map((e) => (
        <div key={e.id} className="card">
          <div className="row center">
            <span className="title with-fig">
              <FigureTile pose={poseFor(e.name, e.unit)} size={46} />
              <span>{e.name}</span>
            </span>
            {badge(e)}
          </div>
          <div className="sub">
            {e.modality} · measured in {e.unit}
          </div>
          {e.description && <div className="sub">{e.description}</div>}
          <div className="sets">
            <EquipmentChips e={e} />
            {!e.canDo && <span className="sub" style={{ marginTop: 0 }}>missing today — still yours to read</span>}
          </div>
          {me?.role === 'admin' && e.active === 1 && (
            <div className="actions">
              <button
                className="ghost danger"
                onClick={() =>
                  run(() => api.retireExercise(e.id), `${e.name} retired`).then(reload)
                }
              >
                Retire
              </button>
            </div>
          )}
        </div>
      ))}

      {me && me.role !== 'outsider' && (
        <>
          <h2>New exercise</h2>
          <div className="card">
            <label>slug</label>
            <input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
            <label>name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <label>modality</label>
            <select
              value={form.modality}
              onChange={(e) => setForm({ ...form, modality: e.target.value })}
            >
              {['strength', 'mobility', 'cardio', 'rehab'].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <label>measured in</label>
            <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
              {['reps', 'seconds', 'metres'].map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
            <div className="actions">
              <button
                className="primary"
                disabled={!form.slug || !form.name}
                onClick={() =>
                  run(() => api.authorExercise(form), `${form.name} is yours`).then(reload)
                }
              >
                Keep it mine
              </button>
              <button
                disabled={!form.slug || !form.name}
                onClick={() =>
                  run(() => api.publishExercise(form), `${form.name} published gym-wide`).then(
                    reload,
                  )
                }
              >
                Publish gym-wide
              </button>
            </div>
            <div className="sub" style={{ marginTop: 8 }}>
              Keeping it private makes it yours: nobody else in the gym sees it, and it stays in
              your library permanently.
            </div>
          </div>
        </>
      )}
    </>
  );
}

/**
 * Your own kit. There is no id for whose account — the operation always writes
 * the caller's — so this component never has to know who it is editing.
 */
function MyEquipment({ me, run }: ScreenProps) {
  const [rows, reload] = useList<Equipment>(() => api.equipment(), [me?.key]);
  const [open, setOpen] = useState(false);
  const chosen = rows.filter((r) => r.available).map((r) => r.slug);

  const toggle = async (slug: string) => {
    const next = chosen.includes(slug) ? chosen.filter((s) => s !== slug) : [...chosen, slug];
    await run(() => api.setMyEquipment(next));
    reload();
  };

  const byCategory = rows.reduce<Record<string, Equipment[]>>((acc, r) => {
    (acc[r.category] ??= []).push(r);
    return acc;
  }, {});

  return (
    <>
      <h2>My equipment</h2>
      <div className="card">
        <div className="sub">
          What you actually have access to. It never hides an exercise from you — it tells you
          what a given one would need.
        </div>
        <div className="sets" style={{ marginTop: 10 }}>
          {chosen.length === 0 ? (
            <span className="chip">nothing yet — bodyweight only</span>
          ) : (
            chosen.map((s) => (
              <span key={s} className="chip">
                {s.replace(/-/g, ' ')}
              </span>
            ))
          )}
        </div>
        <div className="actions">
          <button onClick={() => setOpen(!open)}>{open ? 'Done' : 'Edit'}</button>
        </div>
        {open &&
          Object.entries(byCategory).map(([category, items]) => (
            <div key={category} style={{ marginTop: 12 }}>
              <div className="sub">{category}</div>
              <div className="sets">
                {items.map((r) => (
                  <button
                    key={r.slug}
                    className={`pill toggle${r.available ? ' on' : ''}`}
                    onClick={() => toggle(r.slug)}
                  >
                    {r.available ? '✓ ' : ''}
                    {r.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
      </div>
    </>
  );
}

/**
 * SET UP MY TRAINING — the solo path.
 *
 * A trainee with no coach should not have to learn what a "programme" is, then
 * assign one to themselves, then find it, then book it, then start it. They know
 * two things: how often they train, and roughly what they do. This asks exactly
 * that and builds the rest.
 *
 * Rotation needs no new concept: two workouts on alternating days IS two sets of
 * slots. A on Monday and Friday, B on Wednesday.
 */
function RoutineSetup({ me, run, onOpen }: ScreenProps & { onOpen: (id: string) => void }) {
  const [templates] = useList<Template>(() => api.templates(), [me?.key]);
  const [trainee, setTrainee] = useState<TraineeMe | null>(null);
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(2);
  const [days, setDays] = useState<number[]>([1, 3, 5]);
  const [time, setTime] = useState('18:00');
  const [from, setFrom] = useState<string>('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .meTrainee()
      .then((t) => {
        setTrainee(t);
        // Their onboarding answer is the best guess at how many days to preselect.
        if (t?.days_per_week) {
          setDays([1, 2, 3, 4, 5, 6, 7].filter((_, i) => i < t.days_per_week!).map(spread(t.days_per_week!)));
        }
      })
      .catch(() => setTrainee(null));
  }, [me?.key]);

  if (!trainee) return null;

  const labels = ['A', 'B', 'C', 'D'];
  const create = async () => {
    setBusy(true);
    // Deal the chosen days round the workouts: A, B, A, B…
    const perWorkout: Record<number, { weekday: number; time: string }[]> = {};
    days.forEach((d, i) => {
      const w = i % count;
      (perWorkout[w] ??= []).push({ weekday: d, time });
    });
    let first = '';
    for (let w = 0; w < count; w++) {
      const slots = perWorkout[w] ?? [];
      if (slots.length === 0) continue;
      const ok = await run(async () => {
        const p = await api.createRoutine({
          title: count === 1 ? 'My training' : `Workout ${labels[w]}`,
          kind: 'strength',
          ...(from ? { templateId: from } : {}),
          slots,
        });
        if (!first) first = p.id;
      }, 'Built and booked — open each one to start it');
      if (!ok) break;
    }
    setBusy(false);
    setOpen(false);
    if (first) onOpen(first);
  };

  return (
    <div className="card">
      <div className="row">
        <span className="title">Set up my training</span>
        {trainee.days_per_week && (
          <span className="badge mono">{trainee.days_per_week}× a week</span>
        )}
      </div>
      <div className="sub">
        No coach needed. Pick how many workouts you rotate and which days you train — you
        get one booked workout per slot, ready to fill in and start.
      </div>
      <div className="actions">
        <button className="primary" onClick={() => setOpen(!open)}>
          {open ? 'Cancel' : 'Set it up'}
        </button>
      </div>

      {open && (
        <>
          <label>how many workouts do you rotate?</label>
          <div className="sets">
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                className={`pill toggle${n === count ? ' on' : ''}`}
                onClick={() => setCount(n)}
              >
                {n === 1 ? 'just one' : `${n} (${labels.slice(0, n).join(' / ')})`}
              </button>
            ))}
          </div>

          <label>which days?</label>
          <div className="sets">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <button
                key={d}
                className={`pill toggle${days.includes(d) ? ' on' : ''}`}
                onClick={() =>
                  setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort())
                }
              >
                {DAY_NAMES[d]}
              </button>
            ))}
          </div>

          <label>what time?</label>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />

          <label>start from a plan?</label>
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">empty — I&apos;ll add my own exercises</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.items.length} exercises{t.mine ? ', yours' : t.ownerName ? `, by ${t.ownerName}` : ''})
              </option>
            ))}
          </select>

          {days.length > 0 && (
            <div className="sub" style={{ marginTop: 10 }}>
              {days.map((d, i) => `${DAY_NAMES[d]} → ${count === 1 ? 'My training' : `Workout ${labels[i % count]}`}`).join(' · ')}
            </div>
          )}

          <div className="actions">
            <button className="primary wide" disabled={busy || days.length === 0} onClick={create}>
              Create {count === 1 ? 'it' : `${count} workouts`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Spread N training days evenly across the week rather than clumping Mon–Wed. */
function spread(daysPerWeek: number): (i: number) => number {
  const step = 7 / daysPerWeek;
  return (i: number) => Math.min(7, Math.round(i * step) + 1);
}

const GOAL_LABELS: Record<Goal, string> = {
  strength: 'Get stronger',
  muscle: 'Build muscle',
  endurance: 'Build endurance',
  rehab: 'Recover from an injury',
  general: 'Stay in shape',
};

/**
 * The two questions worth asking on day one. Both answers are the trainee's own
 * — the operation takes no id for whose — and they PREFILL a schedule rather
 * than enforcing one: a week you missed is a fact to show, not an error.
 */
function Onboarding({ me, run }: ScreenProps) {
  const [trainee, setTrainee] = useState<TraineeMe | null>(null);
  const [editing, setEditing] = useState(false);
  const [goal, setGoal] = useState<Goal>('general');
  const [days, setDays] = useState(3);

  const load = useCallback(() => {
    api
      .meTrainee()
      .then((t) => {
        setTrainee(t);
        if (t?.goal) setGoal(t.goal);
        if (t?.days_per_week) setDays(t.days_per_week);
      })
      .catch(() => setTrainee(null));
  }, [me?.key]);
  useEffect(load, [load]);

  if (!trainee) return null;
  const done = Boolean(trainee.onboarded_at);

  if (done && !editing) {
    return (
      <div className="card">
        <div className="row">
          <span className="title">{GOAL_LABELS[trainee.goal as Goal]}</span>
          <span className="badge earned mono">{trainee.days_per_week}× a week</span>
        </div>
        <div className="actions">
          <button className="ghost" onClick={() => setEditing(true)}>
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      {!done && (
        <>
          <div className="title">Let&apos;s set you up</div>
          <div className="sub">
            Two questions, then an optional baseline. They shape what gets suggested —
            nothing here locks you into anything.
          </div>
        </>
      )}
      <label>What are you training for?</label>
      {(Object.keys(GOAL_LABELS) as Goal[]).map((g) => (
        <button
          key={g}
          className={`card tappable${g === goal ? ' chosen' : ''}`}
          style={{ marginTop: 6 }}
          onClick={() => setGoal(g)}
        >
          <span className="title">{GOAL_LABELS[g]}</span>
        </button>
      ))}
      <label>How many days a week can you train?</label>
      <div className="sets">
        {[1, 2, 3, 4, 5, 6, 7].map((d) => (
          <button
            key={d}
            className={`pill toggle${d === days ? ' on' : ''}`}
            onClick={() => setDays(d)}
          >
            {d}
          </button>
        ))}
      </div>
      <div className="actions">
        <button
          className="primary wide"
          onClick={async () => {
            await run(() => api.onboard(goal, days), 'Saved');
            setEditing(false);
            load();
          }}
        >
          {done ? 'Save' : "That's me"}
        </button>
      </div>
    </div>
  );
}


const SHARING_LABELS: Record<SharingMode, { title: string; blurb: string }> = {
  none: {
    title: 'Nothing',
    blurb:
      'They cannot prescribe to you or see your training. Programmes they already wrote for you stay theirs — that record cannot be withdrawn.',
  },
  assigned: {
    title: 'Just what they prescribe',
    blurb: 'They can write you programmes and see how those go. Nothing else of yours.',
  },
  'from-now': {
    title: 'Everything from now on',
    blurb:
      'Plus every session you log from this moment — including on programmes you made yourself. Nothing before today.',
  },
  all: {
    title: 'Everything',
    blurb: 'Your whole history: every programme, session, set and exercise, past included.',
  },
};

/** Invitations, in whichever direction this persona is allowed to send them. */
function InvitePanel({ me, run }: ScreenProps) {
  const [rows, reload] = useList<Invitation>(() => api.invitations(), [me?.key]);
  const [identifier, setIdentifier] = useState('');
  const as: 'coach' | 'trainee' = me?.role === 'trainee' ? 'coach' : 'trainee';

  return (
    <>
      <h2>Invite {as === 'coach' ? 'a coach' : 'a trainee'}</h2>
      <div className="card">
        <label>email or phone</label>
        <input
          inputMode="email"
          autoCapitalize="off"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder="name@example.com"
        />
        <div className="actions">
          <button
            className="primary wide"
            disabled={identifier.length < 3}
            onClick={async () => {
              await run(
                () => api.invite(identifier, as),
                'Invitation recorded. You will not be told whether that address is already here — that is deliberate.',
              );
              setIdentifier('');
              reload();
            }}
          >
            Send invitation
          </button>
        </div>
        <div className="sub" style={{ marginTop: 8 }}>
          The address is hashed before it is stored and never shown again. An invitation confers
          nothing until it is accepted.
        </div>
      </div>
      {rows.length > 0 && <h2>Sent</h2>}
      {rows.map((i) => (
        <div key={i.id} className="card">
          <div className="row">
            <span className="title">{i.role_key}</span>
            <span className={`badge${i.state === 'accepted' ? ' earned' : ''}`}>{i.state}</span>
          </div>
          <div className="sub mono">
            sent {new Date(i.created_at).toLocaleDateString()} · expires{' '}
            {new Date(i.expires_at).toLocaleDateString()}
          </div>
          {i.state === 'invited' && (
            <div className="actions">
              <button
                className="ghost danger"
                onClick={() => run(() => api.revokeInvitation(i.id), 'Invitation withdrawn').then(reload)}
              >
                Withdraw
              </button>
            </div>
          )}
        </div>
      ))}
    </>
  );
}


// ---------------------------------------------------------------------------
// The conversation
// ---------------------------------------------------------------------------

/** The inbox — a walk, so it lists exactly the conversations you may be in. */
export function ChatScreen({
  me,
  onOpen,
}: ScreenProps & { onOpen: (traineeId: string, coachId: string) => void }) {
  const [threads] = useList<Thread>(() => api.threads(), [me?.key]);
  const solo = me?.role === 'trainee';

  return (
    <>
      <h1>Chat</h1>
      {threads.length === 0 && (
        <div className="empty">
          <Figure pose="rest" size={132} />
          <span className="head">No conversations.</span>
          {solo
            ? 'A conversation opens when you connect with a coach — and closes if you end it.'
            : 'A trainee has to connect with you before you can talk.'}
        </div>
      )}
      {threads.length > 0 && (
        <div className="list">
          {threads.map((t) => (
            <button
              key={`${t.traineeId}-${t.coachId}`}
              type="button"
              className="rowbtn"
              onClick={() => onOpen(t.traineeId, t.coachId)}
            >
              <span className="person">
                <span className="avatar">{initials(solo ? t.coachName : t.traineeName)}</span>
                <span>
                  <span className="name">{solo ? t.coachName : t.traineeName}</span>
                  <span className="sub">{t.lastMessage ?? 'No messages yet — say hello.'}</span>
                </span>
              </span>
              <span className="right">
                {t.unread > 0 ? (
                  <span className="badge earned mono">{t.unread} new</span>
                ) : (
                  t.lastAt && (
                    <span className="when">{new Date(t.lastAt).toLocaleDateString()}</span>
                  )
                )}
                <span className="chev">›</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** One thread. Reading it marks it read, which is what the operation does. */
export function ThreadScreen({
  traineeId,
  coachId,
  me,
  run,
  onBack,
}: ScreenProps & { traineeId: string; coachId: string; onBack: () => void }) {
  const [state, setState] = useState<{ messages: Message[]; me: string } | null>(null);
  const [body, setBody] = useState('');
  const [failed, setFailed] = useState(false);
  // A conversation belongs to the PERSON it is with, so the header says who —
  // not "Conversation". The names ride the same walk that lists the threads.
  const [threads] = useList<Thread>(() => api.threads(), [me?.key]);
  const thread = threads.find((t) => t.traineeId === traineeId && t.coachId === coachId);
  const solo = me?.role === 'trainee';
  const withName = (solo ? thread?.coachName : thread?.traineeName) ?? 'Conversation';

  const load = useCallback(() => {
    api
      .messages(traineeId, coachId)
      .then(setState)
      .catch(() => setFailed(true));
  }, [traineeId, coachId, me?.key]);
  useEffect(load, [load]);

  if (failed) {
    return (
      <>
        <button className="back" onClick={onBack}>
          ‹ Back
        </button>
        <div className="empty">
          <Figure pose="sit" size={132} />
          <span className="head">This conversation is not yours to read.</span>
          A thread lives and dies with the coaching relationship.
        </div>
      </>
    );
  }
  if (!state) return <div className="empty">
          <Figure pose="rest" size={132} />…</div>;

  return (
    <>
      <div className="person" style={{ marginBottom: 14 }}>
        <button className="back" onClick={onBack} aria-label="Back">
          ‹
        </button>
        <span className="avatar">{initials(withName)}</span>
        <span>
          <span className="name" style={{ fontSize: 16, fontWeight: 600 }}>
            {withName}
          </span>
          <span className="sub">{solo ? 'your coach' : 'your trainee'}</span>
        </span>
      </div>
      {state.messages.length === 0 && (
        <div className="empty">
          <Figure pose="rest" size={132} />
          <span className="head">Nothing yet.</span>
          Say hello — the thread is the relationship, not the training.
        </div>
      )}
      <div className="thread">
        {state.messages.map((m) => (
          <div key={m.id} className={`bubble ${m.author === state.me ? 'mine' : 'theirs'}`}>
            <div>{m.body}</div>
            <div className="stamp">{new Date(m.created_at).toLocaleString()}</div>
          </div>
        ))}
      </div>
      <div className="composer">
        <textarea
          rows={1}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={`Message ${withName.split(' ')[0]}…`}
        />
        <button
          className="send"
          aria-label="Send"
          disabled={!body.trim()}
          onClick={async () => {
            const ok = await run(() => api.postMessage(traineeId, coachId, body.trim()));
            if (ok) setBody('');
            load();
          }}
        >
          <SendIcon />
        </button>
      </div>
    </>
  );
}



/**
 * MY COACHES — the sharing decision and the conversation in one place, because
 * they are the same relationship. A coach you share with is a coach you can talk
 * to; end it and both go.
 */
function MyCoaches({
  me,
  run,
  onThread,
}: ScreenProps & { onThread: (traineeId: string, coachId: string) => void }) {
  const [rows, reload] = useList<Sharing>(() => api.mySharing(), [me?.key]);
  const [threads] = useList<Thread>(() => api.threads(), [me?.key]);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <>
      <h2>My coaches</h2>
      {rows.length === 0 && (
        <div className="card">
          <div className="sub">
            Nobody — and nobody has to be. Training alone is the default; a coach is
            something you add if you want one, and you decide what they see when they join.
          </div>
        </div>
      )}
      {rows.map((r) => {
        const thread = threads.find((t) => t.coachId === r.coach_id);
        return (
          <div key={r.coach_id} className="card">
            <div className="row center">
              <span className="person">
                <span className="avatar">{initials(r.coachName)}</span>
                <span className="name">{r.coachName}</span>
              </span>
              <span className="badge earned">{SHARING_LABELS[r.mode].title}</span>
            </div>
            <div className="sub" style={{ marginTop: 8 }}>{SHARING_LABELS[r.mode].blurb}</div>
            <div className="actions">
              {thread && (
                // The conversation rides the RELATIONSHIP, not the sharing mode:
                // a coach on `assigned` can still talk to you.
                <button
                  className="wide accent-text"
                  onClick={() => onThread(thread.traineeId, thread.coachId)}
                >
                  {thread.unread > 0 ? `Message · ${thread.unread} new` : 'Message'}
                </button>
              )}
              <button className="wide" onClick={() => setOpen(open === r.coach_id ? null : r.coach_id)}>
                {open === r.coach_id ? 'Done' : 'What they see'}
              </button>
            </div>
            {open === r.coach_id &&
              (['assigned', 'from-now', 'all', 'none'] as SharingMode[]).map((mode) => (
                <button
                  key={mode}
                  className={`card tappable${mode === r.mode ? ' chosen' : ''}`}
                  style={{ marginTop: 8 }}
                  onClick={async () => {
                    await run(
                      () => api.setSharing(r.coach_id, mode),
                      mode === 'none'
                        ? `${r.coachName} can no longer see your training`
                        : `${r.coachName}: ${SHARING_LABELS[mode].title.toLowerCase()}`,
                    );
                    setOpen(null);
                    reload();
                  }}
                >
                  <div className="row">
                    <span className="title">{SHARING_LABELS[mode].title}</span>
                    {mode === r.mode && <span className="badge earned">current</span>}
                  </div>
                  <div className="sub">{SHARING_LABELS[mode].blurb}</div>
                </button>
              ))}
          </div>
        );
      })}
    </>
  );
}

/**
 * MY LIBRARY — the personal half of what used to be the Exercises tab. Browsing
 * the gym's catalogue is something you do while building a workout; what is
 * YOURS is something you own, so it lives here.
 */
function MyLibrary({
  me,
  onBrowse,
}: ScreenProps & { onBrowse: () => void }) {
  const [mine] = useList<Exercise>(() => api.myExercises(), [me?.key]);
  const [show, setShow] = useState(false);
  // "Earned" is the walk reaching an exercise you PERFORMED — the link
  // `logSetOp` makes, which has no un-link. Worth counting on its own.
  const earnedCount = mine.filter((e) => e.access === 'granted').length;

  return (
    <>
      <h2>My library</h2>
      <div className="card">
        <div className="row center">
          <span className="title">Exercises I can use</span>
          <span className="sub mono" style={{ marginTop: 0 }}>
            {mine.length}
            {earnedCount > 0 && (
              <>
                {' · '}
                <span style={{ color: 'var(--good)' }}>{earnedCount} earned</span>
              </>
            )}
          </span>
        </div>
        <div className="sub">
          {mine.length === 0
            ? 'Nothing yet. Perform an exercise once and it is yours permanently.'
            : 'Earned by doing them, or made by you. Nobody can take one out of your library.'}
        </div>
        {show && (
          <div className="sets">
            {mine.map((e) => (
              <span key={e.id} className="chip">
                {e.name}
              </span>
            ))}
          </div>
        )}
        <div className="actions">
          {mine.length > 0 && (
            <button onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show them'}</button>
          )}
          <button onClick={onBrowse}>Browse the catalogue</button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Trainees — the staff roster, and the way into everything about one person.
// ---------------------------------------------------------------------------

export function TraineesScreen({
  me,
  run,
  onOpen,
  onThread,
  onProgress,
}: ScreenProps & {
  onOpen: (id: string) => void;
  onThread: (traineeId: string, coachId: string) => void;
  onProgress: (traineeId: string) => void;
}) {
  const [trainees] = useList<Trainee>(() => api.trainees(), [me?.key]);
  const [threads] = useList<Thread>(() => api.threads(), [me?.key]);
  const [programs] = useList<ProgramCard>(() => api.programs(), [me?.key]);

  return (
    <>
      <h1>Trainees</h1>
      <InvitePanel me={me} run={run} />

      {trainees.length === 0 && (
        <div className="empty">
          <Figure pose="rest" size={132} />
          <span className="head">Nobody yet.</span>
          Invite a trainee above — they decide what they share when they join.
        </div>
      )}
      {trainees.map((t) => {
        const thread = threads.find((x) => x.traineeId === t.id);
        const theirs = programs.filter((p) => p.traineeName === t.name);
        return (
          <div key={t.id} className="card">
            <div className="row center">
              <span className="person">
                <span className="avatar me">{initials(t.name)}</span>
                <span className="name">{t.name}</span>
              </span>
              <span className="sub mono" style={{ marginTop: 0 }}>
                {t.days_per_week ? `${t.days_per_week}× a week` : `#${t.number}`}
              </span>
            </div>
            <div className="sub" style={{ marginTop: 6 }}>
              {t.goal ? `Goal: ${t.goal}` : 'No goal set'}
            </div>
            {/* Their programmes are a nested, bordered list INSIDE the person's
                card — the rows belong to them, not to the screen. */}
            {theirs.length > 0 && (
              <div className="list nested">
                {theirs.map((p) => (
                  <button key={p.id} type="button" className="rowbtn" onClick={() => onOpen(p.id)}>
                    <span className="name">{p.title}</span>
                    <span className={`badge ${p.status}`}>{p.status.replace('_', ' ')}</span>
                  </button>
                ))}
              </div>
            )}
            {theirs.length === 0 && <div className="sub">No programmes you can see</div>}
            <div className="actions">
              {/* The curve and the body. What it shows is whatever this person
                  shared — the screen says so rather than showing an empty chart
                  as though nothing had happened. */}
              <button className="accent-text" onClick={() => onProgress(t.id)}>
                Progress
              </button>
              {thread && (
                <button
                  className="accent-text"
                  onClick={() => onThread(thread.traineeId, thread.coachId)}
                >
                  {thread.unread > 0 ? `Message · ${thread.unread} new` : 'Message'}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export function PeopleScreen({
  me,
  run,
  onOpen,
  onThread,
  onBrowse,
  onProgress,
}: ScreenProps & {
  onOpen: (id: string) => void;
  onThread: (traineeId: string, coachId: string) => void;
  onBrowse: () => void;
  onProgress: () => void;
}) {
  const [trainees] = useList<Trainee>(() => api.trainees(), [me?.key]);
  const [coaches] = useList<Coach>(() => api.coaches(), [me?.key]);

  if (!isStaff(me)) {
    return (
      <>
        <h1>Me</h1>
        {/* `stride/trainees` is a walk, so for a trainee it returns exactly one
            row: themselves. Render THAT rather than a second card from the dev
            cast — two cards with the same name was a bug, and the walk's own
            answer is the honest source. */}
        {/* The profile card. An avatar and a line saying where you are — a
            person, not a record id, even though the id is right there. */}
        {/* Somebody waves from the top edge of the profile card — beside the
            heading, so it costs the column no height of its own. */}
        {trainees.map((t, idx) => (
          <div key={t.id} className={`card${idx === 0 ? ' has-topfig' : ''}`} style={idx === 0 ? { marginTop: 40 } : undefined}>
            {idx === 0 && (
              <Figure
              pose="wave"
              size={100}
              className="topfig"
              style={{ '--s': '100px' } as React.CSSProperties}
            />
            )}
            <div className="person">
              <span className="avatar lg me">{initials(t.name)}</span>
              <span>
                <span className="name">{t.name}</span>
                <span className="sub">
                  trainee · <span className="mono">#{t.number}</span>
                  {t.contact ? ` · ${t.contact}` : ''}
                </span>
              </span>
            </div>
            <div className="sub" style={{ marginTop: 10 }}>
              You can make your own exercises and your own programs. Everything you can reach
              beyond the shared catalogue is narrowed to your own record — including the programs
              you make.
            </div>
          </div>
        ))}
        {trainees.length === 0 && (
          <div className="card">
            <div className="person">
              <span className="avatar lg">{initials(me?.name ?? '?')}</span>
              <span className="name">{me?.name}</span>
            </div>
            <div className="sub" style={{ marginTop: 10 }}>
              You have no trainee record in this gym, so there is nothing here that is yours.
            </div>
          </div>
        )}

        <h2>My training</h2>
        <Onboarding me={me} run={run} />
        <BaselineStep me={me} run={run} onOpen={onOpen} />
        <ProgressCard me={me} onProgress={onProgress} />
        <RoutineSetup me={me} run={run} onOpen={onOpen} />
        <MyCoaches me={me} run={run} onThread={onThread} />
        <MyLibrary me={me} run={run} onBrowse={onBrowse} />
        <MyEquipment me={me} run={run} />
        <InvitePanel me={me} run={run} />
        <SignOut />
      </>
    );
  }

  return (
    <>
      <h1>Me</h1>
      <div className="card has-topfig" style={{ marginTop: 40 }}>
        <Figure
          pose="wave"
          size={100}
          className="topfig"
          style={{ '--s': '100px' } as React.CSSProperties}
        />
        <div className="person">
          <span className="avatar lg me">{initials(me?.name ?? '?')}</span>
          <span>
            <span className="name">{me?.name}</span>
            <span className="sub">{me?.role}</span>
          </span>
        </div>
      </div>

      <StarterLibrary me={me} run={run} />
      <ProgressCard me={me} onProgress={onProgress} />
      <MyLibrary me={me} run={run} onBrowse={onBrowse} />
      <MyEquipment me={me} run={run} />

      <h2>Coaches</h2>
      <div className="list">
        {coaches.map((c) => (
          <div key={c.id} className="rowbtn" style={{ cursor: 'default' }}>
            <span className="person">
              <span className="avatar">{initials(c.name)}</span>
              <span className="name">{c.name}</span>
            </span>
          </div>
        ))}
      </div>

      <SignOut />
    </>
  );
}

/**
 * THE GYM'S DEFAULT LIBRARY, offered once.
 *
 * A gym the platform provisions starts genuinely empty — no equipment
 * vocabulary, no exercises, no templates. The local harness never showed that,
 * because the seed publishes the catalogue on its way in, so the first deployed
 * instance came up with an exercise picker with nothing in it and a "start from
 * a template?" list with nothing to start from.
 *
 * Deliberately a BUTTON and not something provisioning does. Installing it
 * writes ~90 rows and every one of them is attributed to whoever pressed this —
 * which is the honest answer, and one that provisioning, having no principal,
 * cannot give. The operation is idempotent, so pressing it twice is safe, and a
 * gym that has built its own library never sees the card at all.
 */
function StarterLibrary({ me, run }: ScreenProps) {
  const [exercises, reloadExercises] = useList<Exercise>(() => api.exercises(), [me?.key]);
  const [templates, reloadTemplates] = useList<Template>(() => api.templates(), [me?.key]);
  const [busy, setBusy] = useState(false);

  // Only an admin holds `library:publish`; only an empty shelf needs stocking.
  if (me?.role !== 'admin') return null;
  if (exercises.length > 0 && templates.length > 0) return null;

  const install = async () => {
    setBusy(true);
    await run(
      () => api.installStarterLibrary(),
      'Library installed — the catalogue and five plans are live',
    );
    setBusy(false);
    reloadExercises();
    reloadTemplates();
  };

  return (
    <div className="card accent">
      <div className="row">
        <span className="title">Stock the library</span>
      </div>
      <div className="sub">
        This gym has {exercises.length === 0 ? 'no exercises' : `${exercises.length} exercises`} and{' '}
        {templates.length === 0 ? 'no templates' : `${templates.length} templates`} yet. Install the
        default library and you get an equipment vocabulary, a catalogue of common exercises, and
        five plans — two lifting blocks, a baseline that measures each arm and leg on its own, a
        shoulder-rehab week and a running base week.
      </div>
      <div className="sub">
        They are published as this gym&apos;s own, shared with everyone in it. Edit or retire any of
        them afterwards; nothing here is locked.
      </div>
      <div className="actions">
        <button className="tinted" disabled={busy} onClick={install}>
          {busy ? 'Installing…' : 'Install the default library'}
        </button>
      </div>
    </div>
  );
}

/**
 * The way out. It lives on Me because that is where the design puts everything
 * about you, and nowhere else: the canvas has no identity bar on any screen, so
 * there is no other honest home for it.
 *
 * A plain `<a>` to the logout route rather than a button — signing out is a
 * navigation the server performs, and the session cookie is cleared by the same
 * provider that set it.
 */
function SignOut() {
  return (
    <a className="signout" href="/api/auth/logout">
      Sign out
    </a>
  );
}



/**
 * The session clock on the logging screen — the same fact the bar carries, at
 * the size it deserves on the screen you are actually working on. Counting UP;
 * the design's interval mode is the same component counting down, and is not
 * built because the domain has no notion of rounds yet.
 */
function SessionClock({
  session,
  onEnd,
}: {
  session: NonNullable<ReturnType<typeof useActiveSession>>;
  onEnd: () => void;
}) {
  const ms = useElapsed(session);
  // How far through: exercises with a set logged, of exercises prescribed. The
  // same counts the bar reports, so the two can never disagree.
  const known = session.total !== undefined && session.done !== undefined && session.total > 0;
  const pct = known ? Math.min(100, Math.round((session.done! / session.total!) * 100)) : 0;
  return (
    <>
    {known && (
      <div className="track" aria-hidden="true">
        <span className="track-label">
          {session.done} of {session.total}
        </span>
        <div className="track-bar">
          <i style={{ width: `${pct}%` }} data-empty={pct === 0} />
        </div>
        {/* `left` runs from 0 to (100% − the figure), so the runner starts on
            the track and finishes on it rather than half off either end. */}
        <Figure pose={pct >= 100 ? 'cheer' : 'run'} size={56} style={{ left: `calc(${pct}% - ${(pct / 100) * 56}px)` }} />
      </div>
    )}
    <div className="session-head">
      <span className={`session-dot${session.pausedAt ? ' held' : ''}`} />
      <span>
        <span className="session-clock mono">{formatClock(ms)}</span>
        <span className="session-sub">session · {session.pausedAt ? 'paused' : 'counting up'}</span>
      </span>
      <span className="actions">
        <button onClick={() => (session.pausedAt ? resumeSession() : pauseSession())}>
          {session.pausedAt ? 'Resume' : 'Pause session'}
        </button>
        <button onClick={onEnd}>End session</button>
      </span>
    </div>
    </>
  );
}

/**
 * THE OPTIONAL THIRD STEP of onboarding: measure where you start.
 *
 * Shown once the two questions are answered and until a baseline exists — or
 * until it is skipped, which is remembered on this device only (a dismissal is
 * a per-viewer convenience, not a fact about the person). The Progress screen
 * offers the same button for ever, so skipping costs nothing.
 *
 * Taking it creates an assessment from the gym's baseline plan and opens it
 * PLANNED, like every other workout: you start it when you are warmed up.
 */
function BaselineStep({ me, run, onOpen }: ScreenProps & { onOpen: (id: string) => void }) {
  const [trainee, setTrainee] = useState<TraineeMe | null>(null);
  const [programs] = useList<ProgramCard>(() => api.programs(), [me?.key]);
  const [templates] = useList<Template>(() => api.templates(), [me?.key]);
  const [skipped, setSkipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = `stride:baseline-skipped:${me?.traineeId ?? ''}`;

  useEffect(() => {
    api.meTrainee().then(setTrainee).catch(() => setTrainee(null));
    try {
      setSkipped(window.localStorage.getItem(key) === '1');
    } catch {
      setSkipped(false);
    }
  }, [me?.key, key]);

  const baseline = templates.find((t) => t.name.startsWith('Baseline'));
  const taken = programs.some((p) => p.kind === 'assessment');
  if (!trainee?.onboarded_at || taken || skipped || !baseline) return null;

  const skip = () => {
    try {
      window.localStorage.setItem(key, '1');
    } catch {
      /* a private window forgets; the card simply comes back next time */
    }
    setSkipped(true);
  };

  const take = async () => {
    setBusy(true);
    let id = '';
    const ok = await run(async () => {
      const res = await api.assignProgram({
        title: 'Baseline #1',
        kind: 'assessment',
        templateId: baseline.id,
      });
      id = res.program.id;
    }, 'Baseline created — start it when you are warmed up');
    setBusy(false);
    if (ok && id) onOpen(id);
  };

  return (
    <div className="card hero has-topfig">
      <Figure
        pose="rope"
        size={96}
        className="topfig"
        style={{ '--s': '96px' } as React.CSSProperties}
      />
      <div className="row center">
        <span className="title">Measure where you start</span>
        <span className="badge mono">optional</span>
      </div>
      <div className="sub">
        One session, about forty minutes: {baseline.items.length} light sets covering the
        whole body, each arm and each leg logged on its own, and a timed kilometre. You write
        down how many you managed and at what weight — that is the first point on every curve,
        and the left/right gap as a number.
      </div>
      <div className="actions">
        <button className="primary" disabled={busy} onClick={take}>
          Take the baseline
        </button>
        <button className="ghost" onClick={skip}>
          Skip for now
        </button>
      </div>
      <div className="sub">You can take it any time from Progress. Retake it monthly.</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PROGRESS — the evolution: every exercise as a curve, left against right, and
// the body over time. Nothing here is stored; it is all read off the
// append-only log, so it cannot disagree with what was done.
// ---------------------------------------------------------------------------

/** The door to the curve, on Me. Only for someone with a trainee record. */
function ProgressCard({ me, onProgress }: { me: CastMember | null; onProgress: () => void }) {
  if (!me?.traineeId) return null;
  return (
    <button type="button" className="card tappable" onClick={onProgress}>
      <div className="row">
        <span className="title">Progress &amp; measurements</span>
        <span className="chev">›</span>
      </div>
      <div className="sub">
        Where you started, where you are. Each exercise as a curve, the left arm against the
        right, and your weight and range of motion over time.
      </div>
    </button>
  );
}

/** An inline sparkline. Baseline points (an assessment) get a ring. */
function Spark({
  values,
  marks,
  lowerIsBetter,
}: {
  values: number[];
  marks?: boolean[];
  lowerIsBetter?: boolean;
}) {
  if (values.length < 2) return null;
  const w = 160;
  const h = 36;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = 4 + (i * (w - 8)) / (values.length - 1);
    const y = 4 + ((max - v) / span) * (h - 8);
    return [x, y] as const;
  });
  const last = values[values.length - 1]!;
  const first = values[0]!;
  const better = lowerIsBetter ? last < first : last > first;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline
        points={pts.map(([x, y]) => `${x},${y}`).join(' ')}
        fill="none"
        stroke={better ? 'var(--good)' : 'var(--muted)'}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {pts.map(([x, y], i) =>
        marks?.[i] ? (
          <circle key={i} cx={x} cy={y} r="4" fill="var(--accent)" stroke="var(--ink)" strokeWidth="2" />
        ) : null,
      )}
    </svg>
  );
}

/** Which number a curve is drawn on, per exercise. Pace for a run, volume for a
 *  loaded lift, the longest hold for a timed one, the most reps otherwise. */
function metricOf(e: ExerciseProgress): {
  label: string;
  lowerIsBetter: boolean;
  value: (p: ProgressPoint) => number | null;
  format: (p: ProgressPoint) => string;
} {
  const loaded = e.series.some((s) => s.points.some((p) => p.bestLoad));
  if (e.unit === 'metres' && e.series.some((s) => s.points.some((p) => p.paceSecondsPerKm)))
    return {
      label: 'pace',
      lowerIsBetter: true,
      value: (p) => p.paceSecondsPerKm,
      format: (p) =>
        `${formatAmount(p.totalQuantity, 'metres')}${p.paceSecondsPerKm ? ` · ${formatPace(p.paceSecondsPerKm)}` : ''}${
          p.avgHr ? ` · ${p.avgHr} bpm` : ''
        }`,
    };
  if (loaded)
    return {
      label: 'best set',
      lowerIsBetter: false,
      value: (p) => (Number.parseFloat(p.volume) || 0),
      format: (p) => `${p.bestReps} × ${p.bestLoad ?? '—'}${p.sets > 1 ? ` · ${p.sets} sets` : ''}`,
    };
  return {
    label: e.unit === 'seconds' ? 'longest hold' : 'most reps',
    lowerIsBetter: false,
    value: (p) => p.bestReps,
    format: (p) => `${formatAmount(p.bestReps, e.unit)}${p.sets > 1 ? ` · ${p.sets} sets` : ''}`,
  };
}

const SIDE_NAME: Record<string, string> = { left: 'Left', right: 'Right' };

function ExerciseCurve({ e, onOpen }: { e: ExerciseProgress; onOpen: (id: string) => void }) {
  const metric = metricOf(e);
  return (
    <div className="card">
      <div className="row center">
        <span className="title">{e.name}</span>
        <span className="sub mono" style={{ marginTop: 0 }}>
          {metric.label}
        </span>
      </div>
      {e.series.map((series) => {
        const values = series.points.map((p) => metric.value(p) ?? 0);
        const first = series.points[0]!;
        const latest = series.points[series.points.length - 1]!;
        return (
          <div key={series.side ?? 'both'} className="curve-row">
            <div className="curve-head">
              {series.side && <span className={`side-label ${series.side}`}>{SIDE_NAME[series.side]}</span>}
              <span className="mono">{metric.format(latest)}</span>
              {series.points.length > 1 && (
                <span className="sub" style={{ marginTop: 0 }}>
                  {' '}
                  was {metric.format(first)} · {new Date(first.performedAt).toLocaleDateString()}
                </span>
              )}
            </div>
            <Spark
              values={values}
              marks={series.points.map((p) => p.programKind === 'assessment')}
              lowerIsBetter={metric.lowerIsBetter}
            />
            {series.points.length === 1 && (
              <div className="sub">
                One point so far
                {first.programKind === 'assessment' ? ' — the baseline' : ''}. The curve starts
                with the second.
              </div>
            )}
          </div>
        );
      })}
      <div className="actions">
        <button
          className="ghost small"
          onClick={() => onOpen(e.series[0]!.points[e.series[0]!.points.length - 1]!.programId)}
        >
          Open the last workout it was in
        </button>
      </div>
    </div>
  );
}

/**
 * LEFT AGAINST RIGHT. The server gives the latest pair as an exact number; the
 * first pair is recomputed here from the same points, display only, so the card
 * can say "was 50%, now 67%" — the sentence the baseline exists to produce.
 */
/** The poses that read as one-sided when mirrored; anything else falls back. */
const SIDED_POSE: Partial<Record<Pose, Pose>> = { lunge: 'lunge', squat: 'lunge', row: 'row', run: 'lunge' };

function SymmetryCard({ e }: { e: ExerciseProgress }) {
  const sym = e.symmetry!;
  const left = e.series.find((s) => s.side === 'left')?.points ?? [];
  const right = e.series.find((s) => s.side === 'right')?.points ?? [];
  const rightBySession = new Map(right.map((p) => [p.sessionId, p]));
  const firstPair = left.find((p) => rightBySession.has(p.sessionId));
  const score = (p: ProgressPoint) =>
    sym.measure === 'volume' ? Number.parseFloat(p.volume) || 0 : p.totalQuantity;
  let firstPct: number | null = null;
  if (firstPair && firstPair.performedAt !== sym.performedAt) {
    const l = score(firstPair);
    const r = score(rightBySession.get(firstPair.sessionId)!);
    firstPct = l === r ? 100 : Math.round((Math.min(l, r) / Math.max(l, r)) * 100);
  }
  const pct = Math.round(Number(sym.weakerPct));
  const lv = Number.parseFloat(sym.left) || 0;
  const rv = Number.parseFloat(sym.right) || 0;
  const top = Math.max(lv, rv) || 1;
  return (
    <div className={`card${sym.weaker ? ' accent' : ''}`}>
      <div className="row center">
        <span className="title">{e.name}</span>
        <span className="sub mono" style={{ marginTop: 0 }}>
          {new Date(sym.performedAt).toLocaleDateString()}
        </span>
      </div>
      {/* Left and right, facing each other. Only a pose that is itself lopsided
          can say "one side": a mirrored barbell press is the same picture twice.
          So legs get the lunge and everything else gets the one-armed curl. */}
      <div className="sym-pair" aria-hidden="true">
        <Figure pose={SIDED_POSE[poseFor(e.name)] ?? 'curl'} size={84} />
        <Figure pose={SIDED_POSE[poseFor(e.name)] ?? 'curl'} size={84} flip />
      </div>
      <div className="bars">
        <span className="side-label left">L</span>
        <span className={`bar${sym.weaker === 'left' ? ' weak' : ''}`}>
          <i style={{ width: `${(lv / top) * 100}%` }} />
        </span>
        <span className="mono">{sym.left}</span>
        <span className="side-label right">R</span>
        <span className={`bar${sym.weaker === 'right' ? ' weak' : ''}`}>
          <i style={{ width: `${(rv / top) * 100}%` }} />
        </span>
        <span className="mono">{sym.right}</span>
      </div>
      <div className="sub">
        {sym.weaker ? (
          <>
            <b>
              {SIDE_NAME[sym.weaker]} is at {pct}% of {sym.weaker === 'left' ? 'right' : 'left'}
            </b>
            {firstPct !== null && (
              <>
                {' '}
                — was {firstPct}% at the first pair.{' '}
                {pct > firstPct ? 'Closing.' : pct < firstPct ? 'Wider than it was.' : 'Unchanged.'}
              </>
            )}
          </>
        ) : (
          <b>Even.</b>
        )}{' '}
        {sym.measure === 'volume' ? 'By reps × load.' : 'By count.'}
        {sym.weaker &&
          ` Next time, give the ${sym.weaker} its own load and cap the other side to its reps — Edit on the row does that.`}
      </div>
    </div>
  );
}

/** Body measurements: latest per kind and side, with the change since the first. */
function BodyCard({
  traineeId,
  rows,
  readable,
  run,
  onLogged,
}: {
  traineeId: string;
  rows: Measurement[];
  /** False when the kernel refused the read — say so rather than show nothing. */
  readable: boolean;
  run: Run;
  onLogged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<MeasurementKind>('weight');
  const [side, setSide] = useState<Side>('left');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const sided = MEASUREMENT_KINDS[kind].sided;

  const groups = new Map<string, Measurement[]>();
  for (const m of rows) {
    const key = `${m.kind}|${m.side ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }

  const save = async () => {
    setBusy(true);
    const ok = await run(
      () =>
        api.logMeasurement(traineeId, {
          kind,
          value: value.trim(),
          ...(sided ? { side } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      'Measurement logged',
    );
    setBusy(false);
    if (ok) {
      setValue('');
      setNote('');
      setOpen(false);
      onLogged();
    }
  };

  return (
    <>
      <h2>Body</h2>
      {!readable && (
        <div className="empty">
          <Figure pose="sit" size={132} />
          <span className="head">Not shared with you.</span>
          Body measurements are visible to a coach only when the person shares all of their
          training. You can still record one for them.
        </div>
      )}
      {readable && groups.size === 0 && (
        <div className="empty">
          <Figure pose="rest" size={132} />
          <span className="head">Nothing measured yet.</span>
          Weight, a waist, how far each shoulder goes. The first one is the baseline.
        </div>
      )}
      {[...groups.entries()].map(([key, list]) => {
        const latest = list[list.length - 1]!;
        const first = list[0]!;
        const meta = MEASUREMENT_KINDS[latest.kind];
        const delta = (Number.parseFloat(latest.value) || 0) - (Number.parseFloat(first.value) || 0);
        // Up is good for range and strength, neutral for a weight.
        const good = latest.kind === 'weight' || latest.kind === 'waist' || latest.kind === 'hips' || latest.kind === 'body-fat' || latest.kind === 'resting-hr' ? null : delta > 0;
        return (
          <div key={key} className="card">
            <div className="row center">
              <span className="title">
                {latest.side && <span className={`side-label ${latest.side}`}>{SIDE_NAME[latest.side]}</span>}
                {meta?.label ?? latest.kind}
              </span>
              <span className="mono">
                {latest.value} {latest.unit}
              </span>
            </div>
            <div className="sub" style={{ marginTop: 4 }}>
              {list.length > 1 ? (
                <>
                  <span className={`delta${good === null ? '' : good ? ' up' : ' down'}`}>
                    {delta > 0 ? '+' : ''}
                    {Number(delta.toFixed(2))} {latest.unit}
                  </span>{' '}
                  since {new Date(first.measured_at).toLocaleDateString()} ({first.value} {first.unit})
                </>
              ) : (
                `Measured ${new Date(latest.measured_at).toLocaleDateString()}`
              )}
              {latest.note ? ` · ${latest.note}` : ''}
            </div>
            <Spark values={list.map((m) => Number.parseFloat(m.value) || 0)} lowerIsBetter={good === null ? true : false} />
          </div>
        );
      })}
      {!open ? (
        <div className="actions" style={{ marginBottom: 14 }}>
          <button className="tinted" onClick={() => setOpen(true)}>
            + Log a measurement
          </button>
        </div>
      ) : (
        <div className="card">
          <label>what</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as MeasurementKind)}>
            {(Object.keys(MEASUREMENT_KINDS) as MeasurementKind[]).map((k) => (
              <option key={k} value={k}>
                {MEASUREMENT_KINDS[k].label} ({MEASUREMENT_KINDS[k].unit})
              </option>
            ))}
          </select>
          {sided && (
            <div className="side-toggle" role="radiogroup" aria-label="which side">
              {(['left', 'right'] as const).map((x) => (
                <button
                  key={x}
                  type="button"
                  role="radio"
                  aria-checked={side === x}
                  className={`pill toggle ${x}${side === x ? ' on' : ''}`}
                  onClick={() => setSide(x)}
                >
                  {x}
                </button>
              ))}
            </div>
          )}
          <label>value — {MEASUREMENT_KINDS[kind].unit}</label>
          <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="72.4" />
          <label>note (optional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="morning, before breakfast" />
          <div className="actions">
            <button className="primary" disabled={busy || !/^\d+(\.\d+)?$/.test(value.trim())} onClick={save}>
              Save
            </button>
            <button className="ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
          <div className="sub">
            A decimal like 72.4 — use a dot. A correction is a new row; nothing here is ever edited.
          </div>
        </div>
      )}
    </>
  );
}

export function ProgressScreen({
  traineeId,
  me,
  run,
  onBack,
  onOpen,
}: ScreenProps & { traineeId: string | null; onBack: () => void; onOpen: (id: string) => void }) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[] | null>(null);
  const [templates] = useList<Template>(() => api.templates(), [me?.key]);
  const [trainees] = useList<Trainee>(() => api.trainees(), [me?.key]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    if (!traineeId) return;
    api.progress(traineeId).then(setProgress).catch(() => setProgress(null));
    // A 403 here is a decision, not a failure: keep null and say "not shared".
    api.measurements(traineeId).then(setMeasurements).catch(() => setMeasurements(null));
  }, [traineeId]);
  useEffect(reload, [reload]);

  if (!traineeId) {
    return (
      <>
        <button className="back" onClick={onBack}>
          ‹ Back
        </button>
        <h1>Progress</h1>
        <div className="empty">
          <Figure pose="rest" size={132} />
          <span className="head">No trainee record yet.</span>
          Make yourself a workout on the Workouts screen and your curve starts there.
        </div>
      </>
    );
  }

  const mine = traineeId === me?.traineeId;
  const who = trainees.find((t) => t.id === traineeId);
  const baseline = templates.find((t) => t.name.startsWith('Baseline'));
  const baselines = new Set(
    (progress?.exercises ?? []).flatMap((e) =>
      e.series.flatMap((s) => s.points.filter((p) => p.programKind === 'assessment').map((p) => p.programId)),
    ),
  );
  const asymmetric = (progress?.exercises ?? []).filter((e) => e.symmetry);
  const curves = (progress?.exercises ?? []).filter((e) => e.series.some((s) => s.points.length > 0));

  /** Create a fresh baseline from the template and open it — planned, not started. */
  const retake = async () => {
    if (!baseline) return;
    setBusy(true);
    let id = '';
    const ok = await run(async () => {
      const res = await api.assignProgram({
        ...(mine ? {} : { traineeId }),
        title: `Baseline #${baselines.size + 1}`,
        kind: 'assessment',
        templateId: baseline.id,
      });
      id = res.program.id;
    }, 'Baseline created — start it when you are warmed up');
    setBusy(false);
    if (ok && id) onOpen(id);
  };

  return (
    <>
      <button className="back" onClick={onBack}>
        ‹ {mine ? 'Me' : 'Trainees'}
      </button>
      <h1>{mine ? 'My progress' : who ? `${who.name}` : 'Progress'}</h1>
      <div className="sub" style={{ marginTop: -6, marginBottom: 16, paddingLeft: 2 }}>
        {progress
          ? `${progress.sessionsSeen} session${progress.sessionsSeen === 1 ? '' : 's'} ${mine ? 'logged' : 'shared with you'}`
          : 'Loading…'}
      </div>

      {/* THE BASELINE. Raised and accented: it is the one action on the screen. */}
      <div className="card raised accent">
        <div className="row center">
          <span className="title big">Baseline</span>
          <span className="badge mono">{baselines.size} taken</span>
        </div>
        <div className="sub">
          {baselines.size === 0
            ? 'One session of light, measured sets — each arm and each leg on its own, plus a timed kilometre. It is the first point on every curve here.'
            : 'Retake it every few weeks. Same loads, same order: the difference is the progress, and the left/right pair on each row is the gap.'}
        </div>
        <div className="actions">
          <button className="primary wide" disabled={busy || !baseline} onClick={retake}>
            {baselines.size === 0 ? 'Take the baseline' : 'Retake the baseline'}
          </button>
        </div>
        {!baseline && (
          <div className="sub">No baseline template in this gym yet — an admin can install the default library from Me.</div>
        )}
      </div>

      {asymmetric.length > 0 && <h2>Left against right</h2>}
      {asymmetric.map((e) => (
        <SymmetryCard key={e.exerciseId} e={e} />
      ))}

      <h2>Exercises</h2>
      {curves.length === 0 && (
        <div className="empty">
          <Figure pose="rest" size={132} />
          <span className="head">{mine ? 'Nothing logged yet.' : 'Nothing shared yet.'}</span>
          {mine
            ? 'Every set you log becomes a point. Take the baseline and there is a first one on nine curves at once.'
            : 'This person has not shared any sessions with you yet.'}
        </div>
      )}
      {curves.map((e) => (
        <ExerciseCurve key={e.exerciseId} e={e} onOpen={onOpen} />
      ))}

      <BodyCard
        traineeId={traineeId}
        rows={measurements ?? []}
        readable={measurements !== null}
        run={run}
        onLogged={reload}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// PLANS — the reusable prescription, tied to nobody.
//
// A workout is one person's run of a plan. The plan itself has no state, no
// sessions and no subject: you may make one alone, with no coach, and put it in
// front of everyone in the gym — or take it back. What the kernel decides: you
// edit and share only your own (the narrowed `template:read` through the
// `template → you` edge); everyone reads what is shared (the node-level
// `template:read-shared`); an admin reaches all of it.
// ---------------------------------------------------------------------------

function NewPlan({ run, onCreated }: { run: Run; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <div className="actions" style={{ marginBottom: 14 }}>
        <button className="primary wide" onClick={() => setOpen(true)}>
          + New plan
        </button>
      </div>
    );
  }
  return (
    <div className="card">
      <label>name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Garage strength" />
      <label>what it is for (optional)</label>
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Three days a week, kettlebell only"
      />
      <div className="actions">
        <button
          className="primary"
          disabled={busy || !name.trim()}
          onClick={async () => {
            setBusy(true);
            const ok = await run(
              () =>
                api.authorTemplate({
                  name: name.trim(),
                  ...(description.trim() ? { description: description.trim() } : {}),
                }),
              'Plan created — add exercises to it',
            );
            setBusy(false);
            if (ok) {
              setName('');
              setDescription('');
              setOpen(false);
              onCreated();
            }
          }}
        >
          Create
        </button>
        <button className="ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <div className="sub">Only you can see it until you choose to share it.</div>
    </div>
  );
}

/** Add one exercise to a plan — the plan-side twin of AddProgramItem. */
function AddPlanItem({ templateId, run, onAdded }: { templateId: string; run: Run; onAdded: () => void }) {
  const [exercises] = useList<Exercise>(() => api.exercises(), []);
  const [f, setF] = useState({
    exerciseId: '',
    sets: '3',
    reps: '10',
    load: '',
    days: [] as number[],
    perWeek: '',
  });
  const [busy, setBusy] = useState(false);
  const chosen = exercises.find((e) => e.id === f.exerciseId);
  return (
    <div className="item-editor">
      <label>exercise</label>
      <select value={f.exerciseId} onChange={(e) => setF({ ...f, exerciseId: e.target.value })}>
        <option value="">choose…</option>
        {exercises.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
            {e.laterality === 'unilateral' ? ' (each side)' : ''}
          </option>
        ))}
      </select>
      <div className="setgrid">
        <div>
          <label>sets{chosen?.laterality === 'unilateral' ? ' / side' : ''}</label>
          <input inputMode="numeric" value={f.sets} onChange={(e) => setF({ ...f, sets: e.target.value })} />
        </div>
        <div>
          <label>{UNIT_LABEL[chosen?.unit ?? 'reps'] ?? 'reps'}</label>
          <input inputMode="numeric" value={f.reps} onChange={(e) => setF({ ...f, reps: e.target.value })} />
        </div>
        <div>
          <label>load</label>
          <input inputMode="decimal" value={f.load} onChange={(e) => setF({ ...f, load: e.target.value })} />
        </div>
      </div>
      <label>repeat on</label>
      <div className="sets">
        {[1, 2, 3, 4, 5, 6, 7].map((d) => (
          <button
            key={d}
            className={`pill toggle${f.days.includes(d) ? ' on' : ''}`}
            onClick={() =>
              setF({
                ...f,
                perWeek: '',
                days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d].sort(),
              })
            }
          >
            {DAY_NAMES[d]}
          </button>
        ))}
      </div>
      <label>…or a count per week</label>
      <input
        inputMode="numeric"
        value={f.perWeek}
        placeholder="e.g. 5"
        onChange={(e) => setF({ ...f, days: [], perWeek: e.target.value })}
      />
      <div className="actions">
        <button
          className="primary"
          disabled={busy || !f.exerciseId}
          onClick={async () => {
            setBusy(true);
            const ok = await run(
              () =>
                api.addTemplateItem(templateId, {
                  exerciseId: f.exerciseId,
                  targetSets: Number(f.sets) || 1,
                  targetReps: Number(f.reps) || 1,
                  ...(f.load.trim() ? { targetLoad: f.load.trim() } : {}),
                  ...(f.days.length ? { recurDays: f.days.join(',') } : {}),
                  ...(f.perWeek.trim() ? { recurPerWeek: Number(f.perWeek) } : {}),
                }),
              'Added to the plan',
            );
            setBusy(false);
            if (ok) {
              setF({ ...f, exerciseId: '' });
              onAdded();
            }
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  me,
  run,
  exercisesById,
  onChanged,
  onStart,
}: {
  plan: Template;
  me: CastMember | null;
  run: Run;
  exercisesById: Map<string, Exercise>;
  onChanged: () => void;
  onStart: (plan: Template) => void;
}) {
  const [editing, setEditing] = useState(false);
  // Edit is offered to the author and to an admin. Anyone else who somehow
  // pressed it would meet the kernel's refusal in the banner, which is fine.
  const canEdit = plan.mine || me?.role === 'admin';
  const shared = plan.visibility === 'shared';
  const library = shared && !plan.ownerName;
  return (
    <div className="card">
      <div className="row center">
        <span className="title">{plan.name}</span>
        <span className={`badge ${shared ? 'shared' : 'private'}`}>
          {library ? 'gym library' : shared ? 'shared' : 'private'}
        </span>
      </div>
      <div className="sub" style={{ marginTop: 4 }}>
        {plan.items.length} exercise{plan.items.length === 1 ? '' : 's'}
        {plan.mine ? ' · made by you' : plan.ownerName ? ` · by ${plan.ownerName}` : ' · gym library'}
        {plan.description ? ` · ${plan.description}` : ''}
      </div>
      {plan.items.length > 0 && (
        <div className="list nested">
          {plan.items.map((i) => {
            const ex = exercisesById.get(i.exercise_id);
            return (
              <div key={i.id} className="rowbtn" style={{ cursor: 'default' }}>
                <span>
                  <span className="name">{ex?.name ?? 'Exercise'}</span>
                  <span className="sub mono">
                    {i.target_sets} × {formatQuantity(i.target_reps, ex?.unit ?? 'reps')}
                    {i.target_load ? ` @ ${i.target_load}` : ''}
                    {ex?.laterality === 'unilateral' ? ' each side' : ''}
                    {recurrenceLabel(i.recur_days, i.recur_per_week)
                      ? ` · ${recurrenceLabel(i.recur_days, i.recur_per_week)}`
                      : ''}
                  </span>
                </span>
                {editing && (
                  <button
                    className="ghost small"
                    aria-label={`remove ${ex?.name ?? 'exercise'}`}
                    onClick={() =>
                      run(() => api.removeTemplateItem(i.id), 'Taken out of the plan').then(onChanged)
                    }
                  >
                    −
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {editing && <AddPlanItem templateId={plan.id} run={run} onAdded={onChanged} />}
      <div className="actions">
        {plan.items.length > 0 && (
          <button className="primary" onClick={() => onStart(plan)}>
            Start a workout from it
          </button>
        )}
        {canEdit && (
          <button className="ghost" onClick={() => setEditing(!editing)}>
            {editing ? 'Done' : 'Edit'}
          </button>
        )}
        {canEdit && !library && (
          <button
            className="ghost"
            onClick={() =>
              run(
                () => api.shareTemplate(plan.id, shared ? 'nobody' : 'gym'),
                shared
                  ? 'Taken back — workouts already made from it are unaffected'
                  : 'Shared with everyone in this gym',
              ).then(onChanged)
            }
          >
            {shared ? 'Withdraw' : 'Share with the gym'}
          </button>
        )}
      </div>
    </div>
  );
}

export function PlansScreen({
  me,
  run,
  onBack,
  onOpen,
}: ScreenProps & { onBack: () => void; onOpen: (id: string) => void }) {
  const [plans, reload] = useList<Template>(() => api.templates(), [me?.key]);
  const [exercises] = useList<Exercise>(() => api.exercises(), [me?.key]);
  const exercisesById = new Map(exercises.map((e) => [e.id, e] as const));
  const mine = plans.filter((p) => p.mine);
  const others = plans.filter((p) => !p.mine);
  const canTrainMyself = Boolean(me?.traineeId) || me?.role === 'admin';

  /** One tap: a workout of your own from this plan — planned, and opened. */
  const start = async (plan: Template) => {
    let id = '';
    const ok = await run(async () => {
      if (!me?.traineeId) await api.trainMyself(me?.name);
      const p = await api.createRoutine({
        title: plan.name,
        kind: plan.name.startsWith('Baseline') ? 'assessment' : 'strength',
        templateId: plan.id,
        slots: [],
      });
      id = p.id;
    }, 'Workout created — check it over, then start it');
    if (ok && id) onOpen(id);
  };

  return (
    <>
      <button className="back" onClick={onBack}>
        ‹ {me?.role === 'trainee' ? 'Workouts' : 'Programmes'}
      </button>
      <h1>Plans</h1>
      <div className="sub" style={{ marginTop: -6, marginBottom: 16, paddingLeft: 2 }}>
        Reusable workout plans. Follow one from the gym, or build your own and share it.
      </div>
      <NewPlan run={run} onCreated={reload} />

      <h2>My plans</h2>
      {mine.length === 0 && (
        <div className="empty">
          <Figure pose="rest" size={132} />
          <span className="head">None yet.</span>
          Make one above, add exercises, and it is yours to run and — if you like — to share.
        </div>
      )}
      {mine.map((p) => (
        <PlanCard
          key={p.id}
          plan={p}
          me={me}
          run={run}
          exercisesById={exercisesById}
          onChanged={reload}
          onStart={start}
        />
      ))}

      <h2>In this gym</h2>
      {others.length === 0 && <div className="empty">
          <Figure pose="rest" size={132} />Nothing shared here yet.</div>}
      {others.map((p) => (
        <PlanCard
          key={p.id}
          plan={p}
          me={me}
          run={run}
          exercisesById={exercisesById}
          onChanged={reload}
          onStart={start}
        />
      ))}
      {!canTrainMyself && (
        <div className="sub">
          Starting a workout needs a trainee record; a coach gets one by invitation like anyone else.
        </div>
      )}
    </>
  );
}
