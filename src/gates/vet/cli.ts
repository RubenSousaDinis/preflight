/**
 * Driving the agent gate from a terminal.
 *
 *   node --env-file-if-exists=.env.local src/gates/vet/cli.ts vet <agentId> [--min-grade B]
 *   node --env-file-if-exists=.env.local src/gates/vet/cli.ts rehearse <mcp url>
 *
 * `vet` is the real gate: the real registry, the real evidence, the real live recheck.
 *
 * `rehearse` runs B1's acceptance cycle end to end with only the registry stubbed, which is what makes
 * it runnable before a record has been published: grade the target, publish the evidence, hire it, flip
 * its surface, watch the same agent get refused, flip back, watch it get hired again. Every hash in the
 * output is computed from a real run. For a target on a private address the engine's own guard needs
 * `POLYGRAPH_ALLOW_PRIVATE_TARGETS=1`, which is the guard doing its job.
 */

import { isPreflightError, reasonOf } from '../../shared/errors.ts'
import { scoreForGrade } from '../../shared/grade.ts'
import type { AgentCard, GateDecision, Grade, GatePolicy } from '../../shared/types.ts'
import { gradeAgent } from '../../validator/grade-agent.ts'
import { pinEvidence, zerogPinner, dataUriPinner } from '../../validator/pin-evidence.ts'
import { ReceiptChain } from '../../receipts/receipt-chain.ts'
import { DEFAULT_POLICY, vetAgent } from './vet-agent.ts'
import type { ToolSurfaceVariant } from '../../shared/types.ts'

function flagValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function render(label: string, decision: GateDecision): void {
  console.log(
    [
      `${label}: ${decision.verdict}`,
      `  grade             ${decision.grade ?? '(none)'}  score ${decision.score ?? '(none)'}`,
      `  fingerprintMatch  ${decision.fingerprintMatch === null ? 'null (unobtainable, which refuses)' : decision.fingerprintMatch}`,
      `  reason            ${decision.reason}`,
    ].join('\n'),
  )
}

function cardFor(endpoint: string): AgentCard {
  return {
    agentId: 'rehearsal',
    name: 'Rehearsal target',
    mcpEndpoints: [endpoint],
    skillRefs: [],
    raw: { name: 'Rehearsal target', services: [{ name: 'MCP', endpoint }] },
    tokenURI: endpoint,
  }
}

/**
 * Flips the target's surface over its control endpoint, not in this process.
 *
 * The demo server runs somewhere else, so an in-process flip would change nothing and the rehearsal
 * would report a pass it had not earned.
 */
async function flip(endpoint: string, variant: ToolSurfaceVariant): Promise<void> {
  const control = endpoint.replace(/\/mcp$/, '/variant')
  const token = process.env.DEMO_CONTROL_TOKEN?.trim()
  if (token === undefined || token.length === 0) {
    throw new Error('DEMO_CONTROL_TOKEN is not set, so the surface cannot be flipped')
  }
  const response = await fetch(control, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ variant }),
  })
  if (!response.ok) {
    throw new Error(`the flip to ${variant} answered HTTP ${response.status}`)
  }
  const state = (await response.json()) as { variant: string; toolCount: number }
  console.log(`  flipped to ${state.variant}, ${state.toolCount} tools now served`)
}

async function rehearse(endpoint: string): Promise<boolean> {
  const chain = new ReceiptChain()
  console.log(`grading ${endpoint} …`)
  const result = await gradeAgent(cardFor(endpoint))
  console.log(`  grade ${result.grade}, score ${result.score}, ${result.methodologyVersion}`)
  console.log(`  toolFingerprint ${result.toolFingerprint}`)

  const pinner = flagValue('pin') === 'data' ? dataUriPinner : zerogPinner()
  const pinned = await pinEvidence(result.bundle, pinner)
  console.log(`  evidence via ${pinned.provider}, ${pinned.bytes} bytes, hash ${pinned.hash}`)
  if (pinned.contentAddress) console.log(`  content address ${pinned.contentAddress}`)

  const now = Math.floor(Date.now() / 1000)
  const policy: GatePolicy = { minGrade: (flagValue('min-grade') as Grade) ?? 'B', maxAgeSeconds: 86_400 }
  const stubbedRecord = {
    agentId: 'rehearsal',
    score: scoreForGrade(result.grade),
    responseURI: pinned.uri,
    responseHash: pinned.hash,
    tag: result.methodologyVersion,
    validator: '0x0000000000000000000000000000000000000001' as const,
    expiresAt: now + 86_400,
    lastUpdate: now,
    txHash: '0x00' as const,
  }

  const run = (label: string) =>
    vetAgent('rehearsal', policy, {
      now,
      validator: stubbedRecord.validator,
      receipts: chain,
      readRecord: async () => stubbedRecord,
      resolveEndpoints: async () => [endpoint],
    }).then((decision) => {
      render(label, decision)
      return decision
    })

  console.log('\n— the surface as graded —')
  const first = await run('baseline')

  console.log('\n— the surface after a flip to drifted —')
  await flip(endpoint, 'drifted')
  const drifted = await run('drifted')

  console.log('\n— flipped back —')
  await flip(endpoint, 'baseline')
  const restored = await run('baseline again')

  const verified = await chain.verify()
  console.log(`\nreceipts: ${chain.length}, chain ${verified.ok ? 'verified' : `broken: ${verified.reason}`}`)
  console.log(`signer:   ${chain.signerPubKey}`)

  const passed =
    first.verdict === 'HIRE' &&
    drifted.verdict === 'REFUSE' &&
    drifted.fingerprintMatch === false &&
    restored.verdict === 'HIRE' &&
    verified.ok
  console.log(passed ? '\nthe verdict tracked the flip in both directions.' : '\nthe cycle did not hold.')
  return passed
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2)

  if (command === 'vet') {
    const policy: GatePolicy = {
      minGrade: (flagValue('min-grade') as Grade) ?? DEFAULT_POLICY.minGrade,
      maxAgeSeconds: Number(flagValue('max-age') ?? DEFAULT_POLICY.maxAgeSeconds),
    }
    const chain = new ReceiptChain()
    const decision = await vetAgent(rest[0], policy, { receipts: chain })
    render(`agent ${rest[0]}`, decision)
    const receipt = chain.at(0)
    console.log(`  receipt           ${receipt.id}, responseHash ${receipt.responseHash}`)
    console.log(`  signer            ${receipt.signerPubKey}`)
    process.exitCode = decision.verdict === 'HIRE' ? 0 : 1
    return
  }

  if (command === 'rehearse') {
    process.exitCode = (await rehearse(rest[0])) ? 0 : 1
    return
  }

  console.log(
    ['usage:', '  cli.ts vet <agentId> [--min-grade B] [--max-age 86400]', '  cli.ts rehearse <mcp url> [--pin data]'].join('\n'),
  )
  process.exitCode = 1
}

const entry = process.argv[1] ?? ''
if (entry.endsWith('vet/cli.ts') || entry.endsWith('vet/cli.js')) {
  main().catch((err: unknown) => {
    console.error(isPreflightError(err) ? `[${err.code}] ${err.reason}` : reasonOf(err))
    process.exitCode = 1
  })
}
