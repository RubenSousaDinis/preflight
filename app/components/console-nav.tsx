/*
  The stage index.

  The console runs three beats and an audit trail on one page, which is right for
  a judge reading it alone and wrong for an operator moving between beats while
  talking. This sits under the header and stays there, so a beat is one click away
  rather than a scroll the room watches.
*/
const STOPS = [
  { href: "#beat-1", label: "1 hiring" },
  { href: "#beat-1-run", label: "1 run" },
  { href: "#beat-2", label: "2 firewall" },
  { href: "#beat-3", label: "3 board" },
  { href: "#beat-4", label: "4 rug pull" },
  { href: "#audit-trail", label: "receipts" },
];

export function ConsoleNav() {
  return (
    <nav
      aria-label="Beats"
      className="sticky top-0 z-10 -mx-5 mt-6 border-y border-rule bg-paper/95 px-5 py-2 backdrop-blur sm:-mx-7 sm:px-7"
    >
      <ul className="flex flex-wrap items-center gap-x-5 gap-y-1">
        {STOPS.map((stop) => (
          <li key={stop.href}>
            <a
              href={stop.href}
              className="font-data text-[0.7rem] uppercase tracking-[0.14em] text-ink/60 no-underline hover:text-accent"
            >
              {stop.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
