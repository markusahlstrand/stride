// ============================================================================
// The default library a new gym starts with: a controlled equipment vocabulary
// and ~55 exercises tagged with what each one needs.
//
// It is PURE DATA — no imports, no clock, no SQL. It used to be harness only,
// read by `seed.ts`; `stride/install-starter-library` now reads the same arrays
// from module code, so a deployed gym starts with the library the local one
// always had. Nothing here is privileged either way: the installer feeds it
// through the ordinary publish operations, exactly as an admin would by hand.
//
// Note what "shared with everyone" means in Substrat: everyone in THIS TENANT.
// There is no cross-tenant read, so a platform-wide catalogue is this array,
// installed into each gym once, which that gym then owns and can edit.
// ============================================================================

export interface EquipmentSeed {
  slug: string;
  name: string;
  category: string;
}

export interface ExerciseSeed {
  slug: string;
  name: string;
  modality: 'strength' | 'mobility' | 'cardio' | 'rehab';
  unit: 'reps' | 'seconds' | 'metres';
  description?: string;
  /** Empty means bodyweight — nothing to own, so everyone can always do it. */
  equipment: string[];
  /**
   * One side at a time? Omitted means bilateral. A unilateral exercise is logged
   * per side, so the left arm and the right arm are two numbers rather than one —
   * which is the only way a post-operative gap can be seen and watched close.
   */
  laterality?: 'unilateral';
}

export const EQUIPMENT: EquipmentSeed[] = [
  { slug: 'barbell', name: 'Barbell', category: 'free weights' },
  { slug: 'plates', name: 'Weight plates', category: 'free weights' },
  { slug: 'dumbbells', name: 'Dumbbells', category: 'free weights' },
  { slug: 'kettlebell', name: 'Kettlebell', category: 'free weights' },
  { slug: 'medicine-ball', name: 'Medicine ball', category: 'free weights' },
  { slug: 'squat-rack', name: 'Squat rack', category: 'rack & bench' },
  { slug: 'bench', name: 'Flat / incline bench', category: 'rack & bench' },
  { slug: 'pull-up-bar', name: 'Pull-up bar', category: 'rack & bench' },
  { slug: 'dip-bars', name: 'Dip bars', category: 'rack & bench' },
  { slug: 'plyo-box', name: 'Plyo box', category: 'rack & bench' },
  { slug: 'cable-machine', name: 'Cable machine', category: 'machines' },
  { slug: 'lat-pulldown', name: 'Lat pulldown', category: 'machines' },
  { slug: 'leg-press', name: 'Leg press', category: 'machines' },
  { slug: 'leg-curl-machine', name: 'Leg curl machine', category: 'machines' },
  { slug: 'leg-extension-machine', name: 'Leg extension machine', category: 'machines' },
  { slug: 'chest-press-machine', name: 'Chest press machine', category: 'machines' },
  { slug: 'rower', name: 'Rowing ergometer', category: 'cardio' },
  { slug: 'treadmill', name: 'Treadmill', category: 'cardio' },
  { slug: 'stationary-bike', name: 'Stationary bike', category: 'cardio' },
  { slug: 'ski-erg', name: 'Ski ergometer', category: 'cardio' },
  { slug: 'jump-rope', name: 'Jump rope', category: 'cardio' },
  { slug: 'elliptical', name: 'Elliptical trainer', category: 'cardio' },
  { slug: 'stair-climber', name: 'Stair climber', category: 'cardio' },
  { slug: 'assault-bike', name: 'Air / assault bike', category: 'cardio' },
  { slug: 'sled', name: 'Prowler sled', category: 'cardio' },
  { slug: 'battle-ropes', name: 'Battle ropes', category: 'cardio' },
  { slug: 'pool', name: 'Pool', category: 'cardio' },
  { slug: 'resistance-band', name: 'Resistance band', category: 'small kit' },
  { slug: 'mat', name: 'Exercise mat', category: 'small kit' },
  { slug: 'foam-roller', name: 'Foam roller', category: 'small kit' },
  { slug: 'suspension-trainer', name: 'Suspension trainer', category: 'small kit' },
];

