/**
 * The staged fixtures (D3), read from the deployment record `contracts/script/deploy-fixtures.sh`
 * writes.
 *
 * Addresses live in one file rather than in each test, because a redeploy that updates half the
 * references is how half the docs end up pointing at a contract nobody is running.
 */

import { readFileSync } from 'node:fs'
import { getAddress } from 'viem'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { Address, ChainId } from '../../shared/types.ts'

export interface FixtureSet {
  chainId: ChainId
  deployer: Address
  /** The spender and recipient that appear nowhere in a caller's stated intent. */
  collector: Address
  fixtures: {
    backdoorProxy: Address
    vaultV1: Address
    vaultV2: Address
    drainerRouter: Address
    drainableToken: Address
    valueRouter: Address
    unverifiedSink: Address
    cleanControl: Address
    injectionFixture: Address
  }
}

const RECORD = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'contracts',
  'deployments',
  'base-sepolia.json',
)

export function baseSepoliaFixtures(): FixtureSet {
  const record = JSON.parse(readFileSync(RECORD, 'utf8')) as FixtureSet
  // Normalize with getAddress on the way in, per the convention every boundary here follows. The
  // record is written by a shell script, and an address that differs only in case would otherwise
  // fail to match anything the trace decoder returns.
  return {
    ...record,
    deployer: getAddress(record.deployer),
    collector: getAddress(record.collector),
    fixtures: Object.fromEntries(
      Object.entries(record.fixtures).map(([name, address]) => [name, getAddress(address)]),
    ) as FixtureSet['fixtures'],
  }
}
