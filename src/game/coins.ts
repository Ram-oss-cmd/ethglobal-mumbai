import { COLLECTIBLE_TILES, MAZE, PELLET_COUNT, point, START_TILE, VAULT_TILE, WIDTH } from './maze.ts'
import { randomIndex } from './random.ts'

export type Dot = ReturnType<typeof point> & { id: number }
type QueuedDot = Dot & { atMs: number }

export const RESPAWN_MIN_MS = 600
export const RESPAWN_MAX_MS = 900

export interface CoinState {
  carried: number
  banked: number
  dots: Dot[]
  pellets: ReturnType<typeof point>[]
  carriedDots: Dot[]
  retiredTiles: number[]
  route: number[]
  queuedDots: QueuedDot[]
  randomState: number
}

const pelletZones: number[][] = Array.from({ length: PELLET_COUNT }, () => [])
for (const tile of COLLECTIBLE_TILES) {
  const { x, y } = point(tile)
  const center = Math.floor(WIDTH / 2)
  // Leave the outer corners and the direct vault lane free of power-ups.
  if (x <= 1 || x >= WIDTH - 2 || x === center) continue
  const zone = (y < MAZE.length / 2 ? 0 : 2) + Number(x > center)
  pelletZones[zone].push(tile)
}

export function createCoins(seed: number, alternateLayout = false): CoinState {
  // The second seat picks a different tile in every quadrant without changing the common game seed.
  const layout = { randomState: seed >>> 0 }
  const alternate = { randomState: (seed ^ 0x52555348) >>> 0 }
  const pelletTiles = pelletZones.map(zone => {
    const first = randomIndex(layout, zone.length)
    const index = alternateLayout ? (first + 1 + randomIndex(alternate, zone.length - 1)) % zone.length : first
    return zone[index]
  })
  return {
    carried: 0,
    banked: 0,
    dots: COLLECTIBLE_TILES.filter(tile => !pelletTiles.includes(tile)).map((tile, id) => ({ id, ...point(tile) })),
    pellets: pelletTiles.map(point),
    carriedDots: [],
    retiredTiles: [],
    route: [START_TILE],
    queuedDots: [],
    randomState: seed >>> 0,
  }
}

function tileOf({ x, y }: ReturnType<typeof point>) {
  return y * WIDTH + x
}

export function collectDot(state: CoinState, tile: number) {
  const dotIndex = state.dots.findIndex(dot => tileOf(dot) === tile)
  if (dotIndex < 0) return

  const [dot] = state.dots.splice(dotIndex, 1)
  state.carriedDots.push(dot)
  state.carried = state.carriedDots.length
}

export function trackRoute(state: CoinState, tile: number) {
  if (tile !== VAULT_TILE && !state.route.includes(tile)) state.route.push(tile)
}

export function bankDots(state: CoinState) {
  if (state.carried === 0) return

  state.banked += state.carriedDots.length
  state.retiredTiles.push(...state.carriedDots.map(tileOf))
  state.carriedDots = []
  state.carried = 0
  state.route = []
}

export function scheduleLostDots(state: CoinState, elapsedMs: number, tickMs: number) {
  if (state.carriedDots.length === 0) return

  // Every carried dot vacated a unique eligible route tile, so there is room to reserve all of them.
  const reserved = new Set([
    VAULT_TILE, START_TILE, ...state.pellets.map(tileOf),
    ...state.retiredTiles, ...state.dots.map(tileOf), ...state.queuedDots.map(tileOf),
  ])
  const choices = state.route.filter(tile => !reserved.has(tile))
  const delayChoices = (RESPAWN_MAX_MS - RESPAWN_MIN_MS) / tickMs + 1
  const schedule: QueuedDot[] = []
  for (const dot of state.carriedDots) {
    const [tile] = choices.splice(randomIndex(state, choices.length), 1)
    const atMs = elapsedMs + RESPAWN_MIN_MS + tickMs * randomIndex(state, delayChoices)
    schedule.push({ id: dot.id, ...point(tile), atMs })
  }
  // If the independent draws coincide for the whole batch, stagger its final dot.
  if (schedule.length > 1 && schedule.every(dot => dot.atMs === schedule[0].atMs)) {
    const final = schedule[schedule.length - 1]
    const firstDelayIndex = (final.atMs - elapsedMs - RESPAWN_MIN_MS) / tickMs
    const offset = 1 + randomIndex(state, delayChoices - 1)
    final.atMs = elapsedMs + RESPAWN_MIN_MS + tickMs * ((firstDelayIndex + offset) % delayChoices)
  }

  state.queuedDots.push(...schedule)
  state.carriedDots = []
  state.carried = 0
}

export function releaseDots(state: CoinState, elapsedMs: number, occupied: readonly number[] = []) {
  state.queuedDots = state.queuedDots.filter(({ atMs, ...dot }) => {
    // A moving actor can briefly occupy a reserved tile when its dot is due.
    if (atMs > elapsedMs || occupied.includes(tileOf(dot))) return true
    state.dots.push(dot)
    return false
  })
}