export const EXERCISES: ExerciseSeed[] = [
  // --- barbell -------------------------------------------------------------
  {
    slug: 'back-squat',
    name: 'Back squat',
    modality: 'strength',
    unit: 'reps',
    description: 'Barbell on the upper back, hips below parallel.',
    equipment: ['barbell', 'plates', 'squat-rack'],
  },
  { slug: 'front-squat', name: 'Front squat', modality: 'strength', unit: 'reps', equipment: ['barbell', 'plates', 'squat-rack'] },
  { slug: 'deadlift', name: 'Deadlift', modality: 'strength', unit: 'reps', equipment: ['barbell', 'plates'] },
  { slug: 'romanian-deadlift', name: 'Romanian deadlift', modality: 'strength', unit: 'reps', equipment: ['barbell', 'plates'] },
  {
    slug: 'bench-press',
    name: 'Bench press',
    modality: 'strength',
    unit: 'reps',
    equipment: ['barbell', 'plates', 'bench', 'squat-rack'],
  },
  { slug: 'incline-bench-press', name: 'Incline bench press', modality: 'strength', unit: 'reps', equipment: ['barbell', 'plates', 'bench'] },
  { slug: 'overhead-press', name: 'Overhead press', modality: 'strength', unit: 'reps', equipment: ['barbell', 'plates'] },
  { slug: 'barbell-row', name: 'Barbell row', modality: 'strength', unit: 'reps', equipment: ['barbell', 'plates'] },
  { slug: 'hip-thrust', name: 'Barbell hip thrust', modality: 'strength', unit: 'reps', equipment: ['barbell', 'plates', 'bench'] },
  { slug: 'power-clean', name: 'Power clean', modality: 'strength', unit: 'reps', equipment: ['barbell', 'plates'] },

  // --- dumbbell ------------------------------------------------------------
  { slug: 'dumbbell-bench-press', name: 'Dumbbell bench press', modality: 'strength', unit: 'reps', equipment: ['dumbbells', 'bench'] },
  { slug: 'dumbbell-shoulder-press', name: 'Dumbbell shoulder press', modality: 'strength', unit: 'reps', equipment: ['dumbbells'] },
  // Dumbbells only: braced on a knee or a chair it needs no bench, and the
  // baseline has to be takeable at home.
  { slug: 'dumbbell-row', name: 'Single-arm dumbbell row', modality: 'strength', unit: 'reps', description: 'One hand braced on a bench, a chair or your own knee.', equipment: ['dumbbells'], laterality: 'unilateral' },
  { slug: 'dumbbell-lunge', name: 'Dumbbell lunge', modality: 'strength', unit: 'reps', equipment: ['dumbbells'] },
  { slug: 'lateral-raise', name: 'Lateral raise', modality: 'strength', unit: 'reps', equipment: ['dumbbells'] },
  // --- one side at a time ------------------------------------------------
  // The baseline leans on these: pressing, rowing and raising with one arm is
  // how a weaker side shows up as a number instead of a feeling.
  { slug: 'single-arm-dumbbell-press', name: 'Single-arm dumbbell press', modality: 'strength', unit: 'reps', description: 'Standing or seated, one dumbbell, press overhead. Log each arm.', equipment: ['dumbbells'], laterality: 'unilateral' },
  { slug: 'single-arm-lateral-raise', name: 'Single-arm lateral raise', modality: 'strength', unit: 'reps', description: 'One arm out to the side to shoulder height. Log each arm.', equipment: ['dumbbells'], laterality: 'unilateral' },
  { slug: 'bulgarian-split-squat', name: 'Bulgarian split squat', modality: 'strength', unit: 'reps', equipment: ['bench'], laterality: 'unilateral' },
  { slug: 'single-leg-calf-raise', name: 'Single-leg calf raise', modality: 'strength', unit: 'reps', equipment: [], laterality: 'unilateral' },
  { slug: 'bicep-curl', name: 'Biceps curl', modality: 'strength', unit: 'reps', equipment: ['dumbbells'] },
  { slug: 'goblet-squat', name: 'Goblet squat', modality: 'strength', unit: 'reps', equipment: ['kettlebell'] },
  // The baseline is built on these four plus dumbbells, a band and a mat, so a
  // person training at home can take the whole of it.
  { slug: 'dumbbell-squat', name: 'Dumbbell squat', modality: 'strength', unit: 'reps', description: 'One dumbbell held at the chest, or one in each hand at the sides.', equipment: ['dumbbells'] },
  { slug: 'dumbbell-romanian-deadlift', name: 'Dumbbell Romanian deadlift', modality: 'strength', unit: 'reps', description: 'Hips back, dumbbells down the thighs, flat back.', equipment: ['dumbbells'] },
  { slug: 'single-arm-biceps-curl', name: 'Single-arm biceps curl', modality: 'strength', unit: 'reps', equipment: ['dumbbells'], laterality: 'unilateral' },

  // --- kettlebell ----------------------------------------------------------
  { slug: 'kettlebell-swing', name: 'Kettlebell swing', modality: 'strength', unit: 'reps', equipment: ['kettlebell'] },
  { slug: 'turkish-get-up', name: 'Turkish get-up', modality: 'strength', unit: 'reps', equipment: ['kettlebell', 'mat'] },
  { slug: 'kettlebell-clean', name: 'Kettlebell clean', modality: 'strength', unit: 'reps', equipment: ['kettlebell'] },

  // --- machines ------------------------------------------------------------
  { slug: 'lat-pulldown', name: 'Lat pulldown', modality: 'strength', unit: 'reps', equipment: ['lat-pulldown'] },
  { slug: 'seated-cable-row', name: 'Seated cable row', modality: 'strength', unit: 'reps', equipment: ['cable-machine'] },
  { slug: 'cable-triceps-pushdown', name: 'Cable triceps pushdown', modality: 'strength', unit: 'reps', equipment: ['cable-machine'] },
  { slug: 'cable-woodchop', name: 'Cable woodchop', modality: 'strength', unit: 'reps', equipment: ['cable-machine'] },
  { slug: 'leg-press', name: 'Leg press', modality: 'strength', unit: 'reps', equipment: ['leg-press'] },
  { slug: 'leg-curl', name: 'Lying leg curl', modality: 'strength', unit: 'reps', equipment: ['leg-curl-machine'] },
  { slug: 'leg-extension', name: 'Leg extension', modality: 'strength', unit: 'reps', equipment: ['leg-extension-machine'] },
  { slug: 'chest-press-machine', name: 'Chest press (machine)', modality: 'strength', unit: 'reps', equipment: ['chest-press-machine'] },

  // --- bodyweight ----------------------------------------------------------
  { slug: 'push-up', name: 'Push-up', modality: 'strength', unit: 'reps', equipment: [] },
  { slug: 'bodyweight-squat', name: 'Bodyweight squat', modality: 'strength', unit: 'reps', equipment: [] },
  { slug: 'walking-lunge', name: 'Walking lunge', modality: 'strength', unit: 'reps', equipment: [] },
  { slug: 'calf-raise', name: 'Standing calf raise', modality: 'strength', unit: 'reps', equipment: [] },
  { slug: 'burpee', name: 'Burpee', modality: 'cardio', unit: 'reps', equipment: [] },
  { slug: 'pull-up', name: 'Pull-up', modality: 'strength', unit: 'reps', equipment: ['pull-up-bar'] },
  { slug: 'chin-up', name: 'Chin-up', modality: 'strength', unit: 'reps', equipment: ['pull-up-bar'] },
  { slug: 'hanging-knee-raise', name: 'Hanging knee raise', modality: 'strength', unit: 'reps', equipment: ['pull-up-bar'] },
  { slug: 'dip', name: 'Parallel-bar dip', modality: 'strength', unit: 'reps', equipment: ['dip-bars'] },
  { slug: 'box-jump', name: 'Box jump', modality: 'cardio', unit: 'reps', equipment: ['plyo-box'] },
  { slug: 'trx-row', name: 'Suspension row', modality: 'strength', unit: 'reps', equipment: ['suspension-trainer'] },

  // --- core & mobility -----------------------------------------------------
  { slug: 'plank', name: 'Front plank', modality: 'mobility', unit: 'seconds', equipment: ['mat'] },
  { slug: 'side-plank', name: 'Side plank', modality: 'mobility', unit: 'seconds', equipment: ['mat'], laterality: 'unilateral' },
  { slug: 'hollow-hold', name: 'Hollow hold', modality: 'mobility', unit: 'seconds', equipment: ['mat'] },
  { slug: 'glute-bridge', name: 'Glute bridge', modality: 'mobility', unit: 'reps', equipment: ['mat'] },
  { slug: 'single-leg-glute-bridge', name: 'Single-leg glute bridge', modality: 'strength', unit: 'reps', equipment: ['mat'], laterality: 'unilateral' },
  { slug: 'bird-dog', name: 'Bird dog', modality: 'mobility', unit: 'reps', equipment: ['mat'] },
  { slug: 'dead-bug', name: 'Dead bug', modality: 'mobility', unit: 'reps', equipment: ['mat'] },
  { slug: 'mountain-climber', name: 'Mountain climber', modality: 'cardio', unit: 'seconds', equipment: ['mat'] },
  { slug: 'hip-flexor-stretch', name: 'Hip flexor stretch', modality: 'mobility', unit: 'seconds', equipment: ['mat'] },
  { slug: 'thoracic-rotation', name: 'Thoracic rotation', modality: 'mobility', unit: 'reps', equipment: ['mat', 'foam-roller'] },
  { slug: 'wall-slide', name: 'Wall slide', modality: 'mobility', unit: 'reps', equipment: [] },

  // --- cardio --------------------------------------------------------------
  { slug: 'rowing', name: 'Rowing', modality: 'cardio', unit: 'metres', equipment: ['rower'] },
  { slug: 'treadmill-run', name: 'Treadmill run', modality: 'cardio', unit: 'metres', equipment: ['treadmill'] },
  { slug: 'stationary-bike', name: 'Stationary bike', modality: 'cardio', unit: 'metres', equipment: ['stationary-bike'] },
  { slug: 'ski-erg', name: 'Ski erg', modality: 'cardio', unit: 'metres', equipment: ['ski-erg'] },
  { slug: 'jump-rope', name: 'Jump rope', modality: 'cardio', unit: 'seconds', equipment: ['jump-rope'] },
  { slug: 'elliptical', name: 'Elliptical', modality: 'cardio', unit: 'metres', equipment: ['elliptical'] },
  { slug: 'stair-climber', name: 'Stair climber', modality: 'cardio', unit: 'seconds', equipment: ['stair-climber'] },
  { slug: 'assault-bike', name: 'Air bike', modality: 'cardio', unit: 'metres', equipment: ['assault-bike'] },
  { slug: 'sled-push', name: 'Sled push', modality: 'cardio', unit: 'metres', equipment: ['sled'] },
  { slug: 'battle-ropes', name: 'Battle ropes', modality: 'cardio', unit: 'seconds', equipment: ['battle-ropes'] },
  { slug: 'swim-freestyle', name: 'Freestyle swim', modality: 'cardio', unit: 'metres', equipment: ['pool'] },
  // Outdoors needs nothing, which is the point of tagging equipment at all.
  { slug: 'run-outdoor', name: 'Run (outdoor)', modality: 'cardio', unit: 'metres', equipment: [] },
  { slug: 'walk', name: 'Walk', modality: 'cardio', unit: 'metres', equipment: [] },
  { slug: 'cycle-outdoor', name: 'Cycle (outdoor)', modality: 'cardio', unit: 'metres', equipment: [] },
  { slug: 'shuttle-run', name: 'Shuttle run', modality: 'cardio', unit: 'metres', equipment: [] },
  { slug: 'high-knees', name: 'High knees', modality: 'cardio', unit: 'seconds', equipment: [] },
  { slug: 'jumping-jack', name: 'Jumping jacks', modality: 'cardio', unit: 'reps', equipment: [] },

  // --- rehab ---------------------------------------------------------------
  { slug: 'band-external-rotation', name: 'Band external rotation', modality: 'rehab', unit: 'reps', equipment: ['resistance-band'], laterality: 'unilateral' },
  { slug: 'band-pull-apart', name: 'Band pull-apart', modality: 'rehab', unit: 'reps', equipment: ['resistance-band'] },
  { slug: 'shoulder-abduction', name: 'Shoulder abduction', modality: 'rehab', unit: 'reps', equipment: ['resistance-band'], laterality: 'unilateral' },
  { slug: 'clamshell', name: 'Clamshell', modality: 'rehab', unit: 'reps', equipment: ['resistance-band', 'mat'], laterality: 'unilateral' },
  { slug: 'ankle-dorsiflexion', name: 'Ankle dorsiflexion', modality: 'rehab', unit: 'reps', equipment: ['resistance-band'], laterality: 'unilateral' },
  { slug: 'copenhagen-plank', name: 'Copenhagen plank', modality: 'rehab', unit: 'seconds', equipment: ['bench'], laterality: 'unilateral' },
  { slug: 'single-leg-balance', name: 'Single-leg balance', modality: 'rehab', unit: 'seconds', equipment: [], laterality: 'unilateral' },
  { slug: 'heel-slide', name: 'Heel slide', modality: 'rehab', unit: 'reps', equipment: ['mat'], laterality: 'unilateral' },
  {
    slug: 'assisted-arm-raise',
    name: 'Assisted arm raise',
    modality: 'rehab',
    unit: 'reps',
    description:
      'Raise the arm forward and up as far as it goes, the other hand helping on the way. Log each arm; note how high it went.',
    equipment: [],
    laterality: 'unilateral',
  },
];

