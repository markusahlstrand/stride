// ============================================================================
// THE MOVEMENTS. A pose is a person; a MOVE is a person doing something, drawn
// twice — where the rep starts and where it ends — with the mint arrow between
// them saying which way it goes.
//
// Why two frames: a single figure can only say "this is a person with weights".
// Two say "the bar goes from here to here", which is the one thing somebody
// reading an exercise for the first time actually needs. "Assisted arm raise"
// is the case that forced it.
//
// Same grid and the same rules as `figures.tsx`: 120 × 120, ink for the body,
// `--accent` for the kit, feet on y = 108. The drawings stay `aria-hidden`; the
// caption under each frame and the how-to beside them carry the fact in words,
// so nothing here is the only place a reader can learn something.
//
// `moveFor(name, unit)` picks one off the exercise's NAME, exactly as
// `poseFor` does and for the same reason — the name is the one thing every row
// carries. Order in RULES matters: "Bulgarian split squat" must meet `lunge`
// before it meets `squat`.
// ============================================================================
import { Dumbbell, Eye, Eyes, Head, Kit, Mat, POSES } from './figures';

export type Move =
  | 'squat'
  | 'hinge'
  | 'lunge'
  | 'calf'
  | 'bridge'
  | 'legcurl'
  | 'legext'
  | 'bench'
  | 'pushup'
  | 'press'
  | 'raise'
  | 'armraise'
  | 'wallslide'
  | 'extrot'
  | 'pullapart'
  | 'row'
  | 'pullup'
  | 'kneeraise'
  | 'curl'
  | 'pushdown'
  | 'plank'
  | 'sideplank'
  | 'birddog'
  | 'clamshell'
  | 'ankle'
  | 'balance'
  | 'stretch'
  | 'run'
  | 'cycle'
  | 'rowerg'
  | 'jump'
  | 'rope'
  | 'sled'
  | 'ropes'
  | 'stairs'
  | 'swim';

export interface Movement {
  /** Where the rep starts. */
  a: React.ReactNode;
  /** Where it ends — the half most people picture, so it is the thumbnail. */
  b: React.ReactNode;
  /** Two or three words under each frame. Text, so it is readable. */
  from: string;
  to: string;
}

/** A mint band — a resistance band, a cable, a rope, the surface of a pool. */
const Band = ({ d }: { d: string }) => <path className="fig-band" d={d} />;
/** The floor, when a figure needs something to be standing on. */
const Ground = () => <path className="fig-thin" d="M12 108H108" />;

