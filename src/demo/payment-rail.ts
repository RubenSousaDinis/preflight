/**
 * The payment rail behind beat 1's `paid` event.
 *
 * Three implementations, and the difference between them is stated rather than hidden. A stubbed
 * payment is labelled in the event and in the receipt, because a stream missing its payment events
 * reads as if payment never happened, and an unlabelled stub in a beat whose claim is real money is
 * the one shortcut that would not survive a question.
 *
 * - `stubbedRail`: nothing settles. Labelled everywhere it appears.
 * - `hederaTransferRail`: a real HBAR transfer on Hedera Testnet, waiting for consensus. This is what
 *   proves the rail before the loop runs, and it is the pre-authorized minimal-payment path from
 *   02-DECISIONS §12 if the full x402 leg is cut.
 * - `hederaX402Rail`: the full x402 flow. The client calls a resource that answers 402 with its payment
 *   requirements, the scheme builds and signs the payment, the facilitator settles it, and the settled
 *   reference comes back in the response header. It needs a resource server issuing the challenge and a
 *   facilitator, which is what D2 provisions.
 *
 * A failed settlement never retries. An automatic retry against an unknown settlement state is how one
 * call pays twice.
 */

import { HarnessError } from '../shared/errors.ts'
import { ENV, requireEnv } from '../shared/config.ts'

export interface PaymentReceiptRef {
  /** What the rail calls this settlement. A Hedera transaction id, or a labelled stub reference. */
  txRef: string
  stubbed: boolean
  /** Consensus timestamp or equivalent, when the rail reports one. */
  settledAt?: string
}

export interface PaymentRail {
  readonly name: 'stub' | 'hedera-transfer' | 'hedera-x402'
  pay(input: { to: string; amount: bigint; resource?: string }): Promise<PaymentReceiptRef>
}

export const stubbedRail: PaymentRail = {
  name: 'stub',
  async pay({ to, amount }) {
    return { txRef: `stubbed-${to}-${amount}`, stubbed: true }
  },
}

/** Tinybars per HBAR, so an amount in the smallest unit is legible in the log. */
export const TINYBAR_PER_HBAR = 100_000_000n

interface HederaClientBundle {
  client: import('@x402/hedera').Client
  payer: string
}

async function hederaClient(): Promise<HederaClientBundle> {
  const accountId = requireEnv(ENV.hederaAccountId, 'a payment on Hedera Testnet')
  const key = requireEnv(ENV.hederaPrivateKey, 'a payment on Hedera Testnet')
  const { Client, PrivateKey } = await import('@x402/hedera')
  const client = Client.forTestnet()
  // The payer account is ECDSA per 02-DECISIONS §3, so the key is parsed as ECDSA rather than guessed.
  client.setOperator(accountId, PrivateKey.fromStringECDSA(key))
  return { client, payer: accountId }
}

/** Reads the payer's balance in tinybars. Read-only, and the evidence done-when 3 compares. */
export async function hederaBalance(): Promise<{ payer: string; tinybars: bigint; hbar: string }> {
  const { client, payer } = await hederaClient()
  try {
    const { AccountBalanceQuery } = await import('@x402/hedera')
    const balance = await new AccountBalanceQuery().setAccountId(payer).execute(client)
    const tinybars = BigInt(balance.hbars.toTinybars().toString())
    return { payer, tinybars, hbar: (Number(tinybars) / Number(TINYBAR_PER_HBAR)).toFixed(8) }
  } finally {
    client.close()
  }
}

export interface TransferOptions {
  /** Builds and freezes the transaction without executing it, to prove the path without moving funds. */
  dryRun?: boolean
}

/**
 * A real HBAR transfer, waiting for consensus.
 *
 * `execute` only pre-checks and hands the transaction to a node, so the receipt is what turns a
 * submission into a settlement: a consensus failure is only visible there.
 */
export function hederaTransferRail(options: TransferOptions = {}): PaymentRail {
  return {
    name: 'hedera-transfer',
    async pay({ to, amount }) {
      const { client, payer } = await hederaClient()
      try {
        const { Hbar, TransferTransaction } = await import('@x402/hedera')
        const tinybars = Number(amount)
        const transfer = new TransferTransaction()
          .addHbarTransfer(payer, Hbar.fromTinybars(-tinybars))
          .addHbarTransfer(to, Hbar.fromTinybars(tinybars))
          .setTransactionMemo('preflight beat 1, one call fee')
          .freezeWith(client)

        if (options.dryRun === true) {
          return {
            txRef: `dry-run ${transfer.transactionId?.toString() ?? 'unassigned'}`,
            stubbed: true,
          }
        }

        const submitted = await transfer.execute(client)
        const receipt = await submitted.getReceipt(client)
        if (receipt.status.toString() !== 'SUCCESS') {
          throw new HarnessError(`the transfer reached consensus as ${receipt.status.toString()}`)
        }
        return { txRef: submitted.transactionId.toString(), stubbed: false }
      } catch (err) {
        if (err instanceof HarnessError) throw err
        // No retry. Retrying against an unknown settlement state is how one call pays twice.
        throw new HarnessError(`the HBAR transfer did not settle: ${String((err as Error).message ?? err)}`, {
          retryable: false,
          cause: err,
        })
      } finally {
        client.close()
      }
    },
  }
}

/**
 * The x402 leg: pay a resource that answers 402, and read the settled reference back.
 *
 * The resource server issues the challenge and the facilitator settles it, so this needs both to be
 * running. Without a resource URL there is nothing to be charged by, which is a refusal rather than a
 * silent fallback to an unpaid call.
 */
export function hederaX402Rail(): PaymentRail {
  return {
    name: 'hedera-x402',
    async pay({ resource }) {
      if (resource === undefined || resource.length === 0) {
        throw new HarnessError('the x402 rail needs the resource URL that issues the 402 challenge')
      }
      const accountId = requireEnv(ENV.hederaAccountId, 'an x402 payment on Hedera Testnet')
      const key = requireEnv(ENV.hederaPrivateKey, 'an x402 payment on Hedera Testnet')

      const { createClientHederaSigner, ExactHederaScheme, PrivateKey } = await import('@x402/hedera')
      const { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } = await import('@x402/fetch')

      const signer = createClientHederaSigner(accountId, PrivateKey.fromStringECDSA(key), {
        network: 'hedera:testnet',
      })
      const client = new x402Client().register('hedera:testnet', new ExactHederaScheme(signer))
      const paidFetch = wrapFetchWithPayment(fetch, client)

      const response = await paidFetch(resource, { method: 'POST' })
      if (!response.ok) {
        throw new HarnessError(`the paid call answered HTTP ${response.status}`)
      }
      const header = response.headers.get('x-payment-response')
      if (header === null) {
        // A 200 with no settlement header means the resource did not charge. Falling through would turn
        // a payment gate into an advisory.
        throw new HarnessError('the resource answered without a settlement, so nothing was paid')
      }
      const settled = decodePaymentResponseHeader(header) as { transaction?: string; payer?: string }
      return { txRef: settled.transaction ?? 'settled, reference not reported', stubbed: false }
    },
  }
}

export function railByName(name: string, options: TransferOptions = {}): PaymentRail {
  switch (name) {
    case 'hedera-transfer':
      return hederaTransferRail(options)
    case 'hedera-x402':
      return hederaX402Rail()
    case 'stub':
      return stubbedRail
    default:
      throw new HarnessError(`unknown payment rail ${JSON.stringify(name)}`)
  }
}
