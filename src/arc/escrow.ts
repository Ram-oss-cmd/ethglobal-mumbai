import {
  concatHex, createPublicClient, createWalletClient, getAddress, http, isAddress,
  isAddressEqual, keccak256, parseEventLogs, zeroAddress, zeroHash, type Address, type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { RUN_MS } from '../game/index.ts'
import type { MatchRecord } from '../competition/protocol.ts'
import { verifyMatchRecord } from '../competition/replay.ts'
import { ARC_TESTNET, ARC_USDC, ENTRY_AMOUNT, ESCROW_ABI, type EscrowVersion, MATCHED_STAKE_ABI, matchKeyFor, readDeferredPayouts, validStakeUnits } from './chain.ts'

const DEPOSIT_WINDOW = 600n
const SETTLEMENT_WINDOW = 300n
// Allow the full game, both reconnect budgets and time to submit settlement.
const START_BUFFER = BigInt(Math.ceil(RUN_MS / 1000) + 20 + 30)
const SIGNATURE_TTL = 180n
const OPEN_MATCH_ABI = [...ESCROW_ABI, ...MATCHED_STAKE_ABI] as const

type WalletPair = [Address, Address]
type MatchOnChain = readonly [Address, Address, bigint, bigint, boolean, boolean, boolean]

function participantsMatch(match: MatchOnChain, [playerA, playerB]: WalletPair) {
  return isAddressEqual(match[0], playerA) && isAddressEqual(match[1], playerB)
}

export function matchCanStart(match: MatchOnChain, wallets: WalletPair, chainTime: bigint) {
  const [, , , refundAfter, depositedA, depositedB, finalized] = match
  return participantsMatch(match, wallets) && depositedA && depositedB && !finalized &&
    chainTime + START_BUFFER < refundAfter
}

/** Bind the referee signature to one verified result, one Studio deployment and one chain. */
export function resultTypedData(address: Address, matchKey: Hex, record: MatchRecord, wallets: WalletPair, validUntil: bigint, version: EscrowVersion = '1') {
  if (matchKeyFor(record.matchId) !== matchKey || record.runs.some((run, seat) =>
    !isAddress(run.playerId) || !isAddressEqual(run.playerId, wallets[seat])
  )) throw new Error('Replay does not belong to these escrow participants')
  verifyMatchRecord(record)
  const [first, second] = record.runs
  const replayDigest = keccak256(concatHex([`0x${first.digest}`, `0x${second.digest}`]))
  const outcome = record.result.kind === 'win' ? record.result.winner + 1 : record.result.kind === 'draw' ? 3 : 4
  return {
    domain: { name: 'Wallet Rush Escrow', version, chainId: ARC_TESTNET.id, verifyingContract: address },
    types: {
      Result: [
        { name: 'matchId', type: 'bytes32' },
        { name: 'playerA', type: 'address' },
        { name: 'playerB', type: 'address' },
        { name: 'outcome', type: 'uint8' },
        { name: 'scoreA', type: 'uint32' },
        { name: 'scoreB', type: 'uint32' },
        { name: 'validUntil', type: 'uint64' },
        { name: 'replayDigest', type: 'bytes32' },
      ],
    },
    primaryType: 'Result',
    message: {
      matchId: matchKey, playerA: wallets[0], playerB: wallets[1], outcome,
      scoreA: first.finalBanked, scoreB: second.finalBanked, validUntil, replayDigest,
    },
  } as const
}

export function createEscrow() {
  const configured = process.env.ARC_ESCROW_ADDRESS
  const key = process.env.ARC_REFEREE_KEY
  const version = process.env.ARC_ESCROW_VERSION || '1'
  if (!configured || !key) return
  if (!isAddress(configured) || isAddressEqual(configured, zeroAddress) || !/^0x[0-9a-f]{64}$/i.test(key) || (version !== '1' && version !== '2')) {
    throw new Error('Invalid Arc Testnet escrow configuration')
  }
  const address = getAddress(configured)
  const account = privateKeyToAccount(key as Hex)
  const chain = ARC_TESTNET
  const publicClient = createPublicClient({ chain, transport: http() })
  const referee = createWalletClient({ account, chain, transport: http() })
  const contract = { address, abi: ESCROW_ABI }
  let writes: Promise<unknown> = Promise.resolve()

  // One referee signs every match. Wait for inclusion before sending another transaction.
  function serialize<T>(write: () => Promise<T>): Promise<T> {
    const next = writes.then(write)
    writes = next.catch(() => undefined)
    return next
  }

  async function readMatch(matchKey: Hex, blockNumber?: bigint) {
    return publicClient.readContract({ ...contract, functionName: 'getMatch', args: [matchKey], blockNumber })
  }

  async function readStake(matchKey: Hex, blockNumber: bigint) {
    return version === '2' ? publicClient.readContract({ address, abi: MATCHED_STAKE_ABI, functionName: 'getStake',
      args: [matchKey], blockNumber }) : Number(ENTRY_AMOUNT)
  }

  async function assertTestnet() {
    if (await publicClient.getChainId() !== chain.id) throw new Error('Unexpected Arc RPC chain')
  }

  return {
    address,
    version,
    async verifyDeployment() {
      await assertTestnet()
      const blockNumber = await publicClient.getBlockNumber()
      const [domain, registeredReferee, token, emptyStake] = await Promise.all([
        publicClient.readContract({ ...contract, functionName: 'eip712Domain', blockNumber }),
        publicClient.readContract({ ...contract, functionName: 'REFEREE', blockNumber }),
        publicClient.readContract({ ...contract, functionName: 'USDC', blockNumber }),
        readStake(zeroHash, blockNumber),
      ])
      if (domain[1] !== 'Wallet Rush Escrow' || domain[2] !== version || domain[3] !== BigInt(chain.id) ||
          !isAddressEqual(domain[4], address) || !isAddressEqual(registeredReferee, account.address) ||
          !isAddressEqual(token, ARC_USDC) || (version === '2' && emptyStake !== 0)) {
        throw new Error('Unexpected escrow deployment configuration')
      }
    },
    openMatch(matchId: string, wallets: WalletPair, stakeUnits = Number(ENTRY_AMOUNT)) {
      return serialize(async () => {
        const [playerA, playerB] = wallets
        if (isAddressEqual(playerA, playerB) || wallets.some(wallet => isAddressEqual(wallet, zeroAddress))) {
          throw new Error('Escrow requires two different player wallets')
        }
        if (!validStakeUnits(stakeUnits) || (version === '1' && stakeUnits !== Number(ENTRY_AMOUNT))) {
          throw new Error('Invalid stake for this escrow')
        }
        await assertTestnet()
        const matchKey = matchKeyFor(matchId)
        const block = await publicClient.getBlock()
        const depositDeadline = block.timestamp + DEPOSIT_WINDOW
        const refundAfter = depositDeadline + SETTLEMENT_WINDOW
        const args = [matchKey, playerA, playerB, depositDeadline, refundAfter] as const
        const { request } = await publicClient.simulateContract({ address, abi: OPEN_MATCH_ABI, account,
          functionName: 'openMatch', args: version === '2' ? [...args, stakeUnits] : args })
        const hash = await referee.writeContract(request)
        const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 45_000 })
        if (receipt.status !== 'success') throw new Error('Escrow open reverted')
        const [match, stake] = await Promise.all([readMatch(matchKey, receipt.blockNumber), readStake(matchKey, receipt.blockNumber)])
        if (!participantsMatch(match, wallets) || match[2] !== depositDeadline || match[3] !== refundAfter || match[6] || stake !== stakeUnits) {
          throw new Error('Escrow opening did not record these participants, deadlines and stake')
        }
        return { matchKey, transactionHash: receipt.transactionHash, depositDeadline: Number(depositDeadline), refundAfter: Number(refundAfter) }
      })
    },
    async canStart(matchKey: Hex, wallets: WalletPair, stakeUnits: number) {
      await assertTestnet()
      const block = await publicClient.getBlock()
      const [match, stake] = await Promise.all([readMatch(matchKey, block.number), readStake(matchKey, block.number)])
      return stake === stakeUnits && matchCanStart(match, wallets, block.timestamp)
    },
    async matchWasOpened(matchId: string, wallets: WalletPair, stakeUnits: number) {
      await assertTestnet()
      const block = await publicClient.getBlock()
      const [match, stake] = await Promise.all([readMatch(matchKeyFor(matchId), block.number), readStake(matchKeyFor(matchId), block.number)])
      return stake === stakeUnits && participantsMatch(match, wallets)
    },
    settle(matchKey: Hex, record: MatchRecord, wallets: WalletPair, stakeUnits: number) {
      return serialize(async () => {
        await assertTestnet()
        const block = await publicClient.getBlock()
        const [match, stake] = await Promise.all([readMatch(matchKey, block.number), readStake(matchKey, block.number)])
        const [, , , refundAfter, depositedA, depositedB, finalized] = match
        if (stake !== stakeUnits || !participantsMatch(match, wallets) || !depositedA || !depositedB || finalized || block.timestamp >= refundAfter - 1n) {
          throw new Error('Match is not eligible for settlement')
        }
        const expires = block.timestamp + SIGNATURE_TTL
        const validUntil = expires < refundAfter ? expires : refundAfter - 1n
        const typedData = resultTypedData(address, matchKey, record, wallets, validUntil, version)
        const { outcome, scoreA, scoreB, replayDigest } = typedData.message
        const signature = await account.signTypedData(typedData)
        const { request } = await publicClient.simulateContract({
          ...contract, account, functionName: 'settle',
          args: [matchKey, outcome, scoreA, scoreB, validUntil, replayDigest, signature],
        })
        const hash = await referee.writeContract(request)
        const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 45_000 })
        const events = parseEventLogs({
          abi: ESCROW_ABI, eventName: 'Settled', logs: receipt.logs.filter(log => isAddressEqual(log.address, address)),
        })
        if (receipt.status !== 'success' || !events.some(event =>
          event.args.matchId === matchKey && event.args.outcome === outcome && event.args.replayDigest === replayDigest
        )) throw new Error('Arc receipt does not confirm the expected settlement')
        return {
          transactionHash: receipt.transactionHash,
          deferredPayouts: readDeferredPayouts(receipt.logs, address, matchKey),
        }
      })
    },
  }
}
