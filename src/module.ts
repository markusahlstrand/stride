import {
  addDecimal,
  dataSubjectId,
  mulDecimal,
  orgId,
  z,
  type EntityRef,
  type OrgId,
  type PrincipalId,
} from '@substrat-run/contracts';
import {
  assertAllowed,
  PermissionDenied,
  ulid,
  type GuardPredicate,
  type ModuleRegistration,
  type OperationContext,
  type OperationHandler,
} from '@substrat-run/kernel';
import {
  completeWorkOrder,
  createWorkOrder,
  listOrders,
  PERM as WO,
  type WorkOrder,
} from '@substrat-run/engine-workorder';
import {
  acceptInvite,
  listInvites,
  revokeInvite,
  sendInvite,
  INVITES_PERM,
  type Invitation,
} from '@substrat-run/engine-invites';
import { PROGRAM_IN_REACH, TRAIN_PERM, strideManifest } from './manifest.js';
import { strideMigrations } from './migrations.js';

// ============================================================================
// The training operations. Each is either a custodian of the vertical's own
// tables, or a COMPOSITION that wraps an engine in-scope function inside the
// same transaction and adds the vertical's policy.
//
// Two shapes to know before reading:
//
//   GATED operations (every mutation, every single-entity read) start with
//   `assertAllowed(await ctx.check(...))` — a node-level key for staff powers,
//   an ENTITY-NARROWED check when the answer depends on whose record it is.
//
//   WALK operations (the listings) have no blanket gate on purpose. They
//   iterate and `ctx.check` PER ENTITY, so the kernel — not a WHERE clause —
//   decides what each caller sees. A stranger gets an empty list: an open door
//   onto an empty room, not a denial.
//
// Data access is `ctx.sql` only. No `fetch`, no `node:*`, no other module's
// tables.
// ============================================================================

export interface CoachRow {
  id: string;
  principal_id: string;
  name: string;
  created_at: string;
}

export interface TraineeRow {
  id: string;
  number: string;
  name: string;
  contact: string | null;
  coach_id: string | null;
  /** Set from 0002 on. Lets an operation resolve principal → trainee, which is
   *  what makes a trainee an AUTHOR rather than only a subject. */
  principal_id: string | null;
  /** Onboarding answers: what they train for, and how often they intend to. */
  goal: string | null;
  days_per_week: number | null;
  onboarded_at: string | null;
  created_at: string;
}

export interface ExerciseRow {
  id: string;
  slug: string;
  name: string;
  modality: string;
  unit: string;
  description: string | null;
  visibility: string;
  /** Exactly one of the two owner columns is set on a private row; both are
   *  NULL on a shared one. */
  owner_coach_id: string | null;
  owner_trainee_id: string | null;
  active: number;
  created_by: string;
  created_at: string;
}

export interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  visibility: string;
  owner_coach_id: string | null;
  owner_trainee_id: string | null;
  created_by: string;
  created_at: string;
}

export interface ItemRow {
  id: string;
  template_id?: string;
  program_id?: string;
  exercise_id: string;
  position: number;
  target_sets: number;
  target_reps: number;
  target_load: string | null;
  notes: string | null;
  /** ISO weekdays, '1,3,5' — 1 = Monday. Exactly one of these two is set. */
  recur_days: string | null;
  recur_per_week: number | null;
  /** Items sharing a key are a SUPERSET, performed back to back. NULL = alone. */
  group_key: string | null;
}

/** A single prescribed set, when the sets differ from one another. */
export interface ItemSetRow {
  id: string;
  item_id: string;
  item_kind: string;
  set_no: number;
  target_reps: number;
  target_load: string | null;
  note: string | null;
}

export interface EquipmentRow {
  slug: string;
  name: string;
  category: string;
  created_at: string;
}

export interface SessionRow {
  id: string;
  program_id: string;
  trainee_id: string;
  performed_at: string;
  note: string | null;
  logged_by: string;
  created_at: string;
}

export interface SetResultRow {
  id: string;
  session_id: string;
  program_item_id: string;
  exercise_id: string;
  set_no: number;
  /**
   * The quantity, IN THE EXERCISE'S OWN UNIT. 8 reps, 45 seconds, 5000 metres —
   * the number means whatever `train_exercises.unit` says it means, which is why
   * cardio needed no separate table.
   */
  reps: number;
  load: string | null;
  rpe: string | null;
  /** How long it took. The second number a 5 km row needs and a set does not. */
  duration_seconds: number | null;
  avg_hr: number | null;
  logged_by: string;
  logged_at: string;
}

export interface ProgramSummaryRow {
  program_id: string;
  prescribed_sets: number;
  performed_sets: number;
  total_reps: number;
  total_volume: string;
  /** Cardio's contribution: work measured in time rather than in load. */
  total_seconds: number;
  adherence_pct: string;
  computed_at: string;
}

const MODALITIES = ['strength', 'mobility', 'cardio', 'rehab'] as const;
const UNITS = ['reps', 'seconds', 'metres'] as const;
const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/, 'must be a decimal string, never a float');

/**
 * How often an exercise recurs. A lifting program names the days ("Mon/Wed/Fri");
 * a physio prescription names a count ("five times a week") and lets the patient
 * choose when. Both are real, so both are representable — but never at once, or
 * "due today" would have two answers.
 */
const recurrence = {
  recurDays: z
    .string()
    .regex(/^[1-7](,[1-7])*$/, "ISO weekdays as '1,3,5' — 1 is Monday, 7 is Sunday")
    .optional(),
  recurPerWeek: z.number().int().min(1).max(14).optional(),
};

function parseRecurrence(input: { recurDays?: string; recurPerWeek?: number }): {
  days: string | null;
  perWeek: number | null;
} {
  if (input.recurDays !== undefined && input.recurPerWeek !== undefined) {
    throw new Error('set recurDays or recurPerWeek, never both — they would disagree about today');
  }
  if (input.recurDays !== undefined) {
    const days = [...new Set(input.recurDays.split(','))].sort();
    return { days: days.join(','), perWeek: null };
  }
  return { days: null, perWeek: input.recurPerWeek ?? null };
}

/** ISO weekday, 1 = Monday … 7 = Sunday. UTC — see `scheduleOp`. */
function isoWeekday(d: Date): number {
  return d.getUTCDay() === 0 ? 7 : d.getUTCDay();
}

/** Midnight UTC on the Monday of that date's week. */
function weekStart(d: Date): Date {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (isoWeekday(start) - 1));
  return start;
}

// ---------------------------------------------------------------------------
// Small helpers. `percentOf` is INTEGER arithmetic rendered as a decimal string
// — the contracts money helpers have no division, and adherence must not become
// a float. 2/3 → "66.66", never 66.66666666666667.
// ---------------------------------------------------------------------------

function percentOf(part: number, whole: number): string {
  if (whole <= 0) return '0.00';
  const hundredths = Math.floor((part * 10000) / whole);
  return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`;
}

function coachOf(ctx: OperationContext): CoachRow | undefined {
  return ctx.sql.query<CoachRow>('SELECT * FROM train_coaches WHERE principal_id = ?', [
    ctx.principal,
  ])[0];
}

function traineeOf(ctx: OperationContext): TraineeRow | undefined {
  return ctx.sql.query<TraineeRow>('SELECT * FROM train_trainees WHERE principal_id = ?', [
    ctx.principal,
  ])[0];
}

/**
 * WHO is authoring. Everyone may create their own exercises, templates and
 * programs, so the author is whichever record this principal is — a coach or a
 * trainee — and that record becomes the new row's parent. One grant on your own
 * record then reaches everything you have made.
 *
 * An admin with neither record publishes to the shared library instead; there is
 * nothing for a private row to hang from, so we refuse rather than orphan it.
 */
function authorOf(ctx: OperationContext): EntityRef {
  const coach = coachOf(ctx);
  if (coach) return { entityType: 'coach', entityId: coach.id };
  const trainee = traineeOf(ctx);
  if (trainee) return { entityType: 'trainee', entityId: trainee.id };
  throw new PermissionDenied(
    'permission denied: no coach or trainee record for this principal — publish to the shared library instead',
  );
}

/** The trainee this principal IS, for the self-serve paths. */
function requireTrainee(ctx: OperationContext): TraineeRow {
  const trainee = traineeOf(ctx);
  if (!trainee) {
    throw new PermissionDenied('permission denied: no trainee record for this principal');
  }
  return trainee;
}

function programOf(ctx: OperationContext, programId: string): WorkOrder {
  const order = listOrders(ctx).find((o) => o.id === programId);
  if (!order) throw new Error(`program not found: ${programId}`);
  return order;
}

/** The caller's own record, or null — the non-throwing sibling of `authorOf`. */
function accountOf(ctx: OperationContext): EntityRef | null {
  const coach = coachOf(ctx);
  if (coach) return { entityType: 'coach', entityId: coach.id };
  const trainee = traineeOf(ctx);
  if (trainee) return { entityType: 'trainee', entityId: trainee.id };
  return null;
}

/** The equipment slugs this account has. An account with no record has none. */
function myEquipment(ctx: OperationContext): Set<string> {
  const me = accountOf(ctx);
  if (!me) return new Set();
  return new Set(
    ctx.sql
      .query<{ equipment_slug: string }>(
        'SELECT equipment_slug FROM train_account_equipment WHERE owner_type = ? AND owner_id = ?',
        [me.entityType, me.entityId],
      )
      .map((r) => r.equipment_slug),
  );
}

/** exercise id → the equipment it needs. No entry means bodyweight. */
function equipmentByExercise(ctx: OperationContext): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const row of ctx.sql.query<{ exercise_id: string; equipment_slug: string }>(
    'SELECT exercise_id, equipment_slug FROM train_exercise_equipment ORDER BY equipment_slug',
  )) {
    const list = out.get(row.exercise_id) ?? [];
    list.push(row.equipment_slug);
    out.set(row.exercise_id, list);
  }
  return out;
}

/** Shared-and-active is readable by key; anything else has to survive the walk. */
async function canReadExercise(ctx: OperationContext, ex: ExerciseRow): Promise<boolean> {
  if (ex.visibility === 'shared' && ex.active === 1) {
    if ((await ctx.check(TRAIN_PERM.exerciseReadShared)).allowed) return true;
  }
  return (await ctx.check(TRAIN_PERM.exerciseRead, { entityType: 'exercise', entityId: ex.id }))
    .allowed;
}

/** Same two-door rule for templates: the shared key, or the entity walk. */
async function canReadTemplate(ctx: OperationContext, tpl: TemplateRow): Promise<boolean> {
  if (tpl.visibility === 'shared') {
    if ((await ctx.check(TRAIN_PERM.templateReadShared)).allowed) return true;
  }
  return (await ctx.check(TRAIN_PERM.templateRead, { entityType: 'template', entityId: tpl.id }))
    .allowed;
}


// ---------------------------------------------------------------------------
// Equipment — a controlled vocabulary, what each exercise needs, and what each
// account actually has.
// ---------------------------------------------------------------------------

export const equipmentInput = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
});

/** Extending the vocabulary is a gym-wide act, so it is the publish key. */
const publishEquipmentOp: OperationHandler<z.infer<typeof equipmentInput>, EquipmentRow> = async (
  ctx,
  rawInput,
) => {
  assertAllowed(await ctx.check(TRAIN_PERM.libraryPublish));
  const input = equipmentInput.parse(rawInput);
  ctx.sql.exec(
    `INSERT OR REPLACE INTO train_equipment (slug, name, category, created_at) VALUES (?, ?, ?, ?)`,
    [input.slug, input.name, input.category, new Date().toISOString()],
  );
  ctx.emit({
    type: 'stride.equipment-published',
    schemaVersion: 1,
    entity: { entityType: 'equipment', entityId: input.slug },
    piiClass: 'none',
    payload: { ...input },
  });
  return ctx.sql.query<EquipmentRow>('SELECT * FROM train_equipment WHERE slug = ?', [
    input.slug,
  ])[0]!;
};

export type EquipmentView = EquipmentRow & { available: boolean };

/** The vocabulary, each row flagged with whether the caller has it. */
const equipmentOp: OperationHandler<undefined, EquipmentView[]> = async (ctx) => {
  assertAllowed(await ctx.check(TRAIN_PERM.exerciseReadShared));
  const mine = myEquipment(ctx);
  return ctx.sql
    .query<EquipmentRow>('SELECT * FROM train_equipment ORDER BY category, name')
    .map((e) => ({ ...e, available: mine.has(e.slug) }));
};

export const myEquipmentInput = z.object({ equipment: z.array(z.string().min(1)) });

/**
 * Set the equipment on YOUR OWN account.
 *
 * Note what this operation does NOT take: an id saying whose account. There is
 * no whose — it is resolved from `ctx.principal`. That is why `equipment:manage`
 * can be held gym-wide by everyone without a narrowing check: the operation is
 * incapable of naming anyone else.
 */
const setMyEquipmentOp: OperationHandler<
  z.infer<typeof myEquipmentInput>,
  { owner: EntityRef; equipment: string[] }
> = async (ctx, rawInput) => {
  assertAllowed(await ctx.check(TRAIN_PERM.equipmentManage));
  const input = myEquipmentInput.parse(rawInput);
  const me = authorOf(ctx);
  const known = new Set(
    ctx.sql.query<{ slug: string }>('SELECT slug FROM train_equipment').map((r) => r.slug),
  );
  for (const slug of input.equipment) {
    if (!known.has(slug)) throw new Error(`unknown equipment: ${slug}`);
  }
  ctx.sql.exec('DELETE FROM train_account_equipment WHERE owner_type = ? AND owner_id = ?', [
    me.entityType,
    me.entityId,
  ]);
  for (const slug of input.equipment) {
    ctx.sql.exec(
      'INSERT INTO train_account_equipment (owner_type, owner_id, equipment_slug) VALUES (?, ?, ?)',
      [me.entityType, me.entityId, slug],
    );
  }
  ctx.emit({
    type: 'stride.account-equipment-set',
    schemaVersion: 1,
    entity: me,
    piiClass: 'pseudonymous',
    subjectId: dataSubjectId.parse(me.entityId),
    payload: { owner: me, equipment: input.equipment },
  });
  return { owner: me, equipment: input.equipment };
};

const exerciseEquipmentInput = z.object({
  exerciseId: z.string().min(1),
  equipment: z.array(z.string().min(1)),
});

/**
 * Retag an exercise. Two gates, the same shape as editing a template: you must
 * be an author at all, AND the exercise must be one the walk reaches — so a
 * coach retags their own, an admin retags anything.
 */
const setExerciseEquipmentOp: OperationHandler<
  z.infer<typeof exerciseEquipmentInput>,
  ExerciseRow & { equipment: string[] }
> = async (ctx, rawInput) => {
  assertAllowed(await ctx.check(TRAIN_PERM.libraryAuthor));
  const input = exerciseEquipmentInput.parse(rawInput);
  const exercise = ctx.sql.query<ExerciseRow>('SELECT * FROM train_exercises WHERE id = ?', [
    input.exerciseId,
  ])[0];
  if (!exercise) throw new Error(`exercise not found: ${input.exerciseId}`);
  if (exercise.visibility === 'shared') {
    // A shared row belongs to the organisation; only an admin edits it.
    assertAllowed(await ctx.check(TRAIN_PERM.libraryPublish));
  } else {
    assertAllowed(
      await ctx.check(TRAIN_PERM.exerciseRead, { entityType: 'exercise', entityId: exercise.id }),
    );
  }
  setExerciseEquipment(ctx, exercise.id, input.equipment);
  ctx.emit({
    type: 'stride.exercise-equipment-set',
    schemaVersion: 1,
    entity: { entityType: 'exercise', entityId: exercise.id },
    piiClass: 'none',
    payload: { exerciseId: exercise.id, slug: exercise.slug, equipment: input.equipment },
  });
  return { ...exercise, equipment: input.equipment };
};

function setExerciseEquipment(ctx: OperationContext, exerciseId: string, equipment: string[]): void {
  const known = new Set(
    ctx.sql.query<{ slug: string }>('SELECT slug FROM train_equipment').map((r) => r.slug),
  );
  for (const slug of equipment) {
    if (!known.has(slug)) throw new Error(`unknown equipment: ${slug}`);
  }
  ctx.sql.exec('DELETE FROM train_exercise_equipment WHERE exercise_id = ?', [exerciseId]);
  for (const slug of equipment) {
    ctx.sql.exec(
      'INSERT INTO train_exercise_equipment (exercise_id, equipment_slug) VALUES (?, ?)',
      [exerciseId, slug],
    );
  }
}

// ---------------------------------------------------------------------------
// People — admin only.
// ---------------------------------------------------------------------------

export const createCoachInput = z.object({ principalId: z.string().min(1), name: z.string().min(1) });

const createCoachOp: OperationHandler<z.infer<typeof createCoachInput>, CoachRow> = async (
  ctx,
  rawInput,
) => {
  assertAllowed(await ctx.check(TRAIN_PERM.traineeManage));
  const input = createCoachInput.parse(rawInput);
  const id = ulid();
  ctx.sql.exec(
    `INSERT INTO train_coaches (id, principal_id, name, created_at) VALUES (?, ?, ?, ?)`,
    [id, input.principalId, input.name, new Date().toISOString()],
  );
  ctx.emit({
    type: 'stride.coach-registered',
    schemaVersion: 1,
    entity: { entityType: 'coach', entityId: id },
    // 'direct' because the payload carries a real person's name — so the kernel
    // demands a subjectId it can key crypto-shredding on at erasure time.
    piiClass: 'direct',
    subjectId: dataSubjectId.parse(id),
    payload: { coachId: id, principalId: input.principalId, name: input.name },
  });
  return ctx.sql.query<CoachRow>('SELECT * FROM train_coaches WHERE id = ?', [id])[0]!;
};

export const createTraineeInput = z.object({
  number: z.string().min(1),
  name: z.string().min(1),
  contact: z.string().optional(),
  coachId: z.string().optional(),
  /** Who logs in as this trainee. Needed for the self-serve paths — without it
   *  the trainee can be trained but cannot author anything of their own. */
  principalId: z.string().optional(),
});

const createTraineeOp: OperationHandler<z.infer<typeof createTraineeInput>, TraineeRow> = async (
  ctx,
  rawInput,
) => {
  assertAllowed(await ctx.check(TRAIN_PERM.traineeManage));
  const input = createTraineeInput.parse(rawInput);
  const id = ulid();
  let coachId: string | null = null;
  if (input.coachId !== undefined) {
    const coach = ctx.sql.query<CoachRow>('SELECT * FROM train_coaches WHERE id = ?', [
      input.coachId,
    ])[0];
    if (!coach) throw new Error(`coach not found: ${input.coachId}`);
    coachId = coach.id;
  }
  ctx.sql.exec(
    `INSERT INTO train_trainees (id, number, name, contact, coach_id, principal_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.number,
      input.name,
      input.contact ?? null,
      coachId,
      input.principalId ?? null,
      new Date().toISOString(),
    ],
  );
  // NOTE: no trainee -> coach edge. That edge used to hand a coach this
  // person's entire history, for ever, with no way back. What a coach sees is
  // now the trainee's decision — see `setSharingOp`. `coach_id` is the current
  // coach for display and carries no access on its own.
  ctx.emit({
    type: 'stride.trainee-registered',
    schemaVersion: 1,
    entity: { entityType: 'trainee', entityId: id },
    piiClass: 'direct',
    subjectId: dataSubjectId.parse(id),
    payload: { traineeId: id, number: input.number, name: input.name, coachId },
  });
  return ctx.sql.query<TraineeRow>('SELECT * FROM train_trainees WHERE id = ?', [id])[0]!;
};

