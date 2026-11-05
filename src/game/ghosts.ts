import {
  DIRECTIONS, type Direction, HOME_TILE, MAZE, nextTile, OPPOSITE, point, VAULT,
  VAULT_TILE, VECTORS, WIDTH,
} from './maze'
import { type Actor, createActor, moveActor, occupiedTile, reverseActor } from './movement'
import { randomIndex } from './random'

export type GhostMode = 'chase' | 'scatter' | 'frightened' | 'returning' | 'recovering'
type GhostId = 'tracer' | 'snare' | 'relay' | 'warden'
type Point = ReturnType<typeof point>

export interface Ghost extends Actor {
  id: GhostId
  mode: GhostMode
  readyAtMs: number
}

interface GhostContext {
  elapsedMs: number
  frightenedUntilMs: number
  waveMs: number
  randomState: number
  player: Actor
  ghosts: Ghost[]
}

const roster = {
  tracer: { corner: { x: WIDTH - 2, y: 1 }, speed: 56, releaseMs: 0 },
  snare: { corner: { x: 1, y: 1 }, speed: 52, releaseMs: 450 },
  relay: { corner: { x: WIDTH - 2, y: MAZE.length - 3 }, speed: 51, releaseMs: 900 },
  warden: { corner: { x: 1, y: MAZE.length - 3 }, speed: 49, releaseMs: 1_350 },
} satisfies Record<GhostId, { corner: Point; speed: number; releaseMs: number }>

const cells = MAZE.join('')
const corridors = [...cells].flatMap((cell, tile) => cell !== '#' && cell !== 'V' ? [tile] : [])
const exits = new Map(corridors.map(tile => [
  tile,
  DIRECTIONS.flatMap(direction => {
    const destination = nextTile(tile, direction)
    return destination === null ? [] : [{ direction, destination }]
  }),
]))

// Shortest paths follow the same tunnel and vault rules as actor movement.
const routes = new Map(corridors.map(target => {
  const distances = new Uint16Array(cells.length).fill(0xffff)
  const queue = [target]
  distances[target] = 0
  for (let index = 0; index < queue.length; index++) {
    const tile = queue[index]
    for (const { destination } of exits.get(tile)!) {
      if (distances[destination] !== 0xffff) continue
      distances[destination] = distances[tile] + 1
      queue.push(destination)
    }
  }
  return [target, distances]
}))

export function createGhosts(): Ghost[] {
  return (Object.keys(roster) as GhostId[]).map(id => ({
    ...createActor(HOME_TILE),
    id,
    mode: 'recovering',
    readyAtMs: roster[id].releaseMs,
  }))
}

function normalMode(waveMs: number) {
  if (waveMs < 5_000 || (waveMs >= 20_000 && waveMs < 24_000) || (waveMs >= 44_000 && waveMs < 48_000)) {
    return 'scatter'
  }
  return 'chase'
}

function aim(ghost: Ghost, state: GhostContext): Point {
  if (ghost.mode === 'scatter') return roster[ghost.id].corner

  const playerTile = occupiedTile(state.player)
  const player = playerTile === VAULT_TILE ? { x: VAULT.x, y: VAULT.y - 1 } : point(playerTile)
  const [dx, dy] = state.player.direction ? VECTORS[state.player.direction] : [0, 0]
  switch (ghost.id) {
    case 'tracer':
      return player
    case 'snare':
      return { x: player.x + 3 * dx, y: player.y + 3 * dy }
    case 'relay': {
      const tracer = state.ghosts[0]
      return { x: 2 * (player.x + dx) - tracer.x, y: 2 * (player.y + dy) - tracer.y }
    }
    case 'warden':
      return (ghost.x - player.x) ** 2 + (ghost.y - player.y) ** 2 <= 25 ? roster.warden.corner : player
  }
}

function nearestCorridor(target: Point) {
  const x = Math.min(WIDTH - 1, Math.max(0, Math.round(target.x)))
  const y = Math.min(MAZE.length - 1, Math.max(0, Math.round(target.y)))
  const cell = y * WIDTH + x
  if (routes.has(cell)) return cell

  let nearest = corridors[0]
  let shortest = Infinity
  for (const tile of corridors) {
    const candidate = point(tile)
    const distance = Math.abs(candidate.x - x) + Math.abs(candidate.y - y)
    if (distance < shortest) {
      shortest = distance
      nearest = tile
    }
  }
  return nearest
}

function chooseDirection(ghost: Ghost, tile: number, state: GhostContext): Direction {
  const options = exits.get(tile)!
  const reverse = ghost.direction === null ? null : OPPOSITE[ghost.direction]
  const forward = options.filter(exit => exit.direction !== reverse)
  const choices = ghost.mode === 'returning' || forward.length === 0 ? options : forward
  if (choices.length === 1) return choices[0].direction
  if (ghost.mode === 'frightened') return choices[randomIndex(state, choices.length)].direction

  const target = ghost.mode === 'returning' ? HOME_TILE : nearestCorridor(aim(ghost, state))
  const distances = routes.get(target)!
  return choices.reduce((best, next) =>
    distances[next.destination] < distances[best.destination] ? next : best,
  ).direction
}

function recover(ghost: Ghost, state: GhostContext) {
  ghost.mode = 'recovering'
  ghost.direction = null
  ghost.readyAtMs = Math.max(state.elapsedMs + 700, state.frightenedUntilMs)
}

export function moveGhosts(state: GhostContext, tickMs: number) {
  const frightened = state.elapsedMs < state.frightenedUntilMs
  if (!frightened) state.waveMs += tickMs
  const wave = frightened ? 'frightened' : normalMode(state.waveMs)

  for (const ghost of state.ghosts) {
    if (ghost.mode === 'recovering' && state.elapsedMs < ghost.readyAtMs) continue
    let reverseAtCenter: Direction | null = null
    if (ghost.mode !== 'returning' && ghost.mode !== wave) {
      if (ghost.direction && ghost.mode !== 'frightened') {
        if (ghost.destination === null) reverseAtCenter = OPPOSITE[ghost.direction]
        else reverseActor(ghost)
      }
      ghost.mode = wave
    }

    const speed = ghost.mode === 'returning' ? 92 : ghost.mode === 'frightened' ? 37 : roster[ghost.id].speed
    moveActor(ghost, speed, tile => {
      if (ghost.mode === 'returning' && tile === HOME_TILE) recover(ghost, state)
      if (ghost.mode === 'recovering') return null
      if (reverseAtCenter && nextTile(tile, reverseAtCenter) !== null) return reverseAtCenter
      return chooseDirection(ghost, tile, state)
    }, false, {
      onArrival(tile) {
        if (ghost.mode === 'returning' && tile === HOME_TILE) recover(ghost, state)
      },
    })
  }
}

export function touchesPlayer(ghost: Ghost, player: Actor) {
  if (occupiedTile(player) === VAULT_TILE) return false
  const dx = Math.abs(ghost.x - player.x)
  const dy = ghost.y - player.y
  return Math.min(dx, WIDTH - dx) ** 2 + dy ** 2 <= 0.62 ** 2
}
