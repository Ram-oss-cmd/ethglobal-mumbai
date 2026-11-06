import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { expect, it } from 'vitest'
import { createWalletAuth } from './walletAuth.ts'

it('accepts a real wallet signature and rejects cross-wallet signatures and nonce replay', async () => {
  const auth = createWalletAuth()
  const account = privateKeyToAccount(generatePrivateKey())
  const other = privateKeyToAccount(generatePrivateKey())
  const first = auth.challenge(account.address, 'http://localhost:5173')
  await expect(auth.authenticate(first.nonce, await other.signMessage(first))).rejects.toThrow('rejected')
  await expect(auth.authenticate(first.nonce, await account.signMessage(first))).rejects.toThrow('rejected')
  const second = auth.challenge(account.address, 'http://localhost:5173')
  const signature = await account.signMessage(second)
  const session = await auth.authenticate(second.nonce, signature)
  expect(auth.wallet(session.token)).toBe(account.address)
  await expect(auth.authenticate(second.nonce, signature)).rejects.toThrow('rejected')
  expect(auth.wallet(other.address)).toBeUndefined()
})

it('expires challenges and wallet sessions', async () => {
  let now = 0
  const auth = createWalletAuth(() => now)
  const account = privateKeyToAccount(generatePrivateKey())
  const first = auth.challenge(account.address, 'http://localhost:5173')
  now = 300_000
  await expect(auth.authenticate(first.nonce, await account.signMessage(first))).rejects.toThrow('expired')
  const second = auth.challenge(account.address, 'http://localhost:5173')
  const session = await auth.authenticate(second.nonce, await account.signMessage(second))
  now += 3_600_000
  expect(auth.wallet(session.token)).toBeUndefined()
})
