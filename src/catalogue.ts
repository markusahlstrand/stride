// ============================================================================
// The default library a new gym starts with: a controlled equipment vocabulary
// and ~55 exercises tagged with what each one needs.
//
// This is HARNESS, not module code — it is data the seed feeds through the
// normal operations, exactly as an admin would by hand. Nothing here is
// privileged.
//
// Note what "shared with everyone" means in Substrat: everyone in THIS TENANT.
// There is no cross-tenant read, so a platform-wide catalogue is this array,
// seeded into each gym at provisioning, which that gym then owns and can edit.
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
  { slug: 'dumbbell-row', name: 'Single-arm dumbbell row', modality: 'strength', unit: 'reps', equipment: ['dumbbells', 'bench'] },
  { slug: 'dumbbell-lunge', name: 'Dumbbell lunge', modality: 'strength', unit: 'reps', equipment: ['dumbbells'] },
  { slug: 'lateral-raise', name: 'Lateral raise', modality: 'strength', unit: 'reps', equipment: ['dumbbells'] },
  { slug: 'bicep-curl', name: 'Biceps curl', modality: 'strength', unit: 'reps', equipment: ['dumbbells'] },
  { slug: 'goblet-squat', name: 'Goblet squat', modality: 'strength', unit: 'reps', equipment: ['kettlebell'] },

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
  { slug: 'side-plank', name: 'Side plank', modality: 'mobility', unit: 'seconds', equipment: ['mat'] },
  { slug: 'hollow-hold', name: 'Hollow hold', modality: 'mobility', unit: 'seconds', equipment: ['mat'] },
  { slug: 'glute-bridge', name: 'Glute bridge', modality: 'mobility', unit: 'reps', equipment: ['mat'] },
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
  { slug: 'band-external-rotation', name: 'Band external rotation', modality: 'rehab', unit: 'reps', equipment: ['resistance-band'] },
  { slug: 'band-pull-apart', name: 'Band pull-apart', modality: 'rehab', unit: 'reps', equipment: ['resistance-band'] },
  { slug: 'shoulder-abduction', name: 'Shoulder abduction', modality: 'rehab', unit: 'reps', equipment: ['resistance-band'] },
  { slug: 'clamshell', name: 'Clamshell', modality: 'rehab', unit: 'reps', equipment: ['resistance-band', 'mat'] },
  { slug: 'ankle-dorsiflexion', name: 'Ankle dorsiflexion', modality: 'rehab', unit: 'reps', equipment: ['resistance-band'] },
  { slug: 'copenhagen-plank', name: 'Copenhagen plank', modality: 'rehab', unit: 'seconds', equipment: ['bench'] },
  { slug: 'single-leg-balance', name: 'Single-leg balance', modality: 'rehab', unit: 'seconds', equipment: [] },
  { slug: 'heel-slide', name: 'Heel slide', modality: 'rehab', unit: 'reps', equipment: ['mat'] },
];
