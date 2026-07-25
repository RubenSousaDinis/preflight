import type { ReactNode } from "react";
import { Mark } from "../mark";

/*
  The shared slide furniture: the frame, the terminal block, and the two kinds of
  emphasis the decks use. Parameterised by total so a three slide track deck counts
  to three rather than to the main deck's length.
*/

export function Slide({
  tone,
  eyebrow,
  index,
  total,
  children,
}: {
  tone: "light" | "dark";
  eyebrow: string;
  index: number;
  total: number;
  children: ReactNode;
}) {
  const dark = tone === "dark";
  return (
    <section
      className={`flex h-full w-full flex-col ${dark ? "bg-ink text-paper" : "bg-paper text-ink"}`}
      style={{ padding: dark ? "110px 130px 90px" : "90px 130px 80px" }}
    >
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className={dark ? "text-paper" : "text-ink"}>
            <Mark width={dark ? 58 : 52} />
          </span>
          <span className="font-display text-[30px] font-semibold">
            preflight
          </span>
        </div>
        <span
          className={`font-data text-[22px] tracking-[0.14em] ${dark ? "text-dark-faint" : "text-meta"}`}
        >
          {eyebrow}
        </span>
      </header>

      <div className="flex flex-1 flex-col justify-center">{children}</div>

      <footer
        className={`flex justify-between font-data text-[22px] ${dark ? "text-dark-faint" : "text-meta"}`}
      >
        <span>ETHGlobal Lisbon 2026</span>
        <span>
          {String(index).padStart(2, "0")} / {total}
        </span>
      </footer>
    </section>
  );
}

export function Terminal({ children }: { children: ReactNode }) {
  // whitespace-pre-wrap, because the runs of spaces in these blocks are the
  // column alignment. HTML collapses them by default, which turns a two-column
  // log into a paragraph and loses the indent that marks a sub-line. Long lines
  // still wrap, so pre-wrap rather than pre.
  return (
    <div className="rounded-[8px] bg-ink px-[46px] py-[38px] font-data text-[26px] leading-[1.85] whitespace-pre-wrap text-dark-terminal">
      {children}
    </div>
  );
}

export function Dim({ children }: { children: ReactNode }) {
  return <span className="text-dark-faint">{children}</span>;
}

export function Card({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[6px] border border-rule bg-panel px-[42px] py-10">
      <p className="mb-3 text-[31px] font-semibold text-accent">{title}</p>
      <p className="text-[26px] leading-[1.5] text-muted">{body}</p>
    </div>
  );
}

export function Kicker({ children }: { children: ReactNode }) {
  return (
    <p className="font-display text-[40px] tracking-[-0.5px]">{children}</p>
  );
}
