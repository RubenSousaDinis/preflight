/**
 * B4: codeFingerprint and proxy resolution.
 *
 * A contract has a version identity that changes when its executing code changes, including when
 * the change happens behind a proxy. That last clause is the whole task: a proxy hashed alone
 * yields a stable value across an upgrade, which is precisely the rug pull the gate claims to
 * catch, so the fingerprint composes the entry point's code with every implementation and facet it
 * resolves to.
 *
 * Shape: `01-INTERFACES.md` section 6. Failure convention: throw, never return a partial hash. A
 * gate that cannot fingerprint blocks.
 */

import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
  sha256,
  toHex,
} from 'viem'
import { FingerprintError } from '../../shared/errors.ts'
import type { Address, ChainId, CodeFingerprint, ContractRef, Hex, ProxyKind } from '../../shared/types.ts'
import { readerFor, type ChainReader } from './rpc.ts'

/**
 * The composition scheme's version. It is inside the hashed structure, so a future change to what
 * gets composed cannot silently produce a value that compares equal to one made under the old
 * scheme.
 */
export const FINGERPRINT_VERSION = 1

/**
 * EIP-1967 storage slots, each `keccak256(<label>) - 1`. Derived and checked against the spec
 * rather than copied: `cast keccak "eip1967.proxy.implementation"` ends `...bbd`, and the slot is
 * that minus one.
 */
export const EIP1967_IMPLEMENTATION_SLOT: Hex =
  '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
export const EIP1967_BEACON_SLOT: Hex =
  '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50'
/** Not part of the fingerprint. B5e reads it to answer who can upgrade this. */
export const EIP1967_ADMIN_SLOT: Hex =
  '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103'
/** EIP-1822, `keccak256("PROXIABLE")`, with no minus one. */
export const EIP1822_PROXIABLE_SLOT: Hex =
  '0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7'

/** EIP-1167, the canonical 45 byte minimal proxy: prefix, 20 address bytes, suffix. */
const EIP1167_PREFIX = '363d3d373d3d3d363d73'
const EIP1167_SUFFIX = '5af43d82803e903d91602b57fd5bf3'

const BEACON_ABI = parseAbi(['function implementation() view returns (address)'])
const LOUPE_ABI = parseAbi([
  'struct Facet { address facetAddress; bytes4[] functionSelectors; }',
  'function facets() view returns (Facet[])',
])


/** `eip155:{chainId}:{checksummedAddress}`, per 02-DECISIONS section 4. */
export function contractRef(chainId: ChainId, address: Address): ContractRef {
  return `eip155:${chainId}:${normalize(address)}`
}

function normalize(address: string): Address {
  try {
    return getAddress(address)
  } catch (cause) {
    throw new FingerprintError(`${address} is not an address`, { cause })
  }
}

function hasCode(code: Hex): boolean {
  return code.length > 2
}

/** The address in the low 20 bytes of a storage word, or null when the word is empty. */
function addressFromWord(word: Hex): Address | null {
  const padded = word.slice(2).padStart(64, '0')
  const body = padded.slice(24)
  if (/^0+$/.test(padded)) return null
  return normalize(`0x${body}`)
}

/**
 * Does this code delegate execution somewhere the five patterns did not resolve?
 *
 * The scan is opcode aware: a `0xf4` byte sitting inside a PUSH immediate is data, not a
 * DELEGATECALL, and counting those would flag most of the chain. See `resolve` for why the answer
 * matters more than it looks.
 */
export function delegatesExecution(code: Hex): boolean {
  const bytes = code.slice(2)
  for (let i = 0; i + 1 < bytes.length; ) {
    const op = parseInt(bytes.slice(i, i + 2), 16)
    if (op === 0xf4 || op === 0xf2) return true
    // PUSH1 through PUSH32 carry their argument inline; step over it.
    const immediate = op >= 0x60 && op <= 0x7f ? op - 0x5f : 0
    i += 2 + immediate * 2
  }
  return false
}

