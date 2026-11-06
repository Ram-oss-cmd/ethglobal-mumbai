export const MAZE = [
  '#######################',
  '#.....................#',
  '#.###.#######.#######.#',
  '#.###.............###.#',
  '#.#######.#.#####.###.#',
  '#.........#.#####.....#',
  '#.#.#######.#######.#.#',
  '#.#.....#.....#.....#.#',
  '#.#####.#.#D#.#.#####.#',
  ' .........GGG......... ',
  '#.###.###.#.#.###.###.#',
  '#.#.................#.#',
  '#...#.###.###.###.#.#.#',
  '#.###.###..P..###.#...#',
  '#...#....##.##....#.#.#',
  '#.#.####.##.##.####.#.#',
  '#.....................#',
  '###########V###########',
  '#######################',
] as const

export type Direction = 'up' | 'left' | 'down' | 'right'

export const DIRECTIONS: readonly Direction[] = ['up', 'left', 'down', 'right']
export const VECTORS: Record<Direction, readonly [number, number]> = {
  up: [0, -1],
  left: [-1, 0],
  down: [0, 1],
  right: [1, 0],
}
export const OPPOSITE: Record<Direction, Direction> = {
  up: 'down',
  left: 'right',
  down: 'up',
  right: 'left',
}
export const WIDTH = MAZE[0].length
export const TUNNEL_ROW = 9
const tiles = MAZE.join('')

export function point(tile: number) {
  return { x: tile % WIDTH, y: Math.floor(tile / WIDTH) }
}

export const START_TILE = tiles.indexOf('P')
const DOOR_TILE = tiles.indexOf('D')
export const HOME_TILE = DOOR_TILE + WIDTH
export const VAULT_TILE = tiles.indexOf('V')
export const VAULT = point(VAULT_TILE)
export const GHOST_HOME = point(HOME_TILE)
export const COLLECTIBLE_TILES = [...tiles].flatMap((cell, tile) => cell === '.' ? [tile] : [])
export const PELLET_COUNT = 4
export const TOTAL_DOTS = COLLECTIBLE_TILES.length - PELLET_COUNT

export function inGhostHouse(tile: number) {
  return tiles[tile] === 'G' || tile === DOOR_TILE
}

export function nextTile(tile: number, direction: Direction, allowVault = false) {
  const { x, y } = point(tile)
  const [dx, dy] = VECTORS[direction]
  const nextY = y + dy
  let nextX = x + dx
  if (nextY === TUNNEL_ROW) nextX = (nextX + WIDTH) % WIDTH
  const cell = MAZE[nextY]?.[nextX]
  if (!cell || cell === '#' || (!allowVault && cell === 'V')) return null
  const destination = nextY * WIDTH + nextX
  if (inGhostHouse(tile) !== inGhostHouse(destination) &&
      (allowVault || Math.min(tile, destination) !== DOOR_TILE - WIDTH ||
       Math.max(tile, destination) !== DOOR_TILE)) return null
  return destination
}
