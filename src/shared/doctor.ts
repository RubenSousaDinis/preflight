/**
 * `npm run doctor` reports every configuration item as resolved or missing, and with `--probe` it
 * asks each configured RPC what chain it is actually on.
 *
 * A1's done-when check 5 is "run it, do not assume it". A URL that is present and points at the
 * wrong network passes a presence check and fails a verdict, so presence is reported separately
 * from liveness and the probe compares the reported chain id against the configured one.
 *
 * No value is ever printed. This output is meant to be readable over a shoulder at a venue table.
 */

import { CHAINS, CHAIN_KEYS, ENV, optionalEnv, type ChainKey } from './config.ts'

export type Tier = 'required' | 'expected' | 'optional'

export interface DoctorItem {
  name: string
  tier: Tier
  present: boolean
  note: string
}

export interface DoctorReport {
  items: DoctorItem[]
  missingRequired: string[]
  ok: boolean
}

interface ItemSpec {
  name: string
  tier: Tier
  note: string
}

const ITEMS: ItemSpec[] = [
  { name: ENV.baseMainnetRpc, tier: 'required', note: 'Base mainnet reads, and the unseen-run fork' },
  { name: ENV.baseSepoliaRpc, tier: 'required', note: 'Base Sepolia fixtures, and the staged fork' },
  {
    name: ENV.validatorAddress,
    tier: 'required',
    note: 'the read path rejects records from any other validator',
  },
  { name: ENV.validatorPrivateKey, tier: 'required', note: 'signing a validation response' },
  {
    name: ENV.baseMainnetExplorerKey,
    tier: 'optional',
    note: 'cross-check only; Sourcify is the primary verified-source path and needs no key',
  },
  { name: ENV.baseSepoliaExplorerKey, tier: 'optional', note: 'cross-check only, same as above' },
  { name: ENV.hederaRpc, tier: 'expected', note: 'the x402 payment rail' },
  { name: ENV.hederaAccountId, tier: 'expected', note: 'the ECDSA payer account' },
  { name: ENV.hederaPrivateKey, tier: 'expected', note: 'the ECDSA payer key' },
  { name: ENV.zerogStorageKey, tier: 'expected', note: 'pinning evidence bundles' },
  { name: ENV.zerogComputeKey, tier: 'optional', note: 'the advisory scan; it cannot move a verdict' },
  {
    name: ENV.validationRegistryAddress,
    tier: 'expected',
    note: 'set once A4 deploys; every registry read fails closed until then',
  },
  { name: ENV.validationRegistryChainId, tier: 'expected', note: 'the chain A4 deployed to' },
  { name: ENV.ipfsGateway, tier: 'optional', note: 'one gateway, never a race; a default is stated' },
]

export function doctor(): DoctorReport {
  const items: DoctorItem[] = ITEMS.map((spec) => ({
    name: spec.name,
    tier: spec.tier,
    present: optionalEnv(spec.name) !== undefined,
    note: spec.note,
  }))
  const missingRequired = items.filter((i) => i.tier === 'required' && !i.present).map((i) => i.name)
  return { items, missingRequired, ok: missingRequired.length === 0 }
}

export function formatDoctorReport(report: DoctorReport): string {
  const width = Math.max(...report.items.map((i) => i.name.length))
  const lines = report.items.map((item) => {
    const mark = item.present ? 'resolved' : item.tier === 'required' ? 'MISSING ' : 'unset   '
    return `  ${mark}  ${item.name.padEnd(width)}  ${item.note}`
  })
  const verdict = report.ok
    ? 'every required item resolved'
    : `missing required: ${report.missingRequired.join(', ')}`
  return [`configuration (${report.items.length} items)`, ...lines, '', verdict].join('\n')
}

export interface ProbeResult {
  chain: ChainKey
  ok: boolean
  detail: string
}

async function rpcCall(url: string, method: string): Promise<string> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const body = (await response.json()) as { result?: string; error?: { message?: string } }
  if (body.error) throw new Error(body.error.message ?? 'rpc error')
  if (typeof body.result !== 'string') throw new Error('no result')
  return body.result
}

/** Asks each configured RPC for its chain id and head block. A mismatch is a failure, not a note. */
export async function probeChains(): Promise<ProbeResult[]> {
  const results: ProbeResult[] = []
  for (const key of CHAIN_KEYS) {
    const chain = CHAINS[key]
    const url = optionalEnv(chain.rpcEnv)
    if (url === undefined) {
      results.push({ chain: key, ok: false, detail: `${chain.rpcEnv} is not set` })
      continue
    }
    try {
      const reported = Number(await rpcCall(url, 'eth_chainId'))
      const block = Number(await rpcCall(url, 'eth_blockNumber'))
      if (reported !== chain.chainId) {
        results.push({
          chain: key,
          ok: false,
          detail: `answers as chain ${reported}, configured as ${chain.chainId}`,
        })
        continue
      }
      results.push({ chain: key, ok: true, detail: `chain ${reported}, head block ${block}` })
    } catch (err) {
      results.push({
        chain: key,
        ok: false,
        detail: err instanceof Error ? err.message : 'probe failed',
      })
    }
  }
  return results
}

async function main(): Promise<void> {
  const report = doctor()
  console.log(formatDoctorReport(report))
  let probesOk = true
  if (process.argv.includes('--probe')) {
    console.log('\nrpc probe')
    for (const result of await probeChains()) {
      console.log(`  ${result.ok ? 'ok     ' : 'FAILED '}  ${CHAINS[result.chain].label}: ${result.detail}`)
      if (!result.ok) probesOk = false
    }
  }
  process.exitCode = report.ok && probesOk ? 0 : 1
}

const entry = process.argv[1] ?? ''
if (entry.endsWith('doctor.ts') || entry.endsWith('doctor.js')) {
  await main()
}
