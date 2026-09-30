import { useEffect, useState, useCallback } from 'react';
import { api, type CastMember, type Exercise, type ProgramDetail, type Template, type Trainee } from './api';
import type { SequencePlan, PhaseDay, PhaseWorkout, PhaseGoal } from '../../src/phased-plan.js';
import type { PhasedProgramView } from '../../src/phased.js';
import { examplePlan } from './phased-examples';
import { SetLogger, loadNoteOf } from './screens';

type Run = (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;
const clone = <T,>(x: T): T => structuredClone(x);
const dateToday = () => new Date().toLocaleDateString('en-CA');
const newWorkout = (exerciseId = ''): PhaseWorkout => ({ name: 'Workout', items: [{ exerciseId, sets: [{ mode: 'fixed', reps: 5, restSeconds: 60 }] }] });
const newDay = (exerciseId = ''): PhaseDay => ({ name: 'Training day', rest: false, workouts: [newWorkout(exerciseId)] });
const blankPlan = (): SequencePlan => ({ name: '', description: '', tracks: [{ key: 'standard', name: 'Standard', min: 0, max: 1000000, startPhase: 0 }], phases: [{ name: 'Phase 1', notes: '', progression: 'scheduled', days: { standard: [newDay()] } }] });
function ExerciseSelect({ value, onChange, exercises, label = 'Exercise' }: { value: string; onChange: (id: string) => void; exercises: Exercise[]; label?: string }) {
  return <label>{label}<select value={value} onChange={(e) => onChange(e.target.value)}><option value="">Choose an exercise</option>{exercises.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.unit})</option>)}</select></label>;
}
function GoalEditor({ value, onChange, exercises, label }: { value?: PhaseGoal; onChange: (g?: PhaseGoal) => void; exercises: Exercise[]; label: string }) {
  return <fieldset><legend>{label}</legend><label className="row"><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked ? { exerciseId: '', mode: 'single-set', target: 100 } : undefined)} />Include a measurable target</label>
    {value && <div className="phase-grid"><ExerciseSelect value={value.exerciseId} exercises={exercises} onChange={(exerciseId) => onChange({ ...value, exerciseId, side: exercises.find((e) => e.id === exerciseId)?.laterality === 'unilateral' ? 'left' : undefined })} />
      <label>Measure<select value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value as PhaseGoal['mode'] })}><option value="single-set">One continuous set</option><option value="daily-total">Total in one day</option><option value="total">Total across programme</option></select></label>
      <label>Target quantity<input type="number" min="1" value={value.target} onChange={(e) => onChange({ ...value, target: Number(e.target.value) })} /></label>
      {exercises.find((e) => e.id === value.exerciseId)?.laterality === 'unilateral' && <label>Side<select value={value.side ?? 'left'} onChange={(e) => onChange({ ...value, side: e.target.value as 'left' | 'right' })}><option>left</option><option>right</option></select></label>}
    </div>}</fieldset>;
}
export function WorkoutEditor({ workout, onChange, exercises }: { workout: PhaseWorkout; onChange: (w: PhaseWorkout) => void; exercises: Exercise[] }) {
  const change = (fn: (w: PhaseWorkout) => void) => { const w = clone(workout); fn(w); onChange(w); };
  return <div className="phase-workout"><label>Workout name<input value={workout.name} onChange={(e) => change((w) => { w.name = e.target.value; })} /></label>
    {workout.items.map((item, i) => { const ex = exercises.find((e) => e.id === item.exerciseId); return <fieldset key={i}><legend>Exercise {i + 1}</legend>
      <ExerciseSelect value={item.exerciseId} exercises={exercises} onChange={(id) => change((w) => { w.items[i].exerciseId = id; w.items[i].sets.forEach((s) => { s.side = exercises.find((e) => e.id === id)?.laterality === 'unilateral' ? 'left' : undefined; }); })} />
      <div className="phase-grid"><label>Superset group (optional)<input value={item.groupKey ?? ''} onChange={(e) => change((w) => { w.items[i].groupKey = e.target.value || undefined; })} /></label>
        <label>Instructions<input value={item.notes ?? ''} onChange={(e) => change((w) => { w.items[i].notes = e.target.value; })} /></label></div>
      {item.sets.map((set, j) => <div className="phase-set" key={j}><strong>Set {j + 1}</strong><div className="phase-grid">
        <label>Target type<select value={set.mode} onChange={(e) => change((w) => { w.items[i].sets[j].mode = e.target.value as 'fixed' | 'amrap'; })}><option value="fixed">Fixed quantity</option><option value="amrap">As many as possible</option></select></label>
        <label>{set.mode === 'amrap' ? 'Minimum (0 = none)' : 'Quantity'} · {ex?.unit ?? 'reps'}<input type="number" min={set.mode === 'amrap' ? 0 : 1} value={set.reps} onChange={(e) => change((w) => { w.items[i].sets[j].reps = Number(e.target.value); })} /></label>
        <label>Load (kg, optional)<input inputMode="decimal" value={set.load ?? ''} onChange={(e) => change((w) => { w.items[i].sets[j].load = e.target.value || undefined; })} /></label>
        <label>Rest after set (seconds)<input type="number" min="0" max="3600" value={set.restSeconds} onChange={(e) => change((w) => { w.items[i].sets[j].restSeconds = Number(e.target.value); })} /></label>
        {ex?.laterality === 'unilateral' && <label>Side<select value={set.side ?? 'left'} onChange={(e) => change((w) => { w.items[i].sets[j].side = e.target.value as 'left' | 'right'; })}><option>left</option><option>right</option></select></label>}
        <label>Set note<input value={set.note ?? ''} onChange={(e) => change((w) => { w.items[i].sets[j].note = e.target.value; })} /></label>
      </div><button type="button" className="ghost small" disabled={item.sets.length === 1} onClick={() => change((w) => { w.items[i].sets.splice(j, 1); })}>Remove set {j + 1}</button></div>)}
      <div className="actions"><button type="button" className="ghost" disabled={item.sets.length >= 40} onClick={() => change((w) => { w.items[i].sets.push(clone(item.sets.at(-1)!)); })}>Add set</button>
        <button type="button" className="ghost" disabled={workout.items.length === 1} onClick={() => change((w) => { w.items.splice(i, 1); })}>Remove exercise</button></div>
    </fieldset>; })}
    <button type="button" className="ghost" onClick={() => change((w) => { w.items.push(newWorkout().items[0]); })}>Add exercise</button>
  </div>;
}
function PlanPreview({ plan, exercises }: { plan: SequencePlan; exercises: Exercise[] }) {
  const [track, setTrack] = useState(plan.tracks[0]?.key ?? '');
  const key = plan.tracks.some((t) => t.key === track) ? track : plan.tracks[0]?.key;
  return <div className="phase-preview"><label>Preview ability track<select value={key} onChange={(e) => setTrack(e.target.value)}>{plan.tracks.map((t) => <option value={t.key} key={t.key}>{t.name}</option>)}</select></label>
    {plan.phases.map((phase, ph) => <details key={ph} open={ph === 0}><summary>{ph + 1}. {phase.name} · {phase.progression === 'milestone' ? 'confirm milestone to advance' : 'scheduled'}</summary>
      <p>{phase.notes}</p>{(phase.days[key] ?? []).map((day, d) => <div key={d} className="phase-preview-day"><strong>{day.name} {day.rest ? '· Rest' : ''}</strong>
        {day.workouts.map((w, wi) => <div key={wi}><b>{w.name}</b>{w.items.map((item, i) => <p key={i}>{exercises.find((e) => e.id === item.exerciseId)?.name ?? 'Choose exercise'}{item.groupKey ? ` · Superset ${item.groupKey}` : ''}<br />
          {item.sets.map((s, j) => <span key={j}>{j > 0 ? ' / ' : ''}{s.side ? `${s.side} ` : ''}{s.mode === 'amrap' ? `AMRAP${s.reps ? ` ≥ ${s.reps}` : ''}` : s.reps}{s.load ? ` @ ${s.load} kg` : ''} · rest {s.restSeconds}s</span>)}</p>)}</div>)}
      </div>)}</details>)}
  </div>;
}
export function SequenceEditor({ initial, templateId, revision, exercises, run, onSaved, onCancel }: { initial?: SequencePlan; templateId?: string; revision?: number; exercises: Exercise[]; run: Run; onSaved: () => void; onCancel: () => void }) {
  const [plan, setPlan] = useState<SequencePlan>(() => clone(initial ?? blankPlan()));
  const [phaseIndex, setPhaseIndex] = useState(0); const [trackKey, setTrackKey] = useState(plan.tracks[0].key); const [dayIndex, setDayIndex] = useState(0);
  const [preview, setPreview] = useState(false); const [busy, setBusy] = useState(false);
  const change = (fn: (p: SequencePlan) => void) => setPlan((prev) => { const p = clone(prev); fn(p); return p; });
  const phase = plan.phases[phaseIndex]; const day = phase?.days[trackKey]?.[dayIndex];
  return <form className="card phase-editor" onSubmit={async (e) => { e.preventDefault(); setBusy(true); const ok = await run(() => api.savePhasedPlan({ templateId, revision, plan }), 'Phased plan saved'); setBusy(false); if (ok) onSaved(); }}>
    <h2>{templateId ? 'Edit phased plan' : 'Create a phased plan'}</h2><p className="sub">Build the whole journey: phases, training days, rest days and a goal. Saved plans can be reused and shared.</p>
    <label>Plan name<input required value={plan.name} onChange={(e) => change((p) => { p.name = e.target.value; })} /></label>
    <label>Description<textarea value={plan.description} onChange={(e) => change((p) => { p.description = e.target.value; })} /></label>
    <details><summary>Source attribution</summary><label>Source title<input value={plan.source?.title ?? ''} onChange={(e) => change((p) => { p.source = { title: e.target.value, url: p.source?.url ?? '' }; })} /></label><label>Source URL<input type="url" value={plan.source?.url ?? ''} onChange={(e) => change((p) => { p.source = e.target.value ? { title: p.source?.title ?? '', url: e.target.value } : undefined; })} /></label></details>
    <GoalEditor label="Programme goal" value={plan.goal} exercises={exercises} onChange={(goal) => change((p) => { p.goal = goal; })} />
    <details><summary>Ability tracks and entry assessment ({plan.tracks.length})</summary>
      <ExerciseSelect label="Assessment exercise" value={plan.assessmentExerciseId ?? ''} exercises={exercises.filter((e) => e.laterality === 'bilateral')} onChange={(id) => change((p) => { p.assessmentExerciseId = id || undefined; })} />
      {plan.tracks.map((t, i) => <fieldset key={t.key}><legend>Track {i + 1}</legend><div className="phase-grid">
        <label>Track name<input value={t.name} onChange={(e) => change((p) => { p.tracks[i].name = e.target.value; })} /></label>
        <label>Assessment minimum<input type="number" min="0" value={t.min} onChange={(e) => change((p) => { p.tracks[i].min = +e.target.value; })} /></label>
        <label>Assessment maximum<input type="number" min="0" value={t.max} onChange={(e) => change((p) => { p.tracks[i].max = +e.target.value; })} /></label>
        <label>Start at phase<select value={t.startPhase} onChange={(e) => change((p) => { p.tracks[i].startPhase = +e.target.value; })}>{plan.phases.map((ph, n) => <option key={n} value={n}>{ph.name}</option>)}</select></label>
      </div><button type="button" className="ghost small" disabled={plan.tracks.length === 1} onClick={() => { change((p) => { p.tracks.splice(i, 1); p.phases.forEach((ph) => { delete ph.days[t.key]; }); }); setTrackKey(plan.tracks.find((x) => x.key !== t.key)!.key); }}>Remove track</button></fieldset>)}
      <button type="button" className="ghost" disabled={plan.tracks.length >= 6} onClick={() => change((p) => { const key = crypto.randomUUID(); const max = Math.max(...p.tracks.map((t) => t.max)); p.tracks.push({ key, name: 'New level', min: max + 1, max: max + 100, startPhase: 0 }); p.phases.forEach((ph) => { ph.days[key] = clone(ph.days[p.tracks[0].key]); }); })}>Add ability track</button>
    </details>
    <div className="phase-grid"><label>Phase<select value={phaseIndex} onChange={(e) => { setPhaseIndex(+e.target.value); setDayIndex(0); }}>{plan.phases.map((p, i) => <option key={i} value={i}>{i + 1}. {p.name}</option>)}</select></label>
      <label>Edit track<select value={trackKey} onChange={(e) => setTrackKey(e.target.value)}>{plan.tracks.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}</select></label></div>
    {phase && <fieldset><legend>Phase {phaseIndex + 1}</legend><label>Phase name<input required value={phase.name} onChange={(e) => change((p) => { p.phases[phaseIndex].name = e.target.value; })} /></label>
      <label>Phase notes<textarea value={phase.notes} onChange={(e) => change((p) => { p.phases[phaseIndex].notes = e.target.value; })} /></label>
      <label>Progression<select value={phase.progression} onChange={(e) => change((p) => { p.phases[phaseIndex].progression = e.target.value as 'scheduled' | 'milestone'; })}><option value="scheduled">Follow scheduled dates</option><option value="milestone">Meet a target and confirm</option></select></label>
      {phase.progression === 'milestone' && <GoalEditor label="Phase milestone" value={phase.milestone} exercises={exercises} onChange={(g) => change((p) => { p.phases[phaseIndex].milestone = g; })} />}
      <div className="actions"><button type="button" className="ghost" onClick={() => { change((p) => { p.phases.splice(phaseIndex + 1, 0, { ...clone(phase), name: `${phase.name} (copy)` }); p.tracks.forEach((t) => { if (t.startPhase > phaseIndex) t.startPhase++; }); }); setPhaseIndex(phaseIndex + 1); setDayIndex(0); }}>Copy phase / week</button>
        <button type="button" className="ghost" disabled={phaseIndex === 0} onClick={() => { change((p) => { [p.phases[phaseIndex - 1], p.phases[phaseIndex]] = [p.phases[phaseIndex], p.phases[phaseIndex - 1]]; p.tracks.forEach((t) => { if (t.startPhase === phaseIndex) t.startPhase--; else if (t.startPhase === phaseIndex - 1) t.startPhase++; }); }); setPhaseIndex(phaseIndex - 1); setDayIndex(0); }}>Move phase earlier</button>
        <button type="button" className="ghost" disabled={plan.phases.length === 1} onClick={() => { change((p) => { p.phases.splice(phaseIndex, 1); p.tracks.forEach((t) => { t.startPhase = Math.max(0, t.startPhase >= phaseIndex ? t.startPhase - 1 : t.startPhase); }); }); setPhaseIndex(0); setDayIndex(0); }}>Remove phase</button></div>
      <label>Day<select value={dayIndex} onChange={(e) => setDayIndex(+e.target.value)}>{phase.days[trackKey].map((d, i) => <option key={i} value={i}>{i + 1}. {d.name}{d.rest ? ' · Rest' : ''}</option>)}</select></label>
      {day && <><label>Day name<input required value={day.name} onChange={(e) => change((p) => { p.phases[phaseIndex].days[trackKey][dayIndex].name = e.target.value; })} /></label>
        <label className="row"><input type="checkbox" checked={day.rest} onChange={(e) => change((p) => { const d = p.phases[phaseIndex].days[trackKey][dayIndex]; d.rest = e.target.checked; d.workouts = d.rest ? [] : [newWorkout()]; })} />Rest day</label>
        {day.workouts.map((w, wi) => <div key={wi}><WorkoutEditor workout={w} exercises={exercises} onChange={(workout) => change((p) => { p.phases[phaseIndex].days[trackKey][dayIndex].workouts[wi] = workout; })} />
          {day.workouts.length > 1 && <button type="button" className="ghost small" onClick={() => change((p) => { p.phases[phaseIndex].days[trackKey][dayIndex].workouts.splice(wi, 1); })}>Remove workout</button>}</div>)}
        {!day.rest && <button type="button" className="ghost" disabled={day.workouts.length >= 4} onClick={() => change((p) => { p.phases[phaseIndex].days[trackKey][dayIndex].workouts.push(newWorkout()); })}>Add another workout this day</button>}
        <div className="actions"><button type="button" className="ghost" onClick={() => { change((p) => { Object.values(p.phases[phaseIndex].days).forEach((ds) => ds.splice(dayIndex + 1, 0, clone(ds[dayIndex]))); }); setDayIndex(dayIndex + 1); }}>Copy day (all tracks)</button>
          <button type="button" className="ghost" disabled={phase.days[trackKey].length === 1} onClick={() => { change((p) => { Object.values(p.phases[phaseIndex].days).forEach((ds) => ds.splice(dayIndex, 1)); }); setDayIndex(0); }}>Remove day (all tracks)</button></div>
      </>}
      <div className="actions"><button type="button" className="ghost" onClick={() => { change((p) => { Object.values(p.phases[phaseIndex].days).forEach((ds) => ds.push(newDay())); }); setDayIndex(phase.days[trackKey].length); }}>Add training day</button>
        <button type="button" className="ghost" onClick={() => { change((p) => { Object.values(p.phases[phaseIndex].days).forEach((ds) => ds.push({ name: 'Rest', rest: true, workouts: [] })); }); setDayIndex(phase.days[trackKey].length); }}>Add rest day</button></div>
    </fieldset>}
    <button type="button" className="ghost" onClick={() => { change((p) => { p.phases.push({ name: `Phase ${p.phases.length + 1}`, notes: '', progression: 'scheduled', days: Object.fromEntries(p.tracks.map((t) => [t.key, [newDay()]])) }); }); setPhaseIndex(plan.phases.length); setDayIndex(0); }}>Add phase</button>
    <div className="actions"><button type="button" className="ghost" onClick={() => setPreview(!preview)}>{preview ? 'Hide preview' : 'Preview full schedule'}</button><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save phased plan'}</button><button type="button" className="ghost" onClick={onCancel}>Cancel</button></div>
    {preview && <PlanPreview plan={plan} exercises={exercises} />}
  </form>;
}

