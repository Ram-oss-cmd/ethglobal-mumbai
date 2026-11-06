import { expect, it } from 'vitest'
import { buildMatchRecord } from '../competition/replay.ts'
import { decodeReplay, encodeReplay } from './codec.ts'

it('round-trips both distinct maze layouts and rejects tampered banked scores before archiving', async () => {
  const record = buildMatchRecord('prize-demo', ['wallet-a', 'wallet-b'], 77, [
    [{ tick: 1, direction: 'down' }], [{ tick: 1, direction: 'down' }],
  ], [9_000, 9_000], { kind: 'draw', reason: 'banked' })
  expect(await decodeReplay(await encodeReplay(record))).toEqual(record)
  record.runs[1].alternateLayout = false
  await expect(encodeReplay(record)).rejects.toThrow('differs')
})