/** EIP-1167 target, or null when this is not a canonical minimal proxy. */
export function minimalProxyTarget(code: Hex): Address | null {
  const body = code.slice(2).toLowerCase()
  if (body.length !== (EIP1167_PREFIX.length + 40 + EIP1167_SUFFIX.length)) return null
  if (!body.startsWith(EIP1167_PREFIX)) return null
  if (!body.endsWith(EIP1167_SUFFIX)) return null
  return normalize(`0x${body.slice(EIP1167_PREFIX.length, EIP1167_PREFIX.length + 40)}`)
}

interface Resolution {
  proxyKind: ProxyKind
  /** Implementations, beacons, and facets, in the order they were resolved. Never includes self. */
  targets: Address[]
}

/**
 * Detect the proxy kind by probing the known patterns in order. First match wins.
 *
 * A match that fails to resolve is `'unknown'`, never `'none'`. Conflating them turns an
 * unrecognized proxy into a trusted plain contract, and `'unknown'` exists so the caller fails
 * closed instead.
 */
async function resolve(
  reader: ChainReader,
  address: Address,
  code: Hex,
  atBlock: bigint,
): Promise<Resolution> {
  const unresolved = (): Resolution => ({ proxyKind: 'unknown', targets: [] })

  // 1. EIP-1967 implementation slot.
  const implWord = await reader.storageAt(address, EIP1967_IMPLEMENTATION_SLOT, atBlock)
  const impl = addressFromWord(implWord)
  if (impl !== null) {
    return hasCode(await reader.code(impl, atBlock))
      ? { proxyKind: 'eip1967', targets: [impl] }
      : unresolved()
  }

  // 2. EIP-1967 beacon slot. The beacon's own code decides the implementation, so it is part of
  //    the identity and is composed alongside what it points at.
  const beaconWord = await reader.storageAt(address, EIP1967_BEACON_SLOT, atBlock)
  const beacon = addressFromWord(beaconWord)
  if (beacon !== null) {
    if (!hasCode(await reader.code(beacon, atBlock))) return unresolved()
    let beaconImpl: Address | null = null
    try {
      const returned = await reader.call(
        beacon,
        encodeFunctionData({ abi: BEACON_ABI, functionName: 'implementation' }),
        atBlock,
      )
      beaconImpl = normalize(
        decodeFunctionResult({ abi: BEACON_ABI, functionName: 'implementation', data: returned }),
      )
    } catch {
      return unresolved()
    }
    if (!hasCode(await reader.code(beaconImpl, atBlock))) return unresolved()
    return { proxyKind: 'beacon', targets: [beacon, beaconImpl] }
  }

  // 3. EIP-1822 UUPS. OpenZeppelin's UUPS writes the EIP-1967 slot and is caught above; this is
  //    the original proxiable slot.
  const uupsWord = await reader.storageAt(address, EIP1822_PROXIABLE_SLOT, atBlock)
  const uups = addressFromWord(uupsWord)
  if (uups !== null) {
    return hasCode(await reader.code(uups, atBlock))
      ? { proxyKind: 'uups', targets: [uups] }
      : unresolved()
  }

  // 4. EIP-1167 minimal proxy, read out of the bytecode itself.
  const clone = minimalProxyTarget(code)
  if (clone !== null) {
    return hasCode(await reader.code(clone, atBlock))
      ? { proxyKind: 'eip1167', targets: [clone] }
      : unresolved()
  }

  // 5. EIP-2535 Diamond, enumerated through the loupe.
  let facets: readonly { facetAddress: Address }[] | null = null
  try {
    const returned = await reader.call(
      address,
      encodeFunctionData({ abi: LOUPE_ABI, functionName: 'facets' }),
      atBlock,
    )
    facets = decodeFunctionResult({ abi: LOUPE_ABI, functionName: 'facets', data: returned })
  } catch {
    facets = null
  }
  if (facets !== null) {
    if (facets.length === 0) {
      throw new FingerprintError(
        `${address} answers the Diamond loupe with zero facets, which is not a resolvable identity`,
      )
    }
    const targets = facets.map((facet) => normalize(facet.facetAddress))
    for (const target of targets) {
      if (!hasCode(await reader.code(target, atBlock))) return unresolved()
    }
    return { proxyKind: 'diamond', targets }
  }

  // 6. No pattern matched. That is only `'none'` if nothing here delegates execution elsewhere.
  //
  //    This last check is the difference between an honest `'none'` and a dangerous one. USDC on
  //    Base is a real proxy whose implementation lives in a pre-EIP-1967 slot none of the five
  //    patterns read, so the literal first-match rule would report it as a plain contract, and its
  //    fingerprint would then be over the proxy shell alone: stable across exactly the upgrade this
  //    function exists to notice. Checked on Base mainnet the day this was written: USDC carries a
  //    DELEGATECALL and lands on `'unknown'`, while the Aerodrome Router and the Grand Base token,
  //    the clean control and the known-bad target of the unseen run, carry none and stay `'none'`.
  return delegatesExecution(code) ? unresolved() : { proxyKind: 'none', targets: [] }
}

