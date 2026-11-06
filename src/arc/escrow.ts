import {
  concatHex, createPublicClient, createWalletClient, getAddress, http, isAddress,
  isAddressEqual, keccak256, parseEventLogs, zeroAddress, type Address, type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { RUN_MS } from '../game/index.ts'
import type { MatchRecord } from '../competition/protocol.ts'
import { verifyMatchRecord } from '../competition/replay.ts'
import { ARC_TESTNET, ESCROW_ABI, matchKeyFor } from './chain.ts'

const DEPOSIT_WINDOW = 600n
const SETTLEMENT_WINDOW = 300n
// Allow the full game, both reconnect budgets and time to submit settlement.
const START_BUFFER = BigInt(Math.ceil(RUN_MS / 1000) + 20 + 30)
const SIGNATURE_TTL = 180n

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
export function resultTypedData(address: Address, matchKey: Hex, record: MatchRecord, wallets: WalletPair, validUntil: bigint) {
  if (matchKeyFor(record.matchId) !== matchKey || record.runs.some((run, seat) =>
    !isAddress(run.playerId) || !isAddressEqual(run.playerId, wallets[seat])
  )) throw new Error('Replay does not belong to these escrow participants')
  verifyMatchRecord(record)
  const [first, second] = record.runs
  const replayDigest = keccak256(concatHex([`0x${first.digest}`, `0x${second.digest}`]))
  const outcome = record.result.kind === 'win' ? record.result.winner + 1 : record.result.kind === 'draw' ? 3 : 4
  return {
    domain: { name: 'Wallet Rush Escrow', version: '1', chainId: ARC_TESTNET.id, verifyingContract: address },
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
  if (!configured || !key) return
  if (!isAddress(configured) || isAddressEqual(configured, zeroAddress) || !/^0x[0-9a-f]{64}$/i.test(key)) {
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

  async function assertTestnet() {
    if (await publicClient.getChainId() !== chain.id) throw new Error('Unexpected Arc RPC chain')
  }

  return {
    address,
    openMatch(matchId: string, wallets: WalletPair) {
      return serialize(async () => {
        const [playerA, playerB] = wallets
        if (isAddressEqual(playerA, playerB) || wallets.some(wallet => isAddressEqual(wallet, zeroAddress))) {
          throw new Error('Escrow requires two different player wallets')
        }
        await assertTestnet()
        const matchKey = matchKeyFor(matchId)
        const block = await publicClient.getBlock()
        const depositDeadline = block.timestamp + DEPOSIT_WINDOW
        const refundAfter = depositDeadline + SETTLEMENT_WINDOW
        const { request } = await publicClient.simulateContract({
          ...contract, account, functionName: 'openMatch',
          args: [matchKey, playerA, playerB, depositDeadline, refundAfter],
        })
        const hash = await referee.writeContract(request)
        const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 45_000 })
        if (receipt.status !== 'success') throw new Error('Escrow open reverted')
        const match = await readMatch(matchKey, receipt.blockNumber)
        if (!participantsMatch(match, wallets) || match[2] !== depositDeadline || match[3] !== refundAfter || match[6]) {
          throw new Error('Escrow opening did not record these participants and deadlines')
        }
        return { matchKey, transactionHash: receipt.transactionHash, depositDeadline: Number(depositDeadline), refundAfter: Number(refundAfter) }
      })
    },
    async canStart(matchKey: Hex, wallets: WalletPair) {
      await assertTestnet()
      const block = await publicClient.getBlock()
      return matchCanStart(await readMatch(matchKey, block.number), wallets, block.timestamp)
    },
    settle(matchKey: Hex, record: MatchRecord, wallets: WalletPair) {
      return serialize(async () => {
        await assertTestnet()
        const block = await publicClient.getBlock()
        const match = await readMatch(matchKey, block.number)
        const [, , , refundAfter, depositedA, depositedB, finalized] = match
        if (!participantsMatch(match, wallets) || !depositedA || !depositedB || finalized || block.timestamp >= refundAfter - 1n) {
          throw new Error('Match is not eligible for settlement')
        }
        const expires = block.timestamp + SIGNATURE_TTL
        const validUntil = expires < refundAfter ? expires : refundAfter - 1n
        const typedData = resultTypedData(address, matchKey, record, wallets, validUntil)
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
        return receipt.transactionHash
      })
    },
  }
}
