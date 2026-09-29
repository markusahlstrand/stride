import { z } from '@substrat-run/contracts';

const id = z.string().min(1);
export const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  (v) => !Number.isNaN(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v,
  'Use a real calendar date in YYYY-MM-DD format',
);
export const timezone = z.string().min(1).refine((v) => {
  try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; }
}, 'Use an IANA timezone, such as Europe/Madrid');
const goal = z.object({
  exerciseId: id, mode: z.enum(['single-set', 'daily-total', 'total']), target: z.number().int().min(1).max(1000000),
  side: z.enum(['left', 'right']).optional(),
});
export const phaseSet = z.object({
  mode: z.enum(['fixed', 'amrap']), reps: z.number().int().min(0).max(1000000),
  load: z.string().regex(/^\d+(\.\d+)?$/).optional(), side: z.enum(['left', 'right']).optional(),
  restSeconds: z.number().int().min(0).max(3600), note: z.string().max(1000).optional(),
}).refine((s) => s.mode === 'amrap' || s.reps > 0, 'Fixed sets need a positive quantity; AMRAP may have no minimum (0)');
export const phaseWorkout = z.object({
  name: z.string().min(1).max(120),
  items: z.array(z.object({
    exerciseId: id, groupKey: z.string().max(40).optional(), notes: z.string().max(2000).optional(),
    sets: z.array(phaseSet).min(1).max(40),
  })).min(1).max(30),
});
export const phaseDay = z.object({
  name: z.string().min(1).max(120), rest: z.boolean(),
  workouts: z.array(phaseWorkout).max(4),
}).refine((d) => d.rest ? d.workouts.length === 0 : d.workouts.length > 0, 'Rest days have no workouts; training days need a workout');
export const sequencePlan = z.object({
  name: z.string().min(1).max(120), description: z.string().max(4000).default(''),
  source: z.object({ title: z.string().max(200), url: z.string().url() }).optional(),
  goal: goal.optional(), assessmentExerciseId: id.optional(),
  tracks: z.array(z.object({
    key: id, name: z.string().min(1).max(80), min: z.number().int().min(0), max: z.number().int().min(0),
    startPhase: z.number().int().min(0),
  })).min(1).max(6),
  phases: z.array(z.object({
    name: z.string().min(1).max(120), notes: z.string().max(2000).default(''),
    progression: z.enum(['scheduled', 'milestone']), milestone: goal.optional(),
    // Each track has the same calendar length, with independently editable prescriptions.
    days: z.record(z.string(), z.array(phaseDay).min(1).max(100)),
  })).min(1).max(24),
}).superRefine((p, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (new Set(p.tracks.map((t) => t.key)).size !== p.tracks.length) issue('Track keys must be unique');
  const ranges = [...p.tracks].sort((a, b) => a.min - b.min);
  ranges.forEach((t, i) => {
    if (t.min > t.max || (i > 0 && t.min <= ranges[i - 1].max)) issue('Assessment ranges must not overlap and minimum must not exceed maximum');
    if (t.startPhase >= p.phases.length) issue('Track starting phase does not exist');
  });
  let days = 0;
  for (const phase of p.phases) {
    if (phase.progression === 'milestone' && !phase.milestone) issue('Milestone phases need an exercise and target');
    const lengths = p.tracks.map((t) => phase.days[t.key]?.length ?? 0);
    if (lengths.some((n) => n === 0 || n !== lengths[0])) issue('Every phase needs the same number of days for every track');
    if (Object.keys(phase.days).some((key) => !p.tracks.some((t) => t.key === key))) issue('Unknown track in phase');
    days += lengths[0];
  }
  if (days > 366) issue('A plan may contain at most 366 calendar days');
  if (p.tracks.length > 1 && !p.assessmentExerciseId) issue('Multiple tracks need an assessment exercise');
});
export type SequencePlan = z.infer<typeof sequencePlan>;
export type PhaseWorkout = z.infer<typeof phaseWorkout>;
export type PhaseDay = z.infer<typeof phaseDay>;
export type PhaseGoal = z.infer<typeof goal>;
export const saveSequenceInput = z.object({ templateId: id.optional(), revision: z.number().int().min(0).optional(), plan: sequencePlan });
export const readSequenceInput = z.object({ templateId: id });
export const assignSequenceInput = z.object({
  templateId: id, traineeId: id.optional(), title: z.string().min(1).max(120).optional(),
  startDate: localDate, timezone, trackKey: id.describe('Confirm the ability track to follow after previewing the plan.'),
});
export const readSequenceProgramInput = z.object({ programId: id });
export const beginSequenceInput = z.object({ programId: id, occurrenceId: id });
export const controlSequenceInput = z.object({
  programId: id, revision: z.number().int().min(0).describe('Current revision from phased-program; prevents duplicate changes.'),
  action: z.enum(['pause', 'resume', 'skip', 'reschedule', 'repeat-day', 'repeat-phase', 'advance', 'change-track', 'finish-session', 'edit-future']),
  occurrenceId: id.optional(), date: localDate.optional(), phaseIndex: z.number().int().min(0).optional(),
  trackKey: id.optional(), assessmentSetId: id.optional(), workout: phaseWorkout.optional(),
});
export const sequenceTodayInput = z.object({});

// Date arithmetic on explicit civil dates, never elapsed 24-hour windows in a timezone.
export function dateInZone(iso: string, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  return ['year', 'month', 'day'].map((key) => parts.find((p) => p.type === key)!.value).join('-');
}
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
export function dateDistance(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
}
