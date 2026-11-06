import {
  createPublicClient, createWalletClient, custom, erc20Abi, getAddress, http,
  isAddressEqual, numberToHex, parseEventLogs, type Address, type EIP1193Provider, type Hex,
} from 'viem'
import { ARC_TESTNET, ARC_USDC, ENTRY_AMOUNT, ESCROW_ABI, readDeferredPayouts } from '../arc/chain.ts'

export const arc = createPublicClient({ chain: ARC_TESTNET, transport: http(undefined, { timeout: 10_000 }) })

export function injectedWallet() {
  const provider = (window as Window & { ethereum?: EIP1193Provider }).ethereum
  if (!provider) throw new Error('Install MetaMask or open the game in an injected EVM wallet.')
  return { provider, client: createWalletClient({ chain: ARC_TESTNET, transport: custom(provider) }) }
}

export async function switchToArc() {
  const { client, provider } = injectedWallet()
  const switchChain = () => provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: numberToHex(ARC_TESTNET.id) }] })
  try {
    await switchChain()
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 4902) throw error
    await client.addChain({ chain: ARC_TESTNET })
    await switchChain()
  }
}

/** Check the provider again before every signature or transaction, including after approval. */
export async function checkedWallet(account: Address) {
  const { client } = injectedWallet()
  const [chain, addresses] = await Promise.all([client.getChainId(), client.getAddresses()])
  if (chain !== ARC_TESTNET.id) throw new Error('Switch your wallet to Arc Testnet first.')
  if (!addresses[0] || !isAddressEqual(addresses[0], account)) throw new Error('The connected wallet changed. Reconnect it.')
  return client
}

export async function depositUSDC(account: Address, escrow: Address, matchKey: Hex, onHash: (hash: Hex) => void) {
  if (await arc.getChainId() !== ARC_TESTNET.id) throw new Error('Unexpected Arc RPC chain.')
  const client = await checkedWallet(account)
  const allowance = await arc.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: 'allowance', args: [account, escrow] })
  if (allowance < ENTRY_AMOUNT) {
    const { request } = await arc.simulateContract({
      account, address: ARC_USDC, abi: erc20Abi, functionName: 'approve', args: [escrow, ENTRY_AMOUNT],
    })
    const hash = await client.writeContract(request)
    onHash(hash)
    if ((await arc.waitForTransactionReceipt({ hash, timeout: 90_000 })).status !== 'success') {
      throw new Error('USDC approval reverted.')
    }
  }
  const { request } = await arc.simulateContract({
    account, address: escrow, abi: ESCROW_ABI, functionName: 'deposit', args: [matchKey],
  })
  const hash = await (await checkedWallet(account)).writeContract(request)
  onHash(hash)
  if ((await arc.waitForTransactionReceipt({ hash, timeout: 90_000 })).status !== 'success') throw new Error('Deposit reverted.')
  return hash
}

export async function refundUSDC(account: Address, escrow: Address, matchKey: Hex, onHash: (hash: Hex) => void) {
  if (await arc.getChainId() !== ARC_TESTNET.id) throw new Error('Unexpected Arc RPC chain.')
  const client = await checkedWallet(account)
  const { request } = await arc.simulateContract({
    account: getAddress(account), address: escrow, abi: ESCROW_ABI, functionName: 'refundExpired', args: [matchKey],
  })
  const hash = await client.writeContract(request)
  onHash(hash)
  const receipt = await arc.waitForTransactionReceipt({ hash, timeout: 90_000 })
  if (receipt.status !== 'success') throw new Error('Refund reverted.')
  return { transactionHash: receipt.transactionHash, deferredPayouts: readDeferredPayouts(receipt.logs, escrow, matchKey) }
}

export async function claimUSDC(account: Address, escrow: Address, onHash: (hash: Hex) => void) {
  if (await arc.getChainId() !== ARC_TESTNET.id) throw new Error('Unexpected Arc RPC chain.')
  const client = await checkedWallet(account)
  const { request } = await arc.simulateContract({ account, address: escrow, abi: ESCROW_ABI, functionName: 'claim' })
  const hash = await client.writeContract(request)
  onHash(hash)
  const receipt = await arc.waitForTransactionReceipt({ hash, timeout: 90_000 })
  const claims = parseEventLogs({ abi: ESCROW_ABI, eventName: 'Claimed',
    logs: receipt.logs.filter(log => isAddressEqual(log.address, escrow)),
  })
  if (receipt.status !== 'success' ||
      !claims.some(event => isAddressEqual(event.args.player, account) && event.args.amount > 0n)) {
    throw new Error('Arc receipt did not confirm a claim for this wallet.')
  }
  return receipt.transactionHash
}
