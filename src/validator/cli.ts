/**
 * A small command for running the resolver against the live registry.
 *
 * `resolve` is A2's own acceptance check: an id in, its endpoints on screen, or a typed refusal
 * with the reason that would reach the UI. `scan` walks a range of ids and reports which ones
 * declare an MCP surface, which is how a demo target is found without guessing at an id.
 *
 *   node --env-file-if-exists=.env.local src/validator/cli.ts resolve 7 [--chain 8453]
 *   node --env-file-if-exists=.env.local src/validator/cli.ts scan 1 25 [--chain 8453]
 */

import { createWalletClient, getAddress, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import { isPreflightError, reasonOf } from '../shared/errors.ts'
import { ENV, identityRegistryFor, requireEnv, rpcUrlFor } from '../shared/config.ts'
import type { AgentCard } from '../shared/types.ts'
import {
  IDENTITY_REGISTRY_ABI,
  buildAgentCard,
  identityChainId,
  publicClientFor,
} from './identity-registry.ts'
import { resolveAgentDetailed } from './resolve-agent.ts'
import { gradeAgent } from './grade-agent.ts'
import { canonicalize } from './canonical.ts'
import { methodologyVersion } from './methodology.ts'
import {
  dataUriPinner,
  pinEvidence,
  verifyPublishedEvidence,
  zerogPinner,
  type Pinner,
} from './pin-evidence.ts'
import {
  assemblePublishCall,
  publishValidation,
  readCurrentValidation,
  readValidationWithEvidence,
} from './validation-registry.ts'
import { AgentWatcher, describeFlip } from './watcher.ts'
import { liveFingerprint } from '../gates/vet/live-fingerprint.ts'
import { openWorker } from '../demo/mcp-call.ts'

function flagValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function resolveOne(agentId: string, chainId: number): Promise<boolean> {
  try {
    const resolved = await resolveAgentDetailed(agentId, { chainId })
    console.log(`agent ${agentId} on chain ${resolved.chainId}, read at block ${resolved.block}`)
    console.log(`  name        ${resolved.card.name || '(none declared)'}`)
    console.log(`  tokenURI    ${resolved.card.tokenURI.slice(0, 100)}`)
    console.log(`  fetched     ${resolved.fetchedFrom.slice(0, 100)} (${resolved.bytes} bytes)`)
    console.log(`  endpoints   ${resolved.card.mcpEndpoints.join(', ')}`)
    console.log(`  skills      ${resolved.card.skillRefs.join(', ') || '(none)'}`)
    return true
  } catch (err) {
    const code = isPreflightError(err) ? err.code : 'UNTYPED'
    const retryable = isPreflightError(err) ? err.retryable : false
    console.log(`agent ${agentId}: refused [${code}, retryable ${retryable}] ${reasonOf(err)}`)
    return false
  }
}

async function scan(from: number, to: number, chainId: number): Promise<void> {
  for (let id = from; id <= to; id += 1) {
    try {
      const resolved = await resolveAgentDetailed(String(id), { chainId, timeoutMs: 6_000 })
      console.log(`${id}: ${resolved.card.name} -> ${resolved.card.mcpEndpoints.join(', ')}`)
    } catch (err) {
      console.log(`${id}: ${reasonOf(err).slice(0, 110)}`)
    }
  }
}

/**
 * Grades a card and prints the letter, the score, and both hashes.
 *
 * `--write <path>` drops the evidence bundle next to it, which is what the round-trip check and A3b
 * read. The bundle is written as canonical bytes, so the file on disk is the thing that was hashed.
 */
async function gradeCard(card: AgentCard): Promise<boolean> {
  try {
    const started = Date.now()
    const result = await gradeAgent(card, {
      onProgress: (endpoint, done, total, label) => {
        console.log(`  [${done}/${total}] ${label} (${endpoint})`)
      },
    })
    console.log(`grade         ${result.grade}  score ${result.score}`)
    console.log(`methodology   ${result.methodologyVersion}`)
    console.log(`engine        ${result.bundle.engineVersion}`)
    console.log(`evidenceHash  ${result.evidenceHash}`)
    console.log(`fingerprint   ${result.toolFingerprint}`)
    console.log(`endpoints     ${result.bundle.endpoints.map((e) => `${e.endpoint} ${e.grade}`).join(', ')}`)
    console.log(`tools         ${result.bundle.toolSurface.map((s) => s.toolCount).join(', ')}`)
    console.log(`ranAt         ${result.bundle.ranAt}  (${Math.round((Date.now() - started) / 1000)}s)`)

    const out = flagValue('write')
    if (out !== undefined) {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(out, canonicalize(result.bundle))
      console.log(`bundle        ${out} (canonical bytes)`)
    }
    return true
  } catch (err) {
    const code = isPreflightError(err) ? err.code : 'UNTYPED'
    console.log(`refused [${code}] ${reasonOf(err)}`)
    return false
  }
}

/** A card standing in for an endpoint nobody has registered yet, for grading a bare URL. */
function cardForEndpoint(endpoint: string): AgentCard {
  return {
    agentId: `unregistered:${endpoint}`,
    name: '',
    mcpEndpoints: [endpoint],
    skillRefs: [],
    raw: { name: '', services: [{ name: 'MCP', endpoint }] },
    tokenURI: endpoint,
  }
}

function chosenPinner(): Pinner {
  return flagValue('pin') === 'zerog' ? zerogPinner() : dataUriPinner
}

/**
 * A3b, prepared to copy-paste level.
 *
 * Without `--send` it grades, publishes the evidence, prints both transactions' exact arguments, and
 * stops. That is the point: the operator reads the arguments before a key is anywhere near them. With
 * `--send` it signs both legs and then confirms by reading the record back, because a send receipt is
 * not evidence that a record exists.
 */
async function publish(agentId: string, chainId: number): Promise<boolean> {
  const resolved = await resolveAgentDetailed(agentId, { chainId })
  const result = await gradeAgent(resolved.card)
  console.log(`grade         ${result.grade}  score ${result.score}  ${result.methodologyVersion}`)

  const pinned = await pinEvidence(result.bundle, chosenPinner())
  console.log(`evidence      ${pinned.provider}, ${pinned.bytes} bytes`)
  console.log(`  uri         ${pinned.uri.slice(0, 120)}${pinned.uri.length > 120 ? '…' : ''}`)
  console.log(`  hash        ${pinned.hash}`)
  if (pinned.contentAddress) console.log(`  root        ${pinned.contentAddress}`)
  if (pinned.hash !== result.evidenceHash) {
    console.log('refused: the published bytes do not hash to the graded evidence hash')
    return false
  }

  const call = assemblePublishCall({ result, agentId, responseURI: pinned.uri })
  console.log(`registry      ${call.registry} on chain ${call.chainId}`)
  console.log(`requestHash   ${call.requestHash}`)
  console.log(`  leg 1       validationRequest(validator, agentId, responseURI, requestHash)`)
  console.log(`              sent by the agent owner or an approved operator`)
  console.log(`  leg 2       validationResponse(requestHash, ${result.score}, responseURI, ${result.evidenceHash}, ${JSON.stringify(result.methodologyVersion)})`)
  console.log(`              sent by the validator, and only the validator`)

  if (!process.argv.includes('--send')) {
    console.log('\nnothing was sent. re-run with --send to sign both legs.')
    return true
  }

  const record = await publishValidation(result, agentId, pinned.uri, {
    requestExists: process.argv.includes('--request-exists'),
  })
  console.log(`\nlanded        tx ${record.txHash}`)
  console.log(`read back     score ${record.score}, tag ${record.tag}, expiresAt ${record.expiresAt}`)
  console.log(`  validator   ${record.validator}`)
  console.log(`  responseURI ${record.responseURI.slice(0, 120) || '(not in the log)'}`)
  return true
}

/**
 * A5 as a rehearsal: watch a live endpoint, flip its surface, and see the poll notice on its own.
 *
 * The re-grade is the engine's, and the letter that comes back is whatever the new surface earns. The
 * publish step stays the operator's, so this prints the grade rather than sending anything.
 */
async function watch(target: string): Promise<boolean> {
  // An agent id watches the agent: the card is re-resolved every poll, so a target that changes where it
  // points is a change like any other. A URL watches that URL directly, which is the rehearsal form.
  const isAgentId = /^[0-9]+$/.test(target.trim())
  const endpoint = isAgentId
    ? (await resolveAgentDetailed(target, { chainId: identityChainId() })).card.mcpEndpoints[0]
    : target
  if (endpoint === undefined) {
    console.log(`agent ${target} declares no endpoint to watch`)
    return false
  }
  if (isAgentId) console.log(`watching agent ${target} at ${endpoint}`)
  const intervalMs = Number(flagValue('interval') ?? 5_000)
  const rounds = Number(flagValue('rounds') ?? 6)
  const flipAt = Number(flagValue('flip-at') ?? 2)
  const flipTo = flagValue('flip-to') ?? 'drifted'
  const token = process.env.DEMO_CONTROL_TOKEN?.trim()

  console.log(`grading ${endpoint} once, to establish what the watcher is watching …`)
  const baseline = await gradeAgent(
    isAgentId ? (await resolveAgentDetailed(target, { chainId: identityChainId() })).card : cardForEndpoint(endpoint),
  )
  console.log(`  baseline grade ${baseline.grade}, fingerprint ${baseline.toolFingerprint.slice(0, 18)}…`)
  console.log(`polling every ${intervalMs}ms for ${rounds} rounds, flipping to ${flipTo} at round ${flipAt}\n`)

  const regraded: string[] = []
  const watcher = new AgentWatcher(endpoint, {
    intervalMs,
    observeFingerprint: async () => {
      const current = isAgentId
        ? (await resolveAgentDetailed(target, { chainId: identityChainId() })).card.mcpEndpoints[0]!
        : endpoint
      return liveFingerprint([current])
    },
    observeVersion: async () => (await openWorker(endpoint)).serverVersion,
    regrade: async () =>
      gradeAgent(
        isAgentId ? (await resolveAgentDetailed(target, { chainId: identityChainId() })).card : cardForEndpoint(endpoint),
      ),
    onObservation: (observation) => {
      const state =
        observation.error !== null
          ? `could not check: ${observation.error}`
          : observation.changed
            ? `CHANGED (${observation.changeKind})`
            : 'no change'
      console.log(`  [${observation.at}] ${observation.fingerprint?.slice(0, 18) ?? '(none)'}…  ${state}`)
    },
    onChange: (result) => {
      console.log(`  re-graded: ${describeFlip(baseline.grade, result.grade)}, score ${result.score}`)
      console.log(`  evidenceHash    ${result.evidenceHash}`)
      console.log(`  toolFingerprint ${result.toolFingerprint}`)
      regraded.push(result.grade)
    },
  })

  for (let round = 1; round <= rounds; round += 1) {
    if (round === flipAt && flagValue('flip-card') !== undefined && isAgentId) {
      // Beat 4's update, done the way that survives serverless: the agent re-points its own card at a
      // surface named in the URL. The fingerprint moves because the endpoint is part of it, and the
      // re-grade that follows reads that surface reliably rather than whichever one an instance happens
      // to hold. A control-endpoint flip is fine for a single call and unreliable across a whole grade.
      const surface = flagValue('flip-card')
      const base = endpoint.split('?')[0]
      const { buildAgentCard } = await import('./identity-registry.ts')
      const { dataUri } = buildAgentCard({ name: `preflight-demo-${target}`, endpoint: `${base}?surface=${surface}` })
      const key = requireEnv(ENV.validatorPrivateKey, 'writing an agent card')
      const account = privateKeyToAccount(key as `0x${string}`)
      const wallet = createWalletClient({ account, transport: http(rpcUrlFor(identityChainId())) })
      const reader = publicClientFor(identityChainId())
      const hash = await wallet.writeContract({
        address: identityRegistryFor(identityChainId()),
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'setAgentURI',
        args: [BigInt(target), dataUri],
        account,
        chain: null,
      })
      await reader.waitForTransactionReceipt({ hash })
      console.log(`  -- the agent shipped an update: its card now points at ?surface=${surface} --`)
    } else if (round === flipAt && token !== undefined) {
      const bump = flagValue('bump-version')
      const response = await fetch(endpoint.replace(/\/mcp$/, '/variant'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ variant: flipTo, ...(bump === undefined ? {} : { version: bump }) }),
      })
      const state = (await response.json()) as { variant?: string; declaredVersion?: string }
      console.log(
        `  -- the target shipped an update: variant ${state.variant}, declared version ${state.declaredVersion} (HTTP ${response.status}) --`,
      )
    }
    await watcher.check()
    if (round < rounds) await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  watcher.stop()

  const observations = watcher.state().observations
  console.log(
    `\n${observations.length} observations, ${observations.filter((entry) => entry.changed).length} change(s) detected with no manual trigger`,
  )
  console.log(`grade before ${baseline.grade}, after ${regraded.at(-1) ?? '(no re-grade)'}`)
  return regraded.length > 0
}

