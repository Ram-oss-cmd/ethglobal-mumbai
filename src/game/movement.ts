import { CURRENT_MAZE, type Direction, type Maze, OPPOSITE, VECTORS } from './maze.ts'

const TILE_UNITS = 1_000
const HALF_TILE = TILE_UNITS / 2

export interface Actor {
  x: number
  y: number
  direction: Direction | null
  tile: number
  destination: number | null
  progress: number
}

export function createActor(tile: number, maze = CURRENT_MAZE): Actor {
  return { ...maze.point(tile), direction: null, tile, destination: null, progress: 0 }
}

export function reverseActor(actor: Actor) {
  if (actor.destination === null || actor.direction === null) return
  const from = actor.tile
  actor.tile = actor.destination
  actor.destination = from
  actor.progress = TILE_UNITS - actor.progress
  actor.direction = OPPOSITE[actor.direction]
}

export function moveActor(
  actor: Actor,
  budget: number,
  choose: (tile: number) => Direction | null,
  allowVault = false,
  hooks?: {
    onCross?: (from: number, to: number) => boolean | void
    onArrival?: (tile: number) => void
  },
  maze: Maze = CURRENT_MAZE,
) {
  while (budget > 0) {
    if (actor.destination === null) {
      const direction = choose(actor.tile)
      if (direction === null) return
      const destination = maze.nextTile(actor.tile, direction, allowVault)
      if (destination === null) return
      actor.direction = direction
      actor.destination = destination
    }

    const boundary = actor.progress < HALF_TILE ? HALF_TILE : TILE_UNITS
    const advance = Math.min(budget, boundary - actor.progress)
    budget -= advance
    actor.progress += advance
    const { x, y } = maze.point(actor.tile)
    const [dx, dy] = VECTORS[actor.direction!]
    actor.x = x + dx * actor.progress / TILE_UNITS
    actor.y = y + dy * actor.progress / TILE_UNITS
    if (actor.x < -0.5) actor.x += maze.width
    if (actor.x >= maze.width - 0.5) actor.x -= maze.width

    if (actor.progress === HALF_TILE && hooks?.onCross?.(actor.tile, actor.destination) === false) return

    if (actor.progress === TILE_UNITS) {
      actor.tile = actor.destination
      actor.destination = null
      actor.progress = 0
      hooks?.onArrival?.(actor.tile)
    }
  }
}

export function occupiedTile(actor: Actor) {
  return actor.destination !== null && actor.progress >= HALF_TILE ? actor.destination : actor.tile
}
