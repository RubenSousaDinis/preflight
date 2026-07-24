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

import { isPreflightError, reasonOf } from '../shared/errors.ts'
import type { AgentCard } from '../shared/types.ts'
import { identityChainId } from './identity-registry.ts'
import { resolveAgentDetailed } from './resolve-agent.ts'
import { gradeAgent } from './grade-agent.ts'
import { canonicalize } from './canonical.ts'
import { methodologyVersion } from './methodology.ts'

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

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2)
  const chainId = Number(flagValue('chain') ?? identityChainId())

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