/**
 * Points an agent you already own at an MCP endpoint, so it has a surface to grade.
 *
 * D1 support, and the thing that unblocks A3b: an agent registered with a placeholder card has nothing
 * to grade, and gradeAgent refuses it for exactly the right reason. The card is written inline as a data
 * URI, so no hosting is needed and it resolves the moment the transaction lands.
 *
 * Without --send it prints the card and the call and stops.
 */
async function setCard(agentId: string, chainId: number): Promise<boolean> {
  const endpoint = flagValue('endpoint')
  if (endpoint === undefined) {
    console.log('set-card needs --endpoint <mcp url>')
    return false
  }
  const { card, dataUri } = buildAgentCard({
    name: flagValue('name') ?? `preflight-demo-${agentId}`,
    endpoint,
    version: flagValue('version'),
  })
  const registry = identityRegistryFor(chainId)
  const registering = agentId === 'new'

  console.log(`registry      ${registry} on chain ${chainId}`)
  console.log(`card          ${JSON.stringify(card)}`)
  console.log(`agentURI      ${dataUri.slice(0, 80)}… (${dataUri.length} chars)`)
  console.log(
    registering
      ? 'call          register(agentURI) -> a new agent id, owned by the sender'
      : `call          setAgentURI(${agentId}, agentURI) -> the sender must own the agent`,
  )

  if (!process.argv.includes('--send')) {
    console.log('\nnothing was sent. re-run with --send to write the card.')
    return true
  }

  const key = requireEnv(ENV.validatorPrivateKey, 'writing an agent card')
  const account = privateKeyToAccount(key as `0x${string}`)
  const wallet = createWalletClient({ account, transport: http(rpcUrlFor(chainId)) })
  const reader = publicClientFor(chainId)

  if (!registering) {
    const owner = await reader.readContract({
      address: registry,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'ownerOf',
      args: [BigInt(agentId)],
    })
    if (getAddress(owner) !== getAddress(account.address)) {
      console.log(`refused: agent ${agentId} is owned by ${owner}, and the loaded key signs as ${account.address}`)
      return false
    }
  }

  const hash = registering
    ? await wallet.writeContract({
        address: registry,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'register',
        args: [dataUri],
        account,
        chain: null,
      })
    : await wallet.writeContract({
        address: registry,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'setAgentURI',
        args: [BigInt(agentId), dataUri],
        account,
        chain: null,
      })
  const receipt = await reader.waitForTransactionReceipt({ hash })
  console.log(`\nlanded        ${hash} (${receipt.status})`)
  if (receipt.status !== 'success') return false
  if (registering) {
    // The registry is an ERC-721, so the new id arrives as the tokenId of the mint. Printing the hash
    // alone would leave the caller holding a transaction and no way to name what it created.
    const { decodeEventLog, parseAbiItem } = await import('viem')
    const transfer = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)')
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: [transfer], topics: log.topics, data: log.data })
        console.log(`agent id      ${(decoded.args as { tokenId: bigint }).tokenId.toString()}`)
      } catch {
        // Not the mint log. Nothing to report for it.
      }
    }
  }
  if (!registering) {
    // Confirm by resolving it: a send receipt is not evidence that the card reads back.
    const resolved = await resolveAgentDetailed(agentId, { chainId })
    console.log(`resolved      ${resolved.card.name} -> ${resolved.card.mcpEndpoints.join(', ')}`)
  }
  return true
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2)
  const chainId = Number(flagValue('chain') ?? identityChainId())

  if (command === 'set-card') {
    process.exitCode = (await setCard(rest[0], chainId)) ? 0 : 1
    return
  }

  if (command === 'watch') {
    process.exitCode = (await watch(rest[0])) ? 0 : 1
    return
  }
  if (command === 'current') {
    const current = await readCurrentValidation(
      rest[0],
      flagValue('validator') as `0x${string}` | undefined,
    )
    if (current === null) {
      console.log('null: no usable record, which the gate reads as a refusal')
      process.exitCode = 1
      return
    }
    console.log(
      `selected: block ${current.selected.block}, log ${current.selected.logIndex}, score ${current.record.score}`,
    )
    console.log(`history:  ${current.history.length} record(s), oldest first`)
    for (const entry of current.history) {
      console.log(
        `  block ${entry.block} log ${entry.logIndex}  score ${entry.score}  ${entry.requestHash.slice(0, 18)}…  tx ${entry.txHash.slice(0, 18)}…`,
      )
    }
    return
  }
  if (command === 'publish') {
    try {
      process.exitCode = (await publish(rest[0], chainId)) ? 0 : 1
    } catch (err) {
      const code = isPreflightError(err) ? err.code : 'UNTYPED'
      console.log(`refused [${code}] ${reasonOf(err)}`)
      process.exitCode = 1
    }
    return
  }
  if (command === 'read-validation') {
    try {
      const record = await readValidationWithEvidence(
        rest[0],
        flagValue('validator') as `0x${string}` | undefined,
      )
      if (record === null) {
        console.log('null: no usable record from this validator, which the gate reads as a refusal')
        process.exitCode = 1
        return
      }
      console.log(JSON.stringify(record, null, 2))
    } catch (err) {
      console.log(`refused ${reasonOf(err)}`)
      process.exitCode = 1
    }
    return
  }
  if (command === 'verify-evidence') {
    const check = await verifyPublishedEvidence(rest[0], rest[1] as `0x${string}`)
    console.log(`${check.ok ? 'MATCHES' : 'MISMATCH'}  ${check.hash}  (${check.bytes} bytes)`)
    process.exitCode = check.ok ? 0 : 1
    return
  }
  if (command === 'methodology') {
    console.log(methodologyVersion())
    return
  }
  if (command === 'grade-endpoint') {
    process.exitCode = (await gradeCard(cardForEndpoint(rest[0]))) ? 0 : 1
    return
  }
  if (command === 'grade') {
    try {
      const resolved = await resolveAgentDetailed(rest[0], { chainId })
      process.exitCode = (await gradeCard(resolved.card)) ? 0 : 1
    } catch (err) {
      console.log(`refused ${reasonOf(err)}`)
      process.exitCode = 1
    }
    return
  }
  if (command === 'resolve') {
    const ok = await resolveOne(rest[0], chainId)
    process.exitCode = ok ? 0 : 1
    return
  }
  if (command === 'scan') {
    await scan(Number(rest[0] ?? 1), Number(rest[1] ?? 20), chainId)
    return
  }
  console.log(
    [
      'usage:',
      '  cli.ts resolve <agentId> [--chain <id>]',
      '  cli.ts scan <from> <to> [--chain <id>]',
      '  cli.ts grade <agentId> [--chain <id>] [--write <path>]',
      '  cli.ts grade-endpoint <https url> [--write <path>]',
      '  cli.ts publish <agentId> [--pin zerog|data] [--send] [--request-exists]',
      '  cli.ts read-validation <agentId> [--validator <address>]',
      '  cli.ts verify-evidence <uri> <expectedHash>',
      '  cli.ts watch <agentId|mcp url> [--interval 5000] [--rounds 6] [--flip-at 2] [--flip-to drifted|--flip-card drifted]',
      '  cli.ts current <agentId> [--validator <address>]',
      '  cli.ts set-card <agentId|new> --endpoint <mcp url> [--name <name>] [--version <v>] [--send]',
      '  cli.ts methodology',
    ].join('\n'),
  )
  process.exitCode = 1
}

const entry = process.argv[1] ?? ''
if (entry.endsWith('validator/cli.ts') || entry.endsWith('validator/cli.js')) {
  main().catch((err: unknown) => {
    console.error(reasonOf(err))
    process.exitCode = 1
  })
}
