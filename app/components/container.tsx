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
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`mx-auto w-full max-w-[var(--pf-max-width)] px-5 sm:px-8 ${className}`}
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
