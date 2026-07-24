import type { ChainVerification, Receipt } from "@/src/shared";
import { linksToPrevious, type ReceiptLog } from "../../lib/receipts";
import { EmptyState } from "../states";

/*
  The hash-chained record of every decision on this page.

  The chain is the point, so the link between one receipt and the next is drawn
  rather than implied: each receipt carries the hash of the one before it, and both
  values are on screen for anyone who wants to check the claim by eye.
*/

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
      <dt className="font-data text-[0.64rem] uppercase tracking-[0.14em] text-ink/45">
        {label}
      </dt>
      <dd className="font-data text-[0.75rem] break-all text-ink/80">
        {value}
      </dd>
    </div>
  );
}

/**
 * The verifier's answer, or the fact that it has not run.
 *
 * A null verification renders as unverified, never as a quiet absence. The one
 * thing this component must never do is let a chain nobody checked look like a
 * chain that passed.
 */
function VerificationBanner({
  verification,
}: {
  verification: ChainVerification | null;
}) {
  if (verification === null) {
    return (
      <div className="border border-rule border-l-2 border-l-grade-c bg-band/50 px-4 py-3 sm:px-5">
        <p className="font-data text-[0.66rem] uppercase tracking-[0.16em] text-ink/60">
          not verified
        </p>
        <p className="mt-1 text-[0.88rem] leading-snug text-ink/75">
          The chain verifier has not run against these receipts, so nothing here
          claims the signatures hold. The links below are values you can compare
          on screen, which is a weaker statement and the only one available yet.
        </p>
      </div>
    );
  }

  if (verification.ok) {
    return (
      <div className="border border-rule border-l-2 border-l-accent bg-band/50 px-4 py-3 sm:px-5">
        <p className="font-data text-[0.66rem] uppercase tracking-[0.16em] text-accent">
          chain verified
        </p>
        <p className="mt-1 text-[0.88rem] leading-snug text-ink/75">
          Every signature checks out against its signer, and every receipt carries
          the hash of the one before it.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-rule border-l-2 border-l-grade-f bg-band/50 px-4 py-3 sm:px-5">
      <p className="font-data text-[0.66rem] uppercase tracking-[0.16em] text-grade-f">
        chain broken
        {verification.brokenAt === null
          ? ""
          : ` at receipt ${verification.brokenAt + 1}`}
      </p>
      <p className="mt-1 text-[0.88rem] leading-snug text-ink">
        {verification.reason ??
          "The verifier rejected this chain without reporting a reason."}
      </p>
    </div>
  );
}

function ReceiptCard({
  receipt,
  index,
  linked,
}: {
  receipt: Receipt;
  index: number;
  linked: boolean;
}) {
  return (
    <li>
      {index > 0 ? (
        <p
          className={`px-4 py-1.5 font-data text-[0.7rem] sm:px-5 ${
            linked ? "text-ink/50" : "text-grade-f"
          }`}
        >
          {linked
            ? "prevHash matches the hash above"
            : "prevHash does not match the hash above"}
        </p>
      ) : null}

      <article className="border border-rule bg-panel">
        <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule bg-band/50 px-4 py-2 sm:px-5">
          <p className="font-data text-[0.8rem]">{receipt.id}</p>
          <p className="font-data text-[0.64rem] uppercase tracking-[0.14em] text-ink/50">
            {receipt.prevHash === null ? "genesis" : `link ${index + 1}`}
          </p>
        </header>

        <div className="space-y-2 px-4 py-3 sm:px-5">
          <pre className="max-w-full overflow-x-auto border border-rule bg-band/40 px-3 py-2 font-data text-[0.72rem] leading-relaxed break-words whitespace-pre-wrap text-ink/80">
            {JSON.stringify(receipt.subject, null, 2)}
          </pre>
          <dl className="space-y-1">
            <Field label="response hash" value={receipt.responseHash} />
            <Field
              label="prev hash"
              value={receipt.prevHash ?? "none, this is the first receipt"}
            />
            <Field label="hash" value={receipt.hash} />
            <Field label="signature" value={receipt.sig} />
            <Field label="signer" value={receipt.signerPubKey} />
            <Field label="methodology" value={receipt.methodologyVersion} />
            <Field
              label="evidence"
              value={receipt.evidenceURI ?? "none, this is not an agent decision"}
            />
            {receipt.reproducibleFrom ? (
              <Field
                label="reproducible from"
                value={`block ${receipt.reproducibleFrom.block}, ${receipt.reproducibleFrom.from} to ${receipt.reproducibleFrom.to}, calldata ${receipt.reproducibleFrom.calldataHash}, value ${receipt.reproducibleFrom.value}`}
              />
            ) : null}
          </dl>
        </div>
      </article>
    </li>
  );
}

export function ReceiptChain({ log }: { log: ReceiptLog }) {
  if (log.receipts.length === 0) {
    return (
      <EmptyState>
        Every decision on this page emits a signed receipt carrying the hash of the
        one before it. They will appear here in the order they were made.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-3">
      <VerificationBanner verification={log.verification} />
      <ol className="space-y-0">
        {log.receipts.map((receipt, index) => (
          <ReceiptCard
            key={receipt.id}
            receipt={receipt}
            index={index}
            linked={linksToPrevious(log.receipts, index)}
          />
        ))}
      </ol>
    </div>
  );
}
