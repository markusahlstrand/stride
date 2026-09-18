// ============================================================================
// The cast. One stick figure, fourteen poses.
//
// INK DOES THE BODY, MINT DOES THE KIT: every limb is a stroke in `--ink`, and
// every piece of equipment — plates, a mat, a box, the headband — is a shape
// filled with `--accent`. That split is the whole system, and it is why a pose
// needs no colour of its own: it follows the theme like the rest of the app.
//
// A pose is a handful of path points on a 120 × 120 grid with a 5-unit round
// stroke. Feet land on y = 108, so a figure can STAND on whatever is under it —
// a button, a header rule, the progress track — by lining that edge up with
// `size × 0.9`. `FOOT` is that ratio; use it rather than a magic number.
//
// Decoration only. Every figure is `aria-hidden`: it never carries a fact the
// text beside it does not already say.
// ============================================================================

export type Pose =
  | 'press'
  | 'squat'
  | 'bench'
  | 'run'
  | 'rest'
  | 'cheer'
  | 'lunge'
  | 'plank'
  | 'wave'
  | 'curl'
  | 'pullup'
  | 'rope'
  | 'sit'
  | 'row';

/** Where the feet are, as a fraction of the figure's size. */
export const FOOT = 108 / 120;

const Head = ({ x, y, r = 10 }: { x: number; y: number; r?: number }) => (
  <circle className="fig-head" cx={x} cy={y} r={r} />
);
const Eye = ({ x, y }: { x: number; y: number }) => <circle className="fig-eye" cx={x} cy={y} r={1.8} />;
const Eyes = ({ x, y }: { x: number; y: number }) => (
  <>
    <Eye x={x - 3.6} y={y} />
    <Eye x={x + 3.6} y={y} />
  </>
);
const Smile = ({ x, y }: { x: number; y: number }) => (
  <path className="fig-thin" d={`M${x - 4} ${y}Q${x} ${y + 4.5} ${x + 4} ${y}`} />
);
const Kit = (p: { x: number; y: number; w: number; h: number; rx?: number }) => (
  <rect className="fig-kit" x={p.x} y={p.y} width={p.w} height={p.h} rx={p.rx ?? 3} />
);
const Plates = ({ y }: { y: number }) => (
  <>
    <Kit x={19} y={y} w={9} h={28} />
    <Kit x={92} y={y} w={9} h={28} />
  </>
);
const Dumbbell = ({ x, y }: { x: number; y: number }) => (
  <>
    <path d={`M${x - 6} ${y}H${x + 6}`} />
    <Kit x={x - 10} y={y - 5} w={5} h={10} rx={2} />
    <Kit x={x + 5} y={y - 5} w={5} h={10} rx={2} />
  </>
);
const Mat = () => <Kit x={8} y={102} w={104} h={7} rx={3.5} />;

const POSES: Record<Pose, React.ReactNode> = {
  press: (
    <>
      <path d="M12 22H108" />
      <Plates y={8} />
      <path d="M60 50V80L48 108H40M60 80L72 108H80M60 56L43 45L40 23M60 56L77 45L80 23" />
      <Head x={60} y={40} />
      <Eyes x={60} y={39} />
    </>
  ),
  squat: (
    <>
      <path d="M12 56H108" />
      <Plates y={42} />
      <path d="M60 52V80L40 88L45 108H36M60 80L80 88L75 108H84M60 58L46 67L40 57M60 58L74 67L80 57" />
      <Head x={60} y={41} />
      <Eyes x={60} y={40} />
    </>
  ),
  bench: (
    <>
      <path d="M28 108V94M80 108V94" />
      <Kit x={18} y={88} w={72} h={8} rx={4} />
      <path d="M38 84H72L88 78L93 106H102M46 84V58" />
      <circle className="fig-kit" cx={46} cy={48} r={12} />
      <Eye x={46} y={48} />
      <Head x={28} y={79} r={9.5} />
      <Eye x={30} y={75} />
    </>
  ),
  run: (
    <>
      <path className="fig-thin" d="M4 52H20M0 64H14M6 76H18" />
      <path d="M63 37L54 68L74 76L70 98L79 101M54 68L40 84L22 78L19 69M61 45L74 54L83 44M61 45L47 50L41 63" />
      <path className="fig-thin" d="M58 21L47 16M58 22L48 28" />
      <Head x={67} y={27} />
      <path className="fig-band" d="M58 21L77 25" />
      <Eye x={71.5} y={30} />
    </>
  ),
  rest: (
    <>
      <Mat />
      <path d="M36 95L66 98L82 78L97 99L106 97M42 96L55 85L64 93" />
      <Head x={26} y={92} r={9.5} />
      <path className="fig-thin" d="M25 89L31 90" />
    </>
  ),
  cheer: (
    <>
      <path className="fig-thin" d="M20 32L11 28M25 19L19 10M100 32L109 28M95 19L101 10M60 9V1" />
      <path d="M60 42V70L45 82L51 98M60 70L75 82L69 98M60 48L41 34L35 14M60 48L79 34L85 14" />
      <Head x={60} y={31} />
      <Eyes x={60} y={29} />
      <Smile x={60} y={33} />
      <path className="fig-thin" d="M46 110H74M53 116H67" />
    </>
  ),
  lunge: (
    <>
      <path d="M58 38V68L82 78V106H92M58 68L42 94L20 100L17 107M58 44L66 60V74" />
      <Dumbbell x={66} y={78} />
      <Head x={58} y={27} />
      <Eye x={62.5} y={26} />
    </>
  ),
  plank: (
    <>
      <Mat />
      <path d="M34 76L78 84L106 93L108 100M38 77V99H52" />
      <Head x={25} y={70} r={9.5} />
      <Eye x={21} y={72} />
    </>
  ),
  wave: (
    <>
      <path className="fig-thin" d="M92 15L98 11M95 25H102M87 7L89 1" />
      <path d="M60 42V76L50 108H42M60 76L70 108H78M60 49L78 43L84 23M60 49L44 59L57 67" />
      <Head x={60} y={31} />
      <Eyes x={60} y={29} />
      <Smile x={60} y={33} />
    </>
  ),
  curl: (
    <>
      <path d="M60 42V76L50 108H42M60 76L70 108H78M60 49L43 62L40 45M60 49L77 62L79 80" />
      <Dumbbell x={40} y={43} />
      <Dumbbell x={79} y={83} />
      <Head x={60} y={31} />
      <Eyes x={60} y={30} />
    </>
  ),
  pullup: (
    <>
      <Kit x={10} y={7} w={100} h={7} rx={3.5} />
      <path d="M60 50V80L54 98L66 108M60 80L68 97L78 106M60 55L42 40L44 14M60 55L78 40L76 14" />
      <Head x={60} y={38} />
      <Eyes x={60} y={36} />
    </>
  ),
  rope: (
    <>
      <path className="fig-thin" d="M33 60C4 -14 116 -14 87 60" />
      <path d="M60 44V74L53 92L58 104M60 74L67 92L62 104M60 50L45 62L33 60M60 50L75 62L87 60" />
      <Kit x={29} y={55} w={8} h={10} rx={2} />
      <Kit x={83} y={55} w={8} h={10} rx={2} />
      <Head x={60} y={33} />
      <Eyes x={60} y={32} />
      <path className="fig-thin" d="M48 114H72" />
    </>
  ),
  sit: (
    <>
      <Kit x={32} y={82} w={40} h={26} rx={4} />
      <path d="M52 44L50 78L76 80L78 106H88M55 50L68 64L80 58" />
      <Kit x={78} y={46} w={8} h={15} rx={2.5} />
      <Head x={53} y={33} />
      <Eye x={57.5} y={32} />
    </>
  ),
  // Bent over, one hand braced on the bench, the other pulling a dumbbell up.
  row: (
    <>
      <path d="M20 108V92M48 108V92" />
      <Kit x={12} y={86} w={44} h={8} rx={4} />
      <path d="M44 52L84 62L80 86L88 108H98M84 62L96 84L92 108M52 54L44 70V84M66 58L72 70L66 78" />
      <Dumbbell x={66} y={82} />
      <Head x={33} y={47} r={9.5} />
      <Eye x={29} y={49} />
    </>
  ),
};