const assignToCoachInput = z.object({ traineeId: z.string().min(1), coachId: z.string().min(1) });

/**
 * Move a trainee to a coach. The `coach_id` column is the CURRENT coach, for
 * display; the edge is APPEND-ONLY, so a previous coach keeps read access to the
 * history they supervised. Module code has no un-link — revoking would be a
 * control-plane action. See DESIGN.md §3.
 */
const assignToCoachOp: OperationHandler<z.infer<typeof assignToCoachInput>, TraineeRow> = async (
  ctx,
  rawInput,
) => {
  assertAllowed(await ctx.check(TRAIN_PERM.traineeManage));
  const input = assignToCoachInput.parse(rawInput);
  const trainee = ctx.sql.query<TraineeRow>('SELECT * FROM train_trainees WHERE id = ?', [
    input.traineeId,
  ])[0];
  if (!trainee) throw new Error(`trainee not found: ${input.traineeId}`);
  const coach = ctx.sql.query<CoachRow>('SELECT * FROM train_coaches WHERE id = ?', [
    input.coachId,
  ])[0];
  if (!coach) throw new Error(`coach not found: ${input.coachId}`);

  ctx.sql.exec('UPDATE train_trainees SET coach_id = ? WHERE id = ?', [coach.id, trainee.id]);
  // Assignment is bookkeeping, not access: it grants nothing. The trainee opens
  // the door with `stride/set-sharing`, and can close it again.
  ctx.emit({
    type: 'stride.trainee-assigned',
    schemaVersion: 1,
    entity: { entityType: 'trainee', entityId: trainee.id },
    piiClass: 'direct',
    subjectId: dataSubjectId.parse(trainee.id),
    payload: {
      traineeId: trainee.id,
      traineeName: trainee.name,
      coachId: coach.id,
      coachName: coach.name,
      previousCoachId: trainee.coach_id,
    },
  });
  return ctx.sql.query<TraineeRow>('SELECT * FROM train_trainees WHERE id = ?', [trainee.id])[0]!;
};

// ---------------------------------------------------------------------------
// The exercise catalogue — the shared/private split.
// ---------------------------------------------------------------------------

export const exerciseInput = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  modality: z.enum(MODALITIES),
  unit: z.enum(UNITS),
  description: z.string().optional(),
  /** What it needs. Omitted or empty means bodyweight — everyone can do it. */
  equipment: z.array(z.string().min(1)).optional(),
});

function insertExercise(
  ctx: OperationContext,
  input: z.infer<typeof exerciseInput>,
  visibility: 'shared' | 'private',
  owner: EntityRef | null,
): ExerciseRow {
  // Slugs are the human handle and are unique per gym, shared and private
  // alike — two rows called `back-squat` would make the catalogue a guessing
  // game. Check it here so the caller gets a sentence instead of a raw
  // constraint violation.
  const clash = ctx.sql.query<ExerciseRow>('SELECT * FROM train_exercises WHERE slug = ?', [
    input.slug,
  ])[0];
  if (clash) {
    throw new Error(
      `exercise slug already taken in this gym: ${input.slug} (${clash.visibility}) — pick another`,
    );
  }
  const id = ulid();
  ctx.sql.exec(
    `INSERT INTO train_exercises
       (id, slug, name, modality, unit, description, visibility, owner_coach_id, owner_trainee_id,
        active, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      id,
      input.slug,
      input.name,
      input.modality,
      input.unit,
      input.description ?? null,
      visibility,
      owner?.entityType === 'coach' ? owner.entityId : null,
      owner?.entityType === 'trainee' ? owner.entityId : null,
      ctx.principal,
      new Date().toISOString(),
    ],
  );
  ctx.emit({
    type: 'stride.exercise-created',
    schemaVersion: 1,
    entity: { entityType: 'exercise', entityId: id },
    piiClass: 'none',
    payload: {
      exerciseId: id,
      slug: input.slug,
      name: input.name,
      modality: input.modality,
      unit: input.unit,
      visibility,
      owner,
    },
  });
  setExerciseEquipment(ctx, id, input.equipment ?? []);
  return ctx.sql.query<ExerciseRow>('SELECT * FROM train_exercises WHERE id = ?', [id])[0]!;
}

/** Admin only: an exercise the whole organisation can browse. */
const publishExerciseOp: OperationHandler<z.infer<typeof exerciseInput>, ExerciseRow> = async (
  ctx,
  rawInput,
) => {
  assertAllowed(await ctx.check(TRAIN_PERM.libraryPublish));
  return insertExercise(ctx, exerciseInput.parse(rawInput), 'shared', null);
};

/**
 * A coach's own exercise. The `exercise → coach` edge is what makes it theirs:
 * no other coach holds a grant that the walk can reach.
 */
const authorExerciseOp: OperationHandler<z.infer<typeof exerciseInput>, ExerciseRow> = async (
  ctx,
  rawInput,
) => {
  assertAllowed(await ctx.check(TRAIN_PERM.libraryAuthor));
  const owner = authorOf(ctx);
  const exercise = insertExercise(ctx, exerciseInput.parse(rawInput), 'private', owner);
  // The edge IS the ownership. A coach's exercise hangs from coach:<id>; a
  // trainee's from trainee:<id> — the same parent their earned exercises use, so
  // "mine" and "what I've done" are one walk and one grant.
  ctx.link({ entityType: 'exercise', entityId: exercise.id }, owner);
  return exercise;
};

const retireExerciseInput = z.object({ exerciseId: z.string().min(1) });

/**
 * Retire an exercise: it leaves the shared catalogue for everyone. It does NOT
 * leave the library of anyone who has performed it — their `exercise → trainee`
 * edge is untouched, and the walk still resolves. Retire is not erase.
 */
const retireExerciseOp: OperationHandler<z.infer<typeof retireExerciseInput>, ExerciseRow> = async (
  ctx,
  rawInput,
) => {
  assertAllowed(await ctx.check(TRAIN_PERM.libraryPublish));
  const input = retireExerciseInput.parse(rawInput);
  const exercise = ctx.sql.query<ExerciseRow>('SELECT * FROM train_exercises WHERE id = ?', [
    input.exerciseId,
  ])[0];
  if (!exercise) throw new Error(`exercise not found: ${input.exerciseId}`);
  ctx.sql.exec('UPDATE train_exercises SET active = 0 WHERE id = ?', [exercise.id]);
  ctx.emit({
    type: 'stride.exercise-retired',
    schemaVersion: 1,
    entity: { entityType: 'exercise', entityId: exercise.id },
    piiClass: 'none',
    payload: { exerciseId: exercise.id, slug: exercise.slug, name: exercise.name },
  });
  return ctx.sql.query<ExerciseRow>('SELECT * FROM train_exercises WHERE id = ?', [exercise.id])[0]!;
};

export type ExerciseView = ExerciseRow & {
  access: 'shared' | 'granted';
  equipment: string[];
  /** Do you have everything it needs? Bodyweight exercises are always true. */
  canDo: boolean;
  /** What you are missing, so the UI can say WHY rather than just hiding it. */
  missing: string[];
};

/**
 * Equipment is a CONVENIENCE, not a permission. It never hides an exercise you
 * are allowed to see — it tells you what you'd need to do it. Filtering on it
 * happens in the UI, deliberately: the kernel decides what you may READ, your
 * kit decides what you can lift, and conflating the two would be a bug the day
 * someone borrows a barbell.
 */
function withEquipment<T extends ExerciseRow>(
  row: T,
  byExercise: Map<string, string[]>,
  mine: Set<string>,
): T & { equipment: string[]; canDo: boolean; missing: string[] } {
  const equipment = byExercise.get(row.id) ?? [];
  const missing = equipment.filter((e) => !mine.has(e));
  return { ...row, equipment, canDo: missing.length === 0, missing };
}

/**
 * ONE operation, three different correct answers, and none of them a filter the
 * vertical wrote:
 *
 *   admin   holds `exercise:read` at NODE level        → everything
 *   coach   holds it narrowed to their coach record    → shared + own + what
 *                                                        their trainees earned
 *   trainee holds it narrowed to their trainee record  → shared + everything
 *                                                        they have earned
 *
 * The shared-and-active rows come from the node-level key; every other row is
 * walked PER ENTITY. The handler never asks who is calling — the kernel
 * produces the difference, with a proof path behind each allow.
 */
const exercisesOp: OperationHandler<undefined, ExerciseView[]> = async (ctx) => {
  const shared = (await ctx.check(TRAIN_PERM.exerciseReadShared)).allowed;
  const byExercise = equipmentByExercise(ctx);
  const mine = myEquipment(ctx);
  const out: ExerciseView[] = [];
  for (const ex of ctx.sql.query<ExerciseRow>('SELECT * FROM train_exercises ORDER BY name')) {
    if (shared && ex.visibility === 'shared' && ex.active === 1) {
      out.push({ ...withEquipment(ex, byExercise, mine), access: 'shared' });
      continue;
    }
    const decision = await ctx.check(TRAIN_PERM.exerciseRead, {
      entityType: 'exercise',
      entityId: ex.id,
    });
    if (decision.allowed) out.push({ ...withEquipment(ex, byExercise, mine), access: 'granted' });
  }
  return out;
};

/**
 * The personal library: only what the walk allows, with the shared shortcut
 * deliberately NOT applied. For a trainee this is exactly the set of exercises
 * they have performed at least once — the "yours forever" screen.
 */
const myExercisesOp: OperationHandler<
  undefined,
  (ExerciseRow & { equipment: string[]; canDo: boolean; missing: string[] })[]
> = async (ctx) => {
  const byExercise = equipmentByExercise(ctx);
  const mine = myEquipment(ctx);
  const out: (ExerciseRow & { equipment: string[]; canDo: boolean; missing: string[] })[] = [];
  for (const ex of ctx.sql.query<ExerciseRow>('SELECT * FROM train_exercises ORDER BY name')) {
    const decision = await ctx.check(TRAIN_PERM.exerciseRead, {
      entityType: 'exercise',
      entityId: ex.id,
    });
    if (decision.allowed) out.push(withEquipment(ex, byExercise, mine));
  }
  return out;
};

// ---------------------------------------------------------------------------
// Program templates — the reusable prescription.
// ---------------------------------------------------------------------------

export const templateInput = z.object({ name: z.string().min(1), description: z.string().optional() });

function insertTemplate(
  ctx: OperationContext,
  input: z.infer<typeof templateInput>,
  visibility: 'shared' | 'private',
  owner: EntityRef | null,
): TemplateRow {
  const id = ulid();
  ctx.sql.exec(
    `INSERT INTO train_templates
       (id, name, description, visibility, owner_coach_id, owner_trainee_id, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.description ?? null,
      visibility,
      owner?.entityType === 'coach' ? owner.entityId : null,
      owner?.entityType === 'trainee' ? owner.entityId : null,
      ctx.principal,
      new Date().toISOString(),
    ],
  );
  ctx.emit({
    type: 'stride.template-created',
    schemaVersion: 1,
    entity: { entityType: 'template', entityId: id },
    piiClass: 'none',
    payload: { templateId: id, name: input.name, visibility, owner },
  });
  return ctx.sql.query<TemplateRow>('SELECT * FROM train_templates WHERE id = ?', [id])[0]!;
}

