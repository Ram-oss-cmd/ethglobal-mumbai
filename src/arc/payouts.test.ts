import { encodeAbiParameters, encodeEventTopics, type Address, type Log } from 'viem'
import { expect, it } from 'vitest'
import { ESCROW_ABI, matchKeyFor, readDeferredPayouts } from './chain.ts'

const escrow = '0x1000000000000000000000000000000000000000'
const player = '0x2000000000000000000000000000000000000000'
const key = matchKeyFor('prize-review')

function log(address: Address, matchId = key): Log {
  return {
    address, blockHash: key, transactionHash: key, blockNumber: 1n, logIndex: 0, transactionIndex: 0, removed: false,
    topics: encodeEventTopics({ abi: ESCROW_ABI, eventName: 'PayoutDeferred', args: { matchId, player } }) as Log['topics'],
    data: encodeAbiParameters([{ type: 'uint256' }], [20_000_000n]),
  }
}

it('reports deferrals only from the matching escrow and match and keeps the amount JSON-safe', () => {
  const payouts = readDeferredPayouts([
    log(player), log(escrow, matchKeyFor('other-match')), log(escrow),
  ], escrow, key)
  expect(JSON.parse(JSON.stringify(payouts))).toEqual([{ player, amount: '20000000' }])
  expect(readDeferredPayouts([], escrow, key)).toEqual([])
})
