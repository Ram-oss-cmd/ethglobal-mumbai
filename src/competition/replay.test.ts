import { describe, expect, it } from 'vitest'
import { createGame, TOTAL_DOTS } from '../game'
import { buildMatchRecord, decideMatch, verifyMatchRecord } from './replay'
import { replayRun } from './run'

describe('deterministic match verification', () => {
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
    expect(record.runs[0].banking).toEqual([{ tick: 55, banked: 3 }])
    const forged = structuredClone(record)
    forged.runs[0].finalBanked = 4
    expect(() => verifyMatchRecord(forged)).toThrow()
    forged.runs[0].finalBanked = 3
    forged.runs[0].banking[0].tick = 56
    expect(() => verifyMatchRecord(forged)).toThrow()
    forged.runs[0].banking[0].tick = 55
    forged.runs[0].digest = forged.runs[1].digest
    expect(() => verifyMatchRecord(forged)).toThrow()
  })

  it('rejects duplicate, invalid and out-of-range input ticks', () => {
    expect(() => replayRun(0, [{ tick: 0, direction: 'up' }], 5)).toThrow()
    expect(() => replayRun(0, [{ tick: 2, direction: 'up' }, { tick: 2, direction: 'down' }], 5)).toThrow()
    expect(() => replayRun(0, [{ tick: 6, direction: 'up' }], 5)).toThrow()
    expect(() => replayRun(0, [], 9_001)).toThrow()
  })
})