const publishTemplateOp: OperationHandler<z.infer<typeof templateInput>, TemplateRow> = async (
  ctx,
  rawInput,
) => {
  assertAllowed(await ctx.check(TRAIN_PERM.libraryPublish));
  return insertTemplate(ctx, templateInput.parse(rawInput), 'shared', null);
};

const authorTemplateOp: OperationHandler<z.infer<typeof templateInput>, TemplateRow> = async (
  ctx,
  rawInput,
) => {
  assertAllowed(await ctx.check(TRAIN_PERM.libraryAuthor));
  const owner = authorOf(ctx);
  const template = insertTemplate(ctx, templateInput.parse(rawInput), 'private', owner);
  ctx.link({ entityType: 'template', entityId: template.id }, owner);
  return template;
};

const templateItemInput = z.object({
  templateId: z.string().min(1),
  exerciseId: z.string().min(1),
  targetSets: z.number().int().positive(),
  targetReps: z.number().int().positive(),
  targetLoad: decimalString.optional(),
  notes: z.string().optional(),
  groupKey: z.string().min(1).max(8).optional(),
  ...recurrence,
});

/**
 * Two gates on purpose. `library:author` says you may shape a template at all;
 * the per-entity `template:read` says WHICH template — node-level for an admin
 * (so they may edit a shared one), narrowed to their own coach record for a
 * coach (so they may not).
 */
const addTemplateItemOp: OperationHandler<z.infer<typeof templateItemInput>, ItemRow> = async (
  ctx,
  rawInput,
) => {
  assertAllowed(await ctx.check(TRAIN_PERM.libraryAuthor));
  const input = templateItemInput.parse(rawInput);
  // Deliberately the NARROWED key only, unlike assign-program below: browsing a
  // shared template is not permission to edit it. An admin passes at node level;
  // a coach passes for their own template and nothing else.
  assertAllowed(
    await ctx.check(TRAIN_PERM.templateRead, {
      entityType: 'template',
      entityId: input.templateId,
    }),
  );
  const exercise = ctx.sql.query<ExerciseRow>('SELECT * FROM train_exercises WHERE id = ?', [
    input.exerciseId,
  ])[0];
  if (!exercise) throw new Error(`exercise not found: ${input.exerciseId}`);
  if (!(await canReadExercise(ctx, exercise))) {
    throw new PermissionDenied(`permission denied: exercise not in your library: ${exercise.slug}`);
  }
  const position =
    (ctx.sql.query<{ n: number }>(
      'SELECT COALESCE(MAX(position), 0) AS n FROM train_template_items WHERE template_id = ?',
      [input.templateId],
    )[0]?.n ?? 0) + 1;
  const id = ulid();
  const recur = parseRecurrence(input);
  ctx.sql.exec(
    `INSERT INTO train_template_items
       (id, template_id, exercise_id, position, target_sets, target_reps, target_load, notes,
        recur_days, recur_per_week, group_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.templateId,
      exercise.id,
      position,
      input.targetSets,
      input.targetReps,
      input.targetLoad ?? null,
      input.notes ?? null,
      recur.days,
      recur.perWeek,
      input.groupKey ?? null,
    ],
  );
  ctx.emit({
    type: 'stride.template-item-added',
    schemaVersion: 1,
    entity: { entityType: 'template', entityId: input.templateId },
    piiClass: 'none',
    payload: {
      templateId: input.templateId,
      itemId: id,
      exerciseId: exercise.id,
      exerciseSlug: exercise.slug,
      targetSets: input.targetSets,
      targetReps: input.targetReps,
      targetLoad: input.targetLoad ?? null,
      recurDays: recur.days,
      recurPerWeek: recur.perWeek,
    },
  });
  return ctx.sql.query<ItemRow>('SELECT * FROM train_template_items WHERE id = ?', [id])[0]!;
};

const templatesOp: OperationHandler<undefined, (TemplateRow & { items: ItemRow[] })[]> = async (
  ctx,
) => {
  const shared = (await ctx.check(TRAIN_PERM.templateReadShared)).allowed;
  const out: (TemplateRow & { items: ItemRow[] })[] = [];
  for (const tpl of ctx.sql.query<TemplateRow>('SELECT * FROM train_templates ORDER BY name')) {
    const visible =
      (shared && tpl.visibility === 'shared') ||
      (await ctx.check(TRAIN_PERM.templateRead, { entityType: 'template', entityId: tpl.id }))
        .allowed;
    if (!visible) continue;
    out.push({
      ...tpl,
      items: ctx.sql.query<ItemRow>(
        'SELECT * FROM train_template_items WHERE template_id = ? ORDER BY position',
        [tpl.id],
      ),
    });
  }
  return out;
};

// ---------------------------------------------------------------------------
// Trainees — a walk. Admin sees all, a coach sees their own, a trainee sees
// themselves, and a stranger sees an empty list.
// ---------------------------------------------------------------------------

const coachesOp: OperationHandler<undefined, CoachRow[]> = async (ctx) => {
  const out: CoachRow[] = [];
  for (const c of ctx.sql.query<CoachRow>('SELECT * FROM train_coaches ORDER BY name')) {
    const decision = await ctx.check(TRAIN_PERM.resultRead, {
      entityType: 'coach',
      entityId: c.id,
    });
    if (decision.allowed) out.push(c);
  }
  return out;
};

/**
 * The roster. Three ways in, none of them a hand-written filter:
 *
 *   1. a direct `result:read` on the trainee record — an admin passes at node
 *      level, a trainee passes on themselves, a coach passes if that trainee
 *      shared 'all' with them;
 *   2. a RELATIONSHIP: `message:read` on the trainee record, which every coach
 *      a trainee has connected with holds and nobody else does. This is what
 *      makes "my trainees" mean the people who engaged me, rather than the
 *      people I happen to have written something for;
 *   3. the person behind a PROGRAMME you can open — a coach who was handed a
 *      programme without a wider relationship still sees whose it is.
 *
 * Branch 2 was missing, and it showed: a coach whose trainee had just joined —
 * sharing row, live conversation, no programme yet — had an empty roster with an
 * unread message in it.
 *
 * Every branch is decided by `ctx.check`; none of them is a second access rule.
 */
const traineesOp: OperationHandler<undefined, TraineeRow[]> = async (ctx) => {
  const visible = new Set<string>();
  for (const program of listOrders(ctx)) {
    const decision = await ctx.check(WO.read, {
      entityType: 'workorder',
      entityId: program.id,
    });
    if (decision.allowed) visible.add(program.customer.entityId);
  }
  const out: TraineeRow[] = [];
  for (const t of ctx.sql.query<TraineeRow>('SELECT * FROM train_trainees ORDER BY number')) {
    const readable = await ctx.check(TRAIN_PERM.resultRead, {
      entityType: 'trainee',
      entityId: t.id,
    });
    const related = await ctx.check(TRAIN_PERM.messageRead, {
      entityType: 'trainee',
      entityId: t.id,
    });
    if (readable.allowed || related.allowed || visible.has(t.id)) out.push(t);
  }
  return out;
};

// ---------------------------------------------------------------------------
// Programs — the engine's work order, wearing this vertical's vocabulary.
// ---------------------------------------------------------------------------

export const assignProgramInput = z.object({
  /** Omit it to make a program for YOURSELF — the self-serve path. Staff pass it
   *  to assign one to someone else, and the narrowed `result:log` check below
   *  decides whether they may. */
  traineeId: z.string().min(1).optional(),
  title: z.string().min(1),
  kind: z.enum(['strength', 'rehab', 'conditioning']),
  templateId: z.string().optional(),
  notes: z.string().optional(),
  /**
   * Book the training at the same time. A solo trainee setting up "Workout A,
   * Mondays and Fridays at 18:00" should not have to create the thing, then
   * find it, then schedule it — that is three steps for one decision.
   */
  slots: z
    .array(
      z.object({
        weekday: z.number().int().min(1).max(7),
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "a time like '18:00'"),
      }),
    )
    .max(14)
    .optional(),
});

/**
 * Assign a program. Composes the engine's `createWorkOrder` (which owns the
 * number, the state machine and the `workorder → trainee` link), then SNAPSHOTS
 * the template's items into `train_program_items`.
 *
 * Snapshot, not reference: editing the template afterwards must never rewrite a
 * prescription already running under a patient.
 */
const assignProgramOp: OperationHandler<
  z.infer<typeof assignProgramInput>,
  { program: WorkOrder; items: ItemRow[] }
> = async (ctx, rawInput) => {
  assertAllowed(await ctx.check(WO.create));
  const input = assignProgramInput.parse(rawInput);
  const traineeId = input.traineeId ?? requireTrainee(ctx).id;
  // WHICH trainee — the narrowed check, and the whole reason `workorder:create`
  // can be held gym-wide by everyone. A trainee holds `result:log` only against
  // their own record, so self-serve reaches exactly one person: themselves. A
  // coach passes through the trainee → coach edge; an admin at node level.
  assertAllowed(
    await ctx.check(TRAIN_PERM.resultLog, { entityType: 'trainee', entityId: traineeId }),
  );
  const trainee = ctx.sql.query<TraineeRow>('SELECT * FROM train_trainees WHERE id = ?', [
    traineeId,
  ])[0];
  if (!trainee) throw new Error(`trainee not found: ${traineeId}`);

  const program = createWorkOrder(ctx, {
    facility: { entityType: 'trainee', entityId: trainee.id },
    customer: { entityType: 'trainee', entityId: trainee.id },
    kind: input.kind,
    title: input.title,
    ...(input.notes !== undefined ? { description: input.notes } : {}),
  });

  let source: ItemRow[] = [];
  if (input.templateId) {
    const template = ctx.sql.query<TemplateRow>('SELECT * FROM train_templates WHERE id = ?', [
      input.templateId,
    ])[0];
    if (!template) throw new Error(`template not found: ${input.templateId}`);
    // Either door: the shared library by key, or your own by the entity walk.
    // Asserting only the narrowed key here would stop a coach from assigning the
    // organisation's own shared template.
    if (!(await canReadTemplate(ctx, template))) {
      throw new PermissionDenied(`permission denied: template not in your library: ${template.name}`);
    }
    source = ctx.sql.query<ItemRow>(
      'SELECT * FROM train_template_items WHERE template_id = ? ORDER BY position',
      [input.templateId],
    );
    if (source.length === 0) throw new Error(`template has no items: ${input.templateId}`);
  }

  for (const item of source) {
    const exercise = ctx.sql.query<ExerciseRow>('SELECT * FROM train_exercises WHERE id = ?', [
      item.exercise_id,
    ])[0];
    // You cannot smuggle another coach's private exercise into a program by
    // assigning a template that happens to contain it.
    if (!exercise || !(await canReadExercise(ctx, exercise))) {
      throw new PermissionDenied(
        `permission denied: exercise not in your library: ${exercise?.slug ?? item.exercise_id}`,
      );
    }
    const copiedId = ulid();
    ctx.sql.exec(
      `INSERT INTO train_program_items
         (id, program_id, exercise_id, position, target_sets, target_reps, target_load, notes,
          recur_days, recur_per_week, group_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        copiedId,
        program.id,
        exercise.id,
        item.position,
        item.target_sets,
        item.target_reps,
        item.target_load,
        item.notes,
        item.recur_days,
        item.recur_per_week,
        item.group_key,
      ],
    );
    // Per-set rows are part of the prescription, so they are snapshot too — a
    // ramp copied as "3 sets of something" would be a different programme.
    for (const set of ctx.sql.query<ItemSetRow>(
      'SELECT * FROM train_item_sets WHERE item_id = ? ORDER BY set_no',
      [item.id],
    )) {
      ctx.sql.exec(
        `INSERT INTO train_item_sets (id, item_id, item_kind, set_no, target_reps, target_load, note)
         VALUES (?, ?, 'program', ?, ?, ?, ?)`,
        [ulid(), copiedId, set.set_no, set.target_reps, set.target_load, set.note],
      );
    }
  }

  // The 'assigned' floor: a program a coach wrote is reachable from that coach,
  // and from no other. This edge is per PROGRAM — it is the narrow replacement
  // for the trainee -> coach edge that used to hand over a whole history.
  const author = coachOf(ctx);
  if (author) {
    ctx.link(
      { entityType: 'workorder', entityId: program.id },
      { entityType: 'coach', entityId: author.id },
    );
  }

  const now = new Date().toISOString();
  const seen = new Set<string>();
  for (const slot of input.slots ?? []) {
    const key = `${slot.weekday}@${slot.time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ctx.sql.exec(
      `INSERT INTO train_program_slots (id, program_id, weekday, time_of_day, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [ulid(), program.id, slot.weekday, slot.time, now],
    );
  }

  const items = ctx.sql.query<ItemRow>(
    'SELECT * FROM train_program_items WHERE program_id = ? ORDER BY position',
    [program.id],
  );
  ctx.emit({
    type: 'stride.program-assigned',
    schemaVersion: 1,
    entity: { entityType: 'workorder', entityId: program.id },
    piiClass: 'direct',
    subjectId: dataSubjectId.parse(trainee.id),
    payload: {
      programId: program.id,
      number: program.number,
      traineeId: trainee.id,
      traineeName: trainee.name,
      title: input.title,
      kind: input.kind,
      templateId: input.templateId ?? null,
      slots: [...seen],
      items: items.map((i) => ({
        exerciseId: i.exercise_id,
        position: i.position,
        targetSets: i.target_sets,
        targetReps: i.target_reps,
        targetLoad: i.target_load,
      })),
    },
  });
  return { program, items };
};