// ---------------------------------------------------------------------------
// The two templates a gym starts with. Between them they show every shape a
// prescription can take, so a new gym has a worked example of each rather than
// a blank page:
//
//   uniform   `target_sets × target_reps @ load` on the item itself;
//   ramp      an explicit `sets` list, for when the sets differ from one another;
//   superset  items sharing a `group` key, done back to back.
//
// Slugs, not ids: the installer resolves them against the catalogue it has just
// published, so this array never has to know what a ULID is.
// ---------------------------------------------------------------------------

export interface TemplateItemSeed {
  /** The exercise's slug, resolved at install time. */
  exercise: string;
  targetSets: number;
  targetReps: number;
  targetLoad?: string;
  /** ISO weekdays, `'1,3,5'`. */
  recurDays?: string;
  /** A count instead of named days — "five times a week", the patient's choice. */
  recurPerWeek?: number;
  /** Same key AND adjacent = one superset. */
  groupKey?: string;
  /** What to do with it: "as many as you can", "easy pace". Shown on the row. */
  notes?: string;
  /** An explicit ramp. When present it replaces the uniform shape above, and
   *  `targetSets` is brought back into step with the list by the operation.
   *  On a unilateral exercise every row names its side. */
  sets?: { reps: number; load?: string; note?: string; side?: 'left' | 'right' }[];
}

