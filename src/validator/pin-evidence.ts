/**
 * Publishing the evidence bundle so a third party can fetch it and re-derive the hash.
 *
 * Two rules, and the first one is the likeliest single cause of failure in this task: **the bytes
 * published are the bytes that were canonicalized**, never a re-serialization. Re-serializing before
 * publishing changes the hash and breaks every verify path, and the break is invisible until a reader
 * says the evidence does not match the record.
 *
 * The second rule is that the URI has to resolve for someone who is not us. A URI only the build
 * machine can fetch makes the grade unfalsifiable, and falsifiability is the entire claim.
 *
 * The provider is behind an interface because the content hash is what the record carries, so the
 * provider choice never touches the reproducibility claim. `data:` is the pre-authorized degrade: it
 * keeps the hash re-derivable by anyone holding the record and costs the content-addressed property,
 * which is disclosed rather than hidden.
 */

import { PublishError } from '../shared/errors.ts'
import { ENV, requireEnv } from '../shared/config.ts'
import type { EvidenceBundle, Hex } from '../shared/types.ts'
import { canonicalize, canonicalizeValue, hashCanonical } from './canonical.ts'

export interface PinnedEvidence {
  /** Where a third party fetches the bundle. */
  uri: string
  /** keccak256 over the exact published bytes. Equals the record's responseHash. */
  hash: Hex
  bytes: number
  provider: 'zerog' | 'data-uri'
  /** The provider's own content address, when it has one. */
  contentAddress?: string
}

export interface Pinner {
  readonly provider: PinnedEvidence['provider']
  publish(canonical: string): Promise<Omit<PinnedEvidence, 'hash' | 'bytes'>>
}

/**
 * The degrade, always available and needing no credential.
 *
 * A base64 data URI of the canonical bytes. Anyone holding the record can decode it and recompute the
 * hash, so the reproducibility property survives; what is lost is that the URI is not content
 * addressed and not hosted anywhere, which is what the disclosure says.
 */
export const dataUriPinner: Pinner = {
  provider: 'data-uri',
  async publish(canonical: string) {
    const encoded = Buffer.from(canonical, 'utf8').toString('base64')
    return { uri: `data:application/json;base64,${encoded}`, provider: 'data-uri' }
  },
}

/**
 * 0G Storage, the primary provider.
 *
 * Uploaded from memory rather than through a temporary file, so there is no step between the bytes
 * that were hashed and the bytes that were stored. The merkle root is computed before the upload, so a
 * re-run of the same bundle is recognized as already stored instead of read as a failure: the same
 * document has the same root, which is the property content addressing is for.
 *
 * The SDK and ethers load dynamically. They are only needed on the publish path, and a static import
 * would put both into every bundle that touches this module.
 */
export function zerogPinner(): Pinner {
  return {
    provider: 'zerog',
    async publish(canonical: string) {
      const rpc = requireEnv(ENV.zerogRpc, 'an upload to 0G Storage')
      const indexerUrl = requireEnv(ENV.zerogIndexer, 'an upload to 0G Storage')
      const key = requireEnv(ENV.zerogStorageKey, 'paying for an upload to 0G Storage')

      const { Indexer, MemData } = await import('@0gfoundation/0g-storage-ts-sdk')
      const { ethers } = await import('ethers')

      const data = new MemData(Buffer.from(canonical, 'utf8'))
      const [tree, treeErr] = await data.merkleTree()
      const root = tree?.rootHash() ?? null
      if (treeErr !== null || root === null) {
        throw treeErr ?? new Error('the merkle root of the bundle could not be computed')
      }

      const provider = new ethers.JsonRpcProvider(rpc)
      const signer = new ethers.Wallet(key, provider)
      const indexer = new Indexer(indexerUrl)

      const [, uploadErr] = await indexer.upload(data, rpc, signer)
      if (uploadErr !== null) {
        const message = String((uploadErr as Error).message ?? uploadErr)
        // The same bundle uploaded twice is not a failure. Any other error is.
        if (!/already exists|already finalized|duplicate/i.test(message)) {
          throw uploadErr
        }
      }

      return {
        uri: `${indexerUrl.replace(/\/$/, '')}/file?root=${root}`,
        provider: 'zerog',
        contentAddress: root,
      }
    },
  }
}

