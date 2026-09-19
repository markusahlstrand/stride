import { defineEntities, z } from '@substrat-run/contracts';

// ============================================================================
// THE ENTITY REGISTRY — what this vertical stores, declared once.
//
// Until now the tables lived only in `migrations.ts` as raw SQL the manifest
// never saw, and the entity TYPE NAMES lived only in `entityRelations` as bare
// strings nothing checked. So `{ entityType: 'sesson', parentType: 'workorder' }`
// parsed cleanly and produced an edge permission never flows along — a grant
// that should reach a child silently does not. There is no runtime error for
// that; the coach simply sees nothing and nobody knows why.
//
// This module gives those names something to be checked against. `parents` is
// constrained to this map's own keys, so a typo is now a COMPILE error naming
// the declared entities.
//
// ## What this is not
//
// It is NOT the source of the migrations. `migrations.ts` stays exactly as it
// is, append-only, and nothing about how tables are created changes — upstream
// is explicit that whether the model becomes the source migrations are derived
// FROM is a separate, open question. This registry is a prerequisite either
// way, and adopting it moves no DDL.
//
// The names below are not free. Five of them are the entity types the kernel
// already checks permissions against — `coach`, `trainee`, `exercise`,
// `template`, `session` — and renaming one would silently detach every grant
// narrowed to it. The rest are named descriptively and appear only in
// `model.json`.
//
// Field names are the COLUMN names, because that is what `key` and events are
// checked against. Types follow `migrations.ts`: ids and timestamps are TEXT,
// and every number that must be exact — load, volume, adherence — is TEXT
// holding a decimal string, never a float.
// ============================================================================

/** Optional TEXT: absent in SQLite is NULL, and both read back as `null`. */
const text = () => z.string();
const nullableText = () => z.string().nullable();
const int = () => z.number().int();
const nullableInt = () => z.number().int().nullable();
/** A decimal string. Exact money/weight arithmetic, per rule 9. */
const decimal = () => z.string();

