"use client";

import { useMemo, type ReactNode } from "react";
import { chainLabelFor } from "../../lib/agent-display";
import { filterAgentCatalog } from "../../lib/filter-agent-catalog";
import type { KnownAgentCatalogEntry } from "../../lib/known-agents";
import { AgentName } from "./agent-name";

/*
  The one agent picker.

  It was written three times before this: once for the grade form, once for the
  watcher, and then the hiring floor asked for ids in a text box because there was
  nothing to reuse. Search, row layout, and the count line live here so a change to
  how an agent is presented lands on every surface that presents one.

  The query is the parent's state, not this component's, because two of the three
  callers also accept it as a free-text id when nothing in the catalog matches.
*/

export function AgentCatalogPicker({
  catalog,
  query,
  onQueryChange,
  label = "search agents",
  placeholder = "name, registry id, or ENS name",
  disabled = false,
  listHeight = "max-h-[22rem]",
  actions,
  isSelected,
  emptyCatalogNote = "No known agents are configured for this booth.",
  footNote,
}: {
  catalog: readonly KnownAgentCatalogEntry[];
  query: string;
  onQueryChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  listHeight?: string;
  /** Buttons for one row, rendered against the right edge. */
  actions: (agent: KnownAgentCatalogEntry) => ReactNode;
  isSelected?: (agent: KnownAgentCatalogEntry) => boolean;
  emptyCatalogNote?: string;
  /** Appended to the "n of m agents" line. */
  footNote?: ReactNode;
}) {
  const visible = useMemo(
    () => filterAgentCatalog(catalog, query),
    [catalog, query],
  );

  return (
    <div>
      <label className="block">
        <span className="block font-data text-[0.64rem] uppercase tracking-[0.16em] text-ink/50">
          {label}
        </span>
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          className="mt-1 w-full border border-rule bg-paper px-3 py-2 font-data text-[0.85rem] text-ink outline-none focus:border-accent disabled:opacity-50"
        />
      </label>

      {catalog.length === 0 ? (
        <p className="mt-2 font-data text-[0.8rem] text-ink/55">
          {emptyCatalogNote}
        </p>
      ) : visible.length === 0 ? (
        <p className="mt-2 font-data text-[0.8rem] text-ink/55">
          No agents match {JSON.stringify(query.trim())}.
        </p>
      ) : (
        <ul
          className={`mt-2 ${listHeight} divide-y divide-rule overflow-y-auto border border-rule`}
        >
          {visible.map((agent) => {
            const selected = isSelected?.(agent) ?? false;
            return (
              <li
                key={`${agent.identityChainId}:${agent.id}`}
                className={`flex items-stretch ${selected ? "bg-band/70" : ""}`}
              >
                <div className="min-w-0 flex-1 px-3 py-2.5">
                  <AgentName
                    name={agent.label}
                    agentId={agent.id}
                    ensName={agent.ensName}
                    linkEns
                    showId={false}
                    size="compact"
                  />
                  <p className="mt-0.5 text-[0.82rem] leading-snug text-ink/60">
                    {agent.note}
                  </p>
                  {/* The id rides the meta line rather than taking one of its own. */}
                  <p className="mt-0.5 font-data text-[0.66rem] break-all text-ink/40">
                    id {agent.id} / {chainLabelFor(agent.identityChainId)}
                    {agent.sepoliaId !== null
                      ? ` / Sepolia mirror ${agent.sepoliaId}`
                      : ""}
                  </p>
                </div>
                <div className="flex shrink-0">{actions(agent)}</div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-2 font-data text-[0.68rem] text-ink/45">
        {visible.length} of {catalog.length} agents
        {footNote}
      </p>
    </div>
  );
}

/** The row button, so grade / claim / select / add all read as one control set. */
export function PickerAction({
  onClick,
  disabled = false,
  active = false,
  tone = "accent",
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  tone?: "accent" | "quiet";
  title?: string;
  children: ReactNode;
}) {
  const base =
    "shrink-0 border-l border-rule px-3 font-data text-[0.72rem] tracking-[0.08em] transition-colors disabled:opacity-50";
  const toneClass = active
    ? "bg-band/80 text-accent"
    : tone === "accent"
      ? "text-accent hover:bg-band/60"
      : "text-ink/55 hover:bg-band/60 hover:text-accent";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${base} ${toneClass}`}
    >
      {children}
    </button>
  );
}
