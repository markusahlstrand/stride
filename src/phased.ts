import { dataSubjectId, z } from '@substrat-run/contracts';
import { assertAllowed, PermissionDenied, ulid, type OperationContext as Ctx } from '@substrat-run/kernel';
import { getWorkOrder, PERM as WO } from '@substrat-run/engine-workorder';
import { TRAIN_PERM as P } from './manifest.js';
import { sequencePlan, saveSequenceInput, readSequenceInput, assignSequenceInput, readSequenceProgramInput,
  beginSequenceInput, controlSequenceInput, dateInZone, shiftDate, dateDistance,
  type SequencePlan, type PhaseWorkout, type PhaseGoal } from './phased-plan.js';
import type { ExerciseRow, SessionRow, TemplateRow, SetResultRow } from './module.js';

export interface SequenceRow {
  program_id: string; plan_json: string; timezone: string; start_date: string; track_key: string;
  unlocked_phase: number; paused_on: string | null; revision: number; updated_at: string;
}
export interface DayRow {
  id: string; program_id: string; phase_index: number; day_index: number; workout_index: number;
  track_key: string; scheduled_date: string; status: 'pending' | 'rest' | 'skipped' | 'started' | 'done';
  session_id: string | null; prescription_json: string; item_ids_json: string; created_at: string;
}
export interface Prescription { name: string; phase: string; day: string; rest: boolean; workout: PhaseWorkout | null }
export function sequenceOf(ctx: Ctx, id: string) {
  return ctx.sql.query<SequenceRow>('SELECT * FROM train_program_sequences WHERE program_id = ?', [id])[0];
}
export function requireOrdinaryProgram(ctx: Ctx, id: string) {
  if (sequenceOf(ctx, id)) throw new Error('This is a phased programme. Use its scheduled workout and phased controls.');
}
export function requireOrdinaryTemplate(ctx: Ctx, id: string) {
  if (ctx.sql.query('SELECT template_id FROM train_plan_sequences WHERE template_id = ?', [id]).length)
    throw new Error('This is a phased plan. Edit its phases and days.');
}
function daysOf(ctx: Ctx, id: string) {
  return ctx.sql.query<DayRow>('SELECT * FROM train_program_days WHERE program_id = ? ORDER BY scheduled_date, phase_index, day_index, workout_index, id', [id]);
}
export function phasedPrescribedSets(ctx: Ctx, id: string): number | undefined {
  if (!sequenceOf(ctx, id)) return undefined;
  return daysOf(ctx, id).reduce((n, d) => {
    const p = JSON.parse(d.prescription_json) as Prescription;
    return n + (p.workout?.items.reduce((v, i) => v + i.sets.length, 0) ?? 0);
  }, 0);
}
export function assertPhaseSet(ctx: Ctx, sessionId: string, itemId: string, programId: string) {
  if (!sequenceOf(ctx, programId)) return;
  const d = ctx.sql.query<DayRow>('SELECT * FROM train_program_days WHERE session_id = ?', [sessionId])[0];
  if (!d || !(JSON.parse(d.item_ids_json) as string[]).includes(itemId)) throw new Error('This exercise is not prescribed for this scheduled session');
  if (d.status !== 'started') throw new Error('This scheduled session is finished; repeat the day to train again');
}
const orderRef = (id: string) => ({ entityType: 'workorder', entityId: id });
function needSequence(ctx: Ctx, id: string): SequenceRow {
  const s = sequenceOf(ctx, id); if (!s) throw new Error('phased programme not found'); return s;
}
function planOf(s: SequenceRow) { return sequencePlan.parse(JSON.parse(s.plan_json)); }
function locked(s: SequenceRow, p: SequencePlan, phase: number) {
  return p.phases.some((x, i) => i < phase && i >= s.unlocked_phase && x.progression === 'milestone');
}
function emit(ctx: Ctx, programId: string, action: string, extra: object = {}) {
  const order = getWorkOrder(ctx, programId);
  ctx.emit({ type: 'stride.sequence-changed', schemaVersion: 1, entity: orderRef(programId),
    piiClass: 'pseudonymous', subjectId: dataSubjectId.parse(order.customer.entityId),
    payload: { action, programme: sequenceOf(ctx, programId), occurrences: daysOf(ctx, programId), ...extra } });
}
async function validatePlan(ctx: Ctx, p: SequencePlan, canRead: (ctx: Ctx, e: ExerciseRow) => Promise<boolean>) {
  const exercises = new Map<string, ExerciseRow>();
  const get = async (id: string) => {
    if (exercises.has(id)) return exercises.get(id)!;
    const e = ctx.sql.query<ExerciseRow>('SELECT * FROM train_exercises WHERE id = ?', [id])[0];
    if (!e || !await canRead(ctx, e)) throw new Error(`Exercise is not available: ${id}`);
    exercises.set(id, e); return e;
  };
  const goals = [p.goal, ...p.phases.map((x) => x.milestone)].filter((g): g is PhaseGoal => !!g);
  for (const g of goals) {
    const e = await get(g.exerciseId);
    if ((e.laterality === 'unilateral') !== !!g.side) throw new Error('A one-sided goal must name its side; a bilateral goal must not');
  }
  if (p.assessmentExerciseId) {
    const e = await get(p.assessmentExerciseId);
    if (e.laterality === 'unilateral') throw new Error('Track assessment uses a bilateral exercise');
  }
  for (const phase of p.phases) for (const days of Object.values(phase.days)) for (const day of days)
    for (const workout of day.workouts) for (const item of workout.items) {
      const e = await get(item.exerciseId);
      for (const set of item.sets) if ((e.laterality === 'unilateral') !== !!set.side)
        throw new Error(`${e.name}: ${e.laterality === 'unilateral' ? 'name left or right for each set' : 'bilateral sets must not name a side'}`);
    }
}
function addDay(ctx: Ctx, s: SequenceRow, p: SequencePlan, phase: number, day: number, date: string) {
  if (daysOf(ctx, s.program_id).some((d) => d.phase_index === phase && d.day_index === day && d.scheduled_date === date))
    throw new Error('This programme day is already scheduled on that date');
  const d = p.phases[phase].days[s.track_key][day];
  const workouts = d.rest ? [null] : d.workouts;
  for (const [i, workout] of workouts.entries()) {
    const prescription: Prescription = { name: workout?.name ?? 'Rest', phase: p.phases[phase].name, day: d.name, rest: d.rest, workout };
    ctx.sql.exec(`INSERT INTO train_program_days
      (id, program_id, phase_index, day_index, workout_index, track_key, scheduled_date, status, session_id, prescription_json, item_ids_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, '[]', ?)`,
    [ulid(), s.program_id, phase, day, i, s.track_key, date, d.rest ? 'rest' : 'pending', JSON.stringify(prescription), ctx.now()]);
  }
}
async function visibleResults(ctx: Ctx, id: string) {
  const result: (SetResultRow & { performed_at: string })[] = [];
  for (const s of ctx.sql.query<SessionRow>('SELECT * FROM train_sessions WHERE program_id = ? ORDER BY performed_at, id', [id])) {
    if (!(await ctx.check(P.resultRead, { entityType: 'session', entityId: s.id })).allowed) continue;
    for (const r of ctx.sql.query<SetResultRow>(`SELECT r.* FROM train_set_results r WHERE r.session_id = ?
      AND NOT EXISTS (SELECT 1 FROM train_set_voids v WHERE v.set_id = r.id) ORDER BY r.id`, [s.id]))
      result.push({ ...r, performed_at: s.performed_at });
  }
  return result;
}
function goalValue(g: PhaseGoal, results: (SetResultRow & { performed_at: string })[], zone: string) {
  const rows = results.filter((r) => r.exercise_id === g.exerciseId && (r.side ?? undefined) === g.side);
  let value = 0;
  if (g.mode === 'single-set') value = rows.reduce((n, r) => Math.max(n, r.reps), 0);
  else if (g.mode === 'total') value = rows.reduce((n, r) => n + r.reps, 0);
  else {
    const days = new Map<string, number>();
    for (const r of rows) { const day = dateInZone(r.performed_at, zone); days.set(day, (days.get(day) ?? 0) + r.reps); }
    value = Math.max(0, ...days.values());
  }
  return { ...g, value, achieved: value >= g.target, scope: 'visible logged sets' };
}
export async function readPhasedProgram(ctx: Ctx, raw: z.infer<typeof readSequenceProgramInput>) {
  const input = readSequenceProgramInput.parse(raw);
  assertAllowed(await ctx.check(WO.read, orderRef(input.programId)));
  const s = needSequence(ctx, input.programId); const p = planOf(s);
  const today = dateInZone(ctx.now(), s.timezone);
  const results = await visibleResults(ctx, input.programId);
  const days = [];
  for (const d of daysOf(ctx, input.programId)) {
    const visible = !d.session_id || (await ctx.check(P.resultRead, { entityType: 'session', entityId: d.session_id })).allowed;
    days.push({ id: d.id, date: d.scheduled_date, phaseIndex: d.phase_index, dayIndex: d.day_index, trackKey: d.track_key,
      status: visible ? d.status : 'scheduled', sessionId: visible ? d.session_id : null,
      itemIds: visible ? JSON.parse(d.item_ids_json) as string[] : [], prescription: JSON.parse(d.prescription_json) as Prescription,
      locked: locked(s, p, d.phase_index), missed: d.scheduled_date < today && d.status === 'pending' && visible });
  }
  const assessment = [...results].reverse().find((r) => r.exercise_id === p.assessmentExerciseId);
  const recommended = assessment ? p.tracks.find((t) => t.min <= assessment.reps && t.max >= assessment.reps) : undefined;
  return { programId: s.program_id, plan: p, timezone: s.timezone, today, startDate: s.start_date, pausedOn: s.paused_on,
    revision: s.revision, trackKey: s.track_key, unlockedPhase: s.unlocked_phase, days,
    canManage: (await ctx.check(P.resultLog, orderRef(s.program_id))).allowed,
    goal: p.goal ? goalValue(p.goal, results, s.timezone) : null,
    milestones: p.phases.map((phase) => phase.milestone ? goalValue(phase.milestone, results, s.timezone) : null),
    recommendation: recommended && assessment ? { trackKey: recommended.key, name: recommended.name, startPhase: recommended.startPhase, reps: assessment.reps, setId: assessment.id } : null };
}
export type PhasedProgramView = Awaited<ReturnType<typeof readPhasedProgram>>;