const programItemInput = z.object({
  programId: z.string().min(1),
  exerciseId: z.string().min(1),
  targetSets: z.number().int().positive(),
  targetReps: z.number().int().positive(),
  targetLoad: decimalString.optional(),
  notes: z.string().optional(),
  /** Same key on two items makes them a superset: A1, A2, then rest. */
  groupKey: z.string().min(1).max(8).optional(),
  ...recurrence,
});

/**
 * Add an exercise to a program directly, without going through a template —
 * the self-serve path, where you build your own session as you go.
 *
 * Gated by the narrowed `result:log` on the PROGRAM, so the walk
 * workorder → trainee → coach decides: your own, your trainees', or (for an
 * admin) anyone's. The exercise must also be one you can actually read, so a
 * private exercise cannot be smuggled into a program by id.
 *
 * Allowed while `planned` or `in_progress`, and refused once the program is
 * completed — a finished prescription is what adherence was measured against
 * and must not move afterwards.
 */
const addProgramItemOp: OperationHandler<z.infer<typeof programItemInput>, ItemRow> = async (
  ctx,
  rawInput,
) => {
  const input = programItemInput.parse(rawInput);
  assertAllowed(
    await ctx.check(TRAIN_PERM.resultLog, { entityType: 'workorder', entityId: input.programId }),
  );
  const program = programOf(ctx, input.programId);
  if (program.status !== 'planned' && program.status !== 'in_progress') {
    throw new Error(`invalid transition: a ${program.status} program takes no new exercises`);
  }
  const exercise = ctx.sql.query<ExerciseRow>('SELECT * FROM train_exercises WHERE id = ?', [
    input.exerciseId,
  ])[0];
  if (!exercise) throw new Error(`exercise not found: ${input.exerciseId}`);
  if (!(await canReadExercise(ctx, exercise))) {
    throw new PermissionDenied(`permission denied: exercise not in your library: ${exercise.slug}`);
  }
  const position =
    (ctx.sql.query<{ n: number }>(
      'SELECT COALESCE(MAX(position), 0) AS n FROM train_program_items WHERE program_id = ?',
      [input.programId],
    )[0]?.n ?? 0) + 1;
  const id = ulid();
  const recur = parseRecurrence(input);
  ctx.sql.exec(
    `INSERT INTO train_program_items
       (id, program_id, exercise_id, position, target_sets, target_reps, target_load, notes,
        recur_days, recur_per_week, group_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.programId,
      exercise.id,
      position,
      input.targetSets,
      input.targetReps,
      input.targetLoad ?? null,
      input.notes ?? null,
      recur.days,
      recur.perWeek,
      input.groupKey ?? null,
    ],
  );
  ctx.emit({
    type: 'stride.program-item-added',
    schemaVersion: 1,
    entity: { entityType: 'workorder', entityId: input.programId },
    piiClass: 'pseudonymous',
    subjectId: dataSubjectId.parse(program.customer.entityId),
    payload: {
      programId: input.programId,
      itemId: id,
      traineeId: program.customer.entityId,
      exerciseId: exercise.id,
      exerciseSlug: exercise.slug,
      position,
      targetSets: input.targetSets,
      targetReps: input.targetReps,
      targetLoad: input.targetLoad ?? null,
      recurDays: recur.days,
      recurPerWeek: recur.perWeek,
    },
  });
  return ctx.sql.query<ItemRow>('SELECT * FROM train_program_items WHERE id = ?', [id])[0]!;
};

const logSessionInput = z.object({
  programId: z.string().min(1),
  performedAt: z.string().optional(),
  note: z.string().optional(),
});

const logSessionOp: OperationHandler<z.infer<typeof logSessionInput>, SessionRow> = async (
  ctx,
  rawInput,
) => {
  const input = logSessionInput.parse(rawInput);
  assertAllowed(
    await ctx.check(TRAIN_PERM.resultLog, { entityType: 'workorder', entityId: input.programId }),
  );
  const program = programOf(ctx, input.programId);
  if (program.status !== 'in_progress') {
    throw new Error(`invalid transition: a ${program.status} program takes no sessions`);
  }
  const id = ulid();
  const now = new Date().toISOString();
  ctx.sql.exec(
    `INSERT INTO train_sessions (id, program_id, trainee_id, performed_at, note, logged_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, program.id, program.customer.entityId, input.performedAt ?? now, input.note ?? null, ctx.principal, now],
  );
  ctx.link({ entityType: 'session', entityId: id }, { entityType: 'workorder', entityId: program.id });

  // 'from-now' made concrete: each coach the trainee shares forward with is
  // granted THIS session as it is created. Nothing retroactive — a session
  // logged before they turned sharing on carries no grant and stays private.
  // ('all' sharers already reach it through the trainee record; granting again
  // is harmless and keeps the two paths from drifting.)
  for (const share of futureSharers(ctx, program.customer.entityId)) {
    const principal = coachPrincipal(ctx, share.coach_id);
    if (!principal) continue;
    await ctx.grant(principal, TRAIN_PERM.resultRead, { entityType: 'session', entityId: id });
    // …and the program itself, so the session has somewhere to be read.
    // `workorder:read` is identity and prescription only; the RESULTS on it are
    // still gated per session by `result:read`.
    await ctx.grant(principal, WO.read, { entityType: 'workorder', entityId: program.id });
  }

  ctx.emit({
    type: 'stride.session-logged',
    schemaVersion: 1,
    entity: { entityType: 'session', entityId: id },
    piiClass: 'pseudonymous',
    subjectId: dataSubjectId.parse(program.customer.entityId),
    payload: {
      sessionId: id,
      programId: program.id,
      traineeId: program.customer.entityId,
      performedAt: input.performedAt ?? now,
    },
  });
  return ctx.sql.query<SessionRow>('SELECT * FROM train_sessions WHERE id = ?', [id])[0]!;
};

const logSetInput = z.object({
  sessionId: z.string().min(1),
  programItemId: z.string().min(1),
  /** The quantity, in the exercise's own unit — reps, seconds or metres. */
  reps: z.number().int().positive(),
  load: decimalString.optional(),
  rpe: decimalString.optional(),
  /** Optional second number: how long the set took. */
  durationSeconds: z.number().int().positive().max(86_400).optional(),
  avgHr: z.number().int().min(20).max(240).optional(),
});

/**
 * THE MECHANIC — the reason this app is on Substrat.
 *
 * The permission check is ENTITY-NARROWED on the session, so the walk
 * session → workorder → trainee → coach decides. A trainee holding `result:log`
 * on their own record cannot log into anyone else's session, even knowing its
 * id; a coach cannot log into another coach's trainee's session.
 *
 * Then, having performed it, the trainee EARNS the exercise: `ctx.link` records
 * `exercise → trainee`, and from now on every `exercise:read` check on it walks
 * that edge and allows. `ctx.link` is idempotent and there is no un-link in
 * module code — "yours forever" is literal.
 */
const logSetOp: OperationHandler<
  z.infer<typeof logSetInput>,
  { set: SetResultRow; earned: boolean }
> = async (ctx, rawInput) => {
  const input = logSetInput.parse(rawInput);
  assertAllowed(
    await ctx.check(TRAIN_PERM.resultLog, { entityType: 'session', entityId: input.sessionId }),
  );
  const session = ctx.sql.query<SessionRow>('SELECT * FROM train_sessions WHERE id = ?', [
    input.sessionId,
  ])[0];
  if (!session) throw new Error(`session not found: ${input.sessionId}`);
  const program = programOf(ctx, session.program_id);
  if (program.status !== 'in_progress') {
    throw new Error(`invalid transition: a ${program.status} program takes no more sets`);
  }
  const item = ctx.sql.query<ItemRow>(
    'SELECT * FROM train_program_items WHERE id = ? AND program_id = ?',
    [input.programItemId, session.program_id],
  )[0];
  if (!item) throw new Error(`program item not found on this program: ${input.programItemId}`);

  const setNo =
    (ctx.sql.query<{ n: number }>(
      'SELECT COALESCE(MAX(set_no), 0) AS n FROM train_set_results WHERE session_id = ? AND program_item_id = ?',
      [session.id, item.id],
    )[0]?.n ?? 0) + 1;

  // Was this exercise already in the trainee's library before this set?
  const earnedBefore =
    ctx.sql.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM train_set_results r
         JOIN train_sessions s ON s.id = r.session_id
        WHERE s.trainee_id = ? AND r.exercise_id = ?`,
      [session.trainee_id, item.exercise_id],
    )[0]?.n ?? 0;

  const id = ulid();
  const now = new Date().toISOString();
  ctx.sql.exec(
    `INSERT INTO train_set_results
       (id, session_id, program_item_id, exercise_id, set_no, reps, load, rpe,
        duration_seconds, avg_hr, logged_by, logged_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      session.id,
      item.id,
      item.exercise_id,
      setNo,
      input.reps,
      input.load ?? null,
      input.rpe ?? null,
      input.durationSeconds ?? null,
      input.avgHr ?? null,
      ctx.principal,
      now,
    ],
  );

  // ── yours forever ──────────────────────────────────────────────────────────
  ctx.link(
    { entityType: 'exercise', entityId: item.exercise_id },
    { entityType: 'trainee', entityId: session.trainee_id },
  );

  ctx.emit({
    type: 'stride.set-logged',
    schemaVersion: 1,
    entity: { entityType: 'session', entityId: session.id },
    piiClass: 'pseudonymous',
    subjectId: dataSubjectId.parse(session.trainee_id),
    payload: {
      setId: id,
      sessionId: session.id,
      programId: session.program_id,
      traineeId: session.trainee_id,
      exerciseId: item.exercise_id,
      setNo,
      reps: input.reps,
      load: input.load ?? null,
      rpe: input.rpe ?? null,
      durationSeconds: input.durationSeconds ?? null,
      avgHr: input.avgHr ?? null,
    },
  });

  const earned = earnedBefore === 0;
  if (earned) {
    ctx.emit({
      type: 'stride.exercise-earned',
      schemaVersion: 1,
      entity: { entityType: 'exercise', entityId: item.exercise_id },
      piiClass: 'pseudonymous',
      subjectId: dataSubjectId.parse(session.trainee_id),
      payload: {
        exerciseId: item.exercise_id,
        traineeId: session.trainee_id,
        firstPerformedAt: now,
        viaProgramId: session.program_id,
      },
    });
  }

  return { set: ctx.sql.query<SetResultRow>('SELECT * FROM train_set_results WHERE id = ?', [id])[0]!, earned };
};