function SequenceCard({ template, exercises, me, run, onChanged, onOpen }: { template: Template; exercises: Exercise[]; me: CastMember | null; run: Run; onChanged: () => void; onOpen: (id: string) => void }) {
  const [loaded, setLoaded] = useState<Awaited<ReturnType<typeof api.phasedPlan>> | null>(null);
  const [editing, setEditing] = useState(false); const [assigning, setAssigning] = useState(false);
  const [startDate, setStartDate] = useState(dateToday); const [zone, setZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [track, setTrack] = useState(''); const [traineeId, setTraineeId] = useState(''); const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (me?.role !== 'trainee') api.trainees().then(setTrainees).catch(() => {}); }, [me?.key, me?.role]);
  const load = async () => { await run(async () => { const p = await api.phasedPlan(template.id); setLoaded(p); setTrack(p.plan.tracks[0].key); }); };
  if (editing && loaded) return <SequenceEditor initial={loaded.plan} templateId={template.id} revision={loaded.revision} exercises={exercises} run={run} onSaved={() => { setEditing(false); setLoaded(null); onChanged(); }} onCancel={() => setEditing(false)} />;
  return <div className="card"><div className="row center"><h3>{template.name}</h3><span className="badge">Phased · {template.visibility}</span></div><p>{template.description}</p>
    <div className="actions"><button className="primary" onClick={load}>{loaded ? 'Refresh preview' : 'Preview & set up'}</button>
      {loaded?.canEdit && <button className="ghost" onClick={() => setEditing(true)}>Edit phases</button>}
      {loaded?.canEdit && <button className="ghost" onClick={() => run(() => api.shareTemplate(template.id, template.visibility === 'shared' ? 'nobody' : 'gym')).then(onChanged)}>{template.visibility === 'shared' ? 'Withdraw' : 'Share with the gym'}</button>}
    </div>
    {loaded && <><PlanPreview plan={loaded.plan} exercises={exercises} /><button className="primary" onClick={() => setAssigning(!assigning)}>Use this plan</button>
      {assigning && <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); let id = ''; const ok = await run(async () => {
        if (!traineeId && !me?.traineeId && me?.role === 'admin') await api.trainMyself(me.name);
        const p = await api.assignPhasedPlan({ templateId: template.id, traineeId: traineeId || undefined, startDate, timezone: zone, trackKey: track }); id = p.programId;
      }, 'Programme created — review it, then start'); setBusy(false); if (ok) onOpen(id); }}>
        <div className="phase-grid"><label>For whom<select required value={traineeId || 'me'} onChange={(e) => setTraineeId(e.target.value === 'me' ? '' : e.target.value)}><option value="me" disabled={!me?.traineeId && me?.role !== 'admin'}>Me</option>{trainees.filter((t) => t.id !== me?.traineeId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label>Start date<input type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
          <label>Timezone<input required value={zone} onChange={(e) => setZone(e.target.value)} /></label>
          <label>Confirm starting track<select value={track} onChange={(e) => setTrack(e.target.value)}>{loaded.plan.tracks.map((t) => <option value={t.key} key={t.key}>{t.name} · assessment {t.min}–{t.max} · starts at phase {t.startPhase + 1}</option>)}</select></label></div>
        <p className="sub">Choose a level you can manage. You can record an assessment in your first session and confirm a new track afterwards.</p>
        <button className="primary" disabled={busy || (!traineeId && !me?.traineeId && me?.role !== 'admin')}>Create my programme</button>
      </form>}
    </>}
  </div>;
}
export function SequenceLibrary({ plans, exercises, me, run, onChanged, onOpen }: { plans: Template[]; exercises: Exercise[]; me: CastMember | null; run: Run; onChanged: () => void; onOpen: (id: string) => void }) {
  const [draft, setDraft] = useState<SequencePlan | null>(null);
  const start = async (kind?: 'pushups' | 'pullups' | 'strength') => { await run(async () => { setDraft(kind ? examplePlan(kind, exercises) : blankPlan()); }); };
  return <section aria-label="Phased plans"><h2>Programmes with phases</h2><p className="sub">Work towards a goal over changing workouts, rest days and milestones.</p>
    {!draft && <div className="actions"><button className="primary" onClick={() => start()}>Create phased plan</button>
      <button className="ghost" onClick={() => start('pushups')}>Push-up example</button><button className="ghost" onClick={() => start('pullups')}>Pull-up example</button><button className="ghost" onClick={() => start('strength')}>Strength example</button></div>}
    {draft && <SequenceEditor initial={draft} exercises={exercises} run={run} onSaved={() => { setDraft(null); onChanged(); }} onCancel={() => setDraft(null)} />}
    {plans.filter((p) => p.phased).map((p) => <SequenceCard key={p.id} template={p} exercises={exercises} me={me} run={run} onChanged={onChanged} onOpen={onOpen} />)}
  </section>;
}
export function PhasedToday({ onOpen }: { onOpen: (id: string) => void }) {
  const [entries, setEntries] = useState<Awaited<ReturnType<typeof api.phasedToday>>>([]);
  const [error, setError] = useState('');
  useEffect(() => { api.phasedToday().then(setEntries).catch((e) => setError(String(e))); }, []);
  if (error) return <p role="alert">Could not load phased programmes: {error}</p>;
  return <>{entries.map((p) => <button className="card tappable" key={p.programId} onClick={() => onOpen(p.programId)}><strong>{p.title}</strong><span className="sub">{p.pausedOn ? 'Paused' : p.days.length === 0 ? 'No session scheduled today · view programme' : p.days.map((d) => `${d.prescription.phase} · ${d.prescription.name}${d.locked ? ' · milestone required' : ''}`).join(' / ')} · {p.timezone}</span></button>)}</>;
}
function RestTimer({ seconds }: { seconds: number }) {
  const [until, setUntil] = useState<number | null>(null); const [left, setLeft] = useState(0);
  useEffect(() => { if (!until) return; const tick = () => setLeft(Math.max(0, Math.ceil((until - Date.now()) / 1000))); tick(); const t = setInterval(tick, 250); return () => clearInterval(t); }, [until]);
  return <div className="row center"><button type="button" className="ghost small" onClick={() => { setUntil(Date.now() + seconds * 1000); setLeft(seconds); }}>Start {seconds}s rest</button>{until && <output aria-live="off">{left ? `${left}s remaining` : 'Rest complete'}</output>}</div>;
}
export function PhasedProgram({ detail, run, onBack, onProgress, reloadDetail }: { detail: ProgramDetail; run: Run; onBack: () => void; onProgress?: (id: string) => void; reloadDetail: () => void }) {
  const [view, setView] = useState<PhasedProgramView | null>(null); const [error, setError] = useState('');
  const [selected, setSelected] = useState(''); const [exercises, setExercises] = useState<Exercise[]>([]);
  const [edit, setEdit] = useState<PhaseWorkout | null>(null); const [date, setDate] = useState(dateToday); const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => { try { setView(await api.phasedProgram(detail.program.id)); setError(''); } catch (e) { setError(String(e)); } }, [detail.program.id]);
  useEffect(() => { void reload(); api.exercises().then(setExercises).catch(() => {}); }, [reload]);
  if (error) return <p role="alert">{error}</p>;
  if (!view) return <p>Loading programme…</p>;
  const day = view.days.find((d) => d.id === selected) ?? view.days.find((d) => d.date === view.today && d.status === 'started') ?? view.days.find((d) => d.date === view.today) ?? view.days[0];
  const session = detail.sessions.find((s) => s.id === day?.sessionId);
  const manageable = view.canManage && ['planned', 'in_progress'].includes(detail.program.status);
  const mutate = async (fn: () => Promise<unknown>, message: string) => { setBusy(true); const ok = await run(fn, message); setBusy(false); await reload(); reloadDetail(); return ok; };
  const control = (action: string, extra: object = {}) => mutate(() => api.controlPhasedProgram(view.programId, { revision: view.revision, action, occurrenceId: day?.id, ...extra }), 'Programme updated');
  const start = () => mutate(async () => { if (detail.program.status === 'planned') await api.startProgram(view.programId); await api.beginPhasedSession(view.programId, day!.id); }, 'Session ready');
  return <div className="phase-program"><button className="back" onClick={onBack}>‹ Workouts / Programmes</button><h1>{detail.program.title}</h1>
    <p className="sub">{view.plan.tracks.find((t) => t.key === view.trackKey)?.name} · {view.timezone} · {detail.program.status}{view.pausedOn ? ' · Paused' : ''}</p>
    {view.goal && <div className="card hero"><h2>{view.goal.value} / {view.goal.target}</h2><p>{exercises.find((e) => e.id === view.goal?.exerciseId)?.name ?? 'Goal'} · {view.goal.mode === 'single-set' ? 'best continuous set' : view.goal.mode === 'daily-total' ? 'best daily total' : 'total logged'}</p><p>{view.goal.achieved ? 'Goal achieved in logged sets' : 'Working towards your goal'} · based on results shared with you</p></div>}
    {manageable && <div className="actions"><button className="ghost" disabled={busy} onClick={() => control(view.pausedOn ? 'resume' : 'pause')}>{view.pausedOn ? 'Resume & shift future days' : 'Pause programme'}</button>
      {detail.program.status === 'in_progress' && <button className="ghost" disabled={busy} onClick={() => { if (confirm('Finish this programme? Logged results stay, and the programme will accept no more sets.')) void mutate(() => api.completeProgram(view.programId), 'Programme finished'); }}>Finish programme</button>}</div>}
    {onProgress && <button className="ghost" onClick={() => onProgress(detail.program.customer.entityId)}>View training progress</button>}
    {view.recommendation && manageable && <div className="card"><h3>Assessment: {view.recommendation.reps}</h3><p>Suggested track: {view.recommendation.name}. Only unstarted days from today will change.</p><button className="ghost" disabled={busy || view.trackKey === view.recommendation.trackKey} onClick={() => control('change-track', { trackKey: view.recommendation!.trackKey, assessmentSetId: view.recommendation!.setId })}>Confirm suggested track</button></div>}
    {manageable && <details><summary>Choose a different track</summary>{view.plan.tracks.map((t) => <button className="ghost small" key={t.key} disabled={busy || t.key === view.trackKey} onClick={() => { if (confirm(`Change unstarted future days to ${t.name}?`)) void control('change-track', { trackKey: t.key }); }}>{t.name}</button>)}</details>}
    <div className="card"><h2>Schedule</h2>{view.plan.phases.map((phase, ph) => <details key={ph} open={day?.phaseIndex === ph}><summary>{ph + 1}. {phase.name}</summary><p>{phase.notes}</p>
      {view.milestones[ph] && <p>Milestone: {view.milestones[ph]!.value} / {view.milestones[ph]!.target} {ph < view.unlockedPhase ? '· advancement confirmed' : ''}</p>}
      {manageable && phase.progression === 'milestone' && ph >= view.unlockedPhase && <button className="ghost" disabled={busy || !!view.pausedOn || !view.milestones[ph]?.achieved} onClick={() => control('advance', { phaseIndex: ph })}>Confirm milestone & advance</button>}
      {view.days.filter((d) => d.phaseIndex === ph).map((d) => <button className={`rowbtn wide ${day?.id === d.id ? 'on' : ''}`} key={d.id} onClick={() => { setSelected(d.id); setEdit(null); setDate(d.date < view.today ? view.today : d.date); }}><span><b>{d.date} · {d.prescription.day}</b><span className="sub">{d.prescription.name} · {d.missed ? 'missed' : d.status}{d.locked ? ' · locked by milestone' : ''}</span></span></button>)}
    </details>)}</div>
    {day && <div className="card"><h2>{day.prescription.name}</h2><p>{day.prescription.phase} · {day.prescription.day} · {day.date}</p>
      {day.prescription.rest && <p>Rest day. No sets prescribed.</p>}
      {day.locked && <p>Complete and confirm the earlier milestone to unlock this phase.</p>}
      {manageable && <><div className="actions">
        {day.status === 'pending' && <button className="primary" disabled={busy || !!view.pausedOn || day.locked || day.date !== view.today} onClick={start}>Start scheduled workout</button>}
        {day.status === 'started' && <button className="primary" disabled={busy} onClick={() => control('finish-session')}>Finish this session</button>}
        {['pending', 'rest'].includes(day.status) && <button className="ghost" disabled={busy} onClick={() => control('skip')}>Skip day</button>}
        {day.status === 'pending' && <button className="ghost" onClick={() => setEdit(clone(day.prescription.workout!))}>Edit this workout</button>}
      </div><label>Date for rescheduling / repeats<input type="date" min={view.today} value={date} onChange={(e) => setDate(e.target.value)} /></label><div className="actions">
        {['pending', 'rest'].includes(day.status) && <button className="ghost" disabled={busy || !!view.pausedOn} onClick={() => control('reschedule', { date })}>Move to this date</button>}
        <button className="ghost" disabled={busy || !!view.pausedOn} onClick={() => control('repeat-day', { date })}>Repeat day on this date</button><button className="ghost" disabled={busy || !!view.pausedOn} onClick={() => control('repeat-phase', { date, phaseIndex: day.phaseIndex })}>Repeat phase from this date</button>
      </div></>}
      {edit && <><WorkoutEditor workout={edit} exercises={exercises} onChange={setEdit} /><div className="actions"><button className="primary" disabled={busy} onClick={async () => { if (await control('edit-future', { workout: edit })) setEdit(null); }}>Save future prescription</button><button className="ghost" onClick={() => setEdit(null)}>Cancel edit</button></div></>}
      {!edit && day.prescription.workout?.items.map((item, i) => {
        const ex = exercises.find((e) => e.id === item.exerciseId) ?? detail.items.find((x) => x.exercise_id === item.exerciseId)?.exercise;
        const logged = session?.sets.filter((s) => s.program_item_id === day.itemIds[i]) ?? [];
        const next = item.sets[logged.length];
        return <div className="phase-session-item" key={`${day.id}-${i}`}><h3>{ex?.name ?? 'Exercise'}{item.groupKey ? ` · Superset ${item.groupKey}` : ''}</h3><p>{item.notes}</p>
          <ol>{item.sets.map((s, j) => <li key={j}>{s.side ? `${s.side}: ` : ''}{s.mode === 'amrap' ? `As many ${ex?.unit ?? 'reps'} as possible${s.reps ? ` (minimum ${s.reps})` : ''}` : `${s.reps} ${ex?.unit ?? 'reps'}`}{s.load ? ` @ ${s.load} kg` : ''} · Rest {s.restSeconds}s {s.note}</li>)}</ol>
          {logged.map((s) => <div className="row center" key={s.id}><span>Logged: {s.side ? `${s.side} · ` : ''}{s.reps} {ex?.unit ?? 'reps'}{s.load ? ` @ ${s.load} kg` : ''}</span>{manageable && <button className="ghost small" onClick={() => mutate(() => api.voidSet(s.id), 'Set taken back')}>Undo set</button>}</div>)}
          {day.status === 'started' && manageable && next && <><SetLogger key={`${day.id}-${i}-${logged.length}`} unit={ex?.unit ?? 'reps'} modality={ex?.modality ?? 'strength'} loadNote={loadNoteOf(ex?.description ?? null)} defaultSide={next.side}
            defaultFor={(side) => { const prescribed = item.sets.filter((s) => s.side === side); const count = logged.filter((s) => (s.side ?? undefined) === side).length; const s = prescribed[count] ?? next; return { reps: s.mode === 'amrap' && s.reps === 0 ? 1 : s.reps, load: s.load ?? null }; }}
            onLog={async (body) => { await mutate(() => api.logSet(day.sessionId!, { ...body, programItemId: day.itemIds[i] }), 'Set logged'); }} />
            <p className="sub">{next.mode === 'amrap' ? 'Record the actual quantity you performed.' : 'Adjust the quantity if you performed a different amount.'}</p></>}
          {day.status === 'started' && manageable && <RestTimer seconds={item.sets[Math.max(0, logged.length - 1)]?.restSeconds ?? 60} />}
        </div>;
      })}
    </div>}
  </div>;
}
