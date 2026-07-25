"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  checkUnseenAddress,
  type RunScope,
  type UnseenResult,
} from "../../lib/actions";
import { UNSEEN_CHAINS } from "../../lib/flags";
import { ErrorState, PulseDots } from "../states";
import { VerdictCard } from "./verdict-card";

/*
  The slot for code the team did not write.

  It is visible before it is used, on purpose. Beat 2's credibility turn is that the
  staged fixtures and an address handed over on the day run through the same
  pipeline, and a slot that appeared only once the fixtures were done would look
  staged, because it would be.

  It leads the view rather than following the fixtures. A visitor who has to scroll
  past four recorded verdicts to find the one box that runs anything is reading a
  page about the product instead of using it.
*/
/**
 * What this particular run could and could not check.
 *
 * An ALLOW is only as strong as the set of checks that ran against it. When no
 * detector is registered, or when the call carried no data and therefore did
 * nothing, the verdict is still true and still reproducible, and it answers a much
 * narrower question than the word ALLOW suggests. Saying so on the card is cheaper
 * than having it asked from the floor.
 */
function ScopeNotes({ scope }: { scope: RunScope }) {
  const notes: string[] = [];
  if (scope.detectorCount === 0) {
    notes.push(
      "No detector is registered on this build yet, so no red flag could fire. An allow here means the checks have not landed, not that the call is clean.",
    );
  }
  if (scope.calldataWasEmpty) {
    notes.push(
      "Checked with empty calldata, which is a call carrying no data. Most contracts reject it, so this answers what that call does and not what the contract does. Paste the calldata of the call you care about to check that one.",
    );
  }
  if (notes.length === 0) return null;

  return (
    <ul className="space-y-2 border border-rule border-l-2 border-l-grade-c bg-band/40 px-4 py-3 sm:px-5">
      {notes.map((note) => (
        <li key={note} className="text-[0.85rem] leading-snug text-ink/80">
          {note}
        </li>
      ))}
    </ul>
  );
}

export function UnseenSlot() {
  const [result, formAction, isPending] = useActionState<
    UnseenResult | null,
    FormData
  >(checkUnseenAddress, null);

  /*
    The four fields are controlled rather than left to the DOM.

    React clears an uncontrolled field once the form action settles, which emptied
    the address, the calldata, and the chain the moment a verdict arrived. The cost
    lands exactly where this panel is used: checking the same contract with a second
    calldata meant retyping both, and the chain select silently snapped back to Base
    mainnet under a verdict that had just been produced on Sepolia. Holding the
    values in state keeps what was asked next to the answer it produced.
  */
  const [address, setAddress] = useState("");
  const [chainId, setChainId] = useState(String(UNSEEN_CHAINS[0].chainId));
  const [calldata, setCalldata] = useState("");
  const [sender, setSender] = useState("");

  /*
    State is not enough for the select, and this is the part worth knowing.

    React puts a controlled text field back from state on the render after the
    reset, but it does not do that for a select: the value prop it renders did not
    change, so nothing re-applies it and the control silently drops to its first
    option while the state behind it still holds the chain that was asked about.
    Verified in the browser, where the prop read 84532 and the element read 8453.
    Nothing wrong reaches the verdict, because the server action labels the answer
    with the chain it was actually given, but the control would have sat on Base
    mainnet under a verdict produced on Sepolia, which invites the reader to
    mistrust the one number on the card they cannot check for themselves.
  */
  const chainRef = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    const node = chainRef.current;
    if (node !== null && node.value !== chainId) node.value = chainId;
  }, [chainId, result, isPending]);

  return (
    <div className="border border-rule bg-panel">
      <header className="border-b border-rule bg-band/50 px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="font-display text-[1.25rem] leading-tight font-semibold">
            Check a contract
          </h2>
          <p className="font-data text-[0.66rem] uppercase tracking-[0.14em] text-ink/50">
            live gate / base mainnet or sepolia
          </p>
        </div>
        <p className="mt-1 max-w-[52rem] text-[0.92rem] leading-snug text-ink/75">
          Paste an address nobody here wrote. It runs through the same four
          checks, on the same pipeline, as the recorded calls below. The code is
          fingerprinted and compared to its graded version before anything is
          simulated, so an address on its own already answers something. Add
          calldata to check a specific call.
        </p>
      </header>

      <div className="px-4 py-4 sm:px-5">
        <form action={formAction} className="flex flex-wrap items-end gap-3">
          <label className="min-w-0 flex-1">
            <span className="block font-data text-[0.64rem] uppercase tracking-[0.16em] text-ink/50">
              address
            </span>
            <input
              name="address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="0x"
              className="mt-1 w-full border border-rule bg-paper px-3 py-2 font-data text-[0.85rem] text-ink outline-none focus:border-accent"
            />
          </label>
          <label>
            <span className="block font-data text-[0.64rem] uppercase tracking-[0.16em] text-ink/50">
              chain
            </span>
            <select
              name="chainId"
              ref={chainRef}
              value={chainId}
              onChange={(event) => setChainId(event.target.value)}
              className="mt-1 border border-rule bg-paper px-3 py-2 font-data text-[0.85rem] text-ink outline-none focus:border-accent"
            >
              {UNSEEN_CHAINS.map((chain) => (
                <option key={chain.chainId} value={chain.chainId}>
                  {chain.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={isPending}
            className="border border-accent px-4 py-2 font-data text-[0.78rem] tracking-[0.1em] text-accent disabled:opacity-50"
          >
            {isPending ? "checking" : "check it"}
          </button>

          <div className="flex w-full flex-wrap gap-3">
            <label className="min-w-0 flex-1">
              <span className="block font-data text-[0.64rem] uppercase tracking-[0.16em] text-ink/50">
                calldata, optional
              </span>
              <input
                name="calldata"
                value={calldata}
                onChange={(event) => setCalldata(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="0x"
                className="mt-1 w-full border border-rule bg-paper px-3 py-2 font-data text-[0.85rem] text-ink outline-none focus:border-accent"
              />
            </label>
            <label className="min-w-0 flex-1">
              <span className="block font-data text-[0.64rem] uppercase tracking-[0.16em] text-ink/50">
                sender, optional
              </span>
              <input
                name="sender"
                value={sender}
                onChange={(event) => setSender(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="defaults to the zero address"
                className="mt-1 w-full border border-rule bg-paper px-3 py-2 font-data text-[0.85rem] text-ink outline-none focus:border-accent"
              />
            </label>
          </div>
        </form>

        <div className="mt-4">
          {isPending ? (
            <p
              className="flex items-center gap-2 font-data text-[0.8rem] text-ink/70"
              role="status"
              aria-live="polite"
            >
              <PulseDots />
              forking the chain and replaying the call
            </p>
          ) : null}

          {!isPending && result?.kind === "invalid" ? (
            <p className="font-data text-[0.8rem] text-grade-f">
              {result.message}
            </p>
          ) : null}

          {!isPending && result?.kind === "error" ? (
            <div className="space-y-2">
              <p className="font-data text-[0.74rem] break-all text-ink/55">
                {result.address} on {result.chainLabel}
              </p>
              <ErrorState error={result.error} />
            </div>
          ) : null}

          {!isPending && result?.kind === "decided" ? (
            <div className="space-y-3">
              <p className="font-data text-[0.74rem] break-all text-ink/55">
                {result.address} on {result.chainLabel}
              </p>
              <ScopeNotes scope={result.scope} />
              <VerdictCard verdict={result.verdict} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
