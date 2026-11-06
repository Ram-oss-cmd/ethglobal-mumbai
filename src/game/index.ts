import {
  bankDots, type CoinState, collectDot, createCoins, releaseDots,
  scheduleLostDots, trackRoute,
} from './coins.ts'
import { createGhosts, type Ghost, moveGhosts, touchesPlayer } from './ghosts.ts'
import {
  type Direction, nextTile, OPPOSITE, point, START_TILE, TOTAL_DOTS, VAULT_TILE,
} from './maze.ts'
import { type Actor, createActor, moveActor, occupiedTile, reverseActor } from './movement.ts'

export { type Dot } from './coins.ts'
export { type Ghost, type GhostMode } from './ghosts.ts'
export { type Direction, MAZE, VAULT, GHOST_HOME, TOTAL_DOTS } from './maze.ts'

export const TICK_MS = 10
export const RUN_MS = 90_000
export const DEATH_PAUSE_MS = 1_500
export const GHOST_EAT_PAUSE_MS = 350
const PLAYER_SPEED = 60
const RESPAWN_SHIELD_MS = 2_100
const POWER_DURATION_MS = 7_000

export type RunStatus = 'playing' | 'timeout' | 'out-of-lives' | 'full-clear'

export interface GameState extends CoinState {
  elapsedMs: number
  lives: number
  status: RunStatus
  frightenedUntilMs: number
  invulnerableUntilMs: number
  respawnAtMs: number
  ghostPauseUntilMs: number
  player: Actor
  ghosts: Ghost[]
  requestedDirection: Direction | null
  terminalRespawnMs: number
  waveMs: number
}

export function createGame(seed: number, alternateLayout = false): GameState {
  return {
    ...createCoins(seed, alternateLayout),
    elapsedMs: 0,
    lives: 3,
    status: 'playing',
    frightenedUntilMs: 0,
    invulnerableUntilMs: 0,
    respawnAtMs: 0,
    ghostPauseUntilMs: 0,
    player: createActor(START_TILE),
    ghosts: createGhosts(),
    requestedDirection: null,
    terminalRespawnMs: 0,
    waveMs: 0,
  }
}

export function loseLife(state: GameState) {
  state.lives--
  scheduleLostDots(state, state.elapsedMs, TICK_MS)
  state.requestedDirection = null
  state.respawnAtMs = Math.min(RUN_MS, state.elapsedMs + DEATH_PAUSE_MS)
}

function finishTick(state: GameState) {
  if (state.status === 'playing' && state.elapsedMs === RUN_MS) state.status = 'timeout'
  if (state.queuedDots.length === 0) return
  const occupied = state.status === 'playing' ? [occupiedTile(state.player), ...state.ghosts.map(occupiedTile)] : []
  releaseDots(state, state.elapsedMs, occupied)
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
  if (state.respawnAtMs > 0) {
    if (state.elapsedMs === state.respawnAtMs) {
      state.respawnAtMs = 0
      if (state.lives === 0) state.status = 'out-of-lives'
      else if (state.elapsedMs < RUN_MS) {
        state.player = createActor(START_TILE)
        state.invulnerableUntilMs = state.elapsedMs + RESPAWN_SHIELD_MS
      }
    }
    finishTick(state)
    return
  }
  if (input) state.requestedDirection = input
  if (state.ghostPauseUntilMs > 0) {
    if (state.elapsedMs === state.ghostPauseUntilMs) state.ghostPauseUntilMs = 0
    finishTick(state)
    return
  }
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
      if (ghost.mode === 'frightened') {
        ghost.mode = 'returning'
        state.ghostPauseUntilMs = state.elapsedMs + GHOST_EAT_PAUSE_MS
        // The celebration consumes match time, but preserves the remaining power-up.
        state.frightenedUntilMs += GHOST_EAT_PAUSE_MS
        break
      }
      if ((ghost.mode === 'chase' || ghost.mode === 'scatter') && state.elapsedMs >= state.invulnerableUntilMs) {
        loseLife(state)
        break
      }
    }
  }

  if (state.elapsedMs === RUN_MS && state.lives === 0) state.status = 'out-of-lives'
  finishTick(state)
}
