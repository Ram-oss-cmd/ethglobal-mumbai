import { encodeAbiParameters, encodeEventTopics } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { afterEach, expect, it, vi } from 'vitest'
import { ARC_TESTNET, ENTRY_AMOUNT, ESCROW_ABI, matchKeyFor } from '../arc/chain.ts'
import { arc, checkedWallet, claimUSDC, depositUSDC, injectedWallet, refundUSDC, switchToArc } from './wallet.ts'

function stubWallet(request: (args: { method: string }) => Promise<unknown>) {
  const browser = new EventTarget()
  announceWallet(browser, 'io.metamask', { request })
  vi.stubGlobal('window', browser)
}

function announceWallet(browser: EventTarget, rdns: string, provider: { request: unknown }) {
  browser.addEventListener('eip6963:requestProvider', () => {
    browser.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { rdns }, provider } }))
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('uses the announced MetaMask provider when another wallet owns window.ethereum', async () => {
  const account = privateKeyToAccount(generatePrivateKey()).address
  const otherWallet = { isMetaMask: true, request: vi.fn() }
  const metaMask = { request: vi.fn(async () => [account]) }
  const browser = Object.assign(new EventTarget(), { ethereum: otherWallet })
  vi.stubGlobal('window', browser)
  announceWallet(browser, 'io.rabby', otherWallet)
  expect(() => injectedWallet()).toThrow('MetaMask extension')
  announceWallet(browser, 'io.metamask', metaMask)
  await expect(injectedWallet().client.requestAddresses()).resolves.toEqual([account])
  expect(otherWallet.request).not.toHaveBeenCalled()
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
  stubWallet(request)
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
  stubWallet(async ({ method }) => {
    if (method === 'eth_accounts') return [account]
    if (method === 'eth_chainId') return '0x4cef52'
    if (method === 'eth_sendTransaction') return hash
    throw new Error('Unexpected wallet call')
  })
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

it.each([
  ['Deposited', 'deposit', depositUSDC],
  ['Refunded', 'refundExpired', refundUSDC],
] as const)('requires a matching %s event even if a replacement succeeds', async (eventName, functionName, send) => {
  const account = privateKeyToAccount(generatePrivateKey()).address
  const escrow = '0x1000000000000000000000000000000000000000'
  const other = '0x2000000000000000000000000000000000000000'
  const matchId = matchKeyFor('intended-match')
  const originalHash = matchKeyFor('submitted-hash')
  const transactionHash = matchKeyFor('mined-hash')
  stubWallet(async ({ method }) => {
    if (method === 'eth_accounts') return [account]
    if (method === 'eth_chainId') return '0x4cef52'
    if (method === 'eth_sendTransaction') return originalHash
    throw new Error('Unexpected wallet call')
  })
  vi.spyOn(arc, 'getChainId').mockResolvedValue(ARC_TESTNET.id)
  vi.spyOn(arc, 'readContract').mockResolvedValue(ENTRY_AMOUNT)
  vi.spyOn(arc, 'simulateContract').mockResolvedValue({ request: {
    account, address: escrow, abi: ESCROW_ABI, functionName, args: [matchId],
  } } as never)
  const wait = vi.spyOn(arc, 'waitForTransactionReceipt')
  const run = () => send(account, escrow, matchId, vi.fn())
  const makeLog = (address: typeof escrow | typeof other, id = matchId, player = account) => ({
    address,
    topics: encodeEventTopics({ abi: ESCROW_ABI, eventName, args: { matchId: id, player } }),
    data: encodeAbiParameters([{ type: 'uint256' }], [ENTRY_AMOUNT]),
  })
  wait.mockResolvedValue({ status: 'success', transactionHash, logs: [
    makeLog(other), makeLog(escrow, matchKeyFor('other-match')),
  ] } as never)
  await expect(run()).rejects.toThrow('did not confirm')
  if (eventName === 'Deposited') {
    wait.mockResolvedValue({ status: 'success', transactionHash, logs: [makeLog(escrow, matchId, other)] } as never)
    await expect(run()).rejects.toThrow('did not confirm')
  }
  wait.mockResolvedValue({ status: 'success', transactionHash, logs: [makeLog(escrow)] } as never)
  await expect(run()).resolves.toEqual(eventName === 'Deposited' ? transactionHash : { transactionHash, deferredPayouts: [] })
})
