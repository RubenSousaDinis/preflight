/**
 * The mark: a pulse trace.
 *
 * A small accent blip, then the full waveform in ink. It reads as a monitor line,
 * which is the subject: something is being watched before it is trusted. Inline
 * vector, no external asset and no network fetch beyond the font link.
 */
export function Mark({ width = 34 }: { width?: number }) {
  return (
    <svg
      width={width}
      height={Math.round((width * 32) / 60)}
      viewBox="0 0 60 32"
      aria-hidden="true"
      focusable="false"
      className="block shrink-0"
    >
      <polyline
        points="2,16 8,16 11,8 14,16"
        fill="none"
        stroke="var(--pf-accent)"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <polyline
        points="14,16 24,16 29,4 35,28 41,10 46,16 58,16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