/**
 * The canonical structure that gets hashed.
 *
 * Code hashes only, in order, with the resolution path and the scheme version. Addresses are
 * deliberately absent: a proxy repointed at a byte-identical redeployment executes identical code
 * and is not drift, while any change to the code that actually runs moves the hash.
 */
function canonicalize(proxyKind: ProxyKind, codeHashes: readonly Hex[]): string {
  return JSON.stringify({ v: FINGERPRINT_VERSION, proxyKind, code: codeHashes })
}

/**
 * Fingerprint the code executing at an address, at an explicit block.
 *
 * `atBlock` is required and is the drift anchor. An anchor that moves is not an anchor, so there is
 * no head default here: a caller that wants head reads it and passes it, which also records which
 * block the answer belongs to.
 */
export async function codeFingerprint(
  chainId: ChainId,
  address: Address,
  atBlock: bigint,
  reader: ChainReader = readerFor(chainId),
): Promise<CodeFingerprint> {
  const entry = normalize(address)

  let code: Hex
  try {
    code = await reader.code(entry, atBlock)
  } catch (cause) {
    throw new FingerprintError(
      `could not read the code at ${entry} on chain ${chainId} at block ${atBlock}`,
      { cause, retryable: true },
    )
  }
  if (!hasCode(code)) {
    throw new FingerprintError(
      `${entry} holds no code at block ${atBlock} on chain ${chainId}, so there is nothing to fingerprint`,
    )
  }

  let resolution: Resolution
  try {
    resolution = await resolve(reader, entry, code, atBlock)
  } catch (cause) {
    if (cause instanceof FingerprintError) throw cause
    throw new FingerprintError(
      `could not resolve what executes at ${entry} on chain ${chainId} at block ${atBlock}`,
      { cause, retryable: true },
    )
  }

  // The entry point leads, then everything it resolves to, in slot order. Composing the proxy's
  // own code with its implementations is the point rather than a refinement, and keeping the entry
  // point in `resolved` means the fingerprint can be recomputed from what this returns.
  const resolved: CodeFingerprint['resolved'] = [{ address: entry, codeHash: sha256(code) }]
  for (const target of resolution.targets) {
    const targetCode = await reader.code(target, atBlock)
    if (!hasCode(targetCode)) {
      throw new FingerprintError(
        `${target}, resolved from ${entry}, holds no code at block ${atBlock}`,
      )
    }
    resolved.push({ address: target, codeHash: sha256(targetCode) })
  }

  const fingerprint = keccak256(
    toHex(canonicalize(resolution.proxyKind, resolved.map((entry) => entry.codeHash))),
  )

  return { fingerprint, proxyKind: resolution.proxyKind, resolved, observedBlock: atBlock }
}
