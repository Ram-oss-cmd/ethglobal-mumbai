import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { afterEach, expect, it, vi } from 'vitest'
import { ARC_TESTNET } from '../arc/chain.ts'
import { checkedWallet, switchToArc } from './wallet.ts'

afterEach(() => vi.unstubAllGlobals())

it('checks the real provider chain and selected account before permitting a wallet operation', async () => {
  const account = privateKeyToAccount(generatePrivateKey()).address
  let active: string[] = [account]
  let chain = '0x1'
  const request = vi.fn(async ({ method, params }) => {
    if (method === 'eth_accounts') return active
    if (method === 'eth_chainId') return chain
    if (method === 'wallet_switchEthereumChain') {
      chain = params[0].chainId
      return null
    }
    throw new Error('Unexpected wallet call')
  })
  vi.stubGlobal('window', { ethereum: { request } })
  await expect(checkedWallet(account)).rejects.toThrow('Arc Testnet')
  await switchToArc()
  expect(Number(chain)).toBe(ARC_TESTNET.id)
  await expect(checkedWallet(account)).resolves.toBeDefined()
  active = [privateKeyToAccount(generatePrivateKey()).address]
  await expect(checkedWallet(account)).rejects.toThrow('wallet changed')
  expect(request.mock.calls.some(([call]) => call.method === 'eth_sendTransaction')).toBe(false)
})
