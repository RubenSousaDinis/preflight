import type { SerializedTxTuple } from "@/src/shared";

/*
  The five values that make a verdict reproducible.

  This is the claim, not decoration, so it renders on ALLOW exactly as it renders on
  BLOCK. A footer that appeared only under a block would read as a justification for
  bad news rather than a property of every verdict. Nothing here truncates: a
  shortened calldata hash cannot be re-derived from, which defeats the whole footer.
*/

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-1 gap-x-4 border-t border-rule px-4 py-2 first:border-t-0 sm:grid-cols-[8rem_minmax(0,1fr)] sm:px-5">
      <dt className="font-data text-[0.68rem] uppercase tracking-[0.14em] text-ink/50">
        {label}
      </dt>
      <dd className="font-data text-[0.8rem] break-all text-ink">{value}</dd>
    </div>
  );
}

export function ReproducibilityFooter({
  tuple,
  codeFingerprint,
}: {
  tuple: SerializedTxTuple;
  codeFingerprint: string;
}) {
  return (
    <section className="border border-rule bg-band/40">
      <h4 className="border-b border-rule px-4 py-2 font-data text-[0.66rem] uppercase tracking-[0.16em] text-accent sm:px-5">
        reproducible from
      </h4>
      <dl>
        <Row label="block" value={tuple.block} />
        <Row label="from" value={tuple.from} />
        <Row label="to" value={tuple.to} />
        <Row label="calldata hash" value={tuple.calldataHash} />
        <Row label="value" value={tuple.value} />
        <Row label="code fingerprint" value={codeFingerprint} />
      </dl>
      <p className="border-t border-rule px-4 py-2 text-[0.8rem] leading-snug text-ink/65 sm:px-5">
        Run these values against the same chain and the check returns the same
        verdict, or this one is falsified. That is what separates it from an
        opinion about the contract.
      </p>
    </section>
  );
}
