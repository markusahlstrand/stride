import { defineEntities, z } from '@substrat-run/contracts';

// ============================================================================
// The vertical's ENTITY REGISTRY — what exists, as data.
//
// `src/migrations.ts` creates the tables and stays the source of truth for the
// SQL; this file is the DECLARATION of the same rows, and the two are held to
// each other by `test/model.test.ts`, which applies every migration to a real
// SQLite database and compares it column by column. A field added here without
// a migration — or a column added there without a field — goes red.
//
// It is emitted to `model.json` (`pnpm lint:model`) and that artifact is what
// `substrat push` carries, which is what the dashboard's Model tab reads. A
// vertical with no `model.json` deploys fine and shows nothing there.
//
// Field names mirror the SQL columns exactly, snake_case included: a prettier
// domain naming here would be a second description of the same rows.
//
//   `parents` is the permission graph, NOT the foreign keys.
//
// It is the allowlist `ctx.link` is checked against, so it carries only the
// edges permission actually flows along — `exercise → trainee` is here because
// performing an exercise earns it for ever, while `set_result → session` is a
// foreign key that no grant ever walks and is therefore absent. `manifest.ts`
// derives `entityRelations` from these, so they are stated once. The edges that
// involve the ENGINE's work order (`workorder → trainee`, `session → workorder`)
// cannot be declared here — `workorder` is not ours — and live in the
// `relations` list beside them.
// ============================================================================

