/**
 * Fetching an agent card document from whatever the registry pointed at.
 *
 * Three schemes are fetched and nothing else. `https:` goes direct, `ipfs:` goes through the one
 * configured gateway, and `data:` is decoded in process. `data:` is here because the live registry
 * already serves cards that way and because it is the shape A3b falls back to when pinning fights,
 * so it is a stated case rather than a guess. Every other scheme, including plain `http:`, is a
 * typed failure: a validator that quietly widens what it will fetch is a validator whose runs stop
 * matching each other.
 *
 * Both bounds are load-bearing. An unbounded fetch parks the critical path behind a document nobody
 * on this team controls, and an unbounded size makes a hostile card a cheap attack on a public
 * validator.
 */

import { AgentResolveError } from '../shared/errors.ts'
import { ipfsGateway } from '../shared/config.ts'

export type CardScheme = 'https' | 'ipfs' | 'data'

export interface FetchedCard {
  scheme: CardScheme
  /** The URI as the registry reported it. Never rewritten to a gateway URL. */
  tokenURI: string
  /** Where the bytes actually came from, which for ipfs is the gateway. */
  fetchedFrom: string
  text: string
  bytes: number
}

export interface FetchCardOptions {
  timeoutMs?: number
  maxBytes?: number
  gateway?: string
}

export const DEFAULT_TIMEOUT_MS = 10_000
/** A card is a few kilobytes. A megabyte is generous and still bounded. */
export const DEFAULT_MAX_BYTES = 1_048_576

export function classifyScheme(tokenURI: string): CardScheme {
  const uri = tokenURI.trim()
  if (uri.startsWith('https://')) return 'https'
  if (uri.startsWith('ipfs://')) return 'ipfs'
  if (uri.startsWith('data:')) return 'data'
  const scheme = uri.slice(0, Math.max(uri.indexOf(':'), 0)) || 'none'
  throw new AgentResolveError(
    `tokenURI scheme ${JSON.stringify(scheme)} is not fetched by this validator, which reads https, ipfs and data`,
  )
}

/** `ipfs://CID/path` and `ipfs://ipfs/CID` both become one gateway URL. One gateway, never a race. */
export function ipfsToGatewayUrl(tokenURI: string, gateway = ipfsGateway()): string {
  let path = tokenURI.trim().slice('ipfs://'.length)
  if (path.startsWith('ipfs/')) path = path.slice('ipfs/'.length)
  if (path.length === 0) throw new AgentResolveError('tokenURI is an ipfs URI with no content id')
  const base = gateway.endsWith('/') ? gateway : `${gateway}/`
  return `${base}${path}`
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

  const fetchedFrom =
    scheme === 'ipfs' ? ipfsToGatewayUrl(tokenURI, options.gateway) : tokenURI.trim()

  let response: Response
  try {
    response = await fetch(fetchedFrom, {
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
    // grade, and a gateway that rate limits is disclosed rather than silently swapped.
    throw new AgentResolveError(
      `the card at ${fetchedFrom} answered HTTP ${response.status}`,
      { retryable: response.status >= 500 || response.status === 429 },
    )
  }

  const text = await readCapped(response, maxBytes, fetchedFrom)
  return { scheme, tokenURI, fetchedFrom, text, bytes: Buffer.byteLength(text) }
}