export interface TemplateSeed {
  name: string;
  description: string;
  items: TemplateItemSeed[];
}

export const TEMPLATES: TemplateSeed[] = [
  {
    name: 'Foundation Strength',
    description: 'The gym-wide starting program: squat, bench, plank.',
    items: [
      // Mon / Wed / Fri — a lifting program names its days.
      { exercise: 'back-squat', targetSets: 3, targetReps: 5, targetLoad: '60', recurDays: '1,3,5' },
      { exercise: 'bench-press', targetSets: 3, targetReps: 8, targetLoad: '40', recurDays: '1,3,5' },
      { exercise: 'plank', targetSets: 3, targetReps: 45, recurDays: '1,3,5' },
    ],
  },
  {
    name: 'Upper Push — ramp & superset',
    description: 'A ramping bench, then a shoulder/row superset.',
    items: [
      {
        exercise: 'bench-press',
        targetSets: 3,
        targetReps: 10,
        recurDays: '2,5',
        // 10 @ 40, 8 @ 45, 6 @ 50, 4 @ 55 — the sets differ, so they are listed.
        sets: [
          { reps: 10, load: '40', note: 'warm-up' },
          { reps: 8, load: '45' },
          { reps: 6, load: '50' },
          { reps: 4, load: '55', note: 'top set' },
        ],
      },
      // A1 / A2: press then row, back to back.
      { exercise: 'dumbbell-shoulder-press', targetSets: 3, targetReps: 10, targetLoad: '14', groupKey: 'A', recurDays: '2,5' },
      { exercise: 'dumbbell-row', targetSets: 3, targetReps: 10, targetLoad: '20', groupKey: 'A', recurDays: '2,5' },
    ],
  },
  // ---------------------------------------------------------------------------
  // THE BASELINE. Not a workout — a measurement. One set of each, as many clean
  // reps as you can at a light fixed load, and on the one-sided movements each
  // arm and each leg separately. What it produces is a first point on every
  // curve: this is where you started. Retake it every few weeks and the second
  // point is the evolution; the left/right pair on each row is the gap.
  //
  // The loads are deliberately light. A baseline is not a max test — after an
  // operation a max test is the last thing anyone should be doing — it is a
  // number that can be compared with itself in a month.
  // ---------------------------------------------------------------------------
  {
    name: 'Baseline — strength & symmetry',
    description:
      'The whole body in one session: one set of each, as many clean reps as you can at a light fixed load. One-sided movements are logged per arm and per leg, so a weaker side shows as a number. Retake it monthly, same loads, same order.',
    items: [
      // 1. The shoulders first, while fresh — range before strength.
      { exercise: 'assisted-arm-raise', targetSets: 1, targetReps: 10, notes: 'Each arm. Note how high it goes: to shoulder, to ear, past.' },
      { exercise: 'band-external-rotation', targetSets: 1, targetReps: 15, notes: 'Light band, each arm, as many as stay clean.' },
      { exercise: 'single-arm-lateral-raise', targetSets: 1, targetReps: 10, targetLoad: '2', notes: 'Each arm, to shoulder height only. As many as stay clean at 2 kg.' },
      // 2. Legs — squat, hinge, one leg, calves.
      { exercise: 'dumbbell-squat', targetSets: 1, targetReps: 10, targetLoad: '10', notes: 'As many as you can at 10 kg. Same depth every time.' },
      { exercise: 'dumbbell-romanian-deadlift', targetSets: 1, targetReps: 10, targetLoad: '10', notes: 'Two 5 kg dumbbells. As many as stay flat-backed.' },
      { exercise: 'single-leg-glute-bridge', targetSets: 1, targetReps: 10, notes: 'Each leg. Stop when the hips drop.' },
      { exercise: 'single-leg-calf-raise', targetSets: 1, targetReps: 15, notes: 'Each leg, full height, fingertips on a wall.' },
      // 3. Push and pull — flat and overhead.
      { exercise: 'push-up', targetSets: 1, targetReps: 10, notes: 'Max reps. From the knees is fine — just do it the same way next time.' },
      { exercise: 'single-arm-dumbbell-press', targetSets: 1, targetReps: 10, targetLoad: '4', notes: 'As many clean reps as you can at 4 kg — each arm. Stop when the shoulder hikes.' },
      { exercise: 'dumbbell-row', targetSets: 1, targetReps: 10, targetLoad: '8', notes: 'As many as you can at 8 kg — each arm.' },
      { exercise: 'band-pull-apart', targetSets: 1, targetReps: 15, notes: 'Light band, straight arms. As many as stay slow.' },
      // 4. Arms — one at a time, so the two can be compared.
      { exercise: 'single-arm-biceps-curl', targetSets: 1, targetReps: 10, targetLoad: '4', notes: 'Each arm at 4 kg, elbow still.' },
      // 5. Trunk and balance.
      { exercise: 'plank', targetSets: 1, targetReps: 30, notes: 'Hold as long as it stays straight.' },
      { exercise: 'side-plank', targetSets: 1, targetReps: 20, notes: 'Each side. Hold as long as the hips stay up.' },
      { exercise: 'single-leg-balance', targetSets: 1, targetReps: 30, notes: 'Each leg, eyes open. Stop the clock when the other foot touches.' },
      // 6. And a kilometre with a time on it.
      { exercise: 'run-outdoor', targetSets: 1, targetReps: 1000, notes: 'One kilometre, timed. Whatever pace you can hold and talk at. Walk it if you must — just log which.' },
    ],
  },
  // A shoulder coming back. Every row is one-sided so the operated arm gets its
  // own dose, and the whole thing is a count per week rather than named days —
  // physio homework happens when it happens.
  {
    name: 'Shoulder — return to raising',
    description:
      'Daily-ish shoulder work after an operation: assisted raises, rotations, abduction. Each arm logged on its own so the operated side can be dosed differently.',
    items: [
      { exercise: 'assisted-arm-raise', targetSets: 3, targetReps: 10, recurPerWeek: 5, notes: 'Slow up, slower down. Each arm — the good one keeps the pattern honest.' },
      { exercise: 'wall-slide', targetSets: 3, targetReps: 10, recurPerWeek: 5 },
      { exercise: 'band-external-rotation', targetSets: 3, targetReps: 15, recurPerWeek: 5, notes: 'Elbow pinned to the ribs. Each arm.' },
      { exercise: 'shoulder-abduction', targetSets: 3, targetReps: 12, recurPerWeek: 5, notes: 'Each arm. Only as high as it goes without the shrug.' },
      { exercise: 'single-arm-dumbbell-press', targetSets: 3, targetReps: 8, targetLoad: '2', recurPerWeek: 3, notes: 'Each arm. Take the weak side first, and match the other side to its reps.' },
    ],
  },
  // Running is a distance with a time on it, and nothing else in the model had
  // to change for it: the quantity column is metres, the set carries how long it
  // took, and pace falls out of the two. A week of it is a standing programme.
  {
    name: 'Running — base week',
    description:
      'Two easy runs and one longer one, plus calves. Each run is a distance and a time, so pace and heart rate build a curve on their own.',
    items: [
      { exercise: 'run-outdoor', targetSets: 1, targetReps: 3000, recurPerWeek: 2, notes: 'Easy — you should be able to talk. Log the time and, if you have it, average heart rate.' },
      { exercise: 'run-outdoor', targetSets: 1, targetReps: 5000, recurDays: '7', notes: 'The long one. Same easy effort, just further.' },
      { exercise: 'calf-raise', targetSets: 3, targetReps: 15, recurDays: '2,4' },
    ],
  },
];