const completeProgramInput = z.object({ programId: z.string().min(1) });

/**
 * THE ADHERENCE MOMENT — this vertical's analogue of the reference's pricing
 * moment. Fold the append-only set results against the prescription, write the
 * summary, emit it fat, then hand the program to the engine's `completeWorkOrder`
 * inside the SAME transaction so the state machine's invariant stays intact.
 *
 * `billable: []` because there is no money here. The engine takes a billable
 * array because it was built for jobs that get invoiced; the `0` total it
 * returns is ignored. (DESIGN.md §2.)
 */
const completeProgramOp: OperationHandler<
  z.infer<typeof completeProgramInput>,
  { program: WorkOrder; summary: ProgramSummaryRow }
> = async (ctx, rawInput) => {
  assertAllowed(await ctx.check(WO.complete));
  const input = completeProgramInput.parse(rawInput);
  assertAllowed(
    await ctx.check(TRAIN_PERM.resultLog, { entityType: 'workorder', entityId: input.programId }),
  );

  const program = programOf(ctx, input.programId);
  const items = ctx.sql.query<ItemRow>('SELECT * FROM train_program_items WHERE program_id = ?', [
    input.programId,
  ]);
  const results = ctx.sql.query<SetResultRow>(
    `SELECT r.* FROM train_set_results r
       JOIN train_sessions s ON s.id = r.session_id
      WHERE s.program_id = ?`,
    [input.programId],
  );

  const prescribedSets = items.reduce((n, i) => n + i.target_sets, 0);
  const performedSets = results.length;
  const totalReps = results.reduce((n, r) => n + r.reps, 0);
  // Volume = Σ reps × load, in decimal strings. Never a float.
  const totalVolume = results.reduce(
    (sum, r) => (r.load ? addDecimal(sum, mulDecimal(String(r.reps), r.load)) : sum),
    '0',
  );
  // Cardio carries no load, so it contributes nothing to volume — its work shows
  // up as time instead. Reporting both means a conditioning block is not summarised
  // as "0 volume, nothing happened".
  const totalSeconds = results.reduce((n, r) => n + (r.duration_seconds ?? 0), 0);
  const summary: ProgramSummaryRow = {
    total_seconds: totalSeconds,
    program_id: input.programId,
    prescribed_sets: prescribedSets,
    performed_sets: performedSets,
    total_reps: totalReps,
    total_volume: totalVolume,
    adherence_pct: percentOf(performedSets, prescribedSets),
    computed_at: new Date().toISOString(),
  };
  ctx.sql.exec(
    `INSERT OR REPLACE INTO train_program_summary
       (program_id, prescribed_sets, performed_sets, total_reps, total_volume, total_seconds,
        adherence_pct, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      summary.program_id,
      summary.prescribed_sets,
      summary.performed_sets,
      summary.total_reps,
      summary.total_volume,
      summary.total_seconds,
      summary.adherence_pct,
      summary.computed_at,
    ],
  );
  ctx.emit({
    type: 'stride.program-completed',
    schemaVersion: 1,
    entity: { entityType: 'workorder', entityId: input.programId },
    piiClass: 'pseudonymous',
    subjectId: dataSubjectId.parse(program.customer.entityId),
    payload: { ...summary, traineeId: program.customer.entityId },
  });

  const result = completeWorkOrder(ctx, { orderId: input.programId, billable: [] });
  return { program: result.order, summary };
};

export interface ProgramDetail {
  program: WorkOrder & { traineeName: string | null };
  /** `sets` is the explicit prescription when the sets differ; empty means the
   *  uniform `target_sets × target_reps @ target_load` on the item itself. */
  items: (ItemRow & { exercise: ExerciseRow | null; sets: ItemSetRow[] })[];
  sessions: (SessionRow & { sets: SetResultRow[] })[];
  summary: ProgramSummaryRow | null;
  /** When this programme is trained — Wednesday 11:00, and so on. */
  slots: SlotRow[];
}

const programDetailInput = z.object({ programId: z.string().min(1) });

const getProgramOp: OperationHandler<z.infer<typeof programDetailInput>, ProgramDetail> = async (
  ctx,
  rawInput,
) => {
  const input = programDetailInput.parse(rawInput);
  // Two different questions, two different keys. `workorder:read` is may-I-see
  // that this program exists and what it prescribes; `result:read`, checked per
  // session below, is may-I-see what was actually done. Splitting them is what
  // lets a 'from-now' coach open the programme and still not read last month.
  assertAllowed(
    await ctx.check(WO.read, { entityType: 'workorder', entityId: input.programId }),
  );
  const program = programOf(ctx, input.programId);
  const trainee = ctx.sql.query<TraineeRow>('SELECT * FROM train_trainees WHERE id = ?', [
    program.customer.entityId,
  ])[0];
  const items = ctx.sql
    .query<ItemRow>('SELECT * FROM train_program_items WHERE program_id = ? ORDER BY position', [
      program.id,
    ])
    .map((item) => ({
      ...item,
      exercise:
        ctx.sql.query<ExerciseRow>('SELECT * FROM train_exercises WHERE id = ?', [
          item.exercise_id,
        ])[0] ?? null,
      sets: ctx.sql.query<ItemSetRow>(
        'SELECT * FROM train_item_sets WHERE item_id = ? ORDER BY set_no',
        [item.id],
      ),
    }));
  // A WALK, not a query: one check per session, so what comes back depends on
  // what the trainee shared rather than on a WHERE clause this file wrote.
  const sessions: (SessionRow & { sets: SetResultRow[] })[] = [];
  for (const row of ctx.sql.query<SessionRow>(
    'SELECT * FROM train_sessions WHERE program_id = ? ORDER BY performed_at, id',
    [program.id],
  )) {
    const decision = await ctx.check(TRAIN_PERM.resultRead, {
      entityType: 'session',
      entityId: row.id,
    });
    if (!decision.allowed) continue;
    sessions.push({
      ...row,
      sets: ctx.sql.query<SetResultRow>(
        'SELECT * FROM train_set_results WHERE session_id = ? ORDER BY id',
        [row.id],
      ),
    });
  }
  const summary =
    ctx.sql.query<ProgramSummaryRow>('SELECT * FROM train_program_summary WHERE program_id = ?', [
      program.id,
    ])[0] ?? null;
  const slots = ctx.sql.query<SlotRow>(
    'SELECT * FROM train_program_slots WHERE program_id = ? ORDER BY weekday, time_of_day',
    [program.id],
  );
  return {
    program: { ...program, traineeName: trainee?.name ?? null },
    items,
    sessions,
    summary,
    slots,
  };
};

export type ProgramCard = WorkOrder & { traineeName: string | null; setsLogged: number };

/**
 * The portal walk. One `ctx.check` per program — not a filtered query. A
 * trainee sees their own, a coach sees their own trainees', an admin sees all,
 * and a stranger gets an empty list.
 */
const myProgramsOp: OperationHandler<undefined, ProgramCard[]> = async (ctx) => {
  const visible: ProgramCard[] = [];
  for (const program of listOrders(ctx)) {
    const decision = await ctx.check(WO.read, {
      entityType: 'workorder',
      entityId: program.id,
    });
    if (!decision.allowed) continue;
    const trainee = ctx.sql.query<TraineeRow>('SELECT * FROM train_trainees WHERE id = ?', [
      program.customer.entityId,
    ])[0];
    const setsLogged =
      ctx.sql.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM train_set_results r
           JOIN train_sessions s ON s.id = r.session_id
          WHERE s.program_id = ?`,
        [program.id],
      )[0]?.n ?? 0;
    visible.push({ ...program, traineeName: trainee?.name ?? null, setsLogged });
  }
  return visible;
};

export interface ScheduledItem {
  programId: string;
  programTitle: string;
  itemId: string;
  exerciseId: string;
  exerciseName: string;
  unit: string;
  targetSets: number;
  targetReps: number;
  targetLoad: string | null;
  recurDays: string | null;
  recurPerWeek: number | null;
  /** Is it on today's plan? A per-week count is due until the count is met. */
  dueToday: boolean;
  /** Distinct days this week on which at least one set was logged for it. */
  doneThisWeek: number;
  targetThisWeek: number;
}

const scheduleInput = z.object({
  /** ISO date, for a deterministic "today" in tests. Defaults to now. */
  on: z.string().optional(),
});

/**
 * WHAT IS DUE — the recurring-schedule read.
 *
 * A walk, like every other listing: one `ctx.check` per program, so a trainee
 * sees their own plan, a coach sees their trainees', an admin sees the gym, and
 * a stranger sees an empty list.
 *
 * Two honest limits, stated rather than hidden:
 *  - Weeks are ISO weeks in **UTC**. The kernel has no timezone for a scope, so
 *    a Sunday-night session near a date line can land in the neighbouring week.
 *    Fixing it properly means storing the gym's timezone, not guessing here.
 *  - "Done" counts DISTINCT DAYS with at least one logged set, not sets. Three
 *    sets on Monday is one of your three days, not three of them.
 */
