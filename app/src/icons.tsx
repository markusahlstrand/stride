// ============================================================================
// The stroke set. 20 × 20, 1.6px, `currentColor` — so a tab icon inherits
// `--accent` when its tab is on and `--muted` when it is not, with no second
// asset and no colour written into the markup.
//
// Deliberately literal: a calendar is a calendar, a barbell is a bar with two
// plates. Nothing here is a metaphor you have to learn.
// ============================================================================

type IconProps = { size?: number };

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function Svg({ size = 20, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" {...stroke}>
      {children}
    </svg>
  );
}

/** Today. */
export const CalendarIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="14" height="13" rx="2" />
    <path d="M3 8h14M7 2.5v3M13 2.5v3" />
  </Svg>
);

/** Workouts — a bar and two plates. */
export const BarbellIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 10h16" />
    <rect x="3.5" y="6" width="3" height="8" rx="1" />
    <rect x="13.5" y="6" width="3" height="8" rx="1" />
  </Svg>
);

/** Programmes — a clipboard with a list on it. */
export const ClipboardIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 3.5H5.5A1.5 1.5 0 0 0 4 5v11a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 16 16V5a1.5 1.5 0 0 0-1.5-1.5H13" />
    <rect x="7" y="2" width="6" height="3" rx="1" />
    <path d="M7.5 9.5h5M7.5 13h5" />
  </Svg>
);

/** Trainees — two people, because a roster is never one. */
export const PeopleIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7.5" cy="6.5" r="2.8" />
    <path d="M2 16.5c.8-2.7 2.9-4.1 5.5-4.1s4.7 1.4 5.5 4.1" />
    <path d="M13.2 4.2a2.8 2.8 0 0 1 0 5.3M14.4 12.6c1.7.4 2.9 1.6 3.5 3.6" />
  </Svg>
);

/** Me. */
export const PersonIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10" cy="6.5" r="3.2" />
    <path d="M3.5 17c1-3.2 3.5-4.8 6.5-4.8s5.5 1.6 6.5 4.8" />
  </Svg>
);

/** The earned moment — heavier, because it sits alone inside a disc. */
export const CheckIcon = ({ size = 20 }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 10.5 8.5 15 16 5.5" />
  </svg>
);

/** Send. */
export const SendIcon = ({ size = 18 }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 18 18"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M2.5 9h12M10 4.5 15.5 9 10 13.5" />
  </svg>
);
