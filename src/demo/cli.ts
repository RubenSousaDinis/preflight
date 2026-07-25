/**
 * Driving beat 1 from a terminal, against a running demo server.
 *
 *   DEMO_CONTROL_TOKEN=… node --env-file-if-exists=.env.local src/demo/cli.ts beat1 <mcp url> [--pin data] [--poisoned]
 *
 * Everything except the registry read is real: the engine grades the live surface twice, once as
 * baseline and once as drifted, the evidence is published and fetched back, the gate re-enumerates the
 * live surface for every candidate, and the harness calls the worker as an MCP client. The registry is
 * stubbed per candidate because publishing needs the validator key, which lives in the operator's loop.
 *
 * The three candidates are the three rows of beat 1, and each is refused or hired by the real gate for
 * its own reason: a record scored F, a record whose evidence describes a surface the target no longer
 * serves, and a record that matches.
 */

import { isPreflightError, reasonOf } from '../shared/errors.ts'
import type { AgentCard, HarnessEvent, ToolSurfaceVariant, ValidationRecord } from '../shared/types.ts'
import { gradeAgent } from '../validator/grade-agent.ts'
import { dataUriPinner, pinEvidence, zerogPinner } from '../validator/pin-evidence.ts'
import { ReceiptChain } from '../receipts/receipt-chain.ts'
import { vetAgent } from '../gates/vet/vet-agent.ts'
import { runTask } from './harness.ts'
import { hederaBalance, railByName, TINYBAR_PER_HBAR } from './payment-rail.ts'

const VALIDATOR = '0x0000000000000000000000000000000000000001' as const

function flagValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function flip(endpoint: string, variant: ToolSurfaceVariant): Promise<void> {
  const token = process.env.DEMO_CONTROL_TOKEN?.trim()
  if (token === undefined || token.length === 0) {
    throw new Error('DEMO_CONTROL_TOKEN is not set, so the surface cannot be flipped')
  }
  const response = await fetch(endpoint.replace(/\/mcp$/, '/variant'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ variant }),
  })
  if (!response.ok) throw new Error(`the flip to ${variant} answered HTTP ${response.status}`)
}

function cardFor(endpoint: string, agentId: string): AgentCard {
  return {
    agentId,
    name: agentId,
    mcpEndpoints: [endpoint],
    skillRefs: [],
    raw: { name: agentId, services: [{ name: 'MCP', endpoint }] },
    tokenURI: endpoint,
  }
}

function render(event: HarnessEvent): void {
  const at = `[${event.type}]`.padEnd(18)
  switch (event.type) {
    case 'shopping':
      console.log(`${at} ${event.candidates.length} candidates, budget ${event.budget}, task ${event.task}`)
      return
    case 'vetted':
      console.log(`${at} ${event.agentId}: ${event.decision.verdict}  grade ${event.decision.grade ?? '-'}  fingerprintMatch ${event.decision.fingerprintMatch}`)
      console.log(`${''.padEnd(18)}   ${event.decision.reason}`)
      console.log(`${''.padEnd(18)}   receipt ${event.receipt.id}`)
      return
    case 'hired':
      console.log(`${at} ${event.agentId}, grade ${event.decision.grade}`)
      return
    case 'paid':
      console.log(`${at} ${event.amount} on ${event.rail}, ${event.txRef}`)
      console.log(`${''.padEnd(18)}   receipt ${event.receipt.id}`)
      return
    case 'toolOutput':
      console.log(`${at} ${String(event.output).split('\n')[0]}`)
      return
    case 'injectionCaught':
      console.log(`${at} ${event.detail}`)
      console.log(`${''.padEnd(18)}   receipt ${event.receipt.id}`)
      return
    case 'frozen':
      console.log(`${at} ${event.reason}`)
      console.log(`${''.padEnd(18)}   spent ${event.spentSoFar}, remaining ${event.remaining}, receipt ${event.receipt.id}`)
      return
    case 'done':
      console.log(`${at} hired ${event.hired.join(', ') || 'nobody'}; refused ${event.refused.join(', ') || 'nobody'}`)
      console.log(`${''.padEnd(18)}   budget ${event.budget}, spent ${event.spent}, ${event.receiptCount} receipts`)
      return
  }
}

