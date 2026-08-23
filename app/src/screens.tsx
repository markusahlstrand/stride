import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type CastMember,
  type Coach,
  type Equipment,
  type AgendaEntry,
  type Exercise,
  type Goal,
  type Invitation,
  type Message,
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
import { CheckIcon, SendIcon } from './icons';

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
function initials(name: string): string {
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
    if (ok) onOpen(entry.programId);
  };

  const row = (i: ScheduledItem) => (
    <button
      key={i.itemId}
      type="button"
      className="card tappable"
      onClick={() => onOpen(i.programId)}
    >
      <div className="row">
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
      </div>
      <div className="sub">
        {recurrenceLabel(i.recurDays, i.recurPerWeek)} · {i.programTitle}
      </div>
    </button>
  );

  return (
    <>
      <h1>Today</h1>
      <div className="sub" style={{ margin: '-8px 0 14px', paddingLeft: 4 }}>
        {new Date().toLocaleDateString(undefined, {
          weekday: 'long',
          day: 'numeric',
          month: 'short',
        })}
      </div>

      {/* WHAT'S NEXT is raised and accent-bordered; everything below it is
          reference. At most one card on the screen gets that treatment. */}
      {booked.map((a) => (
        <div key={`${a.programId}-${a.time}`} className="card raised accent">
          <div className="row center">
            <span className="title big">{a.programTitle}</span>
            <span className="badge time">{a.time}</span>
          </div>
          <div className="sub mono">
            {a.traineeName ? `${a.traineeName} · ` : ''}
            {a.exercises} exercises
            {a.setsToday > 0 ? ` · ${a.setsToday} logged today` : ''}
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
}: ScreenProps & { onOpen: (id: string) => void }) {
  const [programs, reload] = useList<ProgramCard>(() => api.programs(), [me?.key]);
  const solo = me?.role === 'trainee';

  return (
    <>
      <h1>{solo ? 'My workouts' : 'Programmes'}</h1>

      {/* The obvious place to add one is the list of them. It used to live only
          on the Me screen, which meant the answer to "how do I add a workout?"
          was somewhere you had no reason to look. */}
      <NewWorkout me={me} run={run} onOpen={onOpen} onCreated={reload} />

      {programs.length === 0 && (
        <div className="empty">
          {me?.role === 'trainee' ? (
            <>
              <span className="head">No workouts yet.</span>
              Add one above, or Me → <b>Set up my training</b> to build a week of them at once.
            </>
          ) : (
            <>
              <span className="head">Nothing here for {me?.name ?? 'you'}.</span>
              Not an error — the permission walk simply reaches nothing.
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
 * whole week. Adapts to who is asking rather than existing twice:
 *
 *   a trainee  makes their own and starts it, because they came here to train;
 *   staff      pick whose it is and leave it `planned`, because a coach writes a
 *              programme before the person does it.
 *
 * `traineeId` is simply omitted for a trainee — the operation resolves it from
 * the caller, and the narrowed check means it can only ever be themselves.
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
  const [f, setF] = useState({ title: '', kind: 'strength', templateId: '', traineeId: '' });
  const [days, setDays] = useState<number[]>([]);
  const [time, setTime] = useState('18:00');

  const solo = me?.role === 'trainee';
  if (!me || me.role === 'outsider') return null;

  const create = async () => {
    setBusy(true);
    let id = '';
    const slots = days.map((d) => ({ weekday: d, time }));
    const ok = await run(async () => {
      if (solo) {
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
    }, solo ? 'Ready to train' : 'Programme created');
    setBusy(false);
    if (!ok) return;
    setOpen(false);
    setF({ title: '', kind: 'strength', templateId: '', traineeId: '' });
    setDays([]);
    onCreated();
    if (id) onOpen(id);
  };

  if (!open) {
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
      {!solo && (
        <>
          <label>for whom</label>
          <select value={f.traineeId} onChange={(e) => setF({ ...f, traineeId: e.target.value })}>
            <option value="">choose…</option>
            {trainees.map((t) => (
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
        placeholder={solo ? 'Workout A' : 'Block 1'}
      />

      <label>kind</label>
      <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
        {['strength', 'rehab', 'conditioning'].map((k) => (
          <option key={k}>{k}</option>
        ))}
      </select>

      <label>start from a template?</label>
      <select value={f.templateId} onChange={(e) => setF({ ...f, templateId: e.target.value })}>
        <option value="">empty — add exercises after</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} ({t.items.length} exercises)
          </option>
        ))}
      </select>

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
          disabled={busy || !f.title || (!solo && !f.traineeId)}
          onClick={create}
        >
          {solo ? 'Create and start' : 'Create'}
        </button>
        <button className="ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {solo && (
        <div className="sub" style={{ marginTop: 8 }}>
          Yours alone unless you share it. Booking is optional — an unbooked workout is
          still there whenever you want it.
        </div>
      )}
    </div>
  );
}

export function ProgramDetailScreen({
  programId,
  me,
  run,
  onBack,
}: ScreenProps & { programId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<ProgramDetail | null>(null);
  const [earned, setEarned] = useState<string | null>(null);

  const reload = useCallback(() => {
    api
      .program(programId)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [programId]);
  useEffect(reload, [reload]);

  if (!detail) return <div className="empty">Not visible to {me?.name ?? 'you'}.</div>;

  const { program, items, sessions, summary, slots } = detail;
  const openSession = program.status === 'in_progress' ? sessions[sessions.length - 1] : undefined;

  const setsFor = (itemId: string) => openSession?.sets.filter((s) => s.program_item_id === itemId) ?? [];

  /** One prescription row. `tag` is the superset position (A1, A2) or null. */
  const itemCard = (
    item: ProgramDetail['items'][number],
    tag: string | null,
  ) => {
    const done = setsFor(item.id);
    const unit = item.exercise?.unit ?? 'reps';
    const suffix = unit === 'metres' ? ' m' : '';
    // A uniform prescription and an explicit ramp are the same list once you
    // expand the first — so the pills below never have to know which it was.
    const prescribed =
      item.sets.length > 0
        ? item.sets.map((s) => ({
            no: s.set_no,
            reps: s.target_reps,
            load: s.target_load,
            note: s.note,
          }))
        : Array.from({ length: item.target_sets }, (_, i) => ({
            no: i + 1,
            reps: item.target_reps,
            load: item.target_load,
            note: null as string | null,
          }));
    const total = Math.max(prescribed.length, done.length);
    // One row of pills, not two: a performed set REPLACES its target in place,
    // filled and ticked, so "where am I" is one glance rather than a comparison.
    const showPills = Boolean(openSession) || item.sets.length > 0;

    return (
      <div key={item.id} className={`card${openSession ? ' raised' : ''}`}>
        <div className="row">
          <span className="title">
            {tag && <span className="tag" style={{ marginRight: 8 }}>{tag}</span>}
            {item.exercise?.name ?? 'Unknown exercise'}
          </span>
          <Counter done={done.length} total={item.target_sets} />
        </div>
        {showPills ? (
          <div className="sets">
            {Array.from({ length: total }, (_, i) => {
              const no = i + 1;
              const performed = done.find((s) => s.set_no === no);
              if (performed) {
                return (
                  <span key={performed.id} className="pill done">
                    {no}: {formatQuantity(performed.reps, unit)}
                    {suffix}
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
                  {no}: {formatQuantity(target.reps, unit)}
                  {suffix}
                  {target.load ? ` × ${target.load}` : ''}
                  {target.note ? ` · ${target.note}` : ''}
                </span>
              );
            })}
          </div>
        ) : (
          <div className="sub mono">
            target {item.target_sets} × {formatQuantity(item.target_reps, unit)}{' '}
            {unit === 'reps' ? 'reps' : unit === 'metres' ? 'm' : ''}
            {item.target_load ? ` @ ${item.target_load}` : ''}
          </div>
        )}
        {recurrenceLabel(item.recur_days, item.recur_per_week) && (
          <div className="sub">{recurrenceLabel(item.recur_days, item.recur_per_week)}</div>
        )}
        {openSession && (
          <SetLogger
            unit={item.exercise?.unit ?? 'reps'}
            modality={item.exercise?.modality ?? 'strength'}
            defaultReps={item.sets[done.length]?.target_reps ?? item.target_reps}
            defaultLoad={item.sets[done.length]?.target_load ?? item.target_load}
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
              reload();
            }}
          />
        )}
      </div>
    );
  };

  return (
    <>
      <button className="back" onClick={onBack}>
        ‹ Workouts
      </button>
      {/* Title and state on one line, the identifiers beneath it in mono — the
          header answers "which one, and where is it" before anything else. */}
      <div className="row center" style={{ marginTop: 2 }}>
        <h1 style={{ margin: 0 }}>{program.title}</h1>
        <span className={`badge ${program.status}`}>{program.status.replace('_', ' ')}</span>
      </div>
      <div className="sub mono" style={{ margin: '2px 0 14px' }}>
        #{program.number} · {program.kind}
        {program.traineeName ? ` · ${program.traineeName}` : ''}
      </div>
      <div className="card">
        {program.status === 'in_progress' && (
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
            <button
              className="primary"
              onClick={() => run(() => api.startProgram(program.id), 'Started').then(reload)}
            >
              Start it
            </button>
          )}
          {program.status === 'in_progress' && !openSession && (
            <button
              className="primary"
              onClick={() =>
                run(() => api.logSession(program.id, {}), 'Session opened').then(reload)
              }
            >
              Start a session
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
              Finish this block
            </button>
          )}
        </div>
      </div>

      {summary && <AdherenceCard summary={summary} />}

      {(program.status === 'planned' || program.status === 'in_progress') && (
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
          <span className="disc">
            <CheckIcon />
          </span>
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
            <circle cx="62" cy="62" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="8" />
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
  defaultReps,
  defaultLoad,
  onLog,
}: {
  unit: string;
  modality: string;
  defaultReps: number;
  defaultLoad: string | null;
  onLog: (body: {
    reps: number;
    load?: string;
    rpe?: string;
    durationSeconds?: number;
    avgHr?: number;
  }) => Promise<void>;
}) {
  const isTime = unit === 'seconds';
  const isCardio = modality === 'cardio';
  const [amount, setAmount] = useState(isTime ? formatQuantity(defaultReps, unit) : String(defaultReps));
  const [load, setLoad] = useState(defaultLoad ?? '');
  const [rpe, setRpe] = useState('');
  const [mins, setMins] = useState('');
  const [hr, setHr] = useState('');
  const [busy, setBusy] = useState(false);

  /** '2:30' → 150, '45' → 45. Time is the one field people write two ways. */
  const parseAmount = (raw: string): number => {
    if (!isTime || !raw.includes(':')) return Number(raw);
    const [m, sec] = raw.split(':');
    return Number(m) * 60 + Number(sec || 0);
  };
  const quantity = parseAmount(amount);

  return (
    <div style={{ marginTop: 12 }}>
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
            <label>minutes</label>
            <input inputMode="decimal" value={mins} onChange={(e) => setMins(e.target.value)} />
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
              ...(isCardio && mins ? { durationSeconds: Math.round(Number(mins) * 60) } : {}),
              ...(isCardio && hr ? { avgHr: Number(hr) } : {}),
            });
            setBusy(false);
          }}
        >
          Log {isCardio ? 'it' : 'set'}
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

      <div className="sets" style={{ margin: '10px 0' }}>
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
          <span className="head">Nothing matches those filters.</span>
          Every filter here narrows what the kernel already returned — none of them is an access
          decision.
        </div>
      )}
      {rows.map((e) => (
        <div key={e.id} className="card">
          <div className="row">
            <span className="title">{e.name}</span>
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
      }, 'Ready to train');
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
        get one booked workout per slot, ready to log.
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

          <label>start from a template?</label>
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">empty — I&apos;ll add my own exercises</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.items.length} exercises)
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
            Two questions. They shape what gets suggested — nothing here locks you into
            anything.
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
          <span className="head">This conversation is not yours to read.</span>
          A thread lives and dies with the coaching relationship.
        </div>
      </>
    );
  }
  if (!state) return <div className="empty">…</div>;

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
}: ScreenProps & {
  onOpen: (id: string) => void;
  onThread: (traineeId: string, coachId: string) => void;
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
            {thread && (
              <div className="actions">
                <button
                  className="wide accent-text"
                  onClick={() => onThread(thread.traineeId, thread.coachId)}
                >
                  {thread.unread > 0 ? `Message · ${thread.unread} new` : 'Message'}
                </button>
              </div>
            )}
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
}: ScreenProps & {
  onOpen: (id: string) => void;
  onThread: (traineeId: string, coachId: string) => void;
  onBrowse: () => void;
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
        {trainees.map((t) => (
          <div key={t.id} className="card">
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
        <RoutineSetup me={me} run={run} onOpen={onOpen} />
        <MyCoaches me={me} run={run} onThread={onThread} />
        <MyLibrary me={me} run={run} onBrowse={onBrowse} />
        <MyEquipment me={me} run={run} />
        <InvitePanel me={me} run={run} />
      </>
    );
  }

  return (
    <>
      <h1>Me</h1>
      <div className="card">
        <div className="person">
          <span className="avatar lg me">{initials(me?.name ?? '?')}</span>
          <span>
            <span className="name">{me?.name}</span>
            <span className="sub">{me?.role}</span>
          </span>
        </div>
      </div>

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
    </>
  );
}
