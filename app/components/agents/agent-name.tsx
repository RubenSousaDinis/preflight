import { ensAppUrl } from "../../lib/ens-app-url";

/*
  One agent, named.

  The name is the heading and the id is the line under it. That ordering is the
  whole point of this component: an operator reads the name, and the id is still
  on screen for anyone who wants to check the row against the registry.

  A row with no name falls back to the id as the heading and drops the second
  line, so nothing renders the id twice.
*/

export function AgentName({
  name,
  agentId,
  ensName = null,
  linkEns = false,
  showId = true,
  size = "row",
}: {
  /** The display name, or null when nothing names this agent. */
  name: string | null;
  agentId: string;
  ensName?: string | null;
  /** Render the ENS name as a link into the ENS app. */
  linkEns?: boolean;
  /**
   * Off when the caller already prints the id in a meta line of its own. It is
   * never a way to drop the id from a surface: something else has to carry it.
   */
  showId?: boolean;
  size?: "row" | "compact";
}) {
  const named = name !== null && name.length > 0;
  const headingClass =
    size === "compact"
      ? "font-display text-[0.98rem] leading-tight font-semibold break-words"
      : "font-display text-[1.12rem] leading-tight font-semibold break-words";

  return (
    <div className="min-w-0">
      <p className={headingClass}>{named ? name : agentId}</p>
      {ensName !== null && ensName.length > 0 ? (
        linkEns ? (
          <a
            href={ensAppUrl(ensName)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 block font-data text-[0.72rem] break-all text-accent underline-offset-2 hover:underline"
          >
            {ensName}
          </a>
        ) : (
          <p className="mt-0.5 font-data text-[0.72rem] break-all text-ink/50">
            {ensName}
          </p>
        )
      ) : null}
      {named && showId ? (
        <p className="mt-0.5 font-data text-[0.68rem] break-all text-ink/40">
          id {agentId}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The same rule inside a sentence: the name reads, the id trails it.
 *
 * Used in the transcript, where the run refers to an agent mid-line and a bare id
 * turns every line into a lookup.
 */
export function AgentRef({
  name,
  agentId,
}: {
  name: string | null;
  agentId: string;
}) {
  if (name === null || name.length === 0) {
    return <span className="font-data text-[0.8rem]">{agentId}</span>;
  }
  return (
    <>
      <span className="font-semibold">{name}</span>{" "}
      <span className="font-data text-[0.72rem] text-ink/45">{agentId}</span>
    </>
  );
}