/**
 * Pins the canonical bytes and returns a URI plus the hash over exactly those bytes.
 *
 * The hash is computed from the same string that is handed to the provider, in one place, so there is
 * no path where the published document and the hashed document could differ.
 */
export async function pinEvidence(
  bundle: EvidenceBundle,
  pinner: Pinner = dataUriPinner,
): Promise<PinnedEvidence> {
  const canonical = canonicalize(bundle)
  const hash = hashCanonical(canonical)
  const bytes = Buffer.byteLength(canonical)

  let published: Omit<PinnedEvidence, 'hash' | 'bytes'>
  try {
    published = await pinner.publish(canonical)
  } catch (err) {
    throw new PublishError(`the evidence bundle could not be published through ${pinner.provider}`, {
      retryable: true,
      cause: err,
    })
  }
  if (published.uri.trim().length === 0) {
    throw new PublishError(`${pinner.provider} returned no URI, so the evidence is not retrievable`)
  }
  return { ...published, hash, bytes }
}

/**
 * Fetches a published bundle and re-derives its hash, the way a third party would.
 *
 * This is check 3 of A3b, and it is deliberately a separate path from the write: it re-reads the
 * document, canonicalizes what it parsed, and compares. A verifier that trusted the bytes it was
 * handed would prove nothing.
 */
export async function verifyPublishedEvidence(
  uri: string,
  expectedHash: Hex,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ ok: boolean; hash: Hex; bytes: number }> {
  const text = await readPublished(uri, options)
  const reparsed: unknown = JSON.parse(text)
  const canonical = canonicalizeValue(reparsed)
  const hash = hashCanonical(canonical)
  return {
    ok: hash.toLowerCase() === expectedHash.toLowerCase(),
    hash,
    bytes: Buffer.byteLength(canonical),
  }
}

/**
 * Fetches a published bundle's bytes, whatever it was published through.
 *
 * B1 reads evidence with this, so the gate and the verifier resolve a URI the same way. A scheme this
 * does not fetch is a refusal rather than a guess.
 */
export async function fetchPublishedEvidence(
  uri: string,
  options: FetchEvidenceOptions = {},
): Promise<string> {
  const key = uri.trim()
  // A data URI decodes in process and costs a gateway nothing, so only a fetched one is shared.
  if (key.startsWith('data:')) return readPublished(uri, options)

  const open = inFlight.get(key)
  if (open !== undefined) return open

  const started = readPublished(uri, options).finally(() => {
    inFlight.delete(key)
  })
  inFlight.set(key, started)
  return started
}

export interface FetchEvidenceOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  /** Backoff between attempts at a gateway that is busy. Zero in tests, so they do not sleep. */
  retryDelayMs?: number
}

/**
 * How many times a busy gateway is asked again, and why it is asked at all.
 *
 * Measured against the 0G indexer on 2026-07-25: four concurrent fetches of one evidence URI came
 * back 600, 600, 200, 200, and the 600 body was an internal "failed to download segment 0". Every
 * client on the rug pull beat reads the same URI at the same instant, so without this the gate
 * refuses an agent whose evidence is sitting there and readable a second later.
 *
 * Bounded, and only for statuses that can change: a 404 is an answer about the document and is taken
 * as one. When the attempts run out the read throws and the gate refuses, so waiting never becomes
 * permission.
 */
export const EVIDENCE_FETCH_ATTEMPTS = 5
export const EVIDENCE_RETRY_BASE_MS = 300

/**
 * Backoff for attempt n, spread so that readers who did stumble together do not return together.
 *
 * Without the spread every client on a poll waits the same 300ms and asks again in the same
 * millisecond, which is the burst that produced the failure in the first place.
 */