export const strideEntities = defineEntities({
  /** The staff member, as an entity, so a coach can hold a grant on themselves. */
  coach: {
    table: 'train_coaches',
    fields: z.object({
      id: z.string(),
      principal_id: z.string(),
      name: z.string(),
      created_at: z.string(),
    }),
    key: ['principal_id'],
    erasable: ['name'],
  },

  /**
   * `principal_id` is unique too (`train_trainees_principal`). `key` holds one
   * natural key, and `number` is the one a human quotes.
   */
  trainee: {
    table: 'train_trainees',
    fields: z.object({
      id: z.string(),
      number: z.string(),
      name: z.string(),
      contact: z.string().nullable(),
      coach_id: z.string().nullable(),
      created_at: z.string(),
      principal_id: z.string().nullable(),
      goal: z.string().nullable(),
      days_per_week: z.number().nullable(),
      onboarded_at: z.string().nullable(),
    }),
    key: ['number'],
    erasable: ['name', 'contact'],
  },

  /**
   * `shared` is published gym-wide and reached by a node-level key; `private` is
   * reached only by the walk — which is the same edge whether you authored the
   * exercise or earned it by performing it.
   */
  exercise: {
    table: 'train_exercises',
    fields: z.object({
      id: z.string(),
      slug: z.string(),
      name: z.string(),
      modality: z.string(),
      unit: z.string(),
      description: z.string().nullable(),
      visibility: z.string(),
      owner_coach_id: z.string().nullable(),
      active: z.number(),
      created_by: z.string(),
      created_at: z.string(),
      owner_trainee_id: z.string().nullable(),
      laterality: z.string(),
    }),
    parents: ['coach', 'trainee'],
    key: ['slug'],
  },

  /** The equipment vocabulary. Keyed by its slug — it has no id of its own. */
  equipment: {
    table: 'train_equipment',
    fields: z.object({
      slug: z.string(),
      name: z.string(),
      category: z.string(),
      created_at: z.string(),
    }),
    primaryKey: ['slug'],
  },

  /** What an exercise needs. No rows = bodyweight. */
  exerciseEquipment: {
    table: 'train_exercise_equipment',
    fields: z.object({
      exercise_id: z.string(),
      equipment_slug: z.string(),
    }),
    primaryKey: ['exercise_id', 'equipment_slug'],
  },

  /** What a person has. `owner_type` is 'coach' or 'trainee'. */
  accountEquipment: {
    table: 'train_account_equipment',
    fields: z.object({
      owner_type: z.string(),
      owner_id: z.string(),
      equipment_slug: z.string(),
    }),
    primaryKey: ['owner_type', 'owner_id', 'equipment_slug'],
  },

  /** A reusable prescription, tied to nobody. The UI calls it a plan. */
  template: {
    table: 'train_templates',
    fields: z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      visibility: z.string(),
      owner_coach_id: z.string().nullable(),
      created_by: z.string(),
      created_at: z.string(),
      owner_trainee_id: z.string().nullable(),
    }),
    parents: ['coach', 'trainee'],
  },

  templateItem: {
    table: 'train_template_items',
    fields: z.object({
      id: z.string(),
      template_id: z.string(),
      exercise_id: z.string(),
      position: z.number(),
      target_sets: z.number(),
      target_reps: z.number(),
      target_load: z.string().nullable(),
      notes: z.string().nullable(),
      recur_days: z.string().nullable(),
      recur_per_week: z.number().nullable(),
      group_key: z.string().nullable(),
    }),
  },

  /**
   * The prescription, SNAPSHOT from a template at assignment. `program_id` is
   * the engine's work order id and carries no foreign key — an engine's tables
   * are private (rule 4).
   */
  programItem: {
    table: 'train_program_items',
    fields: z.object({
      id: z.string(),
      program_id: z.string(),
      exercise_id: z.string(),
      position: z.number(),
      target_sets: z.number(),
      target_reps: z.number(),
      target_load: z.string().nullable(),
      notes: z.string().nullable(),
      recur_days: z.string().nullable(),
      recur_per_week: z.number().nullable(),
      group_key: z.string().nullable(),
    }),
  },

  /** Explicit sets, where a prescription's sets differ from each other. */
  itemSet: {
    table: 'train_item_sets',
    fields: z.object({
      id: z.string(),
      item_id: z.string(),
      item_kind: z.string(),
      set_no: z.number(),
      target_reps: z.number(),
      target_load: z.string().nullable(),
      note: z.string().nullable(),
      side: z.string().nullable(),
    }),
  },

  /** "I train Wednesdays at 11" — several per programme. */
  programSlot: {
    table: 'train_program_slots',
    fields: z.object({
      id: z.string(),
      program_id: z.string(),
      weekday: z.number(),
      time_of_day: z.string(),
      created_at: z.string(),
    }),
    key: ['program_id', 'weekday', 'time_of_day'],
  },

  /** Adherence: prescribed vs performed. Decimal strings, never floats. */
  programSummary: {
    table: 'train_program_summary',
    fields: z.object({
      program_id: z.string(),
      prescribed_sets: z.number(),
      performed_sets: z.number(),
      total_reps: z.number(),
      total_volume: z.string(),
      adherence_pct: z.string(),
      computed_at: z.string(),
      total_seconds: z.number(),
    }),
    primaryKey: ['program_id'],
  },

  /** Append-only. A correction is a new row. */
  session: {
    table: 'train_sessions',
    fields: z.object({
      id: z.string(),
      program_id: z.string(),
      trainee_id: z.string(),
      performed_at: z.string(),
      note: z.string().nullable(),
      logged_by: z.string(),
      created_at: z.string(),
    }),
  },

  /** `reps` is the count in the exercise's own unit — reps, seconds or metres. */
  setResult: {
    table: 'train_set_results',
    fields: z.object({
      id: z.string(),
      session_id: z.string(),
      program_item_id: z.string(),
      exercise_id: z.string(),
      set_no: z.number(),
      reps: z.number(),
      load: z.string().nullable(),
      rpe: z.string().nullable(),
      logged_by: z.string(),
      logged_at: z.string(),
      duration_seconds: z.number().nullable(),
      avg_hr: z.number().nullable(),
      side: z.string().nullable(),
    }),
  },

  /**
   * Taking a set back is a void, not a delete: one row per set, and the set
   * itself is never touched. Its identity IS the set's.
   */
  setVoid: {
    table: 'train_set_voids',
    fields: z.object({
      set_id: z.string(),
      voided_by: z.string(),
      voided_at: z.string(),
    }),
    primaryKey: ['set_id'],
  },

  /**
   * The sharing DECISION, one row per (trainee, coach). Kernel grants are the
   * enforcement; if the two disagree, the tuples win.
   */
  sharing: {
    table: 'train_sharing',
    fields: z.object({
      trainee_id: z.string(),
      coach_id: z.string(),
      mode: z.string(),
      since: z.string().nullable(),
      updated_at: z.string(),
    }),
    primaryKey: ['trainee_id', 'coach_id'],
  },

  /** One thread per (trainee, coach) pair — two people have one conversation. */
  message: {
    table: 'train_messages',
    fields: z.object({
      id: z.string(),
      trainee_id: z.string(),
      coach_id: z.string(),
      author: z.string(),
      body: z.string(),
      created_at: z.string(),
    }),
    erasable: ['body'],
  },

  /** How far into a thread one principal has read. */
  threadRead: {
    table: 'train_thread_reads',
    fields: z.object({
      trainee_id: z.string(),
      coach_id: z.string(),
      principal_id: z.string(),
      last_read_at: z.string(),
    }),
    primaryKey: ['trainee_id', 'coach_id', 'principal_id'],
  },

  /** Weight, girths, grip, range of motion. Append-only, sided where a body is. */
  measurement: {
    table: 'train_measurements',
    fields: z.object({
      id: z.string(),
      trainee_id: z.string(),
      kind: z.string(),
      side: z.string().nullable(),
      value: z.string(),
      unit: z.string(),
      measured_at: z.string(),
      note: z.string().nullable(),
      logged_by: z.string(),
      created_at: z.string(),
    }),
    erasable: ['note'],
  },
});
