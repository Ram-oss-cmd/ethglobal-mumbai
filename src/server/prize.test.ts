import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { expect, it } from 'vitest'
import { createPrize, reservePrizeEntry } from './prize.ts'

it('enforces one match reservation per wallet and scope across separate calls', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wallet-rush-entry-'))
  try {
    const file = join(dir, 'entries.jsonl')
    const a = privateKeyToAccount(generatePrivateKey()).address
    const b = privateKeyToAccount(generatePrivateKey()).address
    const c = privateKeyToAccount(generatePrivateKey()).address
    reservePrizeEntry(file, 'tournament', 'match-one', [a, b])
    expect(() => reservePrizeEntry(file, 'tournament', 'match-two', [c, a])).toThrow('already been used')
    expect(() => reservePrizeEntry(file, 'other-tournament', 'match-two', [c, a])).not.toThrow()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('serves the prize HTTP routes and requires a genuine wallet signature and same origin', async () => {
  const prize = createPrize()
  const server = createServer((req, res) => prize.handle(req, res, () => res.writeHead(404).end()))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const account = privateKeyToAccount(generatePrivateKey())
  function post(action: string, body: object, origin = base, token?: string) {
    return fetch(`${base}/api/prize/${action}`, {
      method: 'POST', body: JSON.stringify(body),
      headers: { origin, 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    })
  }
  try {
    expect((await post('wallet-challenge', { wallet: account.address }, 'https://example.org')).status).toBe(403)
    const challenge = await (await post('wallet-challenge', { wallet: account.address })).json()
    expect(challenge.message).toContain(base)
    const signature = await account.signMessage({ message: challenge.message })
    const verified = await post('wallet-verify', { nonce: challenge.nonce, signature })
    expect(verified.status).toBe(200)
    expect((await verified.json()).wallet).toBe(account.address)
    expect((await post('wallet-verify', { nonce: challenge.nonce, signature })).status).toBe(400)
    expect((await post('world-challenge', {})).status).toBe(401)
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
