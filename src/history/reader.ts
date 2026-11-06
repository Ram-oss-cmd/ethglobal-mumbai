import { createPublicClient } from '@arkiv-network/sdk'
import { rabdi } from '@arkiv-network/sdk/chains'
import { desc, eq } from '@arkiv-network/sdk/query'
import { key } from '@arkiv-network/sdk/schema'
import { getAddress, hexToBytes, http } from 'viem'
import { decodeReplay } from './codec.ts'
import { Matches, resultLabel } from './schema.ts'

export function createHistoryReader(writerAddress: string, accessKey = '') {
  const writer = getAddress(writerAddress)
  const client = createPublicClient({ chain: rabdi({ accessKey }), transport: http(undefined, { timeout: 10_000 }) })

  function query() {
    return client.select({
      $key: true, $expiresAt: true, matchId: true, playerA: true, playerB: true,
      engineVersion: true, seed: true, bankedA: true, bankedB: true, result: true,
      settlementTx: true, publishedAt: true,
    }).from(Matches).ownedBy(writer).createdBy(writer)
  }

  return {
    recent() {
      return query().orderBy(desc('publishedAt')).limit(20).fetch()
    },
    async match(matchId: string) {
      if (!/^[a-z0-9-]{3,128}$/i.test(matchId)) throw new Error('Invalid match ID')
      const { entities } = await query().where(eq('matchId', matchId)).limit(2).fetch()
      if (entities.length === 0) return
      if (entities.length > 1) throw new Error('Multiple archives share this match ID')
      const row = entities[0]
      const { entities: payloads } = await client.select({ replay: true }).from(Matches)
        .ownedBy(writer).createdBy(writer).where(eq('matchId', matchId), eq('$key', key(row.$key))).limit(1).fetch()
      if (!payloads[0]?.replay) throw new Error('The replay is unavailable')
      const record = await decodeReplay(hexToBytes(payloads[0].replay.value))
      const [first, second] = record.runs
      if (record.matchId !== matchId || first.engineVersion !== row.engineVersion.value ||
          BigInt(first.seed) !== row.seed.value || first.finalBanked !== row.bankedA.value ||
          second.finalBanked !== row.bankedB.value || resultLabel(record.result) !== row.result.value ||
          getAddress(first.playerId) !== row.playerA.value || getAddress(second.playerId) !== row.playerB.value) {
        throw new Error('Arkiv metadata differs from the verified replay')
      }
      return { row, record }
    },
  }
}

export type HistoryReader = ReturnType<typeof createHistoryReader>
export type HistoryRow = Awaited<ReturnType<HistoryReader['recent']>>['entities'][number]