const scheduleOp: OperationHandler<z.infer<typeof scheduleInput>, ScheduledItem[]> = async (
  ctx,
  rawInput,
) => {
  const input = scheduleInput.parse(rawInput ?? {});
  const today = input.on ? new Date(input.on) : new Date();
  if (Number.isNaN(today.getTime())) throw new Error(`not a date: ${input.on}`);
  const weekday = String(isoWeekday(today));
  const from = weekStart(today).toISOString();

  const out: ScheduledItem[] = [];
  for (const program of listOrders(ctx)) {
    if (program.status !== 'planned' && program.status !== 'in_progress') continue;
    const decision = await ctx.check(WO.read, {
      entityType: 'workorder',
      entityId: program.id,
    });
    if (!decision.allowed) continue;

    for (const item of ctx.sql.query<ItemRow>(
      'SELECT * FROM train_program_items WHERE program_id = ? ORDER BY position',
      [program.id],
    )) {
      if (!item.recur_days && !item.recur_per_week) continue;
      const exercise = ctx.sql.query<ExerciseRow>('SELECT * FROM train_exercises WHERE id = ?', [
        item.exercise_id,
      ])[0];
      const doneThisWeek =
        ctx.sql.query<{ n: number }>(
          `SELECT COUNT(DISTINCT substr(s.performed_at, 1, 10)) AS n
             FROM train_set_results r
             JOIN train_sessions s ON s.id = r.session_id
            WHERE r.program_item_id = ? AND s.performed_at >= ?`,
          [item.id, from],
        )[0]?.n ?? 0;
      const targetThisWeek = item.recur_days
        ? item.recur_days.split(',').length
        : (item.recur_per_week ?? 0);
      const dueToday = item.recur_days
        ? item.recur_days.split(',').includes(weekday)
        : doneThisWeek < targetThisWeek;

      out.push({
        programId: program.id,
        programTitle: program.title,
        itemId: item.id,
        exerciseId: item.exercise_id,
        exerciseName: exercise?.name ?? 'Unknown exercise',
        unit: exercise?.unit ?? 'reps',
        targetSets: item.target_sets,
        targetReps: item.target_reps,
        targetLoad: item.target_load,
        recurDays: item.recur_days,
        recurPerWeek: item.recur_per_week,
        dueToday,
        doneThisWeek,
        targetThisWeek,
      });
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// SHARING — the trainee decides what a coach may see, and can take it back.
//
// The table records the DECISION; kernel grants are the enforcement. `ctx.grant`
// is non-escalating by construction: the entity is required, so module code can
// never mint a scope-wide grant, and the caller's own decision on that entity is
// re-checked — a trainee can only hand out what they already hold. Delegation,
// never elevation.
// ---------------------------------------------------------------------------

export const SHARING_MODES = ['none', 'assigned', 'from-now', 'all'] as const;
export type SharingMode = (typeof SHARING_MODES)[number];

export interface SharingRow {
  trainee_id: string;
  coach_id: string;
  mode: SharingMode;
  since: string | null;
  updated_at: string;
}

/** Coaches this trainee shares future sessions with (`from-now` and `all`). */
function futureSharers(ctx: OperationContext, traineeId: string): SharingRow[] {
  return ctx.sql.query<SharingRow>(
    `SELECT * FROM train_sharing WHERE trainee_id = ? AND mode IN ('from-now', 'all')`,
    [traineeId],
  );
}

function coachPrincipal(ctx: OperationContext, coachId: string): PrincipalId | null {
  const row = ctx.sql.query<CoachRow>('SELECT * FROM train_coaches WHERE id = ?', [coachId])[0];
  return row ? (row.principal_id as PrincipalId) : null;
}

/**
 * The COACHING grant: may this coach prescribe to me, record on my behalf, and
 * talk to me. Present in every mode except 'none' — without it a coach cannot
 * even write you a programme, which is the whole reason you engaged one.
 *
 * It grants no reading of your TRAINING: what they may see is the mode. The
 * conversation is not the training, which is why the message keys sit here and
 * not in `ALL_KEYS` — a coach on the strictest setting can still talk to you.
 */
const RELATIONSHIP_KEYS = () =>
  [TRAIN_PERM.resultLog, TRAIN_PERM.messageRead, TRAIN_PERM.messagePost] as const;

/**
 * What 'all' adds: reading, hung on the trainee record so the walk reaches every
 * programme, session and set — past included. `exercise:read` is in here because
 * the exercises you have made and earned are your data too; without it "share
 * everything" would quietly stop at the catalogue.
 */
const ALL_KEYS = () =>
  [TRAIN_PERM.resultRead, TRAIN_PERM.exerciseRead, WO.read] as const;

export const setSharingInput = z.object({
  coachId: z.string().min(1),
  mode: z.enum(SHARING_MODES),
});

/**
 * Choose what a coach sees. Always run BY THE TRAINEE — there is no id for whose
 * sharing, it is resolved from `ctx.principal`, so this operation cannot alter
 * anyone else's.
 *
 * Mode by mode:
 *   'none'      end it. Every grant this trainee ever made that coach is
 *               withdrawn, including the right to prescribe. What survives is
 *               the workorder -> coach edge on programmes that coach already
 *               wrote — their own prescription record, which module code has no
 *               un-link for. Say so in the UI rather than implying a clean slate.
 *   'assigned'  they may prescribe and record, and see the programmes THEY wrote
 *               — nothing else of yours.
 *   'from-now'  same, plus every session created after this moment is granted as
 *               it is logged. Nothing retroactive: yesterday stays private.
 *   'all'       grants on the trainee record itself, which the walk reaches from
 *               every program, session and set — past included. Revocable.
 */
const setSharingOp: OperationHandler<z.infer<typeof setSharingInput>, SharingRow> = async (
  ctx,
  rawInput,
) => {
  assertAllowed(await ctx.check(TRAIN_PERM.shareManage));
  const input = setSharingInput.parse(rawInput);
  const me = requireTrainee(ctx);
  const coach = ctx.sql.query<CoachRow>('SELECT * FROM train_coaches WHERE id = ?', [
    input.coachId,
  ])[0];
  if (!coach) throw new Error(`coach not found: ${input.coachId}`);
  const principal = coach.principal_id as PrincipalId;
  const traineeRef: EntityRef = { entityType: 'trainee', entityId: me.id };

  // Start from nothing, every time: revoking first makes a downgrade real
  // rather than additive, and makes the operation idempotent.
  for (const key of [...RELATIONSHIP_KEYS(), ...ALL_KEYS()]) {
    await ctx.revoke(principal, key, traineeRef);
  }
  for (const session of ctx.sql.query<SessionRow>(
    'SELECT * FROM train_sessions WHERE trainee_id = ?',
    [me.id],
  )) {
    await ctx.revoke(principal, TRAIN_PERM.resultRead, {
      entityType: 'session',
      entityId: session.id,
    });
  }
  // …and the per-PROGRAMME identity grants that 'from-now' minted along the way.
  // Forgetting these was a real leak: a downgraded coach kept seeing that a
  // programme existed and what it prescribed, with none of its sessions. A
  // revoke of a grant that was never made is a no-op, so this is safe to run for
  // every programme, and the ones the coach AUTHORED are reached by an edge
  // rather than a grant — untouched here, deliberately (see the doc above).
  for (const program of listOrders(ctx)) {
    if (program.customer.entityId !== me.id) continue;
    await ctx.revoke(principal, WO.read, { entityType: 'workorder', entityId: program.id });
  }

  const now = new Date().toISOString();
  if (input.mode !== 'none') {
    for (const key of RELATIONSHIP_KEYS()) await ctx.grant(principal, key, traineeRef);
  }
  if (input.mode === 'all') {
    for (const key of ALL_KEYS()) await ctx.grant(principal, key, traineeRef);
  }

  if (input.mode === 'none') {
    ctx.sql.exec('DELETE FROM train_sharing WHERE trainee_id = ? AND coach_id = ?', [
      me.id,
      coach.id,
    ]);
  } else {
    ctx.sql.exec(
      `INSERT INTO train_sharing (trainee_id, coach_id, mode, since, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(trainee_id, coach_id) DO UPDATE SET mode = excluded.mode,
         since = excluded.since, updated_at = excluded.updated_at`,
      [me.id, coach.id, input.mode, input.mode === 'from-now' ? now : null, now],
    );
  }
  ctx.emit({
    type: 'stride.sharing-changed',
    schemaVersion: 1,
    entity: traineeRef,
    piiClass: 'pseudonymous',
    subjectId: dataSubjectId.parse(me.id),
    payload: {
      traineeId: me.id,
      traineeName: me.name,
      coachId: coach.id,
      coachName: coach.name,
      mode: input.mode,
      since: input.mode === 'from-now' ? now : null,
    },
  });
  return (
    ctx.sql.query<SharingRow>(
      'SELECT * FROM train_sharing WHERE trainee_id = ? AND coach_id = ?',
      [me.id, coach.id],
    )[0] ?? {
      trainee_id: me.id,
      coach_id: coach.id,
      mode: 'none' as SharingMode,
      since: null,
      updated_at: now,
    }
  );
};

export type SharingView = SharingRow & { coachName: string };

/** Who I share with, and how much. Mine only — resolved from the principal. */
const mySharingOp: OperationHandler<undefined, SharingView[]> = async (ctx) => {
  assertAllowed(await ctx.check(TRAIN_PERM.shareManage));
  const me = traineeOf(ctx);
  if (!me) return [];
  return ctx.sql
    .query<SharingRow>('SELECT * FROM train_sharing WHERE trainee_id = ? ORDER BY updated_at', [
      me.id,
    ])
    .map((r) => ({
      ...r,
      coachName:
        ctx.sql.query<CoachRow>('SELECT * FROM train_coaches WHERE id = ?', [r.coach_id])[0]?.name ??
        'Unknown coach',
    }));
};

// ---------------------------------------------------------------------------
// INVITES — composed from engine-invites, which owns the parts that are easy to
// get wrong: the identifier is hashed with this scope's own salt and never
// stored in the clear, an invitation confers nothing until accepted, and the
// sender is never told whether the address exists. That last one is why
// `stride/invite` returns an id and nothing else.
//
// ONE ORG PER SCOPE. The engine keys invitations by org; this vertical has no
// sub-organisations, so the scope IS the org and the id needs no configuration.
// ---------------------------------------------------------------------------

const orgOf = (ctx: OperationContext): OrgId => orgId.parse(ctx.scopeId);

export const inviteInput = z.object({
  /** An email or phone. Hashed before it touches storage. */
  identifier: z.string().min(3),
  as: z.enum(['coach', 'trainee']),
});

/**
 * Invite someone. A coach invites trainees; a trainee invites a coach; an admin
 * may do either. The direction is checked here rather than left to the role,
 * because "a coach invited me" and "I invited a coach" end in different places:
 * only the second leaves the trainee deciding what to share.
 */
const inviteOp: OperationHandler<z.infer<typeof inviteInput>, { id: string }> = async (
  ctx,
  rawInput,
) => {
  assertAllowed(await ctx.check(INVITES_PERM.send));
  const input = inviteInput.parse(rawInput);
  const asCoach = coachOf(ctx);
  const asTrainee = traineeOf(ctx);
  if (asCoach && input.as === 'coach') {
    throw new PermissionDenied('permission denied: a coach invites trainees, not other coaches');
  }
  if (!asCoach && asTrainee && input.as === 'trainee') {
    throw new PermissionDenied('permission denied: a trainee invites a coach, not other trainees');
  }
  const sent = await sendInvite(ctx, {
    orgId: orgOf(ctx),
    identifier: input.identifier,
    roleKey: input.as,
  });
  ctx.emit({
    type: 'stride.invited',
    schemaVersion: 1,
    entity: { entityType: 'invitation', entityId: sent.id },
    piiClass: 'none', // the identifier is hashed inside the engine and never travels
    payload: {
      invitationId: sent.id,
      as: input.as,
      invitedByCoach: asCoach?.id ?? null,
      invitedByTrainee: asTrainee?.id ?? null,
    },
  });
  return sent;
};

const invitationsOp: OperationHandler<undefined, Invitation[]> = async (ctx) => {
  assertAllowed(await ctx.check(INVITES_PERM.read));
  return listInvites(ctx, orgOf(ctx));
};

const revokeInviteInput = z.object({ invitationId: z.string().min(1) });

const revokeInviteOp: OperationHandler<z.infer<typeof revokeInviteInput>, { ok: true }> = async (
  ctx,
  rawInput,
) => {
  assertAllowed(await ctx.check(INVITES_PERM.revoke));
  revokeInvite(ctx, revokeInviteInput.parse(rawInput).invitationId);
  return { ok: true };
};

const acceptInput = z.object({
  invitationId: z.string().min(1),
  /** Re-presented and re-hashed: an invitation id alone must not be a bearer token. */
  identifier: z.string().min(3),
  name: z.string().min(1),
  number: z.string().optional(),
});

/**
 * Accept, as the recipient. NO PERMISSION CHECK PRECEDES THIS, deliberately —
 * the invitation IS the authorization, and requiring a permission first would
 * mean only people already inside could join. What stands in for it is the
 * engine's own re-hash of the identifier, which is why `identifier` is required
 * again here.
 *
 * Then the vertical's half, in the same transaction: create the record this
 * person will be, and — when they are the TRAINEE — record the default floor
 * with the coach who invited them. When the accepter is the COACH, no sharing is
 * set at all: only the trainee may open their own data, and inventing a default
 * here would be that decision taken by someone else.
 *
 * The role and the new person's own entity grants are enqueued as a PLATFORM
 * INTENT rather than granted here — see the comment at `requestPlatform` below.
 * Until the platform drains it they are a record with no permissions, which is
 * the correct intermediate state rather than a bug.
 */
const acceptInviteOp: OperationHandler<
  z.infer<typeof acceptInput>,
  { as: string; recordId: string; sharedWithInviter: boolean }
> = async (ctx, rawInput) => {
  const input = acceptInput.parse(rawInput);
  const invitation = await acceptInvite(ctx, {
    invitationId: input.invitationId,
    identifier: input.identifier,
  });
  const now = new Date().toISOString();
  const id = ulid();

  if (invitation.role_key === 'coach') {
    ctx.sql.exec(
      'INSERT INTO train_coaches (id, principal_id, name, created_at) VALUES (?, ?, ?, ?)',
      [id, ctx.principal, input.name, now],
    );
    ctx.emit({
      type: 'stride.joined',
      schemaVersion: 1,
      entity: { entityType: 'coach', entityId: id },
      piiClass: 'direct',
      subjectId: dataSubjectId.parse(id),
      payload: { as: 'coach', coachId: id, name: input.name, invitationId: invitation.id },
    });
    ctx.requestPlatform({
      kind: 'stride:onboard',
      payload: {
        principal: ctx.principal,
        as: 'coach',
        recordId: id,
        roleKey: invitation.role_key,
        inviterCoachPrincipal: null,
      },
    });
    return { as: 'coach', recordId: id, sharedWithInviter: false };
  }

  // The inviter was a coach: this trainee is joining them.
  const inviter = ctx.sql.query<CoachRow>('SELECT * FROM train_coaches WHERE principal_id = ?', [
    invitation.invited_by,
  ])[0];
  const number =
    input.number ??
    String(
      1000 +
        (ctx.sql.query<{ n: number }>('SELECT COUNT(*) AS n FROM train_trainees')[0]?.n ?? 0) +
        1,
    );
  ctx.sql.exec(
    `INSERT INTO train_trainees (id, number, name, contact, coach_id, principal_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, number, input.name, null, inviter?.id ?? null, ctx.principal, now],
  );
  ctx.emit({
    type: 'stride.joined',
    schemaVersion: 1,
    entity: { entityType: 'trainee', entityId: id },
    piiClass: 'direct',
    subjectId: dataSubjectId.parse(id),
    payload: {
      as: 'trainee',
      traineeId: id,
      name: input.name,
      coachId: inviter?.id ?? null,
      invitationId: invitation.id,
    },
  });

  if (inviter) {
    ctx.sql.exec(
      `INSERT INTO train_sharing (trainee_id, coach_id, mode, since, updated_at)
       VALUES (?, ?, 'assigned', NULL, ?)`,
      [id, inviter.id, now],
    );
  }

  // Why this is an INTENT and not a `ctx.grant`: a grant delegates, it never
  // elevates — and someone who joined thirty milliseconds ago holds nothing on
  // their own record to delegate. Their own entity grants, and the role that
  // goes with them, are the platform's to mint. So the vertical records what it
  // decided and asks; the platform executes it with HostAdmin authority and
  // settles the row. Atomic with this transaction: an acceptance that rolls back
  // never asks for anything.
  ctx.requestPlatform({
    kind: 'stride:onboard',
    payload: {
      principal: ctx.principal,
      as: 'trainee',
      recordId: id,
      roleKey: invitation.role_key,
      inviterCoachPrincipal: inviter?.principal_id ?? null,
    },
  });
  return { as: 'trainee', recordId: id, sharedWithInviter: Boolean(inviter) };
};

// ---------------------------------------------------------------------------
// PER-SET TARGETS — for when the sets differ from one another.
// ---------------------------------------------------------------------------

const itemSetsInput = z.object({
  itemId: z.string().min(1),
  sets: z
    .array(
      z.object({
        reps: z.number().int().positive(),
        load: decimalString.optional(),
        note: z.string().optional(),
      }),
    )
    .min(1)
    .max(20),
});

/**
 * Replace an item's prescription with an explicit list of sets — a ramp
 * (10@60, 8@70, 6@80), a drop set, a rehab ladder. `target_sets` is kept in step
 * with the count so everything that reads the uniform shape — adherence, the
 * schedule, the badge on the card — stays right without knowing about this table.
 *
 * Gated exactly like the item it belongs to: on a programme, the narrowed
 * `result:log` for that programme; on a template, `library:author` plus the
 * narrowed `template:read`.
 */
const setItemSetsOp: OperationHandler<
  z.infer<typeof itemSetsInput>,
  { itemId: string; sets: ItemSetRow[] }
> = async (ctx, rawInput) => {
  const input = itemSetsInput.parse(rawInput);
  const programItem = ctx.sql.query<ItemRow>('SELECT * FROM train_program_items WHERE id = ?', [
    input.itemId,
  ])[0];
  const templateItem = programItem
    ? undefined
    : ctx.sql.query<ItemRow>('SELECT * FROM train_template_items WHERE id = ?', [input.itemId])[0];
  if (!programItem && !templateItem) throw new Error(`item not found: ${input.itemId}`);

  if (programItem) {
    assertAllowed(
      await ctx.check(TRAIN_PERM.resultLog, {
        entityType: 'workorder',
        entityId: programItem.program_id!,
      }),
    );
    const program = programOf(ctx, programItem.program_id!);
    if (program.status !== 'planned' && program.status !== 'in_progress') {
      throw new Error(`invalid transition: a ${program.status} programme takes no new sets`);
    }
  } else {
    assertAllowed(await ctx.check(TRAIN_PERM.libraryAuthor));
    assertAllowed(
      await ctx.check(TRAIN_PERM.templateRead, {
        entityType: 'template',
        entityId: templateItem!.template_id!,
      }),
    );
  }

  const kind = programItem ? 'program' : 'template';
  ctx.sql.exec('DELETE FROM train_item_sets WHERE item_id = ?', [input.itemId]);
  input.sets.forEach((set, i) => {
    ctx.sql.exec(
      `INSERT INTO train_item_sets (id, item_id, item_kind, set_no, target_reps, target_load, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [ulid(), input.itemId, kind, i + 1, set.reps, set.load ?? null, set.note ?? null],
    );
  });
  // Keep the uniform columns honest: everything that reads them — adherence, the
  // schedule, the card — should agree with what is actually prescribed.
  const table = programItem ? 'train_program_items' : 'train_template_items';
  ctx.sql.exec(`UPDATE ${table} SET target_sets = ?, target_reps = ? WHERE id = ?`, [
    input.sets.length,
    input.sets[0]!.reps,
    input.itemId,
  ]);

  const sets = ctx.sql.query<ItemSetRow>(
    'SELECT * FROM train_item_sets WHERE item_id = ? ORDER BY set_no',
    [input.itemId],
  );
  ctx.emit({
    type: 'stride.item-sets-set',
    schemaVersion: 1,
    entity: programItem
      ? { entityType: 'workorder', entityId: programItem.program_id! }
      : { entityType: 'template', entityId: templateItem!.template_id! },
    piiClass: 'none',
    payload: {
      itemId: input.itemId,
      kind,
      sets: sets.map((r) => ({ setNo: r.set_no, reps: r.target_reps, load: r.target_load })),
    },
  });
  return { itemId: input.itemId, sets };
};

// ---------------------------------------------------------------------------
// ONBOARDING — what you are training for, and how often.
// ---------------------------------------------------------------------------

export const GOALS = ['strength', 'muscle', 'endurance', 'rehab', 'general'] as const;

export const onboardInput = z.object({
  goal: z.enum(GOALS),
  daysPerWeek: z.number().int().min(1).max(7),
});

/**
 * Answer the two questions that shape everything after: what is this for, and
 * how often can you actually train. Like the other self-serve operations it
 * takes NO id for whose — it is the caller's, so it cannot answer for anyone
 * else.
 *
 * These are used to PREFILL a schedule, never to enforce one: a plan you missed
 * is a fact to show, not an error to raise.
 */
const onboardOp: OperationHandler<z.infer<typeof onboardInput>, TraineeRow> = async (
  ctx,
  rawInput,
) => {
  assertAllowed(await ctx.check(TRAIN_PERM.shareManage));
  const input = onboardInput.parse(rawInput);
  const me = requireTrainee(ctx);
  const now = new Date().toISOString();
  ctx.sql.exec(
    'UPDATE train_trainees SET goal = ?, days_per_week = ?, onboarded_at = ? WHERE id = ?',
    [input.goal, input.daysPerWeek, now, me.id],
  );
  ctx.emit({
    type: 'stride.onboarded',
    schemaVersion: 1,
    entity: { entityType: 'trainee', entityId: me.id },
    piiClass: 'pseudonymous',
    subjectId: dataSubjectId.parse(me.id),
    payload: { traineeId: me.id, goal: input.goal, daysPerWeek: input.daysPerWeek },
  });
  return ctx.sql.query<TraineeRow>('SELECT * FROM train_trainees WHERE id = ?', [me.id])[0]!;
};

/** Me, as the app knows me — or null if this principal is not a trainee. */
const meOp: OperationHandler<undefined, TraineeRow | null> = async (ctx) => {
  return traineeOf(ctx) ?? null;
};

/** Who the signed-in person is, in this gym's vocabulary. */
export interface WhoAmI {
  principal: string;
  role: 'admin' | 'coach' | 'trainee';
  /** The name on their coach or trainee record; an admin has neither. */
  name: string | null;
  /** Their coach or trainee record id — the entity everything of theirs hangs from. */
  recordId: string | null;
}

/**
 * WHO AM I — the deployed app's first call, and the production counterpart of the
 * harness's dev-cast route.
 *
 * The ROLE is not a column anywhere, and deliberately so: you are a coach because
 * a coach record carries your principal, a trainee because a trainee record does,
 * and an admin because you are neither and still hold the key every member of the
 * gym holds. That key is the check — someone with no role at all is denied here,
 * which is the correct answer to "who am I in this gym" from a person who is not
 * in it, and it arrives as a denial rather than as an empty profile.
 */
const whoamiOp: OperationHandler<undefined, WhoAmI> = async (ctx) => {
  assertAllowed(await ctx.check(TRAIN_PERM.exerciseReadShared));
  const coach = coachOf(ctx);
  if (coach) return { principal: ctx.principal, role: 'coach', name: coach.name, recordId: coach.id };
  const trainee = traineeOf(ctx);
  if (trainee)
    return { principal: ctx.principal, role: 'trainee', name: trainee.name, recordId: trainee.id };
  return { principal: ctx.principal, role: 'admin', name: null, recordId: null };
};

// ---------------------------------------------------------------------------
// TRAINING SLOTS — the appointment, as opposed to the dose.
//
// `recur_days` on an ITEM says how often an exercise comes round. A SLOT says
// when you actually train: Wednesday at 11. They answer different questions and
// a programme needs both — three sessions a week, on these days, at this time.
// ---------------------------------------------------------------------------

export interface SlotRow {
  id: string;
  program_id: string;
  weekday: number;
  time_of_day: string;
  created_at: string;
}

const slotsInput = z.object({
  programId: z.string().min(1),
  slots: z
    .array(
      z.object({
        weekday: z.number().int().min(1).max(7),
        /** Local wall clock. No zone — see the note in migration 0007. */
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "a time like '11:00'"),
      }),
    )
    .max(14),
});

/**
 * Replace a programme's training slots. Gated by the narrowed `result:log` on
 * the programme, so it is the same door as logging into it: your own, your
 * trainees', or — for an admin — anyone's.
 */
const setProgramSlotsOp: OperationHandler<
  z.infer<typeof slotsInput>,
  { programId: string; slots: SlotRow[] }
> = async (ctx, rawInput) => {
  const input = slotsInput.parse(rawInput);
  assertAllowed(
    await ctx.check(TRAIN_PERM.resultLog, { entityType: 'workorder', entityId: input.programId }),
  );
  const program = programOf(ctx, input.programId);
  if (program.status !== 'planned' && program.status !== 'in_progress') {
    throw new Error(`invalid transition: a ${program.status} programme keeps no schedule`);
  }
  const now = new Date().toISOString();
  ctx.sql.exec('DELETE FROM train_program_slots WHERE program_id = ?', [input.programId]);
  // Dedupe rather than let the UNIQUE constraint surface as a raw SQLite error:
  // picking Wednesday twice is a slip, not something to refuse.
  const seen = new Set<string>();
  for (const slot of input.slots) {
    const key = `${slot.weekday}@${slot.time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ctx.sql.exec(
      `INSERT INTO train_program_slots (id, program_id, weekday, time_of_day, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [ulid(), input.programId, slot.weekday, slot.time, now],
    );
  }
  const slots = ctx.sql.query<SlotRow>(
    'SELECT * FROM train_program_slots WHERE program_id = ? ORDER BY weekday, time_of_day',
    [input.programId],
  );
  ctx.emit({
    type: 'stride.slots-set',
    schemaVersion: 1,
    entity: { entityType: 'workorder', entityId: input.programId },
    piiClass: 'pseudonymous',
    subjectId: dataSubjectId.parse(program.customer.entityId),
    payload: {
      programId: input.programId,
      traineeId: program.customer.entityId,
      slots: slots.map((s) => ({ weekday: s.weekday, time: s.time_of_day })),
    },
  });
  return { programId: input.programId, slots };
};

export interface AgendaEntry {
  programId: string;
  programTitle: string;
  traineeName: string | null;
  status: string;
  weekday: number;
  time: string;
  dueToday: boolean;
  /** An open session for this programme TODAY, if one has been started. */
  sessionToday: string | null;
  setsToday: number;
  exercises: number;
}

const agendaInput = z.object({ on: z.string().optional() });

/**
 * THE APPOINTMENT BOOK — what training is booked, and whether it has happened.
 *
 * A walk like every other listing: one `ctx.check` per programme, so a trainee
 * sees their own, a coach sees what was shared, an admin the gym, a stranger an
 * empty list. Sorted by time so "next up" is just the first row.
 */
const agendaOp: OperationHandler<z.infer<typeof agendaInput>, AgendaEntry[]> = async (
  ctx,
  rawInput,
) => {
  const input = agendaInput.parse(rawInput ?? {});
  const today = input.on ? new Date(input.on) : new Date();
  if (Number.isNaN(today.getTime())) throw new Error(`not a date: ${input.on}`);
  const weekday = isoWeekday(today);
  const dayStart = today.toISOString().slice(0, 10);

  const out: AgendaEntry[] = [];
  for (const program of listOrders(ctx)) {
    if (program.status !== 'planned' && program.status !== 'in_progress') continue;
    const decision = await ctx.check(WO.read, {
      entityType: 'workorder',
      entityId: program.id,
    });
    if (!decision.allowed) continue;

    const slots = ctx.sql.query<SlotRow>(
      'SELECT * FROM train_program_slots WHERE program_id = ? ORDER BY weekday, time_of_day',
      [program.id],
    );
    if (slots.length === 0) continue;

    const sessionToday =
      ctx.sql.query<SessionRow>(
        `SELECT * FROM train_sessions
          WHERE program_id = ? AND substr(performed_at, 1, 10) = ?
          ORDER BY performed_at DESC LIMIT 1`,
        [program.id, dayStart],
      )[0] ?? null;
    const setsToday = sessionToday
      ? (ctx.sql.query<{ n: number }>(
          'SELECT COUNT(*) AS n FROM train_set_results WHERE session_id = ?',
          [sessionToday.id],
        )[0]?.n ?? 0)
      : 0;
    const exercises =
      ctx.sql.query<{ n: number }>(
        'SELECT COUNT(*) AS n FROM train_program_items WHERE program_id = ?',
        [program.id],
      )[0]?.n ?? 0;
    const trainee = ctx.sql.query<TraineeRow>('SELECT * FROM train_trainees WHERE id = ?', [
      program.customer.entityId,
    ])[0];

    for (const slot of slots) {
      out.push({
        programId: program.id,
        programTitle: program.title,
        traineeName: trainee?.name ?? null,
        status: program.status,
        weekday: slot.weekday,
        time: slot.time_of_day,
        dueToday: slot.weekday === weekday,
        sessionToday: sessionToday?.id ?? null,
        setsToday,
        exercises,
      });
    }
  }
  return out.sort((a, b) =>
    a.weekday === b.weekday ? a.time.localeCompare(b.time) : a.weekday - b.weekday,
  );
};

const beginInput = z.object({ programId: z.string().min(1) });

/**
 * BEGIN — one tap from "it is Wednesday at 11" to logging a set.
 *
 * The three steps a trainee had to do by hand: start the programme if it has not
 * started, reuse today's session if there is one, open a new one if there is not.
 * Each step still runs its own check — this composes the operations, it does not
 * bypass them — and it is idempotent, so pressing it twice on the same day
 * returns the same session rather than fragmenting a workout into two.
 *
 * The programme's own `workorder/start` is NOT reachable from here: that
 * operation carries the manifest guard, and an in-scope shortcut around it would
 * be exactly the hole the guard exists to close. So a `planned` programme is
 * refused with a message telling the caller to start it, rather than quietly
 * started on their behalf.
 */
const beginOp: OperationHandler<
  z.infer<typeof beginInput>,
  { session: SessionRow; resumed: boolean }
> = async (ctx, rawInput) => {
  const input = beginInput.parse(rawInput);
  assertAllowed(
    await ctx.check(TRAIN_PERM.resultLog, { entityType: 'workorder', entityId: input.programId }),
  );
  const program = programOf(ctx, input.programId);
  if (program.status !== 'in_progress') {
    throw new Error(
      `invalid transition: a ${program.status} programme cannot be trained — start it first`,
    );
  }
  const today = new Date().toISOString().slice(0, 10);
  const existing = ctx.sql.query<SessionRow>(
    `SELECT * FROM train_sessions
      WHERE program_id = ? AND substr(performed_at, 1, 10) = ?
      ORDER BY performed_at DESC LIMIT 1`,
    [program.id, today],
  )[0];
  if (existing) return { session: existing, resumed: true };

  const session = (await (logSessionOp as OperationHandler<{ programId: string }, SessionRow>)(
    ctx,
    { programId: program.id },
  )) as SessionRow;
  return { session, resumed: false };
};

// ---------------------------------------------------------------------------
// THE CONVERSATION — one thread per (trainee, coach) pair.
//
// Both keys are entity-narrowed on the TRAINEE record, and both ride the sharing
// relationship: they are granted when a trainee connects with a coach and
// withdrawn at mode 'none'. So the inbox and the permission model are the same
// thing — end the relationship and the conversation closes, without a second
// rule to keep in step.
// ---------------------------------------------------------------------------

export interface MessageRow {
  id: string;
  trainee_id: string;
  coach_id: string;
  author: string;
  body: string;
  created_at: string;
}

export interface ThreadView {
  traineeId: string;
  traineeName: string;
  coachId: string;
  coachName: string;
  lastMessage: string | null;
  lastAt: string | null;
  unread: number;
}

const threadInput = z.object({
  traineeId: z.string().min(1),
  coachId: z.string().min(1),
});

function threadPeople(
  ctx: OperationContext,
  traineeId: string,
  coachId: string,
): { trainee: TraineeRow; coach: CoachRow } {
  const trainee = ctx.sql.query<TraineeRow>('SELECT * FROM train_trainees WHERE id = ?', [
    traineeId,
  ])[0];
  if (!trainee) throw new Error(`trainee not found: ${traineeId}`);
  const coach = ctx.sql.query<CoachRow>('SELECT * FROM train_coaches WHERE id = ?', [coachId])[0];
  if (!coach) throw new Error(`coach not found: ${coachId}`);
  return { trainee, coach };
}

const postMessageInput = threadInput.extend({ body: z.string().min(1).max(4000) });

const postMessageOp: OperationHandler<z.infer<typeof postMessageInput>, MessageRow> = async (
  ctx,
  rawInput,
) => {
  const input = postMessageInput.parse(rawInput);
  assertAllowed(
    await ctx.check(TRAIN_PERM.messagePost, { entityType: 'trainee', entityId: input.traineeId }),
  );
  const { trainee, coach } = threadPeople(ctx, input.traineeId, input.coachId);
  // A conversation needs a relationship. Without this a coach who holds the key
  // through some OTHER trainee could open a thread with anyone.
  const share = ctx.sql.query<SharingRow>(
    'SELECT * FROM train_sharing WHERE trainee_id = ? AND coach_id = ?',
    [trainee.id, coach.id],
  )[0];
  if (!share) {
    throw new PermissionDenied(
      'permission denied: no coaching relationship with that coach — nothing to talk in',
    );
  }

  const id = ulid();
  const now = new Date().toISOString();
  ctx.sql.exec(
    `INSERT INTO train_messages (id, trainee_id, coach_id, author, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, trainee.id, coach.id, ctx.principal, input.body, now],
  );
  // Writing counts as reading everything before it.
  ctx.sql.exec(
    `INSERT INTO train_thread_reads (trainee_id, coach_id, principal_id, last_read_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(trainee_id, coach_id, principal_id) DO UPDATE SET last_read_at = excluded.last_read_at`,
    [trainee.id, coach.id, ctx.principal, now],
  );
  ctx.emit({
    type: 'stride.message-posted',
    schemaVersion: 1,
    entity: { entityType: 'trainee', entityId: trainee.id },
    // The body is a person writing about their body and their injuries. That is
    // direct PII, and the event carries a subject so an erasure can key on it.
    piiClass: 'direct',
    subjectId: dataSubjectId.parse(trainee.id),
    payload: {
      messageId: id,
      traineeId: trainee.id,
      coachId: coach.id,
      author: ctx.principal,
      body: input.body,
    },
  });
  return ctx.sql.query<MessageRow>('SELECT * FROM train_messages WHERE id = ?', [id])[0]!;
};

/** One thread, oldest first. Reading it marks it read for the caller. */
const messagesOp: OperationHandler<
  z.infer<typeof threadInput>,
  { messages: MessageRow[]; me: string }
> = async (ctx, rawInput) => {
  const input = threadInput.parse(rawInput);
  assertAllowed(
    await ctx.check(TRAIN_PERM.messageRead, { entityType: 'trainee', entityId: input.traineeId }),
  );
  threadPeople(ctx, input.traineeId, input.coachId);
  const messages = ctx.sql.query<MessageRow>(
    'SELECT * FROM train_messages WHERE trainee_id = ? AND coach_id = ? ORDER BY created_at, id',
    [input.traineeId, input.coachId],
  );
  ctx.sql.exec(
    `INSERT INTO train_thread_reads (trainee_id, coach_id, principal_id, last_read_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(trainee_id, coach_id, principal_id) DO UPDATE SET last_read_at = excluded.last_read_at`,
    [input.traineeId, input.coachId, ctx.principal, new Date().toISOString()],
  );
  return { messages, me: ctx.principal };
};

/**
 * The inbox. A walk like every other listing: one `ctx.check` per conversation,
 * so a trainee sees their coaches, a coach sees the trainees who connected with
 * them, an admin sees the gym, and a stranger sees nothing.
 */
const threadsOp: OperationHandler<undefined, ThreadView[]> = async (ctx) => {
  const out: ThreadView[] = [];
  for (const share of ctx.sql.query<SharingRow>('SELECT * FROM train_sharing')) {
    const decision = await ctx.check(TRAIN_PERM.messageRead, {
      entityType: 'trainee',
      entityId: share.trainee_id,
    });
    if (!decision.allowed) continue;
    const { trainee, coach } = threadPeople(ctx, share.trainee_id, share.coach_id);
    const last = ctx.sql.query<MessageRow>(
      'SELECT * FROM train_messages WHERE trainee_id = ? AND coach_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
      [trainee.id, coach.id],
    )[0];
    const read = ctx.sql.query<{ last_read_at: string }>(
      'SELECT last_read_at FROM train_thread_reads WHERE trainee_id = ? AND coach_id = ? AND principal_id = ?',
      [trainee.id, coach.id, ctx.principal],
    )[0];
    const unread =
      ctx.sql.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM train_messages
          WHERE trainee_id = ? AND coach_id = ? AND author != ? AND created_at > ?`,
        [trainee.id, coach.id, ctx.principal, read?.last_read_at ?? ''],
      )[0]?.n ?? 0;
    out.push({
      traineeId: trainee.id,
      traineeName: trainee.name,
      coachId: coach.id,
      coachName: coach.name,
      lastMessage: last?.body ?? null,
      lastAt: last?.created_at ?? null,
      unread,
    });
  }
  return out.sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));
};