function backoffFor(attempt: number, base: number): number {
  if (base === 0) return 0
  const step = base * 2 ** attempt
  return step + Math.floor(Math.random() * base)
}

/**
 * Readers arriving on one URI while a fetch is open share that fetch.
 *
 * In flight only, never a cache: the entry is dropped the moment it settles, so nothing here can
 * serve a stale document or hide a gateway that has started failing. Each client still hashes the
 * bytes against the record itself, which is the check a verdict rests on. What is shared is one GET
 * of an immutable, content addressed document, at one instant, inside one process.
 *
 * Measured against production on 2026-07-25 with three watch streams open: four clients per poll
 * meant four concurrent reads of the same URI, and this gateway answers 600 to about half of eight
 * concurrent requests. Sharing turns each poll's four chances to trip it back into one.
 *
 * A reader that joins an open fetch gets the first reader's timeout and backoff rather than its own,
 * which is worth knowing before someone passes a shorter one and wonders why it was not honoured.
 * The map is per process, so it shares within one instance and never across them.
 */
const inFlight = new Map<string, Promise<string>>()

/**
 * Which statuses are worth asking about twice.
 *
 * 5xx is the server saying it failed, and 600 is this gateway saying the same thing off the RFC
 * scale. 404 is on the list for a reason that took a production run to see: with three watch streams
 * open at once on 2026-07-25, the 0G gateway answered 404 for an evidence document that returned 200
 * seconds before and seconds after, in the same stream. Evidence is content addressed, so it does not
 * leave and come back; that 404 was the gateway failing to serve a file it holds.
 *
 * A document that is genuinely gone still refuses, one bounded round later, so this trades a second
 * against a hire that should have happened. A 403 is an answer about access rather than a stumble,
 * and is taken as one.
 */
function statusCanChange(status: number): boolean {
  return status >= 500 || status === 404 || status === 408 || status === 429
}

async function readPublished(uri: string, options: FetchEvidenceOptions): Promise<string> {
  const trimmed = uri.trim()
  if (trimmed.startsWith('data:')) {
    const comma = trimmed.indexOf(',')
    if (comma < 0) throw new PublishError('the published URI is a data URI with no payload')
    const meta = trimmed.slice('data:'.length, comma)
    const payload = trimmed.slice(comma + 1)
    return /;base64/i.test(meta)
      ? Buffer.from(payload, 'base64').toString('utf8')
      : decodeURIComponent(payload)
  }
  if (!trimmed.startsWith('https://') && !trimmed.startsWith('http://')) {
    throw new PublishError(`the published URI scheme is not one this reader fetches: ${trimmed.slice(0, 40)}`)
  }
  const transport = options.fetchImpl ?? fetch
  const backoff = options.retryDelayMs ?? EVIDENCE_RETRY_BASE_MS

  let lastStatus = 0
  for (let attempt = 0; attempt < EVIDENCE_FETCH_ATTEMPTS; attempt += 1) {
    const isLast = attempt === EVIDENCE_FETCH_ATTEMPTS - 1
    let response: Awaited<ReturnType<typeof transport>>
    try {
      response = await transport(trimmed, {
        signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      })
    } catch (err) {
      // A socket that hung up is the same kind of event as a 600, and under the concurrency this
      // gateway sees it is the likelier one. The last attempt rethrows, so a real outage still ends
      // the read rather than being retried out of existence.
      if (isLast) throw err
      await new Promise((resolve) => setTimeout(resolve, backoffFor(attempt, backoff)))
      continue
    }
    if (response.ok) return response.text()

    lastStatus = response.status
    if (!statusCanChange(response.status)) break
    if (!isLast) {
      await new Promise((resolve) => setTimeout(resolve, backoffFor(attempt, backoff)))
    }
  }

  throw new PublishError(`the published evidence at ${trimmed} answered HTTP ${lastStatus}`, {
    retryable: statusCanChange(lastStatus),
  })
}
