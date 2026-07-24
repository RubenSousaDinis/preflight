/**
 * D5e: every receipt mirrored as one message on a Hedera Consensus Service topic.
 *
 * Two rules, and the first one is the whole reason this is safe to add at all.
 *
 * **The topic is a mirror, never a source.** The signed hash chain is the record. A reader that trusts
 * the topic over the chain has inverted the trust order, so the UI labels it as a mirror and nothing in
 * a verdict path reads it.
 *
 * **It is fire and forget.** Nothing here can delay, block, or reorder a gate decision or a payment. A
 * submit that fails goes on a queue and is retried in the background; a submit that keeps failing is
 * reported as a count, never raised into the caller. A scoring checkbox that can stall a gate would be
 * a bug against the product thesis, not a rough edge.
 *
 * The message carries the receipt id, its hash, and its index, and nothing else. The chain verifies
 * from hashes, so publishing whole receipts would add nothing and bloat every message.
 */

import { HarnessError } from '../shared/errors.ts'
import { ENV, optionalEnv, requireEnv } from '../shared/config.ts'
import type { Hex, Receipt } from '../shared/types.ts'

export interface MirrorMessage {
  receiptId: string
  receiptHash: Hex
  index: number
}

export interface MirrorState {
  topicId: string | null
  /** Submitted and accepted by consensus. */
  mirrored: number
  /** Waiting for a first attempt or a retry. */
  pending: number
  /** Attempts that failed and are being retried. */
  failed: number
  lastError: string | null
}

async function hederaClient(): Promise<{ client: import('@hiero-ledger/sdk').Client; payer: string }> {
  const accountId = requireEnv(ENV.hederaAccountId, 'mirroring receipts to an HCS topic')
  const key = requireEnv(ENV.hederaPrivateKey, 'mirroring receipts to an HCS topic')
  const { Client, PrivateKey } = await import('@hiero-ledger/sdk')
  const client = Client.forTestnet()
  client.setOperator(accountId, PrivateKey.fromStringECDSA(key))
  return { client, payer: accountId }
}

/** Creates the topic once. The id goes in the environment and the README, not in code. */
export async function createReceiptTopic(memo = 'preflight receipt chain mirror'): Promise<{
  topicId: string
  createTx: string
}> {
  const { client } = await hederaClient()
  try {
    const { TopicCreateTransaction } = await import('@hiero-ledger/sdk')
    const submitted = await new TopicCreateTransaction().setTopicMemo(memo).execute(client)
    const receipt = await submitted.getReceipt(client)
    const topicId = receipt.topicId?.toString()
    if (topicId === undefined) {
      throw new HarnessError('the topic was created but the receipt carried no topic id')
    }
    return { topicId, createTx: submitted.transactionId.toString() }
  } finally {
    client.close()
  }
}

export function configuredTopicId(): string | null {
  return optionalEnv(ENV.hcsReceiptTopic) ?? null
}

/**
 * The mirror.
 *
 * `submit` never rejects. The queue drains in the background, and `state()` reports what actually
 * landed against what was asked for, so a lag is shown as "mirrored N of M" rather than implied to be
 * complete.
 */
export class HcsReceiptMirror {
  readonly topicId: string
  #queue: MirrorMessage[] = []
  #mirrored = 0
  #failed = 0
  #lastError: string | null = null
  #draining = false
  #closed = false
  #retryDelayMs: number
  #submitImpl: ((message: MirrorMessage) => Promise<void>) | null

  constructor(
    topicId: string,
    options: {
      retryDelayMs?: number
      /** Injected submitter, for tests. Defaults to the Agent Kit's HCS audit-trail writer. */
      submit?: (message: MirrorMessage) => Promise<void>
    } = {},
  ) {
    this.topicId = topicId
    this.#retryDelayMs = options.retryDelayMs ?? 2_000
    this.#submitImpl = options.submit ?? null
  }