const timelineInput = z.object({
  entityType: z.string().min(1),
  entityId: z.string().min(1),
});

/**
 * An entity's event timeline, read straight off the audit spine. Reading
 * `_substrat_*` for a projection is allowed; writing it is not. Gated by the
 * same per-entity check as everything else, so the timeline obeys the walk.
 */
const timelineOp: OperationHandler<
  z.infer<typeof timelineInput>,
  { type: string; occurred_at: string; actor: string }[]
> = async (ctx, rawInput) => {
  const entity = timelineInput.parse(rawInput);
  // A workorder timeline is program-identity; anything else is results.
  const key = entity.entityType === 'workorder' ? WO.read : TRAIN_PERM.resultRead;
  assertAllowed(await ctx.check(key, entity));
  // Append order is authoritative — rowid, not ULID (ids minted in the same
  // millisecond are not mutually ordered).
  return ctx.sql.query(
    `SELECT type, occurred_at, actor FROM _substrat_outbox
      WHERE entity_type = ? AND entity_id = ? ORDER BY rowid`,
    [entity.entityType, entity.entityId],
  );
};

// ---------------------------------------------------------------------------
// THE GUARD (manifest.ts declares where it runs).
//
// engine-workorder checks `workorder:report` / `:assign` at NODE level — right
// for the workshop it was built for, where every technician is a peer. Here a
// coach is narrowed to their own trainees, so without this the narrowing would
// hold for listings and leak for writes: any coach could start or report on any
// program whose id they knew.
//
// The predicate re-checks `result:log` against the program AS AN ENTITY, so the
// walk workorder → trainee → coach decides. It runs inside the operation's own
// transaction, before the handler, and a throw rolls the whole thing back.
// ---------------------------------------------------------------------------

