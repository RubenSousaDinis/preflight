import type {
  Address,
  Flag,
  Hex,
  SerializedTxTuple,
  TxVerdict,
  Verdict,
} from "@/src/shared";

/**
 * The verdict, with every bigint already a decimal string.
 *
 * The panel renders this rather than TxVerdict itself for a reason that is not
 * style: a verdict has to survive the trip into a client component and back out of
 * a server action, and a bigint does not. Lane 1 already froze SerializedTxTuple
 * for exactly this, so the footer reuses it rather than inventing a second
 * encoding of the same five values.
 */
export type VerdictView = {
  verdict: Verdict;
  reason: string;
  flags: Flag[];
  deltas: { token: string; owner: Address; delta: string }[];
  reproducibleFrom: SerializedTxTuple;
  codeFingerprint: Hex;
  driftFromGraded: boolean | null;
};

export function toVerdictView(verdict: TxVerdict): VerdictView {
  return {
    verdict: verdict.verdict,
    reason: verdict.reason,
    flags: verdict.flags,
    deltas: verdict.deltas.map((delta) => ({
      token: delta.token,
      owner: delta.owner,
      delta: delta.delta.toString(),
    })),
    reproducibleFrom: {
      block: verdict.reproducibleFrom.block.toString(),
      from: verdict.reproducibleFrom.from,
      to: verdict.reproducibleFrom.to,
      calldataHash: verdict.reproducibleFrom.calldataHash,
      value: verdict.reproducibleFrom.value.toString(),
    },
    codeFingerprint: verdict.codeFingerprint,
    driftFromGraded: verdict.driftFromGraded,
  };
}
