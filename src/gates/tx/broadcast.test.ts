/**
 * D5c's rules, offline.
 *
 * Check 3 in the task doc is the whole task: a chain with no protected endpoint falls back to the
 * default and says so, rather than reporting protection it did not apply. Check 4 is what keeps it
 * honest under load: a protected endpoint that fails is an error, not a quiet downgrade.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Hex, TxVerdict } from '../../shared/types.ts'
import { broadcast, routeFor, type RawSender } from './broadcast.ts'

const SIGNED = '0x02f8someraw' as Hex
const HASH = '0xdeadbeef' as Hex

const ALLOW: TxVerdict = {
  verdict: 'ALLOW',
  flags: [],
  reason: 'no red flag fired for this transaction at this block',
  deltas: [],
  reproducibleFrom: {
    block: 500n,
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
    calldataHash: `0x${'11'.repeat(32)}`,
    value: 0n,
  },
  codeFingerprint: `0x${'22'.repeat(32)}`,
  driftFromGraded: null,
}

const BLOCK: TxVerdict = {
  ...ALLOW,
  verdict: 'BLOCK',
  reason: 'unlimited allowance to an address this transaction never named',
}

function recorder(result: Hex | Error = HASH): { send: RawSender; calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    send: async (url) => {
      calls.push(url)
      if (result instanceof Error) throw result
      return result
    },
  }
}

function withEnv(vars: Record<string, string | undefined>, run: () => void | Promise<void>) {
  const previous = new Map(Object.keys(vars).map((key) => [key, process.env[key]]))
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  const restore = () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  return Promise.resolve(run()).finally(restore)
}

test('done-when 1: an allow goes through the endpoint configured for its chain, and says which', async () => {
  await withEnv({ BASE_SEPOLIA_PROTECTED_RPC_URL: 'https://protected.example/rpc' }, async () => {
    const sender = recorder()
    const result = await broadcast(ALLOW, SIGNED, 84532, sender.send)

    assert.equal(result.sent, true)
    assert.equal(result.hash, HASH)
    assert.deepEqual(sender.calls, ['https://protected.example/rpc'])
    assert.equal(result.route?.kind, 'protected')
    assert.match(result.label, /routed through https:\/\/protected\.example\/rpc/)
  })
})

test('done-when 2: a block broadcasts nothing, and contacts nothing', async () => {
  await withEnv({ BASE_SEPOLIA_PROTECTED_RPC_URL: 'https://protected.example/rpc' }, async () => {
    const sender = recorder()
    const result = await broadcast(BLOCK, SIGNED, 84532, sender.send)

    assert.equal(result.sent, false)
    assert.equal(result.hash, null)
    assert.deepEqual(sender.calls, [], 'no request left, to any endpoint')
    assert.equal(result.route, null, 'no route was even resolved')
    assert.match(result.note, /blocked, so it was not sent anywhere/)
  })
})

test('done-when 3: with no protected endpoint it uses the default and says exactly that', async () => {
  await withEnv(
    {
      BASE_SEPOLIA_PROTECTED_RPC_URL: undefined,
      BASE_SEPOLIA_RPC_URL: 'https://default.example/rpc',
    },
    async () => {
      const sender = recorder()
      const result = await broadcast(ALLOW, SIGNED, 84532, sender.send)

      assert.deepEqual(sender.calls, ['https://default.example/rpc'])
      assert.equal(result.route?.kind, 'default')
      assert.match(result.label, /no protected route configured/)
      assert.doesNotMatch(result.label, /protected endpoint/)
      assert.match(result.note, /none was applied/)
    },
  )
})

test('done-when 4: a protected endpoint that fails throws, and nothing is retried elsewhere', async () => {
  await withEnv(
    {
      BASE_SEPOLIA_PROTECTED_RPC_URL: 'https://protected.example/rpc',
      BASE_SEPOLIA_RPC_URL: 'https://default.example/rpc',
    },
    async () => {
      const sender = recorder(new Error('relay refused the payload'))

      await assert.rejects(
        () => broadcast(ALLOW, SIGNED, 84532, sender.send),
        (err: unknown) =>
          err instanceof Error &&
          /nothing was retried elsewhere/.test(err.message) &&
          /relay refused the payload/.test(err.message),
      )
      assert.deepEqual(
        sender.calls,
        ['https://protected.example/rpc'],
        'the default endpoint was never contacted as a consolation prize',
      )
    },
  )
})

test('the label comes from the route that ran, so an unsent transaction claims nothing', async () => {
  await withEnv({ BASE_SEPOLIA_PROTECTED_RPC_URL: 'https://protected.example/rpc' }, async () => {
    const result = await broadcast(BLOCK, SIGNED, 84532, recorder().send)
    assert.equal(result.label, 'not broadcast')
  })
})

test('routeFor reports the default for a chain with nothing configured', async () => {
  await withEnv(
    {
      BASE_MAINNET_PROTECTED_RPC_URL: undefined,
      BASE_MAINNET_RPC_URL: 'https://mainnet.example/rpc',
    },
    () => {
      const route = routeFor(8453)
      assert.equal(route.kind, 'default')
      assert.equal(route.url, 'https://mainnet.example/rpc')
    },
  )
})
