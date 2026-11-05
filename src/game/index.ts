import {
  bankDots, type CoinState, collectDot, createCoins, releaseDots,
  RESPAWN_MAX_MS, scheduleLostDots, trackRoute,
} from './coins'
import {
  type Direction, nextTile, OPPOSITE, point, START_PELLETS, START_TILE, TOTAL_DOTS, VAULT_TILE,
} from './maze'
import { type Actor, createActor, moveActor, reverseActor } from './movement'

export { type Dot } from './coins'
export { type Direction, MAZE, VAULT, GHOST_HOME, TOTAL_DOTS } from './maze'

export const TICK_MS = 10
export const RUN_MS = 90_000
const PLAYER_SPEED = 80
const RESPAWN_SHIELD_MS = 1_200

export type RunStatus = 'playing' | 'timeout' | 'out-of-lives' | 'full-clear'
export type GhostMode = 'chase' | 'scatter' | 'frightened' | 'returning' | 'recovering'
export type Ghost = Actor & { id: string; mode: GhostMode }

export interface GameState extends CoinState {
  elapsedMs: number
  lives: number
  status: RunStatus
  frightenedUntilMs: number
  invulnerableUntilMs: number
  player: Actor
  ghosts: Ghost[]
  pellets: ReturnType<typeof point>[]
  requestedDirection: Direction | null
  frozenUntilMs: number
  terminalRespawnMs: number
}

export function createGame(seed: number): GameState {
  return {
    ...createCoins(seed),
    elapsedMs: 0,
    lives: 3,
    status: 'playing',
    frightenedUntilMs: 0,
    invulnerableUntilMs: 0,
    player: createActor(START_TILE),
    ghosts: [],
    pellets: START_PELLETS.map(point),
    requestedDirection: null,
    frozenUntilMs: 0,
    terminalRespawnMs: 0,
  }
}

export function loseLife(state: GameState) {
  state.lives--
  scheduleLostDots(state, state.elapsedMs, TICK_MS)
  state.player = createActor(START_TILE)
  state.requestedDirection = null
  state.frightenedUntilMs = 0
  state.frozenUntilMs = state.elapsedMs + RESPAWN_MAX_MS
  state.invulnerableUntilMs = state.frozenUntilMs + RESPAWN_SHIELD_MS
  if (state.lives === 0) state.status = 'out-of-lives'
}

export function stepGame(state: GameState, input?: Direction) {
  if (state.status !== 'playing') {
    if (state.queuedDots.length > 0) {
      state.terminalRespawnMs += TICK_MS
      releaseDots(state, state.elapsedMs + state.terminalRespawnMs)
    }
    return
  }
  state.elapsedMs += TICK_MS
  if (input) state.requestedDirection = input
  releaseDots(state, state.elapsedMs)

  if (state.elapsedMs >= state.frozenUntilMs) {
    const { player, requestedDirection } = state
    if (player.direction && requestedDirection === OPPOSITE[player.direction]) reverseActor(player)
    moveActor(player, PLAYER_SPEED, tile => {
      if (requestedDirection && nextTile(tile, requestedDirection, true) !== null) {
        return requestedDirection
      }
      return player.direction
    }, true, {
      onCross(_, to) {
        trackRoute(state, to)
        if (to === VAULT_TILE) {
          bankDots(state)
          if (state.banked === TOTAL_DOTS) {
            state.status = 'full-clear'
            return false
          }
        }
      },
      onArrival(tile) {
        collectDot(state, tile)
      },
    })
  }

  if (state.status === 'playing' && state.elapsedMs === RUN_MS) state.status = 'timeout'
}