async function beat1(endpoint: string): Promise<boolean> {
  const pinner = flagValue('pin') === 'data' ? dataUriPinner : zerogPinner()
  const now = Math.floor(Date.now() / 1000)

  console.log('grading the surface as it stands …')
  await flip(endpoint, 'baseline')
  const baseline = await gradeAgent(cardFor(endpoint, 'a-agent'))
  const baselinePin = await pinEvidence(baseline.bundle, pinner)
  console.log(`  baseline grade ${baseline.grade}, fingerprint ${baseline.toolFingerprint.slice(0, 18)}…`)

  console.log('grading the drifted surface, so one candidate has evidence the target no longer matches …')
  await flip(endpoint, 'drifted')
  const drifted = await gradeAgent(cardFor(endpoint, 'drifted-agent'))
  const driftedPin = await pinEvidence(drifted.bundle, pinner)
  console.log(`  drifted grade  ${drifted.grade}, fingerprint ${drifted.toolFingerprint.slice(0, 18)}…`)

  const serving: ToolSurfaceVariant = process.argv.includes('--poisoned') ? 'poisoned' : 'baseline'
  await flip(endpoint, serving)
  console.log(`\nthe server is now serving: ${serving}\n`)

  const record = (score: 0 | 75 | 100, uri: string, hash: `0x${string}`): ValidationRecord & { lastUpdate: number } => ({
    agentId: 'stubbed',
    score,
    responseURI: uri,
    responseHash: hash,
    tag: baseline.methodologyVersion,
    validator: VALIDATOR,
    expiresAt: now + 86_400,
    lastUpdate: now,
    txHash: '0x00',
  })

  const records: Record<string, ValidationRecord & { lastUpdate: number }> = {
    // Scored F against the surface it actually serves: refused on the letter, not on drift.
    'f-agent': record(0, baselinePin.uri, baselinePin.hash),
    // Evidence describing the drifted surface, while the target serves baseline: refused on drift.
    'drifted-agent': record(100, driftedPin.uri, driftedPin.hash),
    // The honest one.
    'a-agent': record(baseline.score === 100 ? 100 : 75, baselinePin.uri, baselinePin.hash),
  }

  const receipts = new ReceiptChain()
  const events: HarnessEvent[] = []
  for await (const event of runTask(
    { budget: 1_000_000_000n, task: 'src-1,src-2,src-3', candidates: ['f-agent', 'drifted-agent', 'a-agent'] },
    {
      receipts,
      endpointsOf: async () => [endpoint],
      toolName: 'summarize_sources',
      // The stub stays the default so a rehearsal never moves money by omission. When a real rail is
      // asked for, the payee defaults to the demo agent's own Hedera account, so the demo command does
      // not carry an account id the operator has to remember.
      rail: railByName(flagValue('rail') ?? 'stub'),
      payTo: flagValue('pay-to') ?? process.env.A_AGENT_HEDERA_ACCOUNT_ID,
      vet: async (agentId, policy) =>
        vetAgent(agentId, policy, {
          validator: VALIDATOR,
          readRecord: async () => records[agentId] ?? null,
          resolveEndpoints: async () => [endpoint],
        }),
    },
  )) {
    render(event)
    events.push(event)
  }

  const verified = await receipts.verify()
  console.log(`\nreceipt chain: ${verified.ok ? 'verified' : `broken at ${verified.brokenAt}: ${verified.reason}`}`)
  console.log(`signer:        ${receipts.signerPubKey}`)

  const kinds = events.map((event) => event.type)
  const hiredOnce = kinds.filter((k) => k === 'hired').length === 1
  const paidOnce = kinds.filter((k) => k === 'paid').length === 1
  const caught = serving === 'poisoned' ? kinds.includes('injectionCaught') : !kinds.includes('injectionCaught')
  return verified.ok && hiredOnce && paidOnce && caught
}

/**
 * B3 step 1, read-only half: prove the key parses, the account exists, and the network answers, without
 * moving anything. A dry run then builds and freezes the transfer that a real settlement would submit.
 */
