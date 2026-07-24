import type { Flag, FlagId } from "@/src/shared";

/**
 * The four checks, named exactly as 02-DECISIONS section 6 names them.
 *
 * The set is closed. The answer to "check something you have not seen" is new input
 * to these four, never a fifth detector, so the panel never implies one exists.
 */
export const FLAG_NAMES: Record<FlagId, string> = {
  "drainer-approval": "Drainer approval",
  honeypot: "Honeypot",
  "bad-callee": "Bad callee",
  "owner-backdoor": "Owner or upgrade backdoor",
};

export const FLAG_ORDER: FlagId[] = [
  "drainer-approval",
  "honeypot",
  "bad-callee",
  "owner-backdoor",
];

export const CONFIRMED_BY_LABEL: Record<Flag["confirmedBy"], string> = {
  simulation: "confirmed by simulation",
  static: "confirmed by static read",
  "llm-scan": "source scan, advisory only",
};

const CHAIN_LABELS: Record<number, string> = {
  8453: "Base mainnet",
  84532: "Base Sepolia",
};

/** txGuard is chain-parameterized, so nothing here assumes a single network. */
export function chainLabel(chainId: number): string {
  return CHAIN_LABELS[chainId] ?? `chain ${chainId}`;
}

export const UNSEEN_CHAINS = [
  { chainId: 8453, label: CHAIN_LABELS[8453] },
  { chainId: 84532, label: CHAIN_LABELS[84532] },
];
