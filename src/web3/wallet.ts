import {
  createPublicClient, createWalletClient, custom, erc20Abi, fallback, getAddress, http,
  isAddressEqual, numberToHex, parseEventLogs, type Address, type EIP1193Provider, type Hex,
} from 'viem'
import { ARC_TESTNET, ARC_USDC, ENTRY_AMOUNT, ESCROW_ABI, type EscrowVersion, MATCHED_STAKE_ABI, readDeferredPayouts, validStakeUnits } from '../arc/chain.ts'

export const arc = createPublicClient({
  chain: ARC_TESTNET,
  transport: fallback([
    http(undefined, { timeout: 5_000 }),
    http('https://rpc.drpc.testnet.arc.io', { timeout: 5_000 }),
  ], { retryCount: 0 }),
})
export const WALLET_ACCOUNT_KEY = 'wallet-rush:wallet-account'
export const WALLET_SIGN_IN_KEY = 'wallet-rush:signed-in'
export const PRIZE_SESSION_KEY = 'wallet-rush:prize-session'

export function selectedWalletAccount(addresses: readonly Address[], preferred: string | null | undefined) {
  return addresses.find(address => address.toLowerCase() === preferred) ?? addresses[0]
}

export function injectedWallet() {
  let provider: EIP1193Provider | undefined
  function onAnnouncement(event: Event) {
    const detail = (event as CustomEvent<{ info: { rdns: string }; provider: EIP1193Provider }>).detail
    if (detail?.info?.rdns === 'io.metamask') provider ??= detail.provider
  }
  window.addEventListener('eip6963:announceProvider', onAnnouncement)
  window.dispatchEvent(new Event('eip6963:requestProvider'))
  window.removeEventListener('eip6963:announceProvider', onAnnouncement)

  if (!provider) throw new Error('Open Wallet Rush in a browser with the current MetaMask extension installed.')
  return { provider, client: createWalletClient({ chain: ARC_TESTNET, transport: custom(provider) }) }
}

/** Read the six-decimal ERC-20 balance that the escrow actually deposits. */
export function readTestUsdcBalance(account: Address) {
  return arc.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [account] })
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
export async function checkedWallet(account: Address, requestAccess = false) {
  if (window.localStorage.getItem(WALLET_SIGN_IN_KEY) !== '1') throw new Error('Sign in to Wallet Rush first.')
  const { client } = injectedWallet()
  const [chain, addresses] = await Promise.all([client.getChainId(), requestAccess ? client.requestAddresses() : client.getAddresses()])
  if (window.localStorage.getItem(WALLET_SIGN_IN_KEY) !== '1') throw new Error('Sign in to Wallet Rush first.')
  if (chain !== ARC_TESTNET.id) throw new Error('Switch your wallet to Arc Testnet first.')
  const selected = selectedWalletAccount(addresses, window.sessionStorage?.getItem(WALLET_ACCOUNT_KEY))
  if (!selected || !isAddressEqual(selected, account)) {
    throw new Error('MetaMask authorized a different account. Sign out of Wallet Rush, select this account in MetaMask, then sign in again.')
  }
  return client
}

export async function depositUSDC(account: Address, escrow: Address, matchKey: Hex, onHash: (hash: Hex) => void,
  stakeUnits = Number(ENTRY_AMOUNT), version: EscrowVersion = '1') {
  if (await arc.getChainId() !== ARC_TESTNET.id) throw new Error('Unexpected Arc RPC chain.')
  await checkedWallet(account)
  const escrowStake = version === '2'
    ? await arc.readContract({ address: escrow, abi: MATCHED_STAKE_ABI, functionName: 'getStake', args: [matchKey] })
    : Number(ENTRY_AMOUNT)
  if (!validStakeUnits(stakeUnits) || escrowStake !== stakeUnits) throw new Error('Arc escrow stake differs from the confirmed offer.')
  const amount = BigInt(stakeUnits)
  const allowance = await arc.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: 'allowance', args: [account, escrow] })
  if (allowance < amount) {
    const { request } = await arc.simulateContract({
      account, address: ARC_USDC, abi: erc20Abi, functionName: 'approve', args: [escrow, amount],
    })
    const hash = await (await checkedWallet(account)).writeContract(request)
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
  const receipt = await arc.waitForTransactionReceipt({ hash, timeout: 90_000 })
  const deposits = parseEventLogs({ abi: ESCROW_ABI, eventName: 'Deposited',
    logs: receipt.logs.filter(log => isAddressEqual(log.address, escrow)),
  })
  if (receipt.status !== 'success' || !deposits.some(({ args }) =>
    args.matchId === matchKey && isAddressEqual(args.player, account) && args.amount === amount
  )) throw new Error('Arc receipt did not confirm this wallet’s deposit for the match.')
  return receipt.transactionHash
}

export async function refundUSDC(account: Address, escrow: Address, matchKey: Hex, onHash: (hash: Hex) => void, version: EscrowVersion = '1') {
  if (await arc.getChainId() !== ARC_TESTNET.id) throw new Error('Unexpected Arc RPC chain.')
  await checkedWallet(account)
  const stakeUnits = version === '2'
    ? await arc.readContract({ address: escrow, abi: MATCHED_STAKE_ABI, functionName: 'getStake', args: [matchKey] })
    : Number(ENTRY_AMOUNT)
  if (!validStakeUnits(stakeUnits)) throw new Error('Arc escrow did not return a valid stake for this match.')
  const { request } = await arc.simulateContract({
    account: getAddress(account), address: escrow, abi: ESCROW_ABI, functionName: 'refundExpired', args: [matchKey],
  })
  const hash = await (await checkedWallet(account)).writeContract(request)
  onHash(hash)
  const receipt = await arc.waitForTransactionReceipt({ hash, timeout: 90_000 })
  const refunds = parseEventLogs({ abi: ESCROW_ABI, eventName: 'Refunded',
    logs: receipt.logs.filter(log => isAddressEqual(log.address, escrow)),
  })
  // Anyone may trigger the timeout, but only participants with deposits receive a refund.
  if (receipt.status !== 'success' || !refunds.some(({ args }) => args.matchId === matchKey && args.amount === BigInt(stakeUnits))) {
    throw new Error('Arc receipt did not confirm a deposit refund for this match.')
  }
  return { transactionHash: receipt.transactionHash, deferredPayouts: readDeferredPayouts(receipt.logs, escrow, matchKey) }
}

export async function claimUSDC(account: Address, escrow: Address, onHash: (hash: Hex) => void) {
  if (await arc.getChainId() !== ARC_TESTNET.id) throw new Error('Unexpected Arc RPC chain.')
  await checkedWallet(account)
  const { request } = await arc.simulateContract({ account, address: escrow, abi: ESCROW_ABI, functionName: 'claim' })
  const hash = await (await checkedWallet(account)).writeContract(request)
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