  /** Queues one receipt. Returns immediately, and never throws. */
  submit(receipt: Receipt, index: number): void {
    if (this.#closed) return
    this.#queue.push({ receiptId: receipt.id, receiptHash: receipt.hash, index })
    void this.#drain()
  }

  state(): MirrorState {
    return {
      topicId: this.topicId,
      mirrored: this.#mirrored,
      pending: this.#queue.length,
      failed: this.#failed,
      lastError: this.#lastError,
    }
  }

  /** Waits for the queue to empty, for a verification step. Never used by a gate. */
  async flush(timeoutMs = 60_000): Promise<MirrorState> {
    const deadline = Date.now() + timeoutMs
    while (this.#queue.length > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    return this.state()
  }

  close(): void {
    this.#closed = true
  }

  async #drain(): Promise<void> {
    if (this.#draining) return
    this.#draining = true
    try {
      while (this.#queue.length > 0 && !this.#closed) {
        const message = this.#queue[0]
        try {
          await this.#submitOne(message)
          this.#queue.shift()
          this.#mirrored += 1
        } catch (err) {
          // Retried in the background, and reported as a count. Never raised into the caller.
          this.#failed += 1
          this.#lastError = err instanceof Error ? err.message : String(err)
          await new Promise((resolve) => setTimeout(resolve, this.#retryDelayMs))
          if (this.#failed % 5 === 0) {
            // Enough consecutive failures that draining forever would be its own problem: drop the
            // head so a single poisoned message cannot stall every later one.
            this.#queue.shift()
          }
        }
      }
    } finally {
      this.#draining = false
    }
  }

  async #submitOne(message: MirrorMessage): Promise<void> {
    if (this.#submitImpl !== null) {
      await this.#submitImpl(message)
      return
    }
    const { client } = await hederaClient()
    try {
      // The Agent Kit's own audit-trail hook does the write, which is the tool 02-DECISIONS §12 banks.
      // It takes the topic and a client and posts one message; the hook's tool-execution wrapper is not
      // used, because what is being audited here is a receipt rather than one of the kit's tool calls.
      const { HcsAuditTrailHook } = await import('@hashgraph/hedera-agent-kit/hooks')
      const hook = new HcsAuditTrailHook([], this.topicId, client)
      await hook.postMessageToHcsTopic(JSON.stringify(message), client)
    } finally {
      client.close()
    }
  }
}

/** Builds a mirror from the environment, or null when no topic is configured. */
export function mirrorFromEnv(options: { retryDelayMs?: number } = {}): HcsReceiptMirror | null {
  const topicId = configuredTopicId()
  return topicId === null ? null : new HcsReceiptMirror(topicId, options)
}

export interface MirrorNodeCount {
  topicId: string
  messages: number
  /** The most recent message the mirror node has, decoded. */
  latest: MirrorMessage | null
}

/**
 * Reads the topic back from a public mirror node, which is how the count is verified.
 *
 * Read-only and unauthenticated: anyone can run this against the topic id in the README, which is the
 * point of mirroring at all.
 */
export async function readMirrorNode(
  topicId: string,
  limit = 100,
  base = 'https://testnet.mirrornode.hedera.com',
): Promise<MirrorNodeCount> {
  const url = `${base}/api/v1/topics/${topicId}/messages?limit=${limit}&order=desc`
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!response.ok) {
    throw new HarnessError(`the mirror node answered HTTP ${response.status} for topic ${topicId}`)
  }
  const body = (await response.json()) as { messages?: { message?: string; sequence_number?: number }[] }
  const messages = body.messages ?? []
  const newest = messages[0]
  let latest: MirrorMessage | null = null
  if (newest?.message !== undefined) {
    try {
      latest = JSON.parse(Buffer.from(newest.message, 'base64').toString('utf8')) as MirrorMessage
    } catch {
      latest = null
    }
  }
  return {
    topicId,
    messages: newest?.sequence_number ?? messages.length,
    latest,
  }
}
