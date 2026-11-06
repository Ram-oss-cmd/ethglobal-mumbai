import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { GameState } from '../game'
import { ENGINE_VERSION, type MatchRecord, type MatchResult, type Outcome, type RunRecord, type Seat } from './protocol'
import { replayRun } from './run'

export function decideMatch([first, second]: [GameState, GameState]): MatchResult | undefined {
  if (first.status === 'full-clear' || second.status === 'full-clear') {
    if (first.status !== 'full-clear') return { kind: 'win', winner: 1, reason: 'full-clear' }
    if (second.status !== 'full-clear') return { kind: 'win', winner: 0, reason: 'full-clear' }
    if (first.elapsedMs === second.elapsedMs) return { kind: 'draw', reason: 'full-clear' }
    return { kind: 'win', winner: first.elapsedMs < second.elapsedMs ? 0 : 1, reason: 'full-clear' }
  }
  if (first.status === 'playing' || second.status === 'playing') return
  if (first.banked === second.banked) return { kind: 'draw', reason: 'banked' }
  return { kind: 'win', winner: first.banked > second.banked ? 0 : 1, reason: 'banked' }
}

function reconstruct(
  matchId: string,
  playerIds: [string, string],
  seed: number,
  streams: [RunRecord['inputs'], RunRecord['inputs']],
  ticks: [number, number],
  result: MatchResult,
): { record: MatchRecord; states: [GameState, GameState] } {
  if (typeof matchId !== 'string' || !matchId ||
      playerIds.some(id => typeof id !== 'string' || !id) || playerIds[0] === playerIds[1]) {
    throw new Error('Invalid replay identity')
  }
  function run(seat: Seat) {
    const inputs = streams[seat]
    const banking: RunRecord['banking'] = []
    const deaths: RunRecord['deaths'] = []
    let previousBanked = 0
    let previousLives = 3
    const state = replayRun(seed, inputs, ticks[seat], (game, tick) => {
      if (game.banked !== previousBanked) banking.push({ tick, banked: game.banked })
      if (game.lives !== previousLives) deaths.push({ tick, lives: game.lives })
      previousBanked = game.banked
      previousLives = game.lives
    })
    const outcome: Outcome = result.kind === 'win' ? result.winner === seat ? 'win' : 'loss' : result.kind
    const body: Omit<RunRecord, 'digest'> = {
      matchId, playerId: playerIds[seat], seed, engineVersion: ENGINE_VERSION, ticks: ticks[seat],
      inputs: inputs.map(({ tick, direction }) => ({ tick, direction })),
      banking, deaths, finalBanked: state.banked, status: state.status, outcome,
    }
    const digest = createHash('sha256').update(JSON.stringify(body)).digest('hex')
    return { state, record: { ...body, digest } }
  }

  const first = run(0)
  const second = run(1)
  const states: [GameState, GameState] = [first.state, second.state]
  const stopTick = Math.max(...ticks)
  const decision = decideMatch(states)
  if (states.some((state, seat) =>
    (state.status === 'playing' || state.status === 'full-clear') && ticks[seat] !== stopTick
  )) throw new Error('Runs did not stop on the same decisive tick')
  const expected = decision ?? { kind: 'canceled', reason: 'disconnect', refundEligible: true }
  if (!isDeepStrictEqual(expected, result)) throw new Error('Replay outcome differs from server result')
  return { states, record: { matchId, result, runs: [first.record, second.record] } }
}

export function buildMatchRecord(
  matchId: string,
  playerIds: [string, string],
  seed: number,
  streams: [RunRecord['inputs'], RunRecord['inputs']],
  ticks: [number, number],
  result: MatchResult,
) {
  return reconstruct(matchId, playerIds, seed, streams, ticks, result).record
}

/** Verify event logs, scores, timing, identities and digests by simulating both runs again. */
export function verifyMatchRecord(record: MatchRecord) {
  if (!Array.isArray(record?.runs) || record.runs.length !== 2) throw new Error('Expected two replay runs')
  const [first, second] = record.runs
  const replay = reconstruct(
    record.matchId, [first.playerId, second.playerId], first.seed,
    [first.inputs, second.inputs], [first.ticks, second.ticks], record.result,
  )
  if (!isDeepStrictEqual(replay.record, record)) throw new Error('Replay record differs from reconstructed record')
  return replay.states
}
