/**
 * Fetching an agent card document from whatever the registry pointed at.
 *
 * Two schemes are fetched and nothing else. `https:` goes direct, and `data:` is decoded in process,
 * because the live registry already serves cards that way and because it is the shape A3b falls back
 * to when pinning fights. Every other scheme, including plain `http:` and `ipfs:`, is a typed
 * failure: a validator that quietly widens what it will fetch is a validator whose runs stop
 * matching each other.
 *
 * `ipfs:` is out by decision, not by omission. This project's evidence lives on 0G Storage
 * (02-DECISIONS §12), so a public IPFS gateway would be a dependency with nothing behind it, and the
 * measurements taken on 2026-07-24 say it is not one worth taking: for a CID pinned elsewhere,
 * `ipfs.io` never answered inside 25s and `dweb.link` never answered past its redirect inside 20s.
 * An `ipfs://` tokenURI therefore refuses with a reason a reader can act on, which is A2's own
 * pre-authorized degrade.
 *
 * Both bounds are load-bearing. An unbounded fetch parks the critical path behind a document nobody
 * on this team controls, and an unbounded size makes a hostile card a cheap attack on a public
 * validator.
 */

import { AgentResolveError } from '../shared/errors.ts'

export type CardScheme = 'https' | 'data'

export interface FetchedCard {
  scheme: CardScheme
  /** The URI as the registry reported it. Never rewritten. */
  tokenURI: string
  /** Where the bytes actually came from. */
  fetchedFrom: string
  text: string
  bytes: number
}

export interface FetchCardOptions {
  timeoutMs?: number
  maxBytes?: number
  /** Injected transport. Defaults to the platform fetch; tests pass a local one. */
  fetchImpl?: typeof fetch
}

export const DEFAULT_TIMEOUT_MS = 10_000
/** A card is a few kilobytes. A megabyte is generous and still bounded. */
export const DEFAULT_MAX_BYTES = 1_048_576

export function classifyScheme(tokenURI: string): CardScheme {
  const uri = tokenURI.trim()
  if (uri.startsWith('https://')) return 'https'
  if (uri.startsWith('data:')) return 'data'
  if (uri.startsWith('ipfs://')) {
    throw new AgentResolveError(
      'tokenURI is an ipfs URI, which this validator does not fetch: evidence here is stored on 0G Storage, and a public gateway is not a dependency this project takes',
    )
  }
  const scheme = uri.slice(0, Math.max(uri.indexOf(':'), 0)) || 'none'
  throw new AgentResolveError(
    `tokenURI scheme ${JSON.stringify(scheme)} is not fetched by this validator, which reads https and data`,
  )
}

function decodeDataUri(tokenURI: string): string {
  const comma = tokenURI.indexOf(',')
  if (comma < 0) throw new AgentResolveError('tokenURI is a data URI with no payload')
  const meta = tokenURI.slice('data:'.length, comma)
  const payload = tokenURI.slice(comma + 1)
  try {
    if (/;base64/i.test(meta)) {
      return Buffer.from(payload, 'base64').toString('utf8')
    }
    return decodeURIComponent(payload)
  } catch (err) {
    throw new AgentResolveError('tokenURI is a data URI whose payload does not decode', {
      cause: err,
    })
  }
}

async function readCapped(response: Response, maxBytes: number, from: string): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new AgentResolveError(
      `the document at ${from} declares ${declared} bytes, over the ${maxBytes} byte cap`,
    )
  }
  const body = response.body
  if (body === null) {
    const text = await response.text()
    if (Buffer.byteLength(text) > maxBytes) {
      throw new AgentResolveError(`the document at ${from} is over the ${maxBytes} byte cap`)
    }
    return text
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value === undefined) continue
      total += value.byteLength
      if (total > maxBytes) {
        throw new AgentResolveError(`the document at ${from} is over the ${maxBytes} byte cap`)
      }
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export async function fetchCardDocument(
  tokenURI: string,
  options: FetchCardOptions = {},
): Promise<FetchedCard> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const scheme = classifyScheme(tokenURI)

  if (scheme === 'data') {
    const text = decodeDataUri(tokenURI.trim())
    const bytes = Buffer.byteLength(text)
    if (bytes > maxBytes) {
      throw new AgentResolveError(`the inline card is ${bytes} bytes, over the ${maxBytes} byte cap`)
    }
    return { scheme, tokenURI, fetchedFrom: 'data:', text, bytes }
  }

  const fetchedFrom = tokenURI.trim()
  const transport = options.fetchImpl ?? fetch

  let response: Response
  try {
    response = await transport(fetchedFrom, {
      redirect: 'follow',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    const timedOut = err instanceof Error && /timeout|abort/i.test(err.name + err.message)
    throw new AgentResolveError(
      timedOut
        ? `the card at ${fetchedFrom} did not answer within ${timeoutMs}ms`
        : `the card at ${fetchedFrom} could not be fetched`,
      { retryable: true, cause: err },
    )
  }

  if (!response.ok) {
    // Never fall back to a cached or default card. A default card is an ungraded agent wearing a
    // grade, and a host that rate limits is disclosed rather than silently swapped for another.
    throw new AgentResolveError(`the card at ${fetchedFrom} answered HTTP ${response.status}`, {
      retryable: response.status >= 500 || response.status === 429,
    })
  }

  const text = await readCapped(response, maxBytes, fetchedFrom)
  return { scheme, tokenURI, fetchedFrom, text, bytes: Buffer.byteLength(text) }
}