export const MOVES: Record<Move, Movement> = {
  // --- legs ---------------------------------------------------------------
  squat: {
    from: 'stand tall',
    to: 'hips below the knees',
    a: (
      <>
        <Ground />
        <path d="M60 42V74M60 74L48 108M60 74L72 108M60 50L44 62M60 50L76 62" />
        <Head x={60} y={31} />
        <Eyes x={60} y={30} />
      </>
    ),
    b: (
      <>
        <Ground />
        <path d="M60 52V70M60 70L40 84L44 108M60 70L80 84L76 108M60 56L42 58M60 56L78 58" />
        <Head x={60} y={41} />
        <Eyes x={60} y={40} />
      </>
    ),
  },
  hinge: {
    from: 'hips back, bar at the shins',
    to: 'stand tall',
    a: (
      <>
        <path d="M46 52L68 72M68 72L66 108M50 58L54 84" />
        <Head x={38} y={44} r={9.5} />
        <Eye x={34} y={46} />
        <Dumbbell x={54} y={88} />
      </>
    ),
    b: (
      <>
        <path d="M60 42V76M60 76L52 108M60 76L68 108M58 50L56 82" />
        <Head x={60} y={31} />
        <Eye x={64.5} y={30} />
        <Dumbbell x={56} y={86} />
      </>
    ),
  },
  lunge: {
    from: 'stand',
    to: 'back knee down',
    a: (
      <>
        <path d="M58 38V70M58 70L52 108M58 70L64 108M58 44L56 72" />
        <Dumbbell x={56} y={76} />
        <Head x={58} y={27} />
        <Eye x={62.5} y={26} />
      </>
    ),
    b: POSES.lunge,
  },
  calf: {
    from: 'heels down',
    to: 'up on the toes',
    a: (
      <>
        <Ground />
        <path d="M60 42V76M60 76L50 108M60 76L70 108M60 50L46 70M60 50L74 70" />
        <Head x={60} y={31} />
        <Eyes x={60} y={30} />
      </>
    ),
    b: (
      <>
        <Ground />
        <path d="M60 34V68M60 68L50 98L56 108M60 68L70 98L64 108M60 42L46 62M60 42L74 62" />
        <Head x={60} y={23} />
        <Eyes x={60} y={22} />
      </>
    ),
  },
  bridge: {
    from: 'hips on the floor',
    to: 'hips up, ribs to knees in a line',
    a: (
      <>
        <Mat />
        <path d="M32 98H72M72 98L90 76M90 76L98 100M34 97L30 88" />
        <Head x={22} y={94} r={9.5} />
        <Eye x={20} y={91} />
      </>
    ),
    b: (
      <>
        <Mat />
        <path d="M32 98L72 76M72 76L90 72M90 72L98 100M34 97L30 88" />
        <Head x={22} y={94} r={9.5} />
        <Eye x={20} y={91} />
      </>
    ),
  },
  legcurl: {
    from: 'leg long',
    to: 'heel towards the hips',
    a: (
      <>
        <Mat />
        <path d="M36 94L72 97L104 99" />
        <Head x={26} y={90} r={9.5} />
        <Eye x={24} y={87} />
      </>
    ),
    b: (
      <>
        <Mat />
        <path d="M36 94L72 97L92 74" />
        <Head x={26} y={90} r={9.5} />
        <Eye x={24} y={87} />
      </>
    ),
  },
  legext: {
    from: 'knee bent',
    to: 'leg straight out',
    a: (
      <>
        <Kit x={22} y={84} w={46} h={8} rx={3} />
        <Kit x={20} y={52} w={8} h={34} rx={3} />
        <path d="M32 92V108M60 92V108M44 52V82M44 82L70 86M70 86L74 106M44 60L62 72" />
        <Head x={44} y={40} />
        <Eye x={48.5} y={39} />
      </>
    ),
    b: (
      <>
        <Kit x={22} y={84} w={46} h={8} rx={3} />
        <Kit x={20} y={52} w={8} h={34} rx={3} />
        <path d="M32 92V108M60 92V108M44 52V82M44 82L70 86M70 86L106 80M44 60L62 72" />
        <Head x={44} y={40} />
        <Eye x={48.5} y={39} />
      </>
    ),
  },

  // --- push ----------------------------------------------------------------
  bench: {
    from: 'bar touching the chest',
    to: 'arms locked out',
    a: (
      <>
        <path d="M28 108V96M80 108V96" />
        <Kit x={18} y={88} w={72} h={8} rx={4} />
        <path d="M38 84H72L88 78L93 106H102M46 84L36 74L50 70" />
        <Kit x={28} y={64} w={46} h={6} rx={3} />
        <Head x={28} y={79} r={9.5} />
        <Eye x={30} y={75} />
      </>
    ),
    b: (
      <>
        <path d="M28 108V96M80 108V96" />
        <Kit x={18} y={88} w={72} h={8} rx={4} />
        <path d="M38 84H72L88 78L93 106H102M46 84L48 58" />
        <Kit x={26} y={50} w={46} h={6} rx={3} />
        <Head x={28} y={79} r={9.5} />
        <Eye x={30} y={75} />
      </>
    ),
  },
  pushup: {
    from: 'arms straight',
    to: 'chest just off the floor',
    a: (
      <>
        <Mat />
        <path d="M38 74L78 84L106 96M40 76V100" />
        <Head x={27} y={68} r={9.5} />
        <Eye x={23} y={70} />
      </>
    ),
    b: (
      <>
        <Mat />
        <path d="M38 88L78 92L106 98M38 90L26 100L44 100" />
        <Head x={27} y={82} r={9.5} />
        <Eye x={23} y={84} />
      </>
    ),
  },
  press: {
    from: 'weights at the shoulders',
    to: 'locked overhead',
    a: (
      <>
        <path d="M60 44V76M60 76L50 108M60 76L70 108M60 52L46 62L42 48M60 52L74 62L78 48" />
        <Dumbbell x={42} y={44} />
        <Dumbbell x={78} y={44} />
        <Head x={60} y={33} />
        <Eyes x={60} y={32} />
      </>
    ),
    b: (
      <>
        <path d="M60 44V76M60 76L50 108M60 76L70 108M60 52L44 30M60 52L76 30" />
        <Dumbbell x={42} y={26} />
        <Dumbbell x={78} y={26} />
        <Head x={60} y={33} />
        <Eyes x={60} y={32} />
      </>
    ),
  },
  pushdown: {
    from: 'elbows bent, pinned to the ribs',
    to: 'arms straight down',
    a: (
      <>
        <Band d="M60 4V48" />
        <Kit x={48} y={48} w={24} h={6} rx={3} />
        <path d="M60 46V80M60 80L50 108M60 80L70 108M60 54L48 70L54 56M60 54L72 70L66 56" />
        <Head x={60} y={35} />
        <Eyes x={60} y={34} />
      </>
    ),
    b: (
      <>
        <Band d="M60 4V72" />
        <Kit x={48} y={72} w={24} h={6} rx={3} />
        <path d="M60 46V80M60 80L50 108M60 80L70 108M60 54L54 74M60 54L66 74" />
        <Head x={60} y={35} />
        <Eyes x={60} y={34} />
      </>
    ),
  },

  // --- pull ----------------------------------------------------------------
  row: {
    from: 'arm hanging long',
    to: 'elbow past the ribs',
    a: (
      <>
        <path d="M20 108V92M48 108V92" />
        <Kit x={12} y={86} w={44} h={8} rx={4} />
        <path d="M44 52L84 62L80 86L88 108H98M84 62L96 84L92 108M52 54L44 70V84M66 58L64 84" />
        <Dumbbell x={64} y={88} />
        <Head x={33} y={47} r={9.5} />
        <Eye x={29} y={49} />
      </>
    ),
    b: POSES.row,
  },
  pullup: {
    from: 'hanging at full stretch',
    to: 'chin over the bar',
    a: (
      <>
        <Kit x={10} y={7} w={100} h={7} rx={3.5} />
        <path d="M60 62V90L54 106M60 90L68 106M60 66L48 30L46 14M60 66L72 30L74 14" />
        <Head x={60} y={50} />
        <Eyes x={60} y={49} />
      </>
    ),
    b: POSES.pullup,
  },
  kneeraise: {
    from: 'hanging still',
    to: 'knees up to the hips',
    a: (
      <>
        <Kit x={10} y={7} w={100} h={7} rx={3.5} />
        <path d="M60 62V90L54 106M60 90L68 106M60 66L48 30L46 14M60 66L72 30L74 14" />
        <Head x={60} y={50} />
        <Eyes x={60} y={49} />
      </>
    ),
    b: (
      <>
        <Kit x={10} y={7} w={100} h={7} rx={3.5} />
        <path d="M60 62V86M60 86L42 82L44 100M60 86L44 90L48 104M60 66L48 30L46 14M60 66L72 30L74 14" />
        <Head x={60} y={50} />
        <Eyes x={60} y={49} />
      </>
    ),
  },
  curl: {
    from: 'arms long at the sides',
    to: 'weights at the shoulders',
    a: (
      <>
        <path d="M60 42V76M60 76L50 108M60 76L70 108M60 50L46 72M60 50L74 72" />
        <Dumbbell x={46} y={76} />
        <Dumbbell x={74} y={76} />
        <Head x={60} y={31} />
        <Eyes x={60} y={30} />
      </>
    ),
    b: (
      <>
        <path d="M60 42V76M60 76L50 108M60 76L70 108M60 50L42 66L42 52M60 50L78 66L78 52" />
        <Dumbbell x={42} y={48} />
        <Dumbbell x={78} y={48} />
        <Head x={60} y={31} />
        <Eyes x={60} y={30} />
      </>
    ),
  },

  // --- shoulders, and the rehab that lives around them ---------------------
  raise: {
    from: 'arms down',
    to: 'out to shoulder height',
    a: (
      <>
        <path d="M60 42V76M60 76L50 108M60 76L70 108M60 50L48 72M60 50L72 72" />
        <Dumbbell x={48} y={76} />
        <Dumbbell x={72} y={76} />
        <Head x={60} y={31} />
        <Eyes x={60} y={30} />
      </>
    ),
    b: (
      <>
        <path d="M60 42V76M60 76L50 108M60 76L70 108M60 50L34 50M60 50L86 50" />
        <Dumbbell x={30} y={50} />
        <Dumbbell x={90} y={50} />
        <Head x={60} y={31} />
        <Eyes x={60} y={30} />
      </>
    ),
  },
  armraise: {
    from: 'arm down, the other hand under the wrist',
    to: 'forward and up, as high as it goes',
    a: (
      <>
        <Ground />
        <path d="M58 42V76M58 76L50 108M58 76L66 108M58 50L34 70M58 54L46 66L38 66" />
        <Head x={58} y={31} />
        <Eye x={53.5} y={30} />
      </>
    ),
    b: (
      <>
        <Ground />
        <Band d="M34 70Q20 48 30 26" />
        <path d="M58 42V76M58 76L50 108M58 76L66 108M58 50L30 28M58 54L46 48L38 40" />
        <Head x={58} y={31} />
        <Eye x={53.5} y={30} />
      </>
    ),
  },
  wallslide: {
    from: 'forearms flat on the wall',
    to: 'slide them up, ribs down',
    a: (
      <>
        <Kit x={10} y={8} w={8} h={100} rx={4} />
        <path d="M58 42V76M58 76L50 108M58 76L66 108M58 50L40 44L22 48M58 54L42 60L22 62" />
        <Head x={58} y={31} />
        <Eye x={53.5} y={30} />
      </>
    ),
    b: (
      <>
        <Kit x={10} y={8} w={8} h={100} rx={4} />
        <path d="M58 42V76M58 76L50 108M58 76L66 108M58 50L42 32L22 26M58 52L44 44L22 40" />
        <Head x={58} y={31} />
        <Eye x={53.5} y={30} />
      </>
    ),
  },
  extrot: {
    from: 'elbow pinned to the ribs, hand across',
    to: 'forearm swings out',
    a: (
      <>
        <Band d="M66 70Q86 66 104 74" />
        <path d="M60 42V76M60 76L50 108M60 76L70 108M60 52L52 68L66 70M60 52L72 70" />
        <Head x={60} y={31} />
        <Eyes x={60} y={30} />
      </>
    ),
    b: (
      <>
        <Band d="M34 60Q70 58 104 74" />
        <path d="M60 52L52 68L34 60M60 42V76M60 76L50 108M60 76L70 108M60 52L72 70" />
        <Head x={60} y={31} />
        <Eyes x={60} y={30} />
      </>
    ),
  },
  pullapart: {
    from: 'band at arms’ length in front',
    to: 'pulled wide, shoulder blades together',
    a: (
      <>
        <Band d="M44 52H76" />
        <path d="M60 42V76M60 76L50 108M60 76L70 108M60 50L44 52M60 50L76 52" />
        <Head x={60} y={31} />
        <Eyes x={60} y={30} />
      </>
    ),
    b: (
      <>
        <Band d="M28 50Q60 60 92 50" />
        <path d="M60 42V76M60 76L50 108M60 76L70 108M60 50L28 50M60 50L92 50" />
        <Head x={60} y={31} />
        <Eyes x={60} y={30} />
      </>
    ),
  },

  // --- the floor -----------------------------------------------------------
  plank: {
    from: 'set the forearms and the toes',
    to: 'one straight line, ribs down',
    a: (
      <>
        <Mat />
        <path d="M36 76L76 98M76 98H104M38 78L32 100H50" />
        <Head x={26} y={70} r={9.5} />
        <Eye x={22} y={72} />
      </>
    ),
    b: POSES.plank,
  },
  sideplank: {
    from: 'hip resting down',
    to: 'hip lifted, body in a line',
    a: (
      <>
        <Mat />
        <path d="M38 82L74 100L104 102M40 84L32 102H52" />
        <Head x={28} y={76} r={9.5} />
        <Eye x={24} y={78} />
      </>
    ),
    b: (
      <>
        <Mat />
        <path d="M38 82L74 90L104 100M40 84L32 102H52M42 80L46 60" />
        <Head x={28} y={76} r={9.5} />
        <Eye x={24} y={78} />
      </>
    ),
  },
  birddog: {
    from: 'hands and knees',
    to: 'opposite arm and leg long',
    a: (
      <>
        <Mat />
        <path d="M44 74H74M44 76V100M74 76V100" />
        <Head x={34} y={68} r={9.5} />
        <Eye x={30} y={70} />
      </>
    ),
    b: (
      <>
        <Mat />
        <path d="M44 74H74M48 76V100M70 76V100M44 74L18 62M74 74L102 62" />
        <Head x={34} y={68} r={9.5} />
        <Eye x={30} y={70} />
      </>
    ),
  },
  clamshell: {
    from: 'knees stacked',
    to: 'top knee opens, hips still',
    a: (
      <>
        <Mat />
        <Band d="M80 76Q90 84 86 96" />
        <path d="M30 86L64 90M64 90L90 78M90 78L86 100" />
        <Head x={20} y={82} r={9.5} />
        <Eye x={18} y={79} />
      </>
    ),
    b: (
      <>
        <Mat />
        <Band d="M78 58Q96 78 86 96" />
        <path d="M30 86L64 90M64 90L90 78M90 78L86 100M64 88L88 52M88 52L80 76" />
        <Head x={20} y={82} r={9.5} />
        <Eye x={18} y={79} />
      </>
    ),
  },
  ankle: {
    from: 'toes pointed away',
    to: 'toes pulled back towards you',
    a: (
      <>
        <Mat />
        <Band d="M100 104Q116 92 108 70" />
        <path d="M34 96V62M34 96L94 100M94 100L104 106M36 72L54 88" />
        <Head x={34} y={50} />
        <Eye x={38.5} y={49} />
      </>
    ),
    b: (
      <>
        <Mat />
        <Band d="M98 84Q116 84 108 70" />
        <path d="M34 96V62M34 96L94 100M94 100L98 84M36 72L54 88" />
        <Head x={34} y={50} />
        <Eye x={38.5} y={49} />
      </>
    ),
  },
  balance: {
    from: 'both feet down',
    to: 'one foot, everything still',
    a: (
      <>
        <Ground />
        <path d="M60 42V76M60 76L50 108M60 76L70 108M60 50L46 70M60 50L74 70" />
        <Head x={60} y={31} />
        <Eyes x={60} y={30} />
      </>
    ),
    b: (
      <>
        <Ground />
        <path d="M60 42V76M60 76L58 108M60 76L78 90L72 104M60 50L34 44M60 50L86 44" />
        <Head x={60} y={31} />
        <Eyes x={60} y={30} />
      </>
    ),
  },
  stretch: {
    from: 'stand',
    to: 'back knee down, hips pressed forward',
    a: (
      <>
        <Ground />
        <path d="M58 42V76M58 76L50 108M58 76L66 108M58 50L46 70M58 50L70 70" />
        <Head x={58} y={31} />
        <Eyes x={58} y={30} />
      </>
    ),
    b: (
      <>
        <Mat />
        <path d="M54 48V80M54 80L78 88L80 102M54 80L34 100L20 102M54 56L44 78M54 56L64 78" />
        <Head x={54} y={37} />
        <Eye x={58.5} y={36} />
      </>
    ),
  },

  // --- going somewhere -----------------------------------------------------
  run: {
    from: 'left knee up',
    to: 'right knee up',
    a: POSES.run,
    b: (
      <>
        <path className="fig-thin" d="M4 52H20M0 64H14M6 76H18" />
        <path d="M63 37L54 68M54 68L40 82L46 102M54 68L76 78L76 98L84 100M61 45L48 52L42 40M61 45L76 54L82 68" />
        <Head x={67} y={27} />
        <path className="fig-band" d="M58 21L77 25" />
        <Eye x={71.5} y={30} />
      </>
    ),
  },
  cycle: {
    from: 'lead foot at the top',
    to: 'drive it through the bottom',
    a: (
      <>
        <Band d="M24 90m-14 0a14 14 0 1 0 28 0a14 14 0 1 0 -28 0" />
        <Band d="M98 90m-14 0a14 14 0 1 0 28 0a14 14 0 1 0 -28 0" />
        <path className="fig-thin" d="M24 90H98M62 90V62M62 62L40 68" />
        <path d="M56 46L62 70M58 52L44 66M62 70L82 76L74 90M62 70L70 86L50 90" />
        <Head x={54} y={34} />
        <Eye x={49.5} y={33} />
      </>
    ),
    b: (
      <>
        <Band d="M24 90m-14 0a14 14 0 1 0 28 0a14 14 0 1 0 -28 0" />
        <Band d="M98 90m-14 0a14 14 0 1 0 28 0a14 14 0 1 0 -28 0" />
        <path className="fig-thin" d="M24 90H98M62 90V62M62 62L40 68" />
        <path d="M56 46L62 70M58 52L44 66M62 70L76 86L50 90M62 70L78 74L74 90" />
        <Head x={54} y={34} />
        <Eye x={49.5} y={33} />
      </>
    ),
  },
  rowerg: {
    from: 'the catch — knees up, arms long',
    to: 'the finish — legs flat, handle at the ribs',
    a: (
      <>
        <Kit x={16} y={96} w={98} h={7} rx={3.5} />
        <Band d="M88 74H118" />
        <path d="M48 62L54 90M54 90L72 68L92 88M50 68L88 74" />
        <Head x={46} y={50} />
        <Eye x={50.5} y={49} />
      </>
    ),
    b: (
      <>
        <Kit x={16} y={96} w={98} h={7} rx={3.5} />
        <Band d="M54 76H118" />
        <path d="M32 64L54 90M54 90L88 92M88 92L96 84M36 70L62 84L54 76" />
        <Head x={28} y={52} />
        <Eye x={32.5} y={52} />
      </>
    ),
  },
  jump: {
    from: 'dip and load',
    to: 'both feet off the floor',
    a: (
      <>
        <Ground />
        <path d="M60 52V70M60 70L44 84L46 108M60 70L76 84L74 108M60 56L42 68M60 56L78 68" />
        <Head x={60} y={41} />
        <Eyes x={60} y={40} />
      </>
    ),
    b: (
      <>
        <Ground />
        <path className="fig-thin" d="M40 100H52M68 100H80" />
        <path d="M60 36V62M60 62L46 84M60 62L74 84M60 44L44 24M60 44L76 24" />
        <Head x={60} y={25} />
        <Eyes x={60} y={24} />
      </>
    ),
  },
  rope: {
    from: 'rope overhead',
    to: 'hop it under the feet',
    a: POSES.rope,
    b: (
      <>
        <path className="fig-thin" d="M33 60C33 114 87 114 87 60" />
        <path d="M60 40V70M60 70L52 90L58 100M60 70L68 90L62 100M60 46L45 58L33 60M60 46L75 58L87 60" />
        <Kit x={29} y={55} w={8} h={10} rx={2} />
        <Kit x={83} y={55} w={8} h={10} rx={2} />
        <Head x={60} y={29} />
        <Eyes x={60} y={28} />
        <path className="fig-thin" d="M46 112H74" />
      </>
    ),
  },
  sled: {
    from: 'shoulders behind the handles',
    to: 'drive — long back leg, short steps',
    a: (
      <>
        <Ground />
        <Kit x={94} y={62} w={9} h={40} rx={3} />
        <Kit x={84} y={98} w={28} h={8} rx={3} />
        <path d="M44 50L36 80M46 56L92 72M36 80L26 108M36 80L54 106" />
        <Head x={46} y={39} />
        <Eye x={50.5} y={38} />
      </>
    ),
    b: (
      <>
        <Ground />
        <Kit x={94} y={62} w={9} h={40} rx={3} />
        <Kit x={84} y={98} w={28} h={8} rx={3} />
        <path d="M38 58L34 86M40 62L92 74M34 86L14 104M34 86L56 102" />
        <Head x={38} y={47} />
        <Eye x={42.5} y={46} />
      </>
    ),
  },
  ropes: {
    from: 'both ropes low',
    to: 'both ropes high',
    a: (
      <>
        <Ground />
        <Band d="M50 62C66 82 84 46 112 66" />
        <Band d="M70 62C84 84 96 52 114 74" />
        <path d="M60 46V74M60 74L48 108M60 74L72 108M60 52L50 62M60 52L70 62" />
        <Head x={60} y={35} />
        <Eyes x={60} y={34} />
      </>
    ),
    b: (
      <>
        <Ground />
        <Band d="M50 56C68 32 84 74 112 52" />
        <Band d="M70 56C86 34 94 76 114 58" />
        <path d="M60 46V74M60 74L48 108M60 74L72 108M60 50L50 56M60 50L70 56" />
        <Head x={60} y={35} />
        <Eyes x={60} y={34} />
      </>
    ),
  },
  stairs: {
    from: 'one foot on the step',
    to: 'stand all the way up on it',
    a: (
      <>
        <Kit x={58} y={92} w={54} h={16} rx={2} />
        <Kit x={78} y={76} w={34} h={16} rx={2} />
        <path d="M40 44V74M40 74L34 108M40 74L64 86L66 92M40 50L30 72M40 50L52 68" />
        <Head x={40} y={33} />
        <Eye x={44.5} y={32} />
      </>
    ),
    b: (
      <>
        <Kit x={58} y={92} w={54} h={16} rx={2} />
        <Kit x={78} y={76} w={34} h={16} rx={2} />
        <path d="M62 34V64M62 64L58 92M62 64L84 66L86 76M62 40L50 62M62 40L74 58" />
        <Head x={62} y={23} />
        <Eye x={66.5} y={22} />
      </>
    ),
  },
  swim: {
    from: 'one arm reaching forward',
    to: 'pull it through, the other reaches',
    a: (
      <>
        <Band d="M2 62Q16 55 30 62T58 62T86 62T114 62" />
        <path d="M44 80L102 88M44 78L16 62M46 82L76 94" />
        <Head x={34} y={76} r={9.5} />
        <Eye x={30} y={78} />
      </>
    ),
    b: (
      <>
        <Band d="M2 62Q16 55 30 62T58 62T86 62T114 62" />
        <path d="M44 80L102 88M44 78L34 48L58 38M46 82L20 90" />
        <Head x={34} y={76} r={9.5} />
        <Eye x={30} y={78} />
      </>
    ),
  },
};

