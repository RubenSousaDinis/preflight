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
import { identityChainId } from './identity-registry.ts'
import { resolveAgentDetailed } from './resolve-agent.ts'

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

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2)
  const chainId = Number(flagValue('chain') ?? identityChainId())

  if (command === 'resolve') {
    const ok = await resolveOne(rest[0], chainId)
    process.exitCode = ok ? 0 : 1
    return
  }
  if (command === 'scan') {
    await scan(Number(rest[0] ?? 1), Number(rest[1] ?? 20), chainId)
    return
  }
  console.log('usage: cli.ts resolve <agentId> [--chain <id>] | cli.ts scan <from> <to> [--chain <id>]')
  process.exitCode = 1
}

const entry = process.argv[1] ?? ''
if (entry.endsWith('validator/cli.ts') || entry.endsWith('validator/cli.js')) {
  main().catch((err: unknown) => {
    console.error(reasonOf(err))
    process.exitCode = 1
  })
}
