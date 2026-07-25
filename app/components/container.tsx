import type { ReactNode } from "react";

/**
 * The content column: 1080px with 32px gutters, from the design.
 *
 * Sections are full bleed and separated by a hairline; only their contents are
 * constrained. That band structure is what makes the page read as one document
 * rather than as a stack of free floating cards.
 */
export function Container({
  children,
  className = "",
  wide = false,
}: {
  children: ReactNode;
  className?: string;
  /** The console runs wider than the site: 1180px against 1080px. */
  wide?: boolean;
}) {
  return (
    <div
      className={`mx-auto w-full px-5 ${wide ? "max-w-[1180px] sm:px-7" : "max-w-[var(--pf-max-width)] sm:px-8"} ${className}`}
    >
      {children}
    </div>
  );
}

/** One full-bleed band, closed by the hairline that separates it from the next. */
export function Band({
  children,
  className = "",
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`scroll-mt-24 border-b border-rule ${className}`}>
      {children}
    </section>
  );
}

/** The mono eyebrow that numbers a section, as the design sets them. */
export function SectionMark({ children }: { children: ReactNode }) {
  return (
    <p className="font-data text-[12px] tracking-[0.14em] text-meta">
      {children}
    </p>
  );
}