/**
 * Which movement an exercise gets. Specific words before general ones — the
 * comment on `poseFor` applies here word for word, and the order below is load
 * bearing: `leg curl` has to meet `legcurl` before `curl`, and every kind of
 * split squat has to meet `lunge` before `squat`.
 */
const RULES: [RegExp, Move][] = [
  // rehab and the named odd ones first; they are the whole reason for this file
  [/assisted (arm|shoulder)|arm raise|front raise|flexion/i, 'armraise'],
  [/wall slide/i, 'wallslide'],
  [/external rotation|internal rotation/i, 'extrot'],
  [/pull[- ]?apart|face pull|rear delt/i, 'pullapart'],
  [/clamshell|clam shell/i, 'clamshell'],
  [/heel slide|leg curl/i, 'legcurl'],
  [/ankle|dorsiflex|calf stretch/i, 'ankle'],
  [/balance|stork|proprio/i, 'balance'],
  [/side plank|copenhagen/i, 'sideplank'],
  [/bird ?dog|dead ?bug/i, 'birddog'],
  [/bridge|hip thrust/i, 'bridge'],
  [/plank|hollow|mountain climber|wall sit|hold$/i, 'plank'],
  [/stretch|thoracic|get[- ]?up|mobility|rotation/i, 'stretch'],
  // strength
  [/calf/i, 'calf'],
  [/lunge|split squat|step[- ]?up/i, 'lunge'],
  [/leg extension|knee extension/i, 'legext'],
  [/squat|leg press/i, 'squat'],
  [/deadlift|hinge|good morning|swing|clean|snatch|kettlebell/i, 'hinge'],
  [/bench press|chest press|floor press|\bfly\b/i, 'bench'],
  [/push[- ]?up|press[- ]?up|\bdip\b/i, 'pushup'],
  [/pulldown|pull[- ]down|pull[- ]?up|chin[- ]?up/i, 'pullup'],
  [/knee raise|leg raise|hanging/i, 'kneeraise'],
  [/pushdown|triceps|tricep/i, 'pushdown'],
  [/\brow(?!ing)/i, 'row'],
  [/lateral raise|abduction|raise|shrug/i, 'raise'],
  [/curl/i, 'curl'],
  [/press|overhead|jerk|woodchop|chop/i, 'press'],
  // cardio
  [/rowing|ski|\berg\b/i, 'rowerg'],
  [/battle/i, 'ropes'],
  [/jump rope|skip/i, 'rope'],
  [/sled|prowler/i, 'sled'],
  [/stair|step mill/i, 'stairs'],
  [/swim|freestyle|pool/i, 'swim'],
  [/bike|cycl|elliptical|spin/i, 'cycle'],
  [/jump|burpee|\bbox\b|hop|bound|plyo/i, 'jump'],
  [/run|jog|walk|sprint|knees|shuttle|treadmill/i, 'run'],
];

