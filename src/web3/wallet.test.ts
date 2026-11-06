import { encodeAbiParameters, encodeEventTopics } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { afterEach, expect, it, vi } from 'vitest'
import { ARC_TESTNET, ESCROW_ABI, matchKeyFor } from '../arc/chain.ts'
import { arc, checkedWallet, claimUSDC, switchToArc } from './wallet.ts'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

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

it('only confirms a claim when the receipt proves payment to the connected wallet from this escrow', async () => {
  const account = privateKeyToAccount(generatePrivateKey()).address
  const escrow = '0x1000000000000000000000000000000000000000'
  const other = '0x2000000000000000000000000000000000000000'
  const hash = matchKeyFor('claim-test')
  const onHash = vi.fn()
  vi.stubGlobal('window', { ethereum: { request: async ({ method }: { method: string }) => {
    if (method === 'eth_accounts') return [account]
    if (method === 'eth_chainId') return '0x4cef52'
    if (method === 'eth_sendTransaction') return hash
    throw new Error('Unexpected wallet call')
  } } })
  vi.spyOn(arc, 'getChainId').mockResolvedValue(ARC_TESTNET.id)
  vi.spyOn(arc, 'simulateContract').mockResolvedValue({
    result: undefined, request: { address: escrow, account, abi: ESCROW_ABI, functionName: 'claim' },
  } as never)
  const wait = vi.spyOn(arc, 'waitForTransactionReceipt')
  const log = {
    topics: encodeEventTopics({ abi: ESCROW_ABI, eventName: 'Claimed', args: { player: account } }),
    data: encodeAbiParameters([{ type: 'uint256' }], [10_000_000n]),
  }
  wait.mockResolvedValueOnce({ status: 'success', transactionHash: hash, logs: [{ ...log, address: other }] } as never)
  await expect(claimUSDC(account, escrow, onHash)).rejects.toThrow('did not confirm')
  wait.mockResolvedValueOnce({ status: 'success', transactionHash: hash, logs: [{ ...log, address: escrow }] } as never)
  await expect(claimUSDC(account, escrow, onHash)).resolves.toBe(hash)
  expect(onHash).toHaveBeenCalledWith(hash)
})
