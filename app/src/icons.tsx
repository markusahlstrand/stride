// ============================================================================
// The stroke set — what is left of it. The tab icons used to live here; they
// are the cast now (figures.tsx): a runner, a lifter, somebody waving, and the
// tick of the earned moment became somebody cheering. What remains is the one
// glyph that is genuinely a glyph, in `currentColor` so it follows whatever it
// sits on.
// ============================================================================

type IconProps = { size?: number };

/** Send. */
export const SendIcon = ({ size = 18 }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 18 18"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M2.5 9h12M10 4.5 15.5 9 10 13.5" />
  </svg>
);
