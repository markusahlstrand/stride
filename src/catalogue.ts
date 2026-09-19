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

const EXERCISE_TABLE: ExerciseSeed[] = [
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
// HOW TO DO IT.
//
// One entry per exercise, and the shape is always the same three paragraphs:
//
//   1. the one line a LIST row shows — what it is, in a breath;
//   2. how to actually do it, in the order your body does it;
//   3. "Watch for:" — the mistake that makes the exercise a different exercise.
//
// Kept apart from the table above so the table stays a table. Paragraphs are
// split on a blank line; `src/module.ts` stores the whole string in
// `train_exercises.description` and the app splits it again to render it, so
// there is no second column and no migration behind any of this.
//
// Why it exists at all: the catalogue shipped with four descriptions out of 83,
// which meant a member reading "Assisted arm raise" got a name and a number of
// reps and no way to find out what either meant.
// ---------------------------------------------------------------------------
const HOW: Record<string, string> = {
  // --- barbell -------------------------------------------------------------
  'back-squat': `Barbell on the upper back, hips below parallel.

Set the bar across the muscle at the top of your back, not on the bone of your neck. Hands just outside the shoulders, chest up, and step back with two steps — no more. Break at the hips and knees together, sit down between your feet until the hip crease passes the knee, then drive back up.

Watch for: knees falling inwards on the way up, and the chest dropping so it turns into a good morning.`,
  'front-squat': `Barbell across the front of the shoulders, elbows high, upright chest.

The bar rests on the shelf your front delts make, with the fingertips under it only to stop it rolling — the shoulders carry it, not the wrists. Keep the elbows pointed forward and high the whole way down, sit straight down, and stand back up.

Watch for: the elbows dropping. The moment they do, the bar rolls forward and the lift is over.`,
  deadlift: `Bar on the floor, lift it to standing with a flat back.

Stand with the bar over your mid-foot, shins almost touching it. Push your hips back, take a grip just outside your knees, then pull your chest up and your shoulders back until your back is flat and tight. Push the floor away with your legs, and let the bar drag up your shins.

Watch for: hips shooting up first, which turns it into a round-backed lift. Hips and chest rise together.`,
  'romanian-deadlift': `From standing, hips back and the bar down the thighs — the legs stay nearly straight.

Start standing with the bar at your hips. Soften the knees slightly and then push your hips backwards, keeping the bar in contact with your legs the whole way down. Stop when you feel the stretch behind your thighs — usually somewhere below the knee — and drive the hips forward to stand.

Watch for: turning it into a squat. The knees barely move; the hips do everything.`,
  'bench-press': `Lying on a bench, bar from the chest to arms locked out.

Lie back with your eyes under the bar, feet flat on the floor, shoulder blades pulled together and down into the bench. Take the bar out, lower it under control until it touches the lower chest, then press it back up and slightly towards your face.

Watch for: bouncing the bar off the ribs, and the elbows flaring straight out to the sides — keep them at about 45 degrees.`,
  'incline-bench-press': `Bench set at an incline, bar from the upper chest to lockout.

Set the bench at about 30 degrees — higher than that and it becomes a shoulder press. Same setup as a flat bench: shoulder blades pinned, feet down. The bar touches higher on the chest, just under the collarbone.

Watch for: an incline so steep the shoulders take over from the chest.`,
  'overhead-press': `Standing, bar from the shoulders to locked out overhead.

Bar resting on the front of the shoulders, hands just outside them, elbows slightly in front of the bar. Squeeze your glutes and ribs down so you do not lean back, then press the bar up, moving your head back out of the way and pushing it through at the top so the bar finishes over the middle of your feet.

Watch for: leaning back to get the bar up. If it needs a lean, it is too heavy.`,
  'barbell-row': `Bent over with a flat back, bar pulled to the stomach.

Hinge at the hips until your chest is around 45 degrees or lower, knees slightly bent, back flat. Let the bar hang at arms' length, then pull it to your lower ribs by driving the elbows back, and lower it under control.

Watch for: standing up a little on every rep. The torso angle should not change.`,
  'hip-thrust': `Shoulders on a bench, barbell across the hips, drive the hips up.

Sit on the floor with your shoulder blades against the edge of a bench and the bar over your hips — use a pad. Feet flat, about shin-width apart. Drive through your heels until your body makes a straight line from knees to shoulders, squeeze at the top, then lower.

Watch for: arching the lower back at the top instead of finishing with the glutes. Tuck the ribs down.`,
  'power-clean': `Bar from the floor to the front of the shoulders in one movement.

Set up like a deadlift. Lift the bar smoothly to the knee, then accelerate hard by extending hips, knees and ankles. As the bar rises, pull yourself under it and catch it on the front of the shoulders with the elbows whipping through and the knees bent.

Watch for: rushing the first pull. Slow off the floor, fast at the hips — this is a technique lift, so leave the ego weight alone.`,

  // --- dumbbell ------------------------------------------------------------
  'dumbbell-bench-press': `Lying on a bench, two dumbbells from the chest to lockout.

Sit on the end of the bench with the dumbbells on your thighs, then kick them back as you lie down. Shoulder blades pinned, elbows at about 45 degrees. Lower until the dumbbells are level with your chest, then press them up.

Watch for: letting the dumbbells drift apart at the bottom. The range is bigger than a barbell gives you, which is the point — go down, not out.`,
  'dumbbell-shoulder-press': `Dumbbells from the shoulders to overhead, standing or seated.

Start with the dumbbells at shoulder height, palms facing forward, elbows slightly in front of the body rather than straight out to the sides. Press up until your arms are straight, then lower under control to the start.

Watch for: flaring the elbows wide, which grinds the front of the shoulder.`,
  'dumbbell-row': `One hand braced on a bench, a chair or your own knee.

Put one hand and the same-side knee on the bench so your back is flat and roughly horizontal. Let the other arm hang straight down with the dumbbell. Pull it to your hip by driving the elbow back and up, pause, and lower it all the way until the arm is long again.

Watch for: twisting the torso to get an extra inch. The shoulders should stay square to the floor. Log each arm.`,
  'dumbbell-lunge': `Step forward, back knee towards the floor, push back to standing.

Stand tall with a dumbbell in each hand. Step forward far enough that both knees end up at about 90 degrees, lower the back knee towards the floor without banging it, then push off the front foot to come back.

Watch for: a step that is too short, which pushes the front knee way past the toes and takes the work off the hips.`,
  'lateral-raise': `Arms out to the sides to shoulder height.

Stand with a dumbbell in each hand at your sides, a small bend in the elbow. Raise both arms out to the side until they are level with your shoulders, lead with the elbow rather than the hand, then lower slowly.

Watch for: swinging. This is a small-muscle exercise — light weights and no momentum.`,
  'single-arm-dumbbell-press': `Standing or seated, one dumbbell, press overhead. Log each arm.

One dumbbell at shoulder height, palm forward. Brace your middle so you do not lean away from the weight, then press straight up until the arm is locked, and lower under control.

Watch for: side-bending away from the dumbbell. Take the weaker arm first and match the other side to its reps.`,
  'single-arm-lateral-raise': `One arm out to the side to shoulder height. Log each arm.

Stand side-on with one dumbbell. Raise it out to the side to shoulder height with a soft elbow, then lower slowly. Hold something with the free hand if you need to stay still.

Watch for: shrugging the shoulder up towards the ear on the way. The shoulder stays down; the arm goes up.`,
  'bulgarian-split-squat': `Back foot on a bench, sink straight down on the front leg.

Stand a stride in front of a bench and rest the top of your back foot on it. Almost all your weight is on the front leg. Drop straight down until the back knee is close to the floor, then drive up through the front heel.

Watch for: leaning too far forward, or a front foot placed too close, which turns it into a knee-only lift. Log each leg.`,
  'single-leg-calf-raise': `Stand on one foot, rise onto the toes, lower slowly.

Stand on one foot, ideally with the ball of the foot on the edge of a step so the heel can drop below it. Hold something for balance. Push up as high onto the toes as you can, pause, and lower slowly all the way down.

Watch for: rushing the lower half. The slow drop is most of the work. Log each leg.`,
  'bicep-curl': `Curl the dumbbells from the sides to the shoulders.

Stand with the dumbbells at your sides, palms forward, elbows tucked in against your ribs. Curl up without letting the elbows drift forwards, then lower all the way until the arms are straight.

Watch for: swinging the hips to start the rep, and stopping halfway down.`,
  'goblet-squat': `Kettlebell held at the chest, squat between your feet.

Hold the kettlebell by the horns against your chest, elbows pointing down. Squat straight down, keeping the chest up and the elbows inside the knees, until the hips are below the knees, then stand.

Watch for: the weight drifting away from the chest, which pulls you forward.`,
  'dumbbell-squat': `One dumbbell held at the chest, or one in each hand at the sides.

Feet about shoulder-width apart, toes turned out slightly. Sit down between your feet, keeping the chest up, until the hips pass below the knees. Drive back up through the middle of the foot.

Watch for: the heels lifting. If they do, widen the stance a little or turn the toes out more.`,
  'dumbbell-romanian-deadlift': `Hips back, dumbbells down the thighs, flat back.

Stand with the dumbbells in front of your thighs. Soften the knees, push the hips backwards and let the dumbbells slide down the front of your legs. Stop at the stretch behind the thighs and drive the hips forward to stand.

Watch for: rounding the upper back to reach lower. The range is however far the hips can travel with a flat back, and no further.`,
  'single-arm-biceps-curl': `Curl one dumbbell from the side to the shoulder. Log each arm.

Elbow tucked to your ribs, palm forward. Curl up without moving the upper arm, squeeze, then lower all the way until the arm is straight.

Watch for: leaning to the side as you curl. Stand square and let the arm do it.`,

  // --- kettlebell ----------------------------------------------------------
  'kettlebell-swing': `Hinge at the hips and snap the bell forward to chest height.

Stand with the bell an arm's length in front of you. Hinge, tip it back between your legs, then snap the hips forward hard so the bell floats up to about chest height on its own. Let it fall back between the legs and repeat.

Watch for: lifting it with the shoulders. This is a hip movement — the arms are rope.`,
  'turkish-get-up': `Lying down with a weight overhead, stand up without letting it drop.

Lie on your back with the bell locked out over one shoulder, same-side knee bent. Roll onto your free elbow, then your hand, bridge the hips up, sweep the straight leg through to a half-kneeling position, and stand. Reverse every step to come back down.

Watch for: hurrying it. Go one step at a time, eyes on the bell the whole way. Log each side.`,
  'kettlebell-clean': `Bring the bell from between the legs to the front of the shoulder.

Hinge and swing the bell back between your legs, then drive the hips through and guide it up close to the body, spinning your hand around it so it lands softly on the back of the forearm in the rack position.

Watch for: letting it flip over and bang the wrist. It should roll around your hand, not crash onto it.`,

  // --- machines ------------------------------------------------------------
  'lat-pulldown': `Seated, pull the bar down to the upper chest.

Set the thigh pad so you cannot lift off the seat. Take a grip a little wider than your shoulders, lean back slightly, and pull the bar down to your collarbone by driving your elbows down and back. Let it rise all the way until the arms are straight.

Watch for: leaning way back and using the whole body. If you have to, drop the weight.`,
  'seated-cable-row': `Seated, pull the handle to the stomach and let it back out.

Sit tall with a slight knee bend and the chest up. Pull the handle to your lower ribs, driving the elbows back past your sides, then let it out until your arms are straight and you feel the stretch across the back.

Watch for: rowing with the lower back by rocking back and forth. The torso stays upright.`,
  'cable-triceps-pushdown': `Elbows at your ribs, straighten the arms down.

Face the machine with the bar or rope at chest height. Pin your elbows against your ribs and keep them there. Straighten your arms until they are locked, squeeze, and let the weight bring them back up to about 90 degrees.

Watch for: the elbows travelling forwards and backwards. If they move, your back is doing the work.`,
  'cable-woodchop': `Pull the cable diagonally across the body, from high to low or low to high.

Stand side-on to the machine with both hands on the handle. Keeping your arms mostly straight, rotate through your middle and pull the handle diagonally across your body, letting the back foot pivot. Control it back to the start.

Watch for: turning it into an arm exercise. The rotation comes from the torso and hips. Log each direction.`,
  'leg-press': `Push the platform away with both legs, then let it come back.

Feet about shoulder-width apart on the middle of the platform. Release the safeties and lower the platform until your knees are at roughly 90 degrees, or as far as you can go without the hips curling off the seat. Push back up without locking the knees hard.

Watch for: the lower back rounding off the pad at the bottom — stop above that point.`,
  'leg-curl': `Lying face down, curl the heels towards the hips.

Line your knees up with the pivot of the machine, pad just above the heels. Curl your heels up as far as they go, pause, and lower slowly under control.

Watch for: the hips lifting off the pad to get more range. Keep them down.`,
  'leg-extension': `Seated, straighten the legs against the pad.

Sit with the back of your knees against the edge of the seat and the pad just above your ankles. Straighten your legs until they are out in front of you, hold for a beat, and lower slowly.

Watch for: slamming into lockout. Get there under control.`,
  'chest-press-machine': `Seated, press the handles away from the chest.

Set the seat so the handles line up with the middle of your chest. Keep your back against the pad and your shoulder blades down, press the handles out until your arms are straight, and let them come back until you feel the chest stretch.

Watch for: shrugging the shoulders forward at the end of the press.`,

  // --- bodyweight ----------------------------------------------------------
  'push-up': `Hands under the shoulders, chest to the floor and back up.

Hands a little wider than the shoulders, body in one straight line from heels to head. Lower until your chest is just off the floor, elbows at about 45 degrees to the body, then push back up.

Watch for: the hips sagging or piling up. Squeeze the glutes and the middle so the whole body moves as one piece. Knees on the floor is a real version of this, not a lesser one.`,
  'bodyweight-squat': `Sit down between your feet and stand back up.

Feet about shoulder-width apart, toes turned out a little, arms out in front for balance. Sit straight down until the hips pass below the knees, then stand.

Watch for: knees collapsing inwards. Push them out over the middle toes on the way up.`,
  'walking-lunge': `Step forward, sink, then step through with the other leg.

Take a long step forward, lower the back knee towards the floor, then push through the front foot and bring the back leg straight through into the next step. Keep walking.

Watch for: a short step, which puts everything on the front knee. Count one rep per leg.`,
  'calf-raise': `Rise onto the toes, lower slowly.

Stand tall, ideally with the balls of your feet on a step so the heels can drop below. Push up as high as you can, pause at the top, and lower slowly all the way down.

Watch for: fast little bounces. Slow at both ends.`,
  burpee: `Down to the floor, chest down, back up, jump.

From standing, drop your hands to the floor and kick your feet back into a push-up position. Let the chest touch, push back up, jump the feet in under your hips, and stand up and jump with the hands overhead.

Watch for: pacing. It is a whole-body sprint and it will take your breath faster than you expect.`,
  'pull-up': `Hang from the bar, pull until the chin is over it.

Grip the bar a little wider than your shoulders, palms facing away. Start from a full hang with the arms straight. Pull your elbows down to your sides until your chin clears the bar, then lower all the way back down.

Watch for: half reps. A pull-up starts from a straight-arm hang; a band or a foot on a box to help is a better rep than a short one.`,
  'chin-up': `Hang with the palms facing you, pull until the chin is over the bar.

Hands about shoulder-width apart, palms towards you. From a full hang, pull your chest towards the bar, then lower all the way.

Watch for: the same half rep as the pull-up. The palms-towards-you grip brings the biceps in, so most people can do more of these.`,
  'hanging-knee-raise': `Hang from the bar and lift the knees to hip height.

Hang with the arms straight and the shoulders active, not slumped. Lift both knees up towards your chest by curling the hips slightly, pause, and lower under control.

Watch for: swinging. If you are using the swing, shorten the range until you are not.`,
  dip: `Support yourself on the bars, lower until the shoulders are level with the elbows, press back up.

Get on the bars with the arms straight, shoulders down. Lean forward slightly, lower under control until your upper arms are about parallel with the floor, then press back up.

Watch for: going too deep. Stop at the point where the shoulder starts to roll forwards.`,
  'box-jump': `Dip, jump onto the box, stand all the way up.

Stand a short step from the box. Dip at the hips and knees, swing the arms, and jump up onto the box, landing softly with both feet flat and the knees bent. Stand up straight, then step back down.

Watch for: jumping down. Step down every time — the landing is where box jumps hurt people.`,
  'trx-row': `Lean back on the straps and pull your chest to your hands.

Hold the handles and walk your feet forward so you are leaning back with your body in a straight line. Arms straight to start. Pull your chest up to your hands, elbows tucked, then lower.

Watch for: the hips dropping. The whole body stays in one line. Walk the feet forward to make it harder, back to make it easier.`,

  // --- core & mobility -----------------------------------------------------
  plank: `Forearms and toes on the floor, body in one straight line.

Elbows under the shoulders, forearms flat. Push the floor away so your upper back is not sagging, squeeze the glutes and pull the ribs down so there is no arch in the lower back. Breathe.

Watch for: a hold that is technically longer but sagging. Stop the set when the line goes, not when the clock does.`,
  'side-plank': `On one forearm and the side of the foot, hips lifted.

Lie on your side with the elbow under the shoulder and the feet stacked. Lift the hips until your body makes a straight line from ankle to head, and hold. The top hand can rest on the hip.

Watch for: rolling forwards or letting the hips sink. Log each side.`,
  'hollow-hold': `On your back, lower back pressed flat, arms and legs off the floor.

Lie on your back and press your lower back into the floor. Lift your head, shoulders and legs off the floor and reach the arms past your ears. The lower back must stay pressed down the whole time.

Watch for: an arch appearing under the back. The moment it does, raise the legs higher or bend the knees — do not push through it.`,
  'glute-bridge': `Lying down, drive the hips up until knees, hips and shoulders line up.

Lie on your back, knees bent, feet flat and about hip-width apart, heels close enough to brush with your fingertips. Push through the heels and lift the hips until your body makes a straight line from knee to shoulder. Squeeze, then lower.

Watch for: arching the lower back at the top instead of finishing with the glutes.`,
  'single-leg-glute-bridge': `The same bridge on one leg — the other knee stays tucked.

Set up as a glute bridge, then lift one foot and hug that knee towards your chest. Drive through the heel on the floor until the hips are level and in line with the shoulders. Do not let the raised side drop.

Watch for: the hips tilting. Keeping them level is the whole exercise. Log each side.`,
  'bird-dog': `On hands and knees, reach the opposite arm and leg out long.

Hands under shoulders, knees under hips, back flat. Reach one arm forward and the opposite leg back until both are level with your body, hold for a beat, then come back and swap.

Watch for: the hips rocking side to side. Move slowly enough that a glass of water on your back would stay put.`,
  'dead-bug': `On your back, lower the opposite arm and leg without letting the back arch.

Lie on your back with the arms straight up and the knees over the hips at 90 degrees. Press the lower back into the floor. Slowly lower one arm behind you and the opposite leg towards the floor, come back, and swap.

Watch for: the lower back lifting off the floor. Stop the reach where the back stays down.`,
  'mountain-climber': `In a push-up position, drive the knees to the chest one at a time.

Start in a push-up position with the hands under the shoulders and the body in one line. Drive one knee towards your chest, then swap, as if running on the spot with your hands on the floor.

Watch for: the hips bouncing up and down. Keep them level and let the legs do the moving.`,
  'hip-flexor-stretch': `Half-kneeling, press the hips forward until you feel the front of the back hip.

Kneel on one knee with the other foot flat in front, both knees at about 90 degrees. Squeeze the glute of the kneeling side and tuck the tailbone under, then ease the hips forward until you feel a stretch at the front of the hip. Breathe and hold.

Watch for: arching the lower back to get further forward, which puts the stretch in the wrong place. Log each side.`,
  'thoracic-rotation': `Open the upper back by rotating the chest towards the ceiling.

Lie on your side with the knees bent and stacked, arms straight out in front, palms together. Keep the knees down and sweep the top arm across your body and open until the chest faces the ceiling, following the hand with your eyes. Come back slowly.

Watch for: the knees lifting. Rotation should come from the ribs, not the hips. Log each side.`,
  'wall-slide': `Forearms on the wall, slide them up without shrugging.

Stand a step from a wall, facing it, forearms flat against it with the elbows at about shoulder height. Keep your ribs down and your back flat, then slide the forearms up the wall as high as they go with the arms still touching.

Watch for: the shoulders climbing towards the ears, or the ribs flaring so the back arches. The range that keeps both honest is the range that counts.`,

  // --- cardio --------------------------------------------------------------
  rowing: `Legs, then back, then arms — and the reverse on the way out.

Sit with shins vertical, arms long and the shoulders in front of the hips. Push with the legs first, then swing the torso back, and only then pull the handle to the ribs. Out is the reverse: arms away, then body, then bend the knees.

Watch for: pulling with the arms first. It costs you most of the power. Logged in metres — the number on the monitor.`,
  'treadmill-run': `Run on the treadmill. Logged in metres.

Set the pace and start easy. A slight nudge of the incline — around one per cent — makes a treadmill feel like the road.

Watch for: holding the handrails, which changes everything about how you run. Log the time and, if you have it, average heart rate.`,
  'stationary-bike': `Pedal. Logged in metres.

Set the saddle so your leg is nearly straight at the bottom of the pedal stroke, with a small bend left. Sit tall and pedal smoothly, pushing all the way round rather than stamping down.

Watch for: a saddle set too low, which is the quickest way to make the front of the knee ache.`,
  'ski-erg': `Pull both handles down from overhead to the hips.

Stand tall with the handles above your head. Pull them down and past your hips by hinging at the hips and using your whole body, not just your arms, then rise and reach up again.

Watch for: doing it with the arms alone. The power comes from the hips.`,
  'jump-rope': `Skip. Logged in seconds.

Elbows in at your sides, wrists doing the turning, small hops just high enough to clear the rope. Land on the balls of the feet.

Watch for: big arm circles and high jumps. Both wear you out long before your calves do.`,
  elliptical: `Stride on the elliptical. Logged in metres.

Stand tall, keep your weight through the whole foot and push and pull the handles so the arms share the work.

Watch for: leaning on the handles and letting the machine carry you.`,
  'stair-climber': `Climb. Logged in seconds.

Stand upright, step all the way onto each stair, and let your legs carry you rather than hanging off the rails.

Watch for: gripping the handles and leaning back, which turns a hard machine into an easy one.`,
  'assault-bike': `Push and pull the handles while you pedal. Logged in metres.

Arms and legs both work. Set a pace you can hold — this machine punishes an enthusiastic first thirty seconds harder than almost anything else in a gym.

Watch for: going out too hard.`,
  'sled-push': `Get behind the sled and drive it. Logged in metres.

Hands on the uprights, arms straight, body leaning into it in one line from heel to head. Take short, hard steps and keep driving — do not let it stop, because starting it again is the expensive part.

Watch for: standing too upright, which turns the push into a shuffle.`,
  'battle-ropes': `Whip the ropes. Logged in seconds.

Hold one end in each hand, stand in a quarter squat with the chest up, and drive the ropes up and down in alternating waves that travel all the way to the anchor.

Watch for: standing up straight as you tire, which is when the waves stop reaching the far end.`,
  'swim-freestyle': `Front crawl. Logged in metres.

Reach forward, catch the water, and pull past your hip; breathe to the side by rotating your body rather than lifting your head. Kick from the hip, small and steady.

Watch for: lifting the head to breathe, which drops the hips and stops you moving.`,
  'run-outdoor': `Run outside. Logged in metres.

Easy means you can hold a conversation. Land under your body rather than reaching out in front, and keep the steps quick and light.

Watch for: making every run a hard run. Most of them should be easy. Log the time and, if you have it, average heart rate.`,
  walk: `Walk. Logged in metres.

Brisk enough that you notice your breathing, relaxed enough to keep going. It counts, and on a rest day it is often the most useful thing you can do.

Watch for: nothing. This is the one exercise with no way to do it wrong.`,
  'cycle-outdoor': `Ride outside. Logged in metres.

Saddle height so the leg is nearly straight at the bottom of the stroke. Spin at a comfortable cadence rather than grinding a big gear.

Watch for: a saddle too low — the same sore knee as on the stationary bike, for the same reason.`,
  'shuttle-run': `Run between two points, turning at each end. Logged in metres.

Mark two lines. Run flat out to the far one, touch it, turn and run back. The turns are the hard part and the point of it.

Watch for: taking the turns wide. Drop the hips and change direction sharply.`,
  'high-knees': `Run on the spot, knees to hip height. Logged in seconds.

Stay tall, drive the knees up to hip height, land on the balls of the feet, arms moving as if you were running.

Watch for: leaning back to get the knees higher.`,
  'jumping-jack': `Jump the feet out and the arms overhead, then back.

Start with feet together and arms at your sides. Jump the feet out wider than your shoulders while sweeping the arms overhead, then jump back to the start. That is one rep.

Watch for: half-raised arms as you tire. All the way up each time.`,

  // --- rehab ---------------------------------------------------------------
  'band-external-rotation': `Elbow pinned to the ribs, rotate the forearm outwards against the band.

Stand side-on to where the band is anchored, at about elbow height. Hold the band in the hand furthest from the anchor, elbow bent to 90 degrees and tucked against your ribs — a rolled towel under it helps. Keeping the elbow there, rotate your forearm away from your stomach, then come back slowly.

Watch for: the elbow leaving your side, which lets the shoulder do the work the rotators are meant to do. Light band, slow. Log each arm.`,
  'band-pull-apart': `Band at arms' length in front, pull it apart until the shoulder blades meet.

Hold the band with both hands at chest height, arms straight out in front, hands about shoulder-width apart. Pull your hands apart and out to the sides until the band touches your chest, squeezing the shoulder blades together, then return slowly.

Watch for: shrugging, and bending the elbows to make it easier. Keep the shoulders down and the arms long.`,
  'shoulder-abduction': `Raise the arm out to the side, only as far as it goes without a shrug.

Stand tall with the band or a light weight in one hand at your side. Raise the arm out to the side, thumb up, keeping the shoulder down, and stop at the height where the shoulder starts to climb towards your ear.

Watch for: the shrug. That height is your range today, and it is the number worth watching. Log each arm.`,
  clamshell: `Lying on your side with the knees bent, open the top knee without rolling the hips.

Lie on your side with the hips and knees bent, knees stacked and heels in line with your backside. Band around the thighs just above the knees. Keeping the feet together and the hips absolutely still, lift the top knee, then lower it slowly.

Watch for: rolling backwards to get more range. Put a hand on the top hip — if it moves, the range is too big. Log each side.`,
  'ankle-dorsiflexion': `Pull the toes back towards you against the band.

Sit with the leg straight out in front and the band looped around the ball of the foot, anchored to something in front of you. Keeping the leg still, pull the toes back towards your shin as far as they go, then let them slowly point away again.

Watch for: the whole leg rolling or the knee bending. Only the ankle moves. Log each side.`,
  'copenhagen-plank': `Side plank with the top leg on a bench — the inner thigh holds you up.

Lie on your side with your forearm on the floor and the inside of your top ankle or knee resting on a bench. Lift the hips until your body is in a straight line, taking the weight through the leg on the bench.

Watch for: starting with the ankle on the bench. Begin with the knee on it — the short version is hard enough, and the long version tears groins. Log each side.`,
  'single-leg-balance': `Stand on one foot and stay still.

Stand on one foot with a soft knee and the other foot off the floor. Look at a fixed point and stay there for the time. When it gets easy, close your eyes, or stand on something soft.

Watch for: a foot that keeps touching down. Stop the clock and start again rather than counting the time you were on two feet. Log each side.`,
  'heel-slide': `Lying down, slide the heel towards you to bend the knee, then straighten it.

Lie on your back with the leg straight. Slide the heel along the floor towards your backside, bending the knee as far as it comfortably goes, hold for a moment, then slide it back out until the leg is straight.

Watch for: pushing into pain. This is a range exercise after surgery or injury — go to the edge of comfort, not past it. Log each side.`,
  'assisted-arm-raise': `Raise the arm forward and up as far as it goes, the other hand helping on the way. Log each arm; note how high it went.

Stand or sit tall. Let the working arm hang down in front of you and cup the wrist or forearm with your other hand. Using the good arm to take some of the weight, lift the working arm forward and up as far as it will go without pain and without the shoulder shrugging up. Lower it slowly, still supported.

Watch for: the shoulder climbing towards the ear, or leaning back to get higher. The height is the number that should be growing, so it is worth writing down.`,
};

// ---------------------------------------------------------------------------
// WHERE THE WEIGHT GOES.
//
// The set form has one `load` box for every exercise that is not cardio, and
// one box that means a different thing on every row is worse than no box. A
// single-leg glute bridge is the case that made this obvious: the number is not
// your bodyweight, it is not nothing, and the dumbbell does not go on your
// belly — it goes across the hip crease of the working side. Nothing in the app
// said so, so the honest answer was a shrug.
//
// One convention, stated on every row:
//
//   * the load is the WEIGHT BEING MOVED, added up — a bar plus its plates, a
//     pair of dumbbells together, the pin setting on a stack;
//   * on a bodyweight movement it is the ADDED weight only, never your body,
//     and blank means bodyweight, which is the normal entry;
//   * where there is nothing sensible to put in it, the row says so rather than
//     leaving an empty box to be guessed at.
//
// Folded in as a fourth paragraph — `Load: …` — so it travels in the one
// `description` column the app already reads and splits. No second column, no
// migration, and an exercise a member wrote themselves simply has no such
// paragraph and renders without one.
// ---------------------------------------------------------------------------

/** A loaded bar: the number is the whole thing, not the plates you added. */
const BAR = 'The bar and the plates on it, added up — a full-size bar is 20 kg on its own, so a 20 with two 10s is 40.';
/** Two dumbbells, one number. Stated on every pair, because the alternative
 *  convention (log one of them) is just as common in gyms and silently halves
 *  every volume the app computes. */
const PAIR = 'Both dumbbells added together: two 12s is 24. One number per set, so it means the same thing whatever you happen to be holding.';
/** One implement, one arm — and the two arms are two numbers. */
const ONE_HAND = 'The single dumbbell in the working hand. Each side is logged on its own, so the two arms may carry different numbers — after an injury they usually should.';
/** A bodyweight movement somebody can hang weight off. */
const ADDED = 'Added weight only, never your own body. Blank means bodyweight, and blank is the normal entry.';
/** The stack. Honest about what the number is worth. */
const STACK = 'Whatever the pin or the plates say. Machine numbers do not travel between one gym and the next, so this one is only ever compared with itself.';
/** Bands have no honest kilo. */
const BAND = 'A band is not kilos. Leave the load blank and put the colour in the row note — band ratings are not comparable between brands, so reps and how clean they stayed are the real measure.';
const CARDIO_DISTANCE = 'No load: a cardio row asks for the time instead of a weight, and pace falls out of the distance and the time.';
const CARDIO_TIME = 'No load: the row is a stretch of time, and the effort beside it is average heart rate rather than a weight.';

const LOAD: Record<string, string> = {
  // --- barbell -------------------------------------------------------------
  'back-squat': BAR,
  'front-squat': BAR,
  deadlift: BAR,
  'romanian-deadlift': BAR,
  'bench-press': BAR,
  'incline-bench-press': BAR,
  'overhead-press': BAR,
  'barbell-row': BAR,
  'hip-thrust': `${BAR} It rests across the hip crease — high on the hips, not on the belly — with a pad or a folded mat under it, and that is the only place it works from.`,
  'power-clean': `${BAR} Keep it light: the technique goes long before the legs do.`,

  // --- dumbbell ------------------------------------------------------------
  'dumbbell-bench-press': PAIR,
  'dumbbell-shoulder-press': PAIR,
  'dumbbell-row': ONE_HAND,
  'dumbbell-lunge': `${PAIR} One dumbbell held at the chest instead is the same idea — log what you are carrying, in total.`,
  'lateral-raise': `${PAIR} Small numbers are the right numbers here: a straight arm is a long lever, and 4 kg raised slowly beats 10 kg swung.`,
  'single-arm-dumbbell-press': ONE_HAND,
  'single-arm-lateral-raise': `${ONE_HAND} Two to four kilos is a real working weight for most people.`,
  'bulgarian-split-squat': 'Nothing to start with — nearly all of you is already on one leg. When you add dumbbells at your sides, log the pair added together; blank means bodyweight.',
  'single-leg-calf-raise': 'Nothing to start with. A dumbbell in the free hand is the usual next step, and that dumbbell is the number; blank means bodyweight.',
  'bicep-curl': PAIR,
  'goblet-squat': 'The kettlebell at your chest, and that is the whole of it.',
  'dumbbell-squat': 'One dumbbell at the chest: that dumbbell. One in each hand: both added together. Either way the number is what you are holding, in total.',
  'dumbbell-romanian-deadlift': PAIR,
  'single-arm-biceps-curl': ONE_HAND,

  // --- kettlebell ----------------------------------------------------------
  'kettlebell-swing': 'The bell. Swings run heavier than they look — the hips throw it, so a bell you could not press overhead is normal here.',
  'turkish-get-up': 'The one bell overhead, logged per side.',
  'kettlebell-clean': 'The bell.',

  // --- machines ------------------------------------------------------------
  'lat-pulldown': STACK,
  'seated-cable-row': STACK,
  'cable-triceps-pushdown': STACK,
  'cable-woodchop': `${STACK} Logged per direction, the way the reps are.`,
  'leg-press': `${STACK} On a plate-loaded sled it is the plates as marked — the carriage's own weight is not in the number.`,
  'leg-curl': STACK,
  'leg-extension': STACK,
  'chest-press-machine': STACK,

  // --- bodyweight ----------------------------------------------------------
  'push-up': `${ADDED} A plate on the upper back or a weighted vest is what goes in the box.`,
  'bodyweight-squat': `${ADDED} The moment you hold a weight it has become a goblet or dumbbell squat — log it as one, and this row stays the bodyweight one it is measuring.`,
  'walking-lunge': `${ADDED} Dumbbells at your sides, added together.`,
  'calf-raise': `${ADDED} Whatever you are holding, added together.`,
  burpee: 'No load, and no load box — a burpee is logged as reps and the time they took.',
  'pull-up': `${ADDED} A belt and plates, or a dumbbell between the feet. A band or a foot on a box takes weight OFF, and there is nowhere to log a negative: leave it blank and say which help you used in the row note.`,
  'chin-up': `${ADDED} Belt, plates, or a dumbbell between the feet. Assistance from a band has nowhere to go in the number — put it in the row note.`,
  'hanging-knee-raise': `${ADDED} A dumbbell squeezed between the feet is the usual way.`,
  dip: `${ADDED} Belt and plates, or a dumbbell between the feet.`,
  'box-jump': 'No load — and no load box, because a box jump is timed. The box height is the progression, so it belongs in the row note: "50 cm".',
  'trx-row': 'No weight — your angle is the load. Walking the feet forward makes it harder, and that is the progression worth writing in the row note.',

  // --- core & mobility -----------------------------------------------------
  plank: 'Nothing, normally — a plank is measured by the clock. If somebody lays a plate on your upper back, that plate is the number.',
  'side-plank': 'Nothing. Time, and hips that stay up, are the measure.',
  'hollow-hold': 'Nothing. The shape is the difficulty: straighter arms and legs is how it gets harder.',
  'glute-bridge': 'Nothing to start with. Loaded, the weight goes ACROSS THE HIPS — a dumbbell, a plate or a kettlebell resting in the hip crease, held there with both hands, padded with a folded towel. Not on the belly: on the belly it presses into your stomach and lands nowhere near the glutes that are lifting it. Log what is on you; blank means bodyweight.',
  'single-leg-glute-bridge': 'Usually nothing — one leg is already most of the load, which is why the baseline does it unweighted. If you do load it, a single dumbbell goes across the hips on the WORKING side, in the hip crease and held with that hand, never on the belly. Log that dumbbell; blank means bodyweight.',
  'bird-dog': 'Nothing. It is a control exercise — slower and longer is how it gets harder, never heavier.',
  'dead-bug': 'Nothing. Reach further and lower, not heavier.',
  'mountain-climber': 'No load — this row is timed.',
  'hip-flexor-stretch': 'Nothing. It is a stretch, held for the time.',
  'thoracic-rotation': 'Nothing. Range is the entire point.',
  'wall-slide': 'Nothing. How high the forearms go with the ribs still down is the number worth watching.',

  // --- cardio --------------------------------------------------------------
  rowing: `${CARDIO_DISTANCE} The damper setting is not a weight; if you move it, say so in the row note.`,
  'treadmill-run': `${CARDIO_DISTANCE} Incline is not load either — note it when it was more than a nudge.`,
  'stationary-bike': `${CARDIO_DISTANCE} Resistance level belongs in the row note.`,
  'ski-erg': CARDIO_DISTANCE,
  'jump-rope': CARDIO_TIME,
  elliptical: CARDIO_DISTANCE,
  'stair-climber': `${CARDIO_TIME} The level belongs in the row note.`,
  'assault-bike': CARDIO_DISTANCE,
  'sled-push': 'The plates on the sled ARE the load — and this is the one row with nowhere to put them, because a cardio row logs distance and time instead of weight. Write the sled weight in the row note, or the next push is not comparable with this one.',
  'battle-ropes': CARDIO_TIME,
  'swim-freestyle': CARDIO_DISTANCE,
  'run-outdoor': CARDIO_DISTANCE,
  walk: CARDIO_DISTANCE,
  'cycle-outdoor': CARDIO_DISTANCE,
  'shuttle-run': CARDIO_DISTANCE,
  'high-knees': CARDIO_TIME,
  'jumping-jack': 'No load — reps, and the time they took.',

  // --- rehab ---------------------------------------------------------------
  'band-external-rotation': BAND,
  'band-pull-apart': BAND,
  'shoulder-abduction': 'A light dumbbell goes in the box — the one in the raising hand, where one or two kilos is a working weight. With a band instead, leave it blank and put the colour in the row note.',
  clamshell: BAND,
  'ankle-dorsiflexion': BAND,
  'copenhagen-plank': 'No weight. The lever is the load: the knee on the bench is the short version, the ankle on it the long one, and moving between the two is the progression.',
  'single-leg-balance': 'No weight. Eyes closed, or something soft underfoot, is how this one gets harder.',
  'heel-slide': 'No weight, ever. This is a range exercise — how far the knee bends is the number.',
  'assisted-arm-raise': 'No weight, and none for a long while yet. How high the arm goes is the number that should be growing.',
};

/**
 * The catalogue as the installer publishes it: the table above, with the how-to
 * and the load note folded in. An entry in HOW wins over a description written
 * inline, because HOW is where descriptions live now; LOAD is appended after
 * it, so a full library row is four paragraphs — summary, how-to, "Watch for:",
 * "Load:".
 */
export const EXERCISES: ExerciseSeed[] = EXERCISE_TABLE.map((exercise) => {
  const how = HOW[exercise.slug] ?? exercise.description;
  const load = LOAD[exercise.slug];
  const description = [how, load === undefined ? undefined : `Load: ${load}`]
    .filter((p): p is string => p !== undefined && p !== '')
    .join('\n\n');
  return description === '' ? exercise : { ...exercise, description };
});

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
      { exercise: 'back-squat', targetSets: 3, targetReps: 5, targetLoad: '60', recurDays: '1,3,5', notes: 'Bar and plates together — 60 kg in total.' },
      { exercise: 'bench-press', targetSets: 3, targetReps: 8, targetLoad: '40', recurDays: '1,3,5', notes: 'Bar and plates together — 40 kg in total.' },
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
      { exercise: 'dumbbell-shoulder-press', targetSets: 3, targetReps: 10, targetLoad: '14', groupKey: 'A', recurDays: '2,5', notes: 'Two 7 kg dumbbells — the pair added together.' },
      { exercise: 'dumbbell-row', targetSets: 3, targetReps: 10, targetLoad: '20', groupKey: 'A', recurDays: '2,5', notes: 'One 20 kg dumbbell, each arm.' },
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
      { exercise: 'dumbbell-squat', targetSets: 1, targetReps: 10, targetLoad: '10', notes: 'One 10 kg dumbbell held at the chest. As many as you can, same depth every time.' },
      { exercise: 'dumbbell-romanian-deadlift', targetSets: 1, targetReps: 10, targetLoad: '10', notes: 'Two 5 kg dumbbells — 10 kg in total. As many as stay flat-backed.' },
      { exercise: 'single-leg-glute-bridge', targetSets: 1, targetReps: 10, notes: 'Each leg, unweighted. Stop when the hips drop.' },
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