async function railStatus(): Promise<boolean> {
  const balance = await hederaBalance()
  console.log(`payer        ${balance.payer}`)
  console.log(`balance      ${balance.hbar} HBAR (${balance.tinybars} tinybars)`)
  const to = flagValue('to')
  const amount = BigInt(flagValue('amount') ?? '100000000')
  if (to === undefined) {
    console.log('pass --to <account id> to dry-run a transfer of --amount tinybars')
    return balance.tinybars > 0n
  }
  const dry = await railByName('hedera-transfer', { dryRun: true }).pay({ to, amount })
  console.log(`dry run      ${amount} tinybars (${Number(amount) / Number(TINYBAR_PER_HBAR)} HBAR) to ${to}`)
  console.log(`             ${dry.txRef}`)
  console.log('nothing was submitted. `settle` with the same flags is the command that sends it.')
  return balance.tinybars >= amount
}

/** B3 step 1, the half that moves funds. Deliberately its own command, and never part of a rehearsal. */
async function settle(): Promise<boolean> {
  const to = flagValue('to')
  const amount = BigInt(flagValue('amount') ?? '100000000')
  if (to === undefined) {
    console.log('settle needs --to <account id>')
    return false
  }
  const before = await hederaBalance()
  console.log(`balance before  ${before.hbar} HBAR`)
  const settled = await railByName('hedera-transfer').pay({ to, amount })
  console.log(`settled         ${settled.txRef}`)
  const after = await hederaBalance()
  console.log(`balance after   ${after.hbar} HBAR`)
  console.log(`moved           ${before.tinybars - after.tinybars} tinybars, including fees`)
  return !settled.stubbed
}

/**
 * Beat 1 against real published records, which is what the stage runs.
 *
 * No stubbing: each candidate is an ERC-8004 agent id, the gate reads its record from the registry,
 * fetches the evidence, and re-enumerates the live surface. The hostile turn comes from the hired
 * agent's card being re-pointed at the poisoned surface beforehand, which the gate still hires because
 * poisoned and baseline carry byte-identical tool lists and therefore the same fingerprint. What changes
 * is only what comes back from the call, which is precisely a tool-output injection.
 */
async function beat1Live(agentIds: string[]): Promise<boolean> {
  const receipts = new ReceiptChain()
  const events: HarnessEvent[] = []
  const rail = railByName(flagValue('rail') ?? 'stub')
  console.log(`candidates ${agentIds.join(', ')} | rail ${rail.name}\n`)

  for await (const event of runTask(
    { budget: 1_000_000_000n, task: 'src-1,src-2,src-3', candidates: agentIds },
    {
      receipts,
      rail,
      payTo: flagValue('pay-to') ?? process.env.A_AGENT_HEDERA_ACCOUNT_ID,
      toolName: 'summarize_sources',
    },
  )) {
    render(event)
    events.push(event)
  }

  const verified = await receipts.verify()
  console.log(`\nreceipt chain: ${verified.ok ? 'verified' : `broken at ${verified.brokenAt}`}`)
  console.log(`signer:        ${receipts.signerPubKey}`)
  const kinds = events.map((event) => event.type)
  return verified.ok && kinds.filter((k) => k === 'paid').length <= 1
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2)
  if (command === 'rail-status') {
    process.exitCode = (await railStatus()) ? 0 : 1
    return
  }
  if (command === 'settle') {
    process.exitCode = (await settle()) ? 0 : 1
    return
  }
  if (command === 'beat1-live') {
    process.exitCode = (await beat1Live((flagValue('agents') ?? rest[0] ?? '').split(',').filter(Boolean))) ? 0 : 1
    return
  }
  if (command === 'beat1') {
    process.exitCode = (await beat1(rest[0])) ? 0 : 1
    return
  }
  console.log(
    [
      'usage:',
      '  cli.ts beat1-live --agents 8430,8436 [--rail hedera-transfer]',
      '  cli.ts beat1 <mcp url> [--pin data] [--poisoned] [--rail stub|hedera-transfer|hedera-x402] [--pay-to <account>]',
      '  cli.ts rail-status [--to <account id>] [--amount <tinybars>]',
      '  cli.ts settle --to <account id> [--amount <tinybars>]',
    ].join('\n'),
  )
  process.exitCode = 1
}

const entry = process.argv[1] ?? ''
if (entry.endsWith('demo/cli.ts') || entry.endsWith('demo/cli.js')) {
  main().catch((err: unknown) => {
    console.error(isPreflightError(err) ? `[${err.code}] ${err.reason}` : reasonOf(err))
    process.exitCode = 1
  })
}