export function moveFor(name: string | null | undefined, unit?: string | null): Move {
  const n = name ?? '';
  for (const [re, move] of RULES) if (re.test(n)) return move;
  if (unit === 'metres') return 'run';
  if (unit === 'seconds') return 'plank';
  return 'curl';
}

/**
 * One frame of a movement, sized like any other figure. `frame="b"` is the
 * default because the finish is the half people picture when they hear the
 * name — it is what a list row should show.
 */
export function MoveFigure({
  move,
  frame = 'b',
  size = 64,
  className,
}: {
  move: Move;
  frame?: 'a' | 'b';
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={`fig${className ? ` ${className}` : ''}`}
      viewBox="0 0 120 120"
      width={size}
      height={size}
      aria-hidden="true"
    >
      {MOVES[move][frame]}
    </svg>
  );
}

/** A movement frame in a mint tile — the thumbnail beside an exercise's name. */
export function MoveTile({
  move,
  frame = 'b',
  size = 56,
}: {
  move: Move;
  frame?: 'a' | 'b';
  size?: number;
}) {
  return (
    <span className="fig-tile" style={{ width: size, height: size }}>
      <MoveFigure move={move} frame={frame} size={size - 10} />
    </span>
  );
}

/**
 * Both frames with the arrow between them — the picture of the movement.
 * `aria-hidden` on the drawings, captions in real text underneath, so a screen
 * reader gets the same two facts a sighted reader does.
 */
export function MovementFigures({ move, size = 108 }: { move: Move; size?: number }) {
  const m = MOVES[move];
  return (
    <div className="movement">
      <figure>
        <MoveFigure move={move} frame="a" size={size} />
        <figcaption>{m.from}</figcaption>
      </figure>
      <svg className="movement-arrow" viewBox="0 0 48 24" width={40} height={20} aria-hidden="true">
        <path d="M2 12H38M30 5L40 12L30 19" />
      </svg>
      <figure>
        <MoveFigure move={move} frame="b" size={size} />
        <figcaption>{m.to}</figcaption>
      </figure>
    </div>
  );
}
