import { describe, expect, it } from 'vitest'
import { createGame, TOTAL_DOTS } from '../game'
import { buildMatchRecord, decideMatch, verifyMatchRecord } from './replay'
import { replayRun } from './run'
import { LEGACY_ENGINE_VERSION, type MatchRecord } from './protocol'

describe('deterministic match verification', () => {
  it('verifies an unchanged version 5 record against the original maze', () => {
    const base = { matchId: 'legacy-board', seed: 19, engineVersion: LEGACY_ENGINE_VERSION, ticks: 70,
      status: 'playing', outcome: 'canceled' } as const
    const record: MatchRecord = {
      matchId: base.matchId, result: { kind: 'canceled', reason: 'disconnect', refundEligible: true },
      runs: [{
        ...base, deaths: [], playerId: 'a', alternateLayout: false, inputs: [{ tick: 1, direction: 'down' }],
        banking: [{ tick: 59, banked: 3 }], finalBanked: 3,
        digest: '9c0a94396ba4d9e8f83294263b7f7ffc9ca551bbda8226c859765338b2916ad5',
      }, {
        ...base, deaths: [], playerId: 'b', alternateLayout: true, inputs: [], banking: [], finalBanked: 0,
        digest: 'c1e86cd75c774b0d73b1c2f78b5d25955d54ad2e22c66e9ed088c4a8537b2793',
      }],
    }
    expect(verifyMatchRecord(record).map(state => [state.legacy, state.banked])).toEqual([[true, 3], [true, 0]])
  })

  it('uses verified full-clear times and treats identical times as a draw', () => {
    const first = createGame(1)
    const second = createGame(1)
    Object.assign(first, { status: 'full-clear', elapsedMs: 30_000, banked: TOTAL_DOTS })
    expect(decideMatch([first, second])).toEqual({ kind: 'win', winner: 0, reason: 'full-clear' })
    Object.assign(second, { status: 'full-clear', elapsedMs: 30_000, banked: TOTAL_DOTS })
    expect(decideMatch([first, second])).toEqual({ kind: 'draw', reason: 'full-clear' })
    second.elapsedMs -= 10
    expect(decideMatch([first, second])).toEqual({ kind: 'win', winner: 1, reason: 'full-clear' })
  })

  it('reconstructs and verifies both runs and rejects modified scores, event logs and digests', () => {
    const record = buildMatchRecord('arena', ['a', 'b'], 42, [
      [{ tick: 1, direction: 'down' }], [{ tick: 1, direction: 'down' }],
    ], [9_000, 9_000], { kind: 'draw', reason: 'banked' })
    expect(verifyMatchRecord(record).map(run => run.banked)).toEqual([3, 3])
    expect(record.runs[0].banking).toEqual([{ tick: 59, banked: 3 }])
    const forged = structuredClone(record)
    forged.runs[0].finalBanked = 4
    expect(() => verifyMatchRecord(forged)).toThrow()
    forged.runs[0].finalBanked = 3
    forged.runs[0].banking[0].tick = 60
    expect(() => verifyMatchRecord(forged)).toThrow()
    forged.runs[0].banking[0].tick = 59
    forged.runs[0].digest = forged.runs[1].digest
    expect(() => verifyMatchRecord(forged)).toThrow()
    Object.assign(forged.runs[0], { engineVersion: 'wallet-rush-2' })
    expect(() => verifyMatchRecord(forged)).toThrow('different game engine version')
  })

  it('rejects duplicate, invalid and out-of-range input ticks', () => {
    expect(() => replayRun(0, [{ tick: 0, direction: 'up' }], 5)).toThrow()
    expect(() => replayRun(0, [{ tick: 2, direction: 'up' }, { tick: 2, direction: 'down' }], 5)).toThrow()
    expect(() => replayRun(0, [{ tick: 6, direction: 'up' }], 5)).toThrow()
    expect(() => replayRun(0, [], 9_001)).toThrow()
  })
})
