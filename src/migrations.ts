import type { SqlMigration } from '@substrat-run/kernel';

// ============================================================================
// The vertical's OWN tables, prefixed `train_` so they can never collide with
// an engine's. Ids are TEXT (ULIDs), timestamps ISO-8601 TEXT, and every number
// that must be EXACT — load, volume, adherence — is TEXT holding a decimal
// string. Never a float: 3 × 0.1 kg must be 0.3 kg, not 0.30000000000000004.
//
// Migrations are append-only and ordered: once a version has shipped you add a
// new one, you never edit this one.
// ============================================================================

export const strideMigrations: SqlMigration[] = [
  {
    version: '0001-init',
    sql: `
      -- The staff member, as an ENTITY. It exists so a coach can hold an
      -- entity-narrowed grant on themselves: one grant on coach:<id> reaches
      -- their trainees, programs, sessions and sets through the parent walk.
      CREATE TABLE train_coaches (
        id           TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL UNIQUE,
        name         TEXT NOT NULL,
        created_at   TEXT NOT NULL
      );

      -- coach_id is the CURRENT coach, for display. Access is carried by the
      -- trainee → coach edge, which is append-only: reassigning a trainee adds
      -- the new coach without erasing the old one's reach. See DESIGN.md §3.
      CREATE TABLE train_trainees (
        id         TEXT PRIMARY KEY,
        number     TEXT NOT NULL UNIQUE,
        name       TEXT NOT NULL,
        contact    TEXT,
        coach_id   TEXT REFERENCES train_coaches(id),
        created_at TEXT NOT NULL
      );

      -- visibility 'shared'  → published by an admin, readable via the
      --                        node-level key exercise:read-shared.
      -- visibility 'private' → authored by a coach, readable only through the
      --                        exercise → coach edge, or the exercise → trainee
      --                        edge minted when someone performs it.
      CREATE TABLE train_exercises (
        id             TEXT PRIMARY KEY,
        slug           TEXT NOT NULL UNIQUE,
        name           TEXT NOT NULL,
        modality       TEXT NOT NULL,
        unit           TEXT NOT NULL,
        description    TEXT,
        visibility     TEXT NOT NULL,
        owner_coach_id TEXT REFERENCES train_coaches(id),
        active         INTEGER NOT NULL DEFAULT 1,
        created_by     TEXT NOT NULL,
        created_at     TEXT NOT NULL
      );

      CREATE TABLE train_templates (
        id             TEXT PRIMARY KEY,
        name           TEXT NOT NULL,
        description    TEXT,
        visibility     TEXT NOT NULL,
        owner_coach_id TEXT REFERENCES train_coaches(id),
        created_by     TEXT NOT NULL,
        created_at     TEXT NOT NULL
      );

      CREATE TABLE train_template_items (
        id           TEXT PRIMARY KEY,
        template_id  TEXT NOT NULL REFERENCES train_templates(id),
        exercise_id  TEXT NOT NULL REFERENCES train_exercises(id),
        position     INTEGER NOT NULL,
        target_sets  INTEGER NOT NULL,
        target_reps  INTEGER NOT NULL,
        target_load  TEXT,
        notes        TEXT
      );

      -- The prescription, SNAPSHOT from a template at assignment. Editing the
      -- template afterwards must never rewrite a program already running: a
      -- physio's prescription in flight cannot change under the patient.
      -- program_id is the engine's work-order id.
      CREATE TABLE train_program_items (
        id           TEXT PRIMARY KEY,
        program_id   TEXT NOT NULL,
        exercise_id  TEXT NOT NULL REFERENCES train_exercises(id),
        position     INTEGER NOT NULL,
        target_sets  INTEGER NOT NULL,
        target_reps  INTEGER NOT NULL,
        target_load  TEXT,
        notes        TEXT
      );

      CREATE TABLE train_sessions (
        id           TEXT PRIMARY KEY,
        program_id   TEXT NOT NULL,
        trainee_id   TEXT NOT NULL REFERENCES train_trainees(id),
        performed_at TEXT NOT NULL,
        note         TEXT,
        logged_by    TEXT NOT NULL,
        created_at   TEXT NOT NULL
      );

      -- Append-only: what was actually performed. Nothing updates or deletes a
      -- row here; a correction is a new row.
      CREATE TABLE train_set_results (
        id              TEXT PRIMARY KEY,
        session_id      TEXT NOT NULL REFERENCES train_sessions(id),
        program_item_id TEXT NOT NULL REFERENCES train_program_items(id),
        exercise_id     TEXT NOT NULL REFERENCES train_exercises(id),
        set_no          INTEGER NOT NULL,
        reps            INTEGER NOT NULL,
        load            TEXT,
        rpe             TEXT,
        logged_by       TEXT NOT NULL,
        logged_at       TEXT NOT NULL
      );

      CREATE TABLE train_program_summary (
        program_id      TEXT PRIMARY KEY,
        prescribed_sets INTEGER NOT NULL,
        performed_sets  INTEGER NOT NULL,
        total_reps      INTEGER NOT NULL,
        total_volume    TEXT NOT NULL,
        adherence_pct   TEXT NOT NULL,
        computed_at     TEXT NOT NULL
      );

      CREATE INDEX train_program_items_program ON train_program_items(program_id, position);
      CREATE INDEX train_sessions_program      ON train_sessions(program_id);
      CREATE INDEX train_set_results_session   ON train_set_results(session_id);
      CREATE INDEX train_template_items_tpl    ON train_template_items(template_id, position);
    `,
  },
  {
    version: '0002-self-serve',
    sql: `
      -- Everyone may create their own exercises, templates and programs, so a
      -- trainee can now be an AUTHOR and not only a subject. Two consequences:
      --
      --   1. an operation must be able to resolve principal → trainee record,
      --      which until now only the grant tuples knew. Hence principal_id.
      --   2. ownership can no longer be "which coach", so each ownable table
      --      gains a trainee owner alongside the coach one. Exactly one of the
      --      two is set on a private row; both are NULL on a shared one.
      --
      -- Additive only. 0001-init has shipped and is never edited.
      ALTER TABLE train_trainees  ADD COLUMN principal_id     TEXT;
      ALTER TABLE train_exercises ADD COLUMN owner_trainee_id TEXT REFERENCES train_trainees(id);
      ALTER TABLE train_templates ADD COLUMN owner_trainee_id TEXT REFERENCES train_trainees(id);

      -- A partial-by-nature unique index: SQLite treats NULLs as distinct, so
      -- trainees seeded before this migration (no principal) do not collide.
      CREATE UNIQUE INDEX train_trainees_principal ON train_trainees(principal_id);
    `,
  },
  {
    version: '0003-equipment-and-schedule',
    sql: `
      -- EQUIPMENT ---------------------------------------------------------
      -- A small controlled vocabulary rather than free text, so "kettlebell"
      -- and "Kettlebell" can never be two different things and an availability
      -- check stays a set intersection.
      CREATE TABLE train_equipment (
        slug       TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        category   TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      -- What an exercise NEEDS. No rows at all means bodyweight — nothing to
      -- own, so everyone can always do it.
      CREATE TABLE train_exercise_equipment (
        exercise_id    TEXT NOT NULL REFERENCES train_exercises(id),
        equipment_slug TEXT NOT NULL REFERENCES train_equipment(slug),
        PRIMARY KEY (exercise_id, equipment_slug)
      );

      -- What a PERSON has. owner_type is 'coach' or 'trainee' and owner_id is
      -- that record's id — the same pair the permission walk already uses, so
      -- "my equipment" needs no new grant: an operation only ever writes the
      -- row for whoever is asking.
      CREATE TABLE train_account_equipment (
        owner_type     TEXT NOT NULL,
        owner_id       TEXT NOT NULL,
        equipment_slug TEXT NOT NULL REFERENCES train_equipment(slug),
        PRIMARY KEY (owner_type, owner_id, equipment_slug)
      );

      -- RECURRENCE --------------------------------------------------------
      -- Exactly one of the two is set, or neither for "no schedule":
      --   recur_days     '1,3,5'  ISO weekdays, 1 = Monday … 7 = Sunday
      --   recur_per_week 5        a count, when the days are the patient's choice
      -- Physio says "five times a week"; a lifting program says "Mon/Wed/Fri".
      -- Both are real, and collapsing them into one column would lose which was
      -- meant.
      ALTER TABLE train_template_items ADD COLUMN recur_days     TEXT;
      ALTER TABLE train_template_items ADD COLUMN recur_per_week INTEGER;
      ALTER TABLE train_program_items  ADD COLUMN recur_days     TEXT;
      ALTER TABLE train_program_items  ADD COLUMN recur_per_week INTEGER;

      CREATE INDEX train_account_equipment_owner ON train_account_equipment(owner_type, owner_id);
    `,
  },
  {
    version: '0004-sharing',
    sql: `
      -- WHAT A TRAINEE SHARES, AND WITH WHOM.
      --
      -- This table is the trainee's DECISION, not the enforcement. Enforcement is
      -- kernel grants minted by ctx.grant when the decision is made and withdrawn
      -- by ctx.revoke when it changes. If this table and the tuples ever disagree,
      -- the tuples win — they are what the permission evaluator reads.
      --
      --   'assigned'  the coach sees only the programs THEY assigned. Carried by
      --               the workorder -> coach edge, minted at assignment. No grant.
      --   'from-now'  plus every session logged from the moment this was chosen.
      --               One grant per session as it is created; older sessions keep
      --               no grant and stay invisible.
      --   'all'       everything, past and future, via grants on the trainee record.
      CREATE TABLE train_sharing (
        trainee_id TEXT NOT NULL REFERENCES train_trainees(id),
        coach_id   TEXT NOT NULL REFERENCES train_coaches(id),
        mode       TEXT NOT NULL,
        since      TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (trainee_id, coach_id)
      );

      CREATE INDEX train_sharing_coach ON train_sharing(coach_id);
    `,
  },
  {
    version: '0005-sets-supersets-onboarding',
    sql: `
      -- SUPERSETS -----------------------------------------------------------
      -- Items sharing a group_key are performed back to back: A1, A2, A3 then
      -- rest. A NULL group_key is a plain exercise on its own, which is what
      -- every row written before this migration is.
      ALTER TABLE train_template_items ADD COLUMN group_key TEXT;
      ALTER TABLE train_program_items  ADD COLUMN group_key TEXT;

      -- PER-SET TARGETS -----------------------------------------------------
      -- The uniform case stays on the item (3 x 5 @ 60). This table is for when
      -- the sets DIFFER — a ramp of 10@60, 8@70, 6@80, or a rehab ladder. When
      -- an item has rows here they are the prescription and target_sets is
      -- their count; when it has none, the item's own three columns are.
      --
      -- item_id points at a template item or a programme item; ULIDs are unique
      -- across both, and item_kind keeps a reader from having to know that.
      CREATE TABLE train_item_sets (
        id          TEXT PRIMARY KEY,
        item_id     TEXT NOT NULL,
        item_kind   TEXT NOT NULL,
        set_no      INTEGER NOT NULL,
        target_reps INTEGER NOT NULL,
        target_load TEXT,
        note        TEXT
      );

      -- ONBOARDING ----------------------------------------------------------
      -- What this person is training FOR, and how often they intend to. Both
      -- are the trainee's own answers, used to prefill a schedule rather than to
      -- enforce anything.
      ALTER TABLE train_trainees ADD COLUMN goal          TEXT;
      ALTER TABLE train_trainees ADD COLUMN days_per_week INTEGER;
      ALTER TABLE train_trainees ADD COLUMN onboarded_at  TEXT;

      CREATE INDEX train_item_sets_item ON train_item_sets(item_id, set_no);
    `,
  },
  {
    version: '0006-cardio',
    sql: `
      -- CARDIO ------------------------------------------------------------
      -- The quantity itself already worked: an exercise carries a unit
      -- ('reps' | 'seconds' | 'metres') and a set's \`reps\` column is the count
      -- IN THAT UNIT. Rowing 5000 has always meant 5000 metres.
      --
      -- What was missing is the second number. A 5 km row is a distance AND a
      -- duration, and one column cannot hold both — so a set may now also carry
      -- how long it took, and what the heart was doing. Both optional, both
      -- meaningful for a barbell set too (a 90-second plank at 140 bpm), so they
      -- live on every set rather than on a cardio-only table.
      ALTER TABLE train_set_results ADD COLUMN duration_seconds INTEGER;
      ALTER TABLE train_set_results ADD COLUMN avg_hr           INTEGER;

      -- Cardio carries no load, so it adds nothing to volume — its work is time.
      -- Without this a conditioning block completes as "0 volume", which reads as
      -- "nothing happened".
      ALTER TABLE train_program_summary ADD COLUMN total_seconds INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: '0007-training-slots',
    sql: `
      -- WHEN I TRAIN, as opposed to how often an exercise recurs.
      --
      -- Two different questions that were being answered by one column. An ITEM
      -- says "this exercise, three times a week" (0003). A SLOT says "I train
      -- Wednesdays at 11" — the appointment, not the dose. A programme can have
      -- several, so Wednesday 11:00 and Saturday 09:00 are two rows.
      --
      -- program_id is the ENGINE's work-order id and carries no foreign key on
      -- purpose: a constraint into another module's table would weld this schema
      -- to its private one.
      --
      -- time_of_day is local wall-clock 'HH:MM' with no zone, the same
      -- simplification the weekly rollup makes. A gym timezone is the real fix
      -- for both, and it is one field, not a rewrite.
      CREATE TABLE train_program_slots (
        id          TEXT PRIMARY KEY,
        program_id  TEXT NOT NULL,
        weekday     INTEGER NOT NULL,
        time_of_day TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        UNIQUE (program_id, weekday, time_of_day)
      );

      CREATE INDEX train_program_slots_program ON train_program_slots(program_id, weekday);
    `,
  },
  {
    version: '0008-messages',
    sql: `
      -- A CONVERSATION between one trainee and one coach.
      --
      -- Keyed by the PAIR, not by a thread id: there is exactly one conversation
      -- between two people, and inventing an id for it would let two exist.
      --
      -- Who may read and write it follows the SHARING relationship — the same
      -- grants on the trainee record that let a coach prescribe. End the
      -- relationship and the conversation closes with it, which is the honest
      -- behaviour: a coach you dismissed should not still be in your inbox.
      CREATE TABLE train_messages (
        id         TEXT PRIMARY KEY,
        trainee_id TEXT NOT NULL REFERENCES train_trainees(id),
        coach_id   TEXT NOT NULL REFERENCES train_coaches(id),
        author     TEXT NOT NULL,
        body       TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      -- How far each side has read. Per PRINCIPAL rather than per side, so it
      -- stays right if a coach record is ever handed to a different person.
      CREATE TABLE train_thread_reads (
        trainee_id   TEXT NOT NULL,
        coach_id     TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        last_read_at TEXT NOT NULL,
        PRIMARY KEY (trainee_id, coach_id, principal_id)
      );

      CREATE INDEX train_messages_thread ON train_messages(trainee_id, coach_id, created_at);
    `,
  },
];
