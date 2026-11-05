import {
  type Direction, nextTile, OPPOSITE, point, START_DOTS, START_PELLETS, START_TILE,
} from './maze'
import { type Actor, createActor, moveActor, reverseActor } from './movement'

export { type Direction, MAZE, VAULT, GHOST_HOME, TOTAL_DOTS } from './maze'

export const TICK_MS = 10
export const RUN_MS = 90_000
const PLAYER_SPEED = 80

export type RunStatus = 'playing' | 'timeout' | 'out-of-lives' | 'full-clear'
export type GhostMode = 'chase' | 'scatter' | 'frightened' | 'returning' | 'recovering'
export type Ghost = Actor & { id: string; mode: GhostMode }
export type Dot = ReturnType<typeof point> & { id: number }

export interface GameState {
  elapsedMs: number
  lives: number
  carried: number
  banked: number
  status: RunStatus
  frightenedUntilMs: number
  invulnerableUntilMs: number
  player: Actor
  ghosts: Ghost[]
  dots: Dot[]
  pellets: ReturnType<typeof point>[]
  requestedDirection: Direction | null
  randomState: number
}

export function createGame(seed: number): GameState {
  return {
    elapsedMs: 0,
    lives: 3,
    carried: 0,
    banked: 0,
    status: 'playing',
    frightenedUntilMs: 0,
    invulnerableUntilMs: 0,
    player: createActor(START_TILE),
    ghosts: [],
    dots: START_DOTS.map((tile, id) => ({ id, ...point(tile) })),
    pellets: START_PELLETS.map(point),
    requestedDirection: null,
    randomState: seed >>> 0,
  }
}

export function stepGame(state: GameState, input?: Direction) {
  if (state.status !== 'playing') return
  state.elapsedMs += TICK_MS
  if (input) state.requestedDirection = input

  const { player, requestedDirection } = state
  if (player.direction && requestedDirection === OPPOSITE[player.direction]) reverseActor(player)
  moveActor(player, PLAYER_SPEED, tile => {
    if (requestedDirection && nextTile(tile, requestedDirection, true) !== null) {
      return requestedDirection
    }
    return player.direction
  }, true)

  if (state.elapsedMs === RUN_MS) state.status = 'timeout'
}