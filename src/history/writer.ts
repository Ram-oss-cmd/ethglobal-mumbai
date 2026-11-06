import { createWalletClient, ExpirationTime } from '@arkiv-network/sdk'
import { rabdi } from '@arkiv-network/sdk/chains'
import { addr, u64 } from '@arkiv-network/sdk/schema'
import { getAddress, http, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { MatchRecord } from '../competition/protocol.ts'
import { encodeReplay } from './codec.ts'
import { Matches, resultLabel } from './schema.ts'

export function createHistoryWriter() {
  const key = process.env.ARKIV_WRITER_KEY
  if (!key) return
  if (!/^0x[0-9a-f]{64}$/i.test(key)) throw new Error('ARKIV_WRITER_KEY must be a hex test-wallet private key')
  const account = privateKeyToAccount(key as Hex)
  const wallet = createWalletClient({
    chain: rabdi({ accessKey: process.env.ARKIV_ACCESS_KEY ?? '' }), transport: http(), account,
  })
  let queue: Promise<unknown> = Promise.resolve()

  return {
    address: account.address,
    publish(record: MatchRecord, wallets: [string, string], settlementTx?: string) {
      // One signer submits writes in order so concurrent matches do not race its nonce.
      const write = queue.then(async () => {
        const [playerA, playerB] = wallets.map(getAddress)
        if (playerA === playerB) throw new Error('Archive requires two distinct player wallets')
        if (getAddress(record.runs[0].playerId) !== playerA || getAddress(record.runs[1].playerId) !== playerB) {
          throw new Error('Archive wallet references must match the verified run identities')
        }
        if (settlementTx && !/^0x[0-9a-f]{64}$/i.test(settlementTx)) throw new Error('Invalid settlement transaction hash')
        const replay = await encodeReplay(record)
        const [first, second] = record.runs
        const { entityKey, txHash } = await wallet.createEntity(Matches, {
          matchId: record.matchId,
          playerA: addr(playerA),
          playerB: addr(playerB),
          engineVersion: first.engineVersion,
          seed: u64(first.seed),
          bankedA: first.finalBanked,
          bankedB: second.finalBanked,
          result: resultLabel(record.result),
          settlementTx,
          publishedAt: u64(Date.now()),
          replay,
        }, { expiration: ExpirationTime.fromDays(30), flags: { readonly: true } })
        return { entityKey, transactionHash: txHash }
      })
      queue = write.catch(() => {})
      return write
    },
  }
}