const programInReach: GuardPredicate = async (ctx, _config, input) => {
  const orderId = (input as { orderId?: unknown } | null | undefined)?.orderId;
  if (typeof orderId !== 'string' || orderId.length === 0) {
    throw new PermissionDenied('permission denied: guarded operation carried no program id');
  }
  assertAllowed(
    await ctx.check(TRAIN_PERM.resultLog, { entityType: 'workorder', entityId: orderId }),
  );
};

export const strideModule: ModuleRegistration = {
  manifest: strideManifest,
  migrations: strideMigrations,
  predicates: { [PROGRAM_IN_REACH]: programInReach },
  operations: {
    'stride/equipment': equipmentOp as never,
    'stride/publish-equipment': publishEquipmentOp as never,
    'stride/set-my-equipment': setMyEquipmentOp as never,
    'stride/set-exercise-equipment': setExerciseEquipmentOp as never,
    'stride/create-coach': createCoachOp as never,
    'stride/create-trainee': createTraineeOp as never,
    'stride/assign-to-coach': assignToCoachOp as never,
    'stride/coaches': coachesOp as never,
    'stride/trainees': traineesOp as never,
    'stride/publish-exercise': publishExerciseOp as never,
    'stride/author-exercise': authorExerciseOp as never,
    'stride/retire-exercise': retireExerciseOp as never,
    'stride/exercises': exercisesOp as never,
    'stride/my-exercises': myExercisesOp as never,
    'stride/publish-template': publishTemplateOp as never,
    'stride/author-template': authorTemplateOp as never,
    'stride/add-template-item': addTemplateItemOp as never,
    'stride/templates': templatesOp as never,
    'stride/assign-program': assignProgramOp as never,
    'stride/add-program-item': addProgramItemOp as never,
    'stride/log-session': logSessionOp as never,
    'stride/log-set': logSetOp as never,
    'stride/complete-program': completeProgramOp as never,
    'stride/get-program': getProgramOp as never,
    'stride/my-programs': myProgramsOp as never,
    'stride/schedule': scheduleOp as never,
    'stride/agenda': agendaOp as never,
    'stride/set-program-slots': setProgramSlotsOp as never,
    'stride/begin': beginOp as never,
    'stride/invite': inviteOp as never,
    'stride/invitations': invitationsOp as never,
    'stride/revoke-invite': revokeInviteOp as never,
    'stride/accept-invite': acceptInviteOp as never,
    'stride/set-item-sets': setItemSetsOp as never,
    'stride/onboard': onboardOp as never,
    'stride/me': meOp as never,
    'stride/whoami': whoamiOp as never,
    'stride/threads': threadsOp as never,
    'stride/messages': messagesOp as never,
    'stride/post-message': postMessageOp as never,
    'stride/set-sharing': setSharingOp as never,
    'stride/my-sharing': mySharingOp as never,
    'stride/timeline': timelineOp as never,
  },
};
