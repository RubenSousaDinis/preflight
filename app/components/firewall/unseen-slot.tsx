"use client";

import { useActionState } from "react";
import { checkUnseenAddress, type UnseenResult } from "../../lib/actions";
import { UNSEEN_CHAINS } from "../../lib/flags";
import { ErrorState, PulseDots } from "../states";
import { VerdictCard } from "./verdict-card";

/*
  The slot for code the team did not write.

  It is visible before it is used, on purpose. Beat 2's credibility turn is that the
  staged fixtures and an address handed over on the day run through the same
  pipeline, and a slot that appeared only once the fixtures were done would look
  staged, because it would be.
*/
export function UnseenSlot() {
  const [result, formAction, isPending] = useActionState<
    UnseenResult | null,
    FormData
  >(checkUnseenAddress, null);

  return (
    <div className="border border-dashed border-rule bg-panel">
      <header className="border-b border-dashed border-rule px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="font-display text-[1.05rem] leading-tight font-semibold">
            Unseen contract
          </h3>
          <p className="font-data text-[0.66rem] uppercase tracking-[0.14em] text-ink/50">
            reserved
          </p>
        </div>
        <p className="mt-1 text-[0.88rem] leading-snug text-ink/70">
          Paste an address nobody here wrote. It runs through the same four
          checks, on the same pipeline, as everything above.
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
              defaultValue={UNSEEN_CHAINS[0].chainId}
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
              <VerdictCard verdict={result.verdict} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
