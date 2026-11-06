const legacyRows = [
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

const rows = [
  '#################################',
  '#.oo.........................oo.#',
  '#.###.####.#####.#####.####.###.#',
  '#.###.####.#####.#####.####.###.#',
  '#.....##...#####.#####...##.....#',
  '#.######.#.#####.#####.#.######.#',
  '#.######.#.#####.#####.#.######.#',
  ' ............................... ',
  '#.####.######.##.##.######.####.#',
  '#.####.######.##.##.######.####.#',
  '#.####........##D##........####.#',
  '#.#####.##.###GGGGG###.##.#####.#',
  '#.#####.##.###########.##.#####.#',
  ' ............................... ',
  '#.#.#.###.##.###.###.##.###.#.#.#',
  '#.#.#.###.##.###.###.##.###.#.#.#',
  '#.........##.........##.........#',
  '#.#.####.###.###P###.###.####.#.#',
  '#.#.####.###.###.###.###.####.#.#',
  '#.oo.........................oo.#',
  '################.################',
  '################V################',
  '#################################',
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
function createMaze(rows: readonly string[]) {
  const width = rows[0].length
  const tunnels = rows.flatMap((row, y) => row.startsWith(' ') && row.endsWith(' ') ? [y] : [])
  const tiles = rows.join('')
  const start = tiles.indexOf('P')
  const door = tiles.indexOf('D')
  const home = door + width
  const vaultTile = tiles.indexOf('V')
  const collectibleTiles = [...tiles].flatMap((cell, tile) => '.o'.includes(cell) ? [tile] : [])

  function point(tile: number) {
    return { x: tile % width, y: Math.floor(tile / width) }
  }

  function inGhostHouse(tile: number) {
    return tiles[tile] === 'G' || tile === door
  }

  function nextTile(tile: number, direction: Direction, allowVault = false) {
    const { x, y } = point(tile)
    const [dx, dy] = VECTORS[direction]
    const nextY = y + dy
    let nextX = x + dx
    if (tunnels.includes(nextY)) nextX = (nextX + width) % width
    const cell = rows[nextY]?.[nextX]
    if (!cell || cell === '#' || (!allowVault && cell === 'V')) return null
    const destination = nextY * width + nextX
    if (inGhostHouse(tile) !== inGhostHouse(destination) &&
        (allowVault || Math.min(tile, destination) !== door - width ||
         Math.max(tile, destination) !== door)) return null
    return destination
  }

  return {
    rows, width, tunnels, tiles, start, door, home, vaultTile, vault: point(vaultTile),
    collectibleTiles, totalDots: collectibleTiles.length - PELLET_COUNT, point, inGhostHouse, nextTile,
  }
}

export const PELLET_COUNT = 4
export const CURRENT_MAZE = createMaze(rows)
export const LEGACY_MAZE = createMaze(legacyRows)
export type Maze = ReturnType<typeof createMaze>
export const {
  rows: MAZE, width: WIDTH, start: START_TILE, home: HOME_TILE, vaultTile: VAULT_TILE, vault: VAULT,
  collectibleTiles: COLLECTIBLE_TILES, totalDots: TOTAL_DOTS, point, inGhostHouse, nextTile,
} = CURRENT_MAZE
export const GHOST_HOME = point(HOME_TILE)
export const TUNNEL_ROW = CURRENT_MAZE.tunnels[0]
