/**
 * Contract-boundary fixtures: a pending call, a simulation, a fingerprint, and four verdicts.
 *
 * The fourth verdict is the structural block: no flags, still BLOCK, because the simulation could
 * not run. A surface built only against flagged blocks renders that case as an empty state, and an
 * empty state next to the word BLOCK is the one screen that must never look like an allow.
 */

import type {
  CodeFingerprint,
  Flag,
  PendingTx,
  SimulationResult,
  TxTuple,
  TxVerdict,
} from '../types.ts'
import { fixtureAddress, fixtureHash } from './seed.ts'

export const FIXTURE_WALLET = fixtureAddress('client-agent-wallet')
export const FIXTURE_TOKEN = fixtureAddress('fixture-erc20')
export const FIXTURE_DRAINER = fixtureAddress('unknown-spender')
export const FIXTURE_ROUTER = fixtureAddress('verified-router')

/** approve(spender, type(uint256).max) against the fixture token. */
export const FIXTURE_TX_DRAINER: PendingTx = {
  chainId: 84532,
  from: FIXTURE_WALLET,
  to: FIXTURE_TOKEN,
  calldata: `0x095ea7b3${FIXTURE_DRAINER.slice(2).padStart(64, '0')}${'f'.repeat(64)}`,
  value: 0n,
}

/** A plain swap through a verified router. */
export const FIXTURE_TX_CLEAN: PendingTx = {
  chainId: 84532,
  from: FIXTURE_WALLET,
  to: FIXTURE_ROUTER,
  calldata: '0x38ed1739',
  value: 0n,
}

export const FIXTURE_BLOCK = 20_000_000n

export const FIXTURE_SIMULATION_DRAINER: SimulationResult = {
  block: FIXTURE_BLOCK,
  reverted: false,
  balanceDeltas: [],
  approvalDeltas: [
    {
      token: FIXTURE_TOKEN,
      owner: FIXTURE_WALLET,
      spender: FIXTURE_DRAINER,
      amount: 2n ** 256n - 1n,
    },
  ],
  callGraph: [
    { from: FIXTURE_WALLET, to: FIXTURE_TOKEN, selector: '0x095ea7b3', value: 0n },
  ],
  raw: { note: 'fixture trace' },
}

export const FIXTURE_SIMULATION_CLEAN: SimulationResult = {
  block: FIXTURE_BLOCK,
  reverted: false,
  balanceDeltas: [
    { token: 'native', owner: FIXTURE_WALLET, delta: -1_000_000_000_000_000n },
    { token: FIXTURE_TOKEN, owner: FIXTURE_WALLET, delta: 4_200_000n },
  ],
  approvalDeltas: [],
  callGraph: [{ from: FIXTURE_WALLET, to: FIXTURE_ROUTER, selector: '0x38ed1739', value: 0n }],
  raw: { note: 'fixture trace' },
}

export const FIXTURE_CODE_FINGERPRINT: CodeFingerprint = {
  fingerprint: fixtureHash('fixture-code-fingerprint'),
  proxyKind: 'none',
  resolved: [{ address: FIXTURE_TOKEN, codeHash: fixtureHash('fixture-token-codehash') }],
  observedBlock: FIXTURE_BLOCK,
}

/** An EIP-1967 proxy whose implementation moved since it was graded. */
export const FIXTURE_CODE_FINGERPRINT_PROXY: CodeFingerprint = {
  fingerprint: fixtureHash('fixture-proxy-fingerprint'),
  proxyKind: 'eip1967',
  resolved: [
    { address: FIXTURE_TOKEN, codeHash: fixtureHash('proxy-codehash') },
    { address: fixtureAddress('implementation-v2'), codeHash: fixtureHash('impl-v2-codehash') },
  ],
  observedBlock: FIXTURE_BLOCK,
}

export const FIXTURE_FLAG_DRAINER: Flag = {
  id: 'drainer-approval',
  severity: 'block',
  title: 'Unlimited allowance to an unknown spender',
  detail:
    'The call approves the maximum uint256 allowance for an address outside the verified set, which lets that address move the full balance later without another signature.',
  confirmedBy: 'simulation',
}

export const FIXTURE_FLAG_BACKDOOR: Flag = {
  id: 'owner-backdoor',
  severity: 'block',
  title: 'Owner-gated mint fires during this call',
  detail:
    'Simulating the call reaches an owner-only mint path, so the balance the caller ends up holding can be diluted by the owner at will.',
  confirmedBy: 'simulation',
}

export const FIXTURE_FLAG_ADVISORY: Flag = {
  id: 'bad-callee',
  severity: 'advisory',
  title: 'Source scan noted an unverified callee',
  detail:
    'Reported by the advisory source scan only. An advisory finding never moves a verdict on its own; a simulator-confirmed finding is what blocks.',
  confirmedBy: 'llm-scan',
}

const tuple = (tx: PendingTx): TxTuple => ({
  block: FIXTURE_BLOCK,
  from: tx.from,
  to: tx.to,
  calldataHash: fixtureHash('fixture-calldata-hash'),
  value: tx.value,
})

export const FIXTURE_VERDICT_BLOCK_DRAINER: TxVerdict = {
  verdict: 'BLOCK',
  flags: [FIXTURE_FLAG_DRAINER],
  reason: 'blocks this action: it grants an unlimited allowance to an unknown spender',
  deltas: FIXTURE_SIMULATION_DRAINER.balanceDeltas,
  reproducibleFrom: tuple(FIXTURE_TX_DRAINER),
  codeFingerprint: FIXTURE_CODE_FINGERPRINT.fingerprint,
  driftFromGraded: null,
}

export const FIXTURE_VERDICT_BLOCK_BACKDOOR: TxVerdict = {
  verdict: 'BLOCK',
  flags: [FIXTURE_FLAG_BACKDOOR],
  reason: 'blocks this action: an owner-gated path fires during the call',
  deltas: [],
  reproducibleFrom: tuple(FIXTURE_TX_DRAINER),
  codeFingerprint: FIXTURE_CODE_FINGERPRINT_PROXY.fingerprint,
  driftFromGraded: true,
}

/** No flags, still a block. The simulation could not be established, so the gate refuses. */
export const FIXTURE_VERDICT_BLOCK_STRUCTURAL: TxVerdict = {
  verdict: 'BLOCK',
  flags: [],
  reason: 'blocks this action: the fork could not be established, so the call was never checked',
  deltas: [],
  reproducibleFrom: tuple(FIXTURE_TX_CLEAN),
  codeFingerprint: FIXTURE_CODE_FINGERPRINT.fingerprint,
  driftFromGraded: null,
}

export const FIXTURE_VERDICT_ALLOW: TxVerdict = {
  verdict: 'ALLOW',
  flags: [FIXTURE_FLAG_ADVISORY],
  reason: 'no simulator-confirmed red flag on this call at this block',
  deltas: FIXTURE_SIMULATION_CLEAN.balanceDeltas,
  reproducibleFrom: tuple(FIXTURE_TX_CLEAN),
  codeFingerprint: FIXTURE_CODE_FINGERPRINT.fingerprint,
  driftFromGraded: false,
}

export const FIXTURE_VERDICTS: TxVerdict[] = [
  FIXTURE_VERDICT_ALLOW,
  FIXTURE_VERDICT_BLOCK_DRAINER,
  FIXTURE_VERDICT_BLOCK_BACKDOOR,
  FIXTURE_VERDICT_BLOCK_STRUCTURAL,
]
