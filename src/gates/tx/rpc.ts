/**
 * The chain reader the contract boundary runs on.
 *
 * One narrow interface rather than a viem client passed around, for two reasons. It keeps every
 * read explicitly block scoped, which is what a drift anchor requires, and it gives the tests a
 * seam: a stub reader exercises the resolution paths that a live RPC cannot be made to produce on
 * demand, such as a slot pointing at an address with no code.
 *
 * Server side only. Reads the per-chain RPC from the shared config, which throws when a chain is
 * not configured. There is no default endpoint and no default chain.
 */

import { createPublicClient, http, type PublicClient } from 'viem'
import { rpcUrlFor } from '../../shared/config.ts'
import type { Address, ChainId, Hex } from '../../shared/types.ts'

export interface ChainReader {
  readonly chainId: ChainId
  /** The head block. Callers that need an anchor read it once and pass it down explicitly. */
  blockNumber(): Promise<bigint>
  /** Runtime code at a block. `'0x'` when the address holds none. */
  code(address: Address, atBlock: bigint): Promise<Hex>
  storageAt(address: Address, slot: Hex, atBlock: bigint): Promise<Hex>
  /** A view call at a block. Throws when the call reverts, which is information, not a failure. */
  call(to: Address, data: Hex, atBlock: bigint): Promise<Hex>
}

const clients = new Map<ChainId, PublicClient>()

function clientFor(chainId: ChainId): PublicClient {
  const existing = clients.get(chainId)
  if (existing !== undefined) return existing
  const client = createPublicClient({ transport: http(rpcUrlFor(chainId)) })
  clients.set(chainId, client)
  return client
}

export function readerFor(chainId: ChainId): ChainReader {
  return {
    chainId,
    async blockNumber() {
      return clientFor(chainId).getBlockNumber()
    },
    async code(address, atBlock) {
      const code = await clientFor(chainId).getCode({ address, blockNumber: atBlock })
      return code ?? '0x'
    },
    async storageAt(address, slot, atBlock) {
      const value = await clientFor(chainId).getStorageAt({
        address,
        slot,
        blockNumber: atBlock,
      })
      return value ?? `0x${'00'.repeat(32)}`
    },
    async call(to, data, atBlock) {
      const { data: result } = await clientFor(chainId).call({
        to,
        data,
        blockNumber: atBlock,
      })
      return result ?? '0x'
    },
  }
}
