import { describe, expect, it } from 'vitest'
import { createGame, TOTAL_DOTS } from '../game'
import { buildMatchRecord, decideMatch, verifyMatchRecord } from './replay'
import { replayRun } from './run'
import { LEGACY_ENGINE_VERSION, type MatchRecord } from './protocol'

describe('deterministic match verification', () => {
  it.each([
    [LEGACY_ENGINE_VERSION, 'legacy', 'legacy-board',
      '9c0a94396ba4d9e8f83294263b7f7ffc9ca551bbda8226c859765338b2916ad5',
      'c1e86cd75c774b0d73b1c2f78b5d25955d54ad2e22c66e9ed088c4a8537b2793'],
    ['wallet-rush-6', 'symmetric', 'symmetric-board',
      '87ea5acf6b9f07d46000101b0c3160e7556c09a99d31cf4a8c9ba88261e7477a',
      '7a39a7978e33eb3b057e5736c2d4d7693c14b25213a05f8a59e148b44dc9dec7'],
  ] as const)('verifies an unchanged %s record against its original maze', (engineVersion, layout, matchId, first, second) => {
    const base = { matchId, seed: 19, engineVersion, ticks: 70,
      status: 'playing', outcome: 'canceled' } as const
    const record: MatchRecord = {
      matchId: base.matchId, result: { kind: 'canceled', reason: 'disconnect', refundEligible: true },
      runs: [{
        ...base, deaths: [], playerId: 'a', alternateLayout: false, inputs: [{ tick: 1, direction: 'down' }],
        banking: [{ tick: 59, banked: 3 }], finalBanked: 3,
        digest: first,
      }, {
        ...base, deaths: [], playerId: 'b', alternateLayout: true, inputs: [], banking: [], finalBanked: 0,
        digest: second,
      }],
    }
    expect(verifyMatchRecord(record).map(state => [state.layout, state.banked])).toEqual([[layout, 3], [layout, 0]])
  })

  it('preserves the dot return in an archived v7 match and keeps it gone in a new match', () => {
    const matchId = 'classic-death'
    const result = { kind: 'canceled', reason: 'disconnect', refundEligible: true } as const
    const base = { matchId, seed: 1, engineVersion: 'wallet-rush-7', ticks: 1550, finalBanked: 0,
      status: 'playing', outcome: 'canceled' } as const
    const record: MatchRecord = { matchId, result, runs: [{
      ...base, playerId: 'a', alternateLayout: false, inputs: [{ tick: 1, direction: 'up' }], banking: [],
      deaths: [{ tick: 1364, lives: 2 }], digest: '46512a73528a67aaad79281bf791f556676df0e48e7878bba44d1164db622307',
    }, {
      ...base, playerId: 'b', alternateLayout: true, inputs: [], banking: [],
      deaths: [{ tick: 1166, lives: 2 }, { tick: 1526, lives: 1 }],
      digest: 'c8c455154532e47ba26ae6ef9e51ba98f529986175303585464f105fc53825e4',
    }] }
    const lost = { id: 249, x: 12, y: 26 }
    expect(verifyMatchRecord(record)[0].dots).toContainEqual(lost)
    const current = buildMatchRecord(matchId, ['a', 'b'], 1, [record.runs[0].inputs, []], [1550, 1550], result)
    expect(current.runs[0].deaths).toEqual(record.runs[0].deaths)
    expect(verifyMatchRecord(current)[0].dots).not.toContainEqual(lost)
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