export const strideEntities = defineEntities({
  // --- THE PEOPLE ---------------------------------------------------------
  //
  // `coach` exists as an entity so a coach can hold ONE entity-narrowed grant
  // on themselves and have it reach their trainees, programmes, sessions and
  // sets through the parent walk. It is the whole reason the record is a row
  // rather than a principal.
  coach: {
    table: 'train_coaches',
    fields: z.object({
      id: text(),
      principal_id: text(),
      name: text(),
      created_at: text(),
    }),
    key: ['principal_id'],
    erasable: ['name'],
  },

  // No `parents`. There is deliberately NO trainee → coach edge: it was removed
  // in rev 6 because it handed a coach a person's entire history for ever,
  // including everything from before the relationship began. A coach's reach is
  // per-programme (`workorder → coach`, in `relations` below) and per-session.
  // Re-adding a parent here would quietly restore the leak.
  trainee: {
    table: 'train_trainees',
    fields: z.object({
      id: text(),
      number: text(),
      name: text(),
      contact: nullableText(),
      // The CURRENT coach, for display only. Access never reads this column.
      coach_id: nullableText(),
      created_at: text(),
      principal_id: nullableText(),
      // Onboarding: what this person trains FOR and how often they intend to.
      // Prefills a schedule, enforces nothing.
      goal: nullableText(),
      days_per_week: nullableInt(),
      onboarded_at: nullableText(),
    }),
    key: ['number'],
    erasable: ['name', 'contact'],
  },

  // --- THE LIBRARY -------------------------------------------------------
  //
  // Both parents, and an array even for one: `entityRelations` is an ALLOWLIST,
  // not an assertion. The kernel accumulates permitted parents into a set per
  // entity type and `ctx.link` checks membership, so an exercise may hang off
  // either — a coach's private row off the coach, a trainee's own off the
  // trainee.
  //
  // Authoring and EARNING are the same edge on purpose: performing an exercise
  // links it to the trainee, so "mine" and "what I have done" are one walk and
  // one grant. `ctx.link` has no un-link, which is what makes "yours forever"
  // literal rather than a `WHERE` clause.
  exercise: {
    table: 'train_exercises',
    fields: z.object({
      id: text(),
      slug: text(),
      name: text(),
      modality: text(),
      // 'reps' | 'seconds' | 'metres' — a set's `reps` is the count IN THIS UNIT.
      unit: text(),
      // Paragraphs, split on blank lines: the lede, the how-to, `Watch for:`,
      // `Load:`. One column on purpose — there is no second one and no
      // migration behind any of it.
      description: nullableText(),
      // 'shared' (published gym-wide) | 'private' (exactly one owner set).
      visibility: text(),
      owner_coach_id: nullableText(),
      owner_trainee_id: nullableText(),
      active: int(),
      created_by: text(),
      created_at: text(),
      // 'bilateral' | 'unilateral'. On a unilateral row `target_sets` counts
      // sets PER SIDE, which is why adherence doubles it.
      laterality: text(),
    }),
    key: ['slug'],
    parents: ['coach', 'trainee'],
  },

  template: {
    table: 'train_templates',
    fields: z.object({
      id: text(),
      name: text(),
      description: nullableText(),
      visibility: text(),
      owner_coach_id: nullableText(),
      owner_trainee_id: nullableText(),
      created_by: text(),
      created_at: text(),
    }),
    parents: ['coach', 'trainee'],
  },

  templateItem: {
    table: 'train_template_items',
    fields: z.object({
      id: text(),
      template_id: text(),
      exercise_id: text(),
      position: int(),
      target_sets: int(),
      target_reps: int(),
      target_load: nullableText(),
      notes: nullableText(),
      // Exactly one of the two, or neither for "no schedule". Physio says "five
      // times a week"; a lifting block says "Mon/Wed/Fri". Collapsing them into
      // one column would lose which was meant.
      recur_days: nullableText(),
      recur_per_week: nullableInt(),
      // Same key AND adjacent = one superset. NULL is a plain exercise.
      group_key: nullableText(),
    }),
  },

  // --- THE PRESCRIPTION --------------------------------------------------
  //
  // A SNAPSHOT taken from a template at assignment, never a reference: editing
  // the template afterwards must not rewrite a programme already running. A
  // physio's prescription in flight cannot change under the patient.
  //
  // `program_id` is the ENGINE's work-order id and carries no foreign key, on
  // purpose — a constraint into another module's table would weld this schema
  // to its private one (rule 4).
  programItem: {
    table: 'train_program_items',
    fields: z.object({
      id: text(),
      program_id: text(),
      exercise_id: text(),
      position: int(),
      target_sets: int(),
      target_reps: int(),
      target_load: nullableText(),
      notes: nullableText(),
      recur_days: nullableText(),
      recur_per_week: nullableInt(),
      group_key: nullableText(),
    }),
  },

  // Explicit per-set targets, for when the sets DIFFER — a ramp of 10@60,
  // 8@70, 6@80, or a rehab ladder. When an item has rows here they ARE the
  // prescription and `target_sets` is kept in step with their count; when it
  // has none, the item's own three columns are.
  //
  // `item_id` points at a template item or a programme item — ULIDs are unique
  // across both, and `item_kind` saves a reader from having to know that.
  itemSet: {
    table: 'train_item_sets',
    fields: z.object({
      id: text(),
      item_id: text(),
      item_kind: text(),
      set_no: int(),
      target_reps: int(),
      target_load: nullableText(),
      note: nullableText(),
      // 'left' | 'right' | NULL. A unilateral set MUST name one and a
      // bilateral one must not.
      side: nullableText(),
    }),
  },

  // --- WHAT WAS ACTUALLY DONE --------------------------------------------
  //
  // The parent is the engine's `workorder`, which this map cannot name — a
  // foreign name goes in `relations` (see `manifest.ts`), where both sides are
  // checked against the engine's own registry. Hence no `parents` here.
  //
  // The walk is `session → workorder → trainee → coach`: depth 3, against an
  // evaluator limit of 4.
  session: {
    table: 'train_sessions',
    fields: z.object({
      id: text(),
      program_id: text(),
      trainee_id: text(),
      performed_at: text(),
      note: nullableText(),
      logged_by: text(),
      created_at: text(),
    }),
  },

  // Append-only. Nothing updates or deletes a row here; a correction is a new
  // row, and the history is the point.
  setResult: {
    table: 'train_set_results',
    fields: z.object({
      id: text(),
      session_id: text(),
      program_item_id: text(),
      exercise_id: text(),
      set_no: int(),
      // The count in the EXERCISE's unit. Rowing 5000 is 5000 metres.
      reps: int(),
      load: nullableText(),
      rpe: nullableText(),
      // Optional on EVERY set, not on a cardio-only table: a 5 km row is a
      // distance and a duration, and a 90-second plank at 140 bpm is the same
      // shape.
      duration_seconds: nullableInt(),
      avg_hr: nullableInt(),
      side: nullableText(),
      logged_by: text(),
      logged_at: text(),
    }),
  },

  // Keyed by the engine's work-order id, so `primaryKey` is declared: this
  // table has no id of its own to have, and inventing one would permit two
  // summaries for one programme — the very thing the key exists to prevent.
  programSummary: {
    table: 'train_program_summary',
    fields: z.object({
      program_id: text(),
      prescribed_sets: int(),
      performed_sets: int(),
      total_reps: int(),
      total_volume: decimal(),
      adherence_pct: decimal(),
      // Cardio carries no load, so it adds nothing to volume — its work is
      // time. Without this a conditioning block completes as "0 volume",
      // which reads as "nothing happened".
      total_seconds: int(),
      computed_at: text(),
    }),
    primaryKey: ['program_id'],
  },

  // "I train Wednesdays at 11" — the appointment, not the dose. A different
  // question from an item's rhythm, and a programme can have several.
  // `time_of_day` is local wall-clock 'HH:MM' with no zone; a gym timezone is
  // the real fix, and it is one field rather than a rewrite.
  programSlot: {
    table: 'train_program_slots',
    fields: z.object({
      id: text(),
      program_id: text(),
      weekday: int(),
      time_of_day: text(),
      created_at: text(),
    }),
    key: ['program_id', 'weekday', 'time_of_day'],
  },

  // --- EQUIPMENT ---------------------------------------------------------
  //
  // A controlled vocabulary rather than free text, so "kettlebell" and
  // "Kettlebell" can never be two things and an availability check stays a set
  // intersection. Keyed by slug, not by an id.
  equipment: {
    table: 'train_equipment',
    fields: z.object({
      slug: text(),
      name: text(),
      category: text(),
      created_at: text(),
    }),
    primaryKey: ['slug'],
  },

  // What an exercise NEEDS. No rows at all means bodyweight — nothing to own,
  // so everyone can always do it. Composite key, so not something a grant can
  // narrow to; equipment is advice, never a permission.
  exerciseEquipment: {
    table: 'train_exercise_equipment',
    fields: z.object({
      exercise_id: text(),
      equipment_slug: text(),
    }),
    primaryKey: ['exercise_id', 'equipment_slug'],
  },

  // What a PERSON has. `owner_type` is 'coach' or 'trainee' and `owner_id` is
  // that record's id — the same pair the permission walk already uses, which is
  // why "my equipment" needs no new grant: the operation only ever writes the
  // row for whoever is asking, and takes no id saying whose.
  accountEquipment: {
    table: 'train_account_equipment',
    fields: z.object({
      owner_type: text(),
      owner_id: text(),
      equipment_slug: text(),
    }),
    primaryKey: ['owner_type', 'owner_id', 'equipment_slug'],
  },

  // --- SHARING AND CONVERSATION ------------------------------------------
  //
  // This table is the trainee's DECISION, not the enforcement. Enforcement is
  // kernel grants, minted when the decision is made and revoked when it
  // changes. If the two ever disagree, the TUPLES win — they are what the
  // permission evaluator reads.
  sharing: {
    table: 'train_sharing',
    fields: z.object({
      trainee_id: text(),
      coach_id: text(),
      // 'none' | 'assigned' | 'from-now' | 'all'
      mode: text(),
      since: nullableText(),
      updated_at: text(),
    }),
    primaryKey: ['trainee_id', 'coach_id'],
  },

  // One thread per (trainee, coach) PAIR — no thread id, because two people
  // have exactly one conversation and inventing an id would let two exist.
  //
  // The message keys ride the RELATIONSHIP, not the sharing mode: a coach on
  // `assigned` can still talk to you, because the conversation is not the
  // training.
  message: {
    table: 'train_messages',
    fields: z.object({
      id: text(),
      trainee_id: text(),
      coach_id: text(),
      author: text(),
      body: text(),
      created_at: text(),
    }),
    erasable: ['body'],
  },

  // How far each side has read. Per PRINCIPAL rather than per side, so it stays
  // right if a coach record is ever handed to a different person.
  threadRead: {
    table: 'train_thread_reads',
    fields: z.object({
      trainee_id: text(),
      coach_id: text(),
      principal_id: text(),
      last_read_at: text(),
    }),
    primaryKey: ['trainee_id', 'coach_id', 'principal_id'],
  },

  // --- THE BODY ----------------------------------------------------------
  //
  // Weight, girths, grip, shoulder range. Not a set — nothing was performed —
  // but the same shape of question: a number, a date, and for a limb a side.
  // Append-only for the same reason results are.
  //
  // Gated by `result:log` / `result:read` on the TRAINEE record, which is why
  // these arrive at sharing `all` and not before: a decimal about a body has no
  // session to hang from.
  measurement: {
    table: 'train_measurements',
    fields: z.object({
      id: text(),
      trainee_id: text(),
      kind: text(),
      side: nullableText(),
      value: decimal(),
      unit: text(),
      measured_at: text(),
      note: nullableText(),
      logged_by: text(),
      created_at: text(),
    }),
    erasable: ['note'],
  },
});
