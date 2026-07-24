/**
 * The mark: a fingerprint drawn as a three by three block of bytes.
 *
 * Inline vector, no external asset and no network fetch beyond the font link. The
 * filled cells are fixed rather than generated, which is the point of the subject:
 * the same input draws the same block every time.
 */
const CELLS = [true, false, true, false, true, true, true, true, false];

export function Mark({ size = 18 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      {CELLS.map((filled, index) =>
        filled ? (
          <rect
            key={index}
            x={(index % 3) * 7}
            y={Math.floor(index / 3) * 7}
            width={6}
            height={6}
            fill={index === 4 ? "var(--pf-accent)" : "currentColor"}
          />
        ) : null,
      )}
    </svg>
  );
}
