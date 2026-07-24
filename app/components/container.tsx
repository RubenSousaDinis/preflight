import type { ReactNode } from "react";

/**
 * The one content column. Every route composes inside it so the projector width
 * (1280) and the phone width (390) are decided once rather than per panel.
 */
export function Container({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto w-full max-w-[68rem] px-5 sm:px-7 ${className}`}>
      {children}
    </div>
  );
}