/**
 * One figure. `mini` is the tab-bar weight: a heavier stroke and no eyes or
 * motion lines, because at 28px those are noise rather than charm.
 */
export function Figure({
  pose,
  size = 64,
  mini,
  flip,
  className,
  style,
}: {
  pose: Pose;
  size?: number;
  mini?: boolean;
  /** Mirror it — the right-hand half of a left/right pair. */
  flip?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      className={`fig${mini ? ' mini' : ''}${className ? ` ${className}` : ''}`}
      viewBox="0 0 120 120"
      width={size}
      height={size}
      aria-hidden="true"
      style={flip ? { transform: 'scaleX(-1)', ...style } : style}
    >
      {POSES[pose]}
    </svg>
  );
}

/** A figure in a mint tile — the thumbnail beside an exercise's name. */
export function FigureTile({ pose, size = 56 }: { pose: Pose; size?: number }) {
  return (
    <span className="fig-tile" style={{ width: size, height: size }}>
      <Figure pose={pose} size={size - 10} />
    </span>
  );
}

/**
 * Which pose an exercise gets. Read off its NAME (and unit), because that is
 * the one thing every row in the app carries — a scheduled item has no slug and
 * no modality. Order matters: the specific words come before the general ones,
 * so "Bulgarian split squat" is a lunge and not a squat.
 *
 * This is decoration, so a wrong guess costs nothing and an unknown exercise
 * gets the curl — a person holding weights is never a lie about training.
 */
const RULES: [RegExp, Pose][] = [
  [/plank|hollow|dead ?bug|bird ?dog|hold|bridge|wall sit/i, 'plank'],
  [/lunge|split squat|step[- ]?up|single[- ]leg|calf/i, 'lunge'],
  [/squat|deadlift|hinge|good morning|thrust|leg press/i, 'squat'],
  [/bench|floor press|push[- ]?up|press[- ]?up|chest|fly|dip/i, 'bench'],
  [/pull[- ]?up|chin[- ]?up|pulldown|pull[- ]down|hang/i, 'pullup'],
  [/\brow(?!ing)|face pull|pull[- ]apart|rear delt/i, 'row'],
  [/press|raise|overhead|snatch|jerk|clean|shrug/i, 'press'],
  [/rope|jump|skip|burpee|box|bound|hop/i, 'rope'],
  [/run|jog|walk|sprint|rowing|erg|bike|cycl|ski|swim|kilomet|cardio/i, 'run'],
  [/stretch|mobility|rotation|range|breath|sit[- ]?up|crunch|curl[- ]?up/i, 'rest'],
  [/curl|extension|triceps|biceps|carry|grip/i, 'curl'],
];

export function poseFor(name: string | null | undefined, unit?: string | null): Pose {
  const n = name ?? '';
  for (const [re, pose] of RULES) if (re.test(n)) return pose;
  if (unit === 'metres') return 'run';
  if (unit === 'seconds') return 'plank';
  return 'curl';
}
