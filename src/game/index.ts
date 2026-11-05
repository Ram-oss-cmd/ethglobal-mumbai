import {
  bankDots, type CoinState, collectDot, createCoins, releaseDots,
  RESPAWN_MAX_MS, scheduleLostDots, trackRoute,
} from './coins'
import { createGhosts, type Ghost, moveGhosts, touchesPlayer } from './ghosts'
import {
  type Direction, nextTile, OPPOSITE, point, START_PELLETS, START_TILE, TOTAL_DOTS, VAULT_TILE,
} from './maze'
import { type Actor, createActor, moveActor, reverseActor } from './movement'

export { type Dot } from './coins'
export { type Ghost, type GhostMode } from './ghosts'
export { type Direction, MAZE, VAULT, GHOST_HOME, TOTAL_DOTS } from './maze'

export const TICK_MS = 10
export const RUN_MS = 90_000
const PLAYER_SPEED = 80
const RESPAWN_SHIELD_MS = 1_200
const POWER_DURATION_MS = 7_000

export type RunStatus = 'playing' | 'timeout' | 'out-of-lives' | 'full-clear'

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
  waveMs: number
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
    ghosts: createGhosts(0),
    pellets: START_PELLETS.map(point),
    requestedDirection: null,
    frozenUntilMs: 0,
    terminalRespawnMs: 0,
    waveMs: 0,
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
  state.ghosts = createGhosts(state.frozenUntilMs)
  state.waveMs = 0
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
        const { x, y } = point(tile)
        const pellet = state.pellets.findIndex(pickup => pickup.x === x && pickup.y === y)
        if (pellet !== -1) {
          state.pellets.splice(pellet, 1)
          state.frightenedUntilMs = state.elapsedMs + POWER_DURATION_MS
        }
      },
    })
    if (state.status === 'playing') {
      moveGhosts(state, TICK_MS)
      for (const ghost of state.ghosts) {
        if (!touchesPlayer(ghost, player)) continue
        if (ghost.mode === 'frightened') ghost.mode = 'returning'
        if ((ghost.mode === 'chase' || ghost.mode === 'scatter') && state.elapsedMs >= state.invulnerableUntilMs) {
          loseLife(state)
          break
        }
      }
    }
  }

  if (state.status === 'playing' && state.elapsedMs === RUN_MS) state.status = 'timeout'
}