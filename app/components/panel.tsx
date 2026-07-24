import type { ReactNode } from "react";

/**
 * The titled panel every later view composes from. The eyebrow carries the name of
 * the thing being shown (the function, the boundary, the beat) rather than a
 * decorative label, so the header reads as a specimen label on a record.
 */
export function Panel({
  title,
  eyebrow,
  status,
  children,
  className = "",
}: {
  title: string;
  eyebrow?: string;
  status?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`border border-rule bg-panel ${className}`}>
      <header className="flex items-baseline justify-between gap-4 border-b border-rule px-4 py-3 sm:px-5">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="font-data text-[0.68rem] uppercase tracking-[0.16em] text-accent">
              {eyebrow}
            </p>
          ) : null}
          <h2 className="font-display text-[1.15rem] font-semibold leading-tight">
            {title}
          </h2>
        </div>
        {status ? (
          <div className="shrink-0 font-data text-[0.7rem] uppercase tracking-[0.12em] text-ink/60">
            {status}
          </div>
        ) : null}
      </header>
      <div className="px-4 py-4 sm:px-5 sm:py-5">{children}</div>
    </section>
  );
}