interface Dependencies {
  authorTemplate: (ctx: Ctx, input: { name: string; description?: string }) => Promise<TemplateRow> | TemplateRow;
  assignProgram: (ctx: Ctx, input: { traineeId?: string; title: string; kind: 'strength' }) => Promise<{ program: { id: string } }> | { program: { id: string } };
  recordSession: (ctx: Ctx, input: { programId: string; note?: string }) => Promise<SessionRow> | SessionRow;
  canReadExercise: (ctx: Ctx, exercise: ExerciseRow) => Promise<boolean>;
  canReadTemplate: (ctx: Ctx, template: TemplateRow) => Promise<boolean>;
}
export function phasedOperations(deps: Dependencies) {
  const save = async (ctx: Ctx, raw: z.infer<typeof saveSequenceInput>) => {
    assertAllowed(await ctx.check(P.libraryAuthor));
    const { plan, templateId, revision } = saveSequenceInput.parse(raw);
    let tpl: TemplateRow;
    if (templateId) {
      assertAllowed(await ctx.check(P.templateRead, { entityType: 'template', entityId: templateId }));
      tpl = ctx.sql.query<TemplateRow>('SELECT * FROM train_templates WHERE id = ?', [templateId])[0];
      if (!tpl) throw new Error('plan not found');
      if (ctx.sql.query('SELECT id FROM train_template_items WHERE template_id = ?', [templateId]).length)
        throw new Error('Create a new phased plan instead of replacing a simple plan');
    } else tpl = await deps.authorTemplate(ctx, { name: plan.name, description: plan.description });
    const existing = ctx.sql.query<{ revision: number }>('SELECT revision FROM train_plan_sequences WHERE template_id = ?', [tpl.id])[0];
    if (existing && revision !== existing.revision) throw new Error('Plan changed. Reload before saving.');
    await validatePlan(ctx, plan, deps.canReadExercise);
    const next = (existing?.revision ?? 0) + 1;
    ctx.sql.exec('INSERT OR REPLACE INTO train_plan_sequences (template_id, plan_json, revision, updated_at) VALUES (?, ?, ?, ?)', [tpl.id, JSON.stringify(plan), next, ctx.now()]);
    ctx.sql.exec('UPDATE train_templates SET name = ?, description = ? WHERE id = ?', [plan.name, plan.description, tpl.id]);
    ctx.emit({ type: 'stride.sequence-plan-saved', schemaVersion: 1, entity: { entityType: 'template', entityId: tpl.id }, piiClass: 'none', payload: { templateId: tpl.id, revision: next, plan } });
    return { templateId: tpl.id, revision: next, plan };
  };
  const read = async (ctx: Ctx, raw: z.infer<typeof readSequenceInput>) => {
    const input = readSequenceInput.parse(raw);
    const tpl = ctx.sql.query<TemplateRow>('SELECT * FROM train_templates WHERE id = ?', [input.templateId])[0];
    if (!tpl || !await deps.canReadTemplate(ctx, tpl)) throw new PermissionDenied('permission denied: plan is not available');
    const row = ctx.sql.query<{ plan_json: string; revision: number }>('SELECT * FROM train_plan_sequences WHERE template_id = ?', [tpl.id])[0];
    if (!row) throw new Error('phased plan not found');
    return { templateId: tpl.id, revision: row.revision, plan: sequencePlan.parse(JSON.parse(row.plan_json)),
      canEdit: (await ctx.check(P.libraryAuthor)).allowed && (await ctx.check(P.templateRead, { entityType: 'template', entityId: tpl.id })).allowed };
  };
  const assign = async (ctx: Ctx, raw: z.infer<typeof assignSequenceInput>) => {
    assertAllowed(await ctx.check(WO.create));
    const input = assignSequenceInput.parse(raw);
    const { plan } = await read(ctx, { templateId: input.templateId });
    const track = plan.tracks.find((t) => t.key === input.trackKey);
    if (!track) throw new Error('Choose an existing ability track');
    await validatePlan(ctx, plan, deps.canReadExercise);
    const { program } = await deps.assignProgram(ctx, { traineeId: input.traineeId, title: input.title ?? plan.name, kind: 'strength' });
    ctx.sql.exec(`INSERT INTO train_program_sequences
      (program_id, plan_json, timezone, start_date, track_key, unlocked_phase, paused_on, revision, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, 1, ?)`, [program.id, JSON.stringify(plan), input.timezone, input.startDate, track.key, track.startPhase, ctx.now()]);
    const s = needSequence(ctx, program.id); let offset = 0;
    for (let ph = track.startPhase; ph < plan.phases.length; ph++) for (let d = 0; d < plan.phases[ph].days[track.key].length; d++)
      addDay(ctx, s, plan, ph, d, shiftDate(input.startDate, offset++));
    emit(ctx, program.id, 'assigned'); return { programId: program.id };
  };
  const begin = async (ctx: Ctx, raw: z.infer<typeof beginSequenceInput>) => {
    const input = beginSequenceInput.parse(raw);
    assertAllowed(await ctx.check(P.resultLog, orderRef(input.programId)));
    const s = needSequence(ctx, input.programId); const p = planOf(s);
    const day = daysOf(ctx, s.program_id).find((d) => d.id === input.occurrenceId);
    if (!day) throw new Error('Scheduled workout not found');
    // Resuming hands back the session's ids, which the programme view masks
    // behind `result:read` on the session — so resuming is gated the same way,
    // or a coach downgraded by sharing could recover what the view hides.
    if (day.session_id) {
      assertAllowed(await ctx.check(P.resultRead, { entityType: 'session', entityId: day.session_id }));
      return { sessionId: day.session_id, itemIds: JSON.parse(day.item_ids_json) as string[] };
    }
    if (getWorkOrder(ctx, s.program_id).status !== 'in_progress') throw new Error('Start the programme first with workorder/start');
    if (s.paused_on) throw new Error('Resume this programme before training');
    if (day.status !== 'pending') throw new Error('This is not an available training day');
    if (locked(s, p, day.phase_index)) throw new Error('Meet and confirm the earlier phase milestone first');
    if (day.scheduled_date !== dateInZone(ctx.now(), s.timezone)) throw new Error('This workout is not scheduled today. Reschedule it first.');
    const prescription = JSON.parse(day.prescription_json) as Prescription;
    const session = await deps.recordSession(ctx, { programId: s.program_id, note: `${prescription.phase} · ${prescription.day} · ${prescription.name}` });
    const ids: string[] = [];
    for (const [position, item] of prescription.workout!.items.entries()) {
      const id = ulid(); ids.push(id);
      const sides = new Set(item.sets.map((x) => x.side));
      ctx.sql.exec(`INSERT INTO train_program_items (id, program_id, exercise_id, position, target_sets, target_reps, target_load, notes, recur_days, recur_per_week, group_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
      [id, s.program_id, item.exerciseId, position, Math.ceil(item.sets.length / sides.size), item.sets[0].reps, item.sets[0].load ?? null, item.notes ?? null, item.groupKey ?? null]);
      const counts = new Map<string, number>();
      for (const set of item.sets) {
        const key = set.side ?? ''; const no = (counts.get(key) ?? 0) + 1; counts.set(key, no);
        ctx.sql.exec(`INSERT INTO train_item_sets (id, item_id, item_kind, set_no, target_reps, target_load, note, side) VALUES (?, ?, 'program', ?, ?, ?, ?, ?)`,
          [ulid(), id, no, set.reps, set.load ?? null, set.note ?? null, set.side ?? null]);
      }
    }
    ctx.sql.exec("UPDATE train_program_days SET session_id = ?, item_ids_json = ?, status = 'started' WHERE id = ?", [session.id, JSON.stringify(ids), day.id]);
    ctx.sql.exec('UPDATE train_program_sequences SET revision = revision + 1, updated_at = ? WHERE program_id = ?', [ctx.now(), s.program_id]);
    emit(ctx, s.program_id, 'session-started', { session, itemIds: ids });
    return { sessionId: session.id, itemIds: ids };
  };
  const control = async (ctx: Ctx, raw: z.infer<typeof controlSequenceInput>) => {
    const input = controlSequenceInput.parse(raw);
    assertAllowed(await ctx.check(P.resultLog, orderRef(input.programId)));
    const s = needSequence(ctx, input.programId); const p = planOf(s);
    if (!['planned', 'in_progress'].includes(getWorkOrder(ctx, s.program_id).status)) throw new Error('A finished programme cannot be changed');
    if (input.revision !== s.revision) throw new Error('Programme changed. Reload before making this change.');
    const today = dateInZone(ctx.now(), s.timezone); const days = daysOf(ctx, s.program_id);
    const day = days.find((d) => d.id === input.occurrenceId);
    const pending = (d: DayRow) => !d.session_id && ['pending', 'rest'].includes(d.status);
    const date = () => { if (!input.date || input.date < today) throw new Error('Choose today or a future date'); return input.date; };
    const requireDay = () => { if (!day) throw new Error('occurrenceId: choose a scheduled workout'); return day; };
    // Resume shifts every pending day on or after paused_on, so a date chosen while paused would be moved twice.
    if (s.paused_on && ['reschedule', 'repeat-day', 'repeat-phase', 'advance'].includes(input.action))
      throw new Error('Resume this programme before changing its schedule');
    if (input.action === 'pause') {
      if (s.paused_on) throw new Error('Programme is already paused');
      ctx.sql.exec('UPDATE train_program_sequences SET paused_on = ? WHERE program_id = ?', [today, s.program_id]);
    } else if (input.action === 'resume') {
      if (!s.paused_on) throw new Error('Programme is not paused');
      const shift = dateDistance(s.paused_on, today);
      for (const d of days.filter((d) => pending(d) && d.scheduled_date >= s.paused_on!))
        ctx.sql.exec('UPDATE train_program_days SET scheduled_date = ? WHERE id = ?', [shiftDate(d.scheduled_date, shift), d.id]);
      ctx.sql.exec('UPDATE train_program_sequences SET paused_on = NULL WHERE program_id = ?', [s.program_id]);
    } else if (['skip', 'reschedule', 'edit-future'].includes(input.action)) {
      const d = requireDay(); if (!pending(d)) throw new Error('Only an unstarted day may be edited, skipped or rescheduled');
      if (input.action === 'skip') ctx.sql.exec("UPDATE train_program_days SET status = 'skipped' WHERE id = ?", [d.id]);
      else if (input.action === 'reschedule') {
        const target = date();
        if (days.some((x) => x.id !== d.id && x.phase_index === d.phase_index && x.day_index === d.day_index && x.workout_index === d.workout_index && x.scheduled_date === target))
          throw new Error('This workout is already scheduled on that date');
        ctx.sql.exec('UPDATE train_program_days SET scheduled_date = ? WHERE id = ?', [target, d.id]);
      }
      else {
        if (!input.workout || d.status === 'rest') throw new Error('workout: provide a training prescription');
        const probe = structuredClone(p); for (const phase of probe.phases) for (const key of Object.keys(phase.days)) phase.days[key] = [{ name: 'Validate', rest: false, workouts: [input.workout] }];
        await validatePlan(ctx, probe, deps.canReadExercise);
        const snap = JSON.parse(d.prescription_json) as Prescription;
        ctx.sql.exec('UPDATE train_program_days SET prescription_json = ? WHERE id = ?', [JSON.stringify({ ...snap, name: input.workout.name, workout: input.workout }), d.id]);
      }
    } else if (input.action === 'finish-session') {
      const d = requireDay(); if (d.status !== 'started') throw new Error('Start this session before finishing it');
      ctx.sql.exec("UPDATE train_program_days SET status = 'done' WHERE id = ?", [d.id]);
    } else if (input.action === 'repeat-day') {
      const d = requireDay(); const target = date();
      if (days.some((x) => x.phase_index === d.phase_index && x.day_index === d.day_index && x.scheduled_date === target)) throw new Error('This day is already scheduled on that date');
      for (const x of days.filter((x) => x.phase_index === d.phase_index && x.day_index === d.day_index && x.scheduled_date === d.scheduled_date)) {
        ctx.sql.exec(`INSERT INTO train_program_days (id, program_id, phase_index, day_index, workout_index, track_key, scheduled_date, status, session_id, prescription_json, item_ids_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, '[]', ?)`, [ulid(), s.program_id, x.phase_index, x.day_index, x.workout_index, x.track_key, target,
          (JSON.parse(x.prescription_json) as Prescription).rest ? 'rest' : 'pending', x.prescription_json, ctx.now()]);
      }
    } else if (input.action === 'repeat-phase') {
      const ph = input.phaseIndex; if (ph === undefined || !p.phases[ph]) throw new Error('phaseIndex: choose an existing phase');
      for (let i = 0; i < p.phases[ph].days[s.track_key].length; i++) addDay(ctx, s, p, ph, i, shiftDate(date(), i));
    } else if (input.action === 'advance') {
      const ph = input.phaseIndex; if (ph === undefined || !p.phases[ph]?.milestone || p.phases[ph].progression !== 'milestone') throw new Error('phaseIndex: choose a milestone phase');
      if (ph < s.unlocked_phase || locked(s, p, ph)) throw new Error('This phase is already confirmed or is still locked');
      const evidence = goalValue(p.phases[ph].milestone!, await visibleResults(ctx, s.program_id), s.timezone);
      if (!evidence.achieved) throw new Error('The milestone has not been met by your visible logged sets');
      const future = days.filter((d) => pending(d) && d.phase_index > ph);
      if (future.length && future[0].scheduled_date <= today) {
        const delta = dateDistance(future[0].scheduled_date, shiftDate(today, 1));
        for (const d of future) ctx.sql.exec('UPDATE train_program_days SET scheduled_date = ? WHERE id = ?', [shiftDate(d.scheduled_date, delta), d.id]);
      }
      ctx.sql.exec('UPDATE train_program_sequences SET unlocked_phase = ? WHERE program_id = ?', [ph + 1, s.program_id]);
    } else if (input.action === 'change-track') {
      const track = p.tracks.find((t) => t.key === input.trackKey); if (!track) throw new Error('trackKey: choose an existing track');
      const evidence = input.assessmentSetId ? (await visibleResults(ctx, s.program_id)).find((r) => r.id === input.assessmentSetId) : undefined;
      if (input.assessmentSetId && (!evidence || evidence.exercise_id !== p.assessmentExerciseId || evidence.reps < track.min || evidence.reps > track.max)) throw new Error('Assessment does not recommend this track');
      // Rebuild only whole unstarted days. A second workout on a started day stays on its original track.
      const candidates = days.filter((d) => pending(d) && d.scheduled_date >= today && !days.some((x) => x.scheduled_date === d.scheduled_date && x.phase_index === d.phase_index && x.day_index === d.day_index && !pending(x)));
      const groups = new Map<string, DayRow>();
      for (const d of candidates) { groups.set(`${d.scheduled_date}|${d.phase_index}|${d.day_index}`, d); ctx.sql.exec('DELETE FROM train_program_days WHERE id = ?', [d.id]); }
      for (const d of groups.values()) addDay(ctx, { ...s, track_key: track.key }, p, d.phase_index, d.day_index, d.scheduled_date);
      ctx.sql.exec('UPDATE train_program_sequences SET track_key = ? WHERE program_id = ?', [track.key, s.program_id]);
    }
    ctx.sql.exec('UPDATE train_program_sequences SET revision = revision + 1, updated_at = ? WHERE program_id = ?', [ctx.now(), s.program_id]);
    emit(ctx, s.program_id, input.action, { request: input }); return { revision: s.revision + 1 };
  };
  const today = async (ctx: Ctx) => {
    const result = [];
    for (const row of ctx.sql.query<SequenceRow>('SELECT * FROM train_program_sequences')) {
      if (!(await ctx.check(WO.read, orderRef(row.program_id))).allowed) continue;
      const program = getWorkOrder(ctx, row.program_id);
      if (!['planned', 'in_progress'].includes(program.status)) continue;
      const view = await readPhasedProgram(ctx, { programId: row.program_id });
      result.push({ programId: row.program_id, title: program.title, today: view.today, timezone: view.timezone, pausedOn: view.pausedOn,
        days: view.days.filter((d) => d.date === view.today) });
    }
    return result;
  };
  return { 'stride/save-phased-plan': save, 'stride/phased-plan': read, 'stride/assign-phased-plan': assign,
    'stride/phased-program': readPhasedProgram, 'stride/begin-phased-session': begin,
    'stride/control-phased-program': control, 'stride/phased-today': today };
}
