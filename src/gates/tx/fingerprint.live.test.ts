/**
 * B4 step 6: verify check 1 against real proxies before wiring anything else.
 *
 * These hit Base over the network, so they skip when no RPC is configured rather than failing a
 * run that was never going to reach a chain. Everything that must hold without a network lives in
 * `fingerprint.test.ts`.
 *
 * Run: `node --env-file-if-exists=.env.local --import tsx --test src/gates/tx/fingerprint.live.test.ts`
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Address } from '../../shared/types.ts'
import { codeFingerprint } from './fingerprint.ts'
import { readerFor } from './rpc.ts'

const BASE_MAINNET = 8453
const offline = process.env.BASE_MAINNET_RPC_URL === undefined

/** ERC-8004 IdentityRegistry, an ERC1967 proxy run by the standard's authors (02-DECISIONS 13.1). */
const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as Address
/** USDC on Base: a real proxy whose implementation sits in a slot none of the five patterns read. */
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address
/** The unseen run's clean control (02-DECISIONS 13.3). It must not land on 'unknown'. */
const AERODROME_ROUTER = '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43' as Address
/** The unseen run's known-bad target. Its backdoor is an owner gated mint, not a proxy. */
const GRAND_BASE = '0x2aF864fb54b55900Cd58d19c7102d9e4FA8D84a3' as Address

test('check 1, live: the same address at the same block fingerprints identically', { skip: offline }, async () => {
  const reader = readerFor(BASE_MAINNET)
  const block = await reader.blockNumber()
  const first = await codeFingerprint(BASE_MAINNET, IDENTITY_REGISTRY, block, reader)
  const second = await codeFingerprint(BASE_MAINNET, IDENTITY_REGISTRY, block, reader)

  assert.equal(first.fingerprint, second.fingerprint)
  assert.equal(first.observedBlock, block)
  assert.equal(first.proxyKind, 'eip1967')
  assert.equal(first.resolved.length, 2)
  assert.equal(first.resolved[0].address, IDENTITY_REGISTRY)
  console.log(
    `  identity registry: ${first.fingerprint} at block ${block}, ${first.proxyKind}, impl ${first.resolved[1].address}`,
  )
})

test('an unrecognized proxy is unknown, so the caller fails closed', { skip: offline }, async () => {
  const reader = readerFor(BASE_MAINNET)
  const block = await reader.blockNumber()
  const usdc = await codeFingerprint(BASE_MAINNET, USDC, block, reader)
  assert.equal(usdc.proxyKind, 'unknown')
  console.log(`  usdc: ${usdc.proxyKind} at block ${block}`)
})

test('the unseen run targets do not land on unknown', { skip: offline }, async () => {
  const reader = readerFor(BASE_MAINNET)
  const block = await reader.blockNumber()
  for (const [label, address] of [
    ['aerodrome router', AERODROME_ROUTER],
    ['grand base', GRAND_BASE],
  ] as const) {
    const result = await codeFingerprint(BASE_MAINNET, address, block, reader)
    assert.equal(result.proxyKind, 'none')
    assert.equal(result.resolved.length, 1)
    console.log(`  ${label}: ${result.proxyKind}, ${result.fingerprint} at block ${block}`)
  }
})

test('an EOA has nothing to fingerprint and throws', { skip: offline }, async () => {
  const reader = readerFor(BASE_MAINNET)
  const block = await reader.blockNumber()
  await assert.rejects(() =>
    codeFingerprint(BASE_MAINNET, '0x0000000000000000000000000000000000000001' as Address, block, reader),
  )
})
