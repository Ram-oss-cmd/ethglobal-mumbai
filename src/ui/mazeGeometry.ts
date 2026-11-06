import { HOME_TILE, MAZE, point, WIDTH as COLUMNS } from '../game/maze.ts'

export const TILE_WIDTH = 60
export const TILE_HEIGHT = 54
export const BOARD_WIDTH = COLUMNS * TILE_WIDTH
export const BOARD_HEIGHT = MAZE.length * TILE_HEIGHT
export const BOARD_ASPECT = BOARD_WIDTH / BOARD_HEIGHT
export const WALL_STROKE = 4
export const PLAYER_SIZE = 106

const LANE_WIDTH = 100
const insetX = (LANE_WIDTH - TILE_WIDTH) / 2
const insetY = (LANE_WIDTH - TILE_HEIGHT) / 2
const reach = Math.max(insetX, insetY) + 1

type Point = readonly [number, number]
type Vertex = { point: Point; links: Set<Vertex> }

const door = point(HOME_TILE - COLUMNS)
const gateY = door.y * TILE_HEIGHT + insetY
export const gate: readonly [Point, Point] = [
  [door.x * TILE_WIDTH - insetX, gateY],
  [(door.x + 1) * TILE_WIDTH + insetX, gateY],
]

/** Trace the collision grid into continuous wall paths with a shared stroke and lane width. */
function traceWalls() {
  const vertices = new Map<string, Vertex>()
  function vertex(point: Point) {
    const key = point.join(',')
    const existing = vertices.get(key)
    if (existing) return existing
    const next: Vertex = { point, links: new Set() }
    vertices.set(key, next)
    return next
  }
  function link(a: Point, b: Point) {
    const first = vertex(a)
    const second = vertex(b)
    if (first === second) return
    first.links.add(second)
    second.links.add(first)
  }
  function wall(x: number, y: number) {
    // Continue wall edges to the sides of the canvas at the wrap tunnel.
    const cell = MAZE[y]?.[Math.max(0, Math.min(x, COLUMNS - 1))] ?? '#'
    return cell === '#' || cell === 'G'
  }
  for (let y = 0; y <= MAZE.length; y++) {
    for (let x = 0; x <= COLUMNS; x++) {
      const left = x * TILE_WIDTH
      const top = y * TILE_HEIGHT
      const cells = [wall(x - 1, y - 1), wall(x, y - 1), wall(x, y), wall(x - 1, y)]
      const edges = cells.map((cell, i) => cell !== cells[(i + 1) % 4])
      const ports: Point[] = [
        [left + (cells[0] ? -insetX : insetX), top - reach],
        [left + reach, top + (cells[1] ? -insetY : insetY)],
        [left + (cells[2] ? insetX : -insetX), top + reach],
        [left - reach, top + (cells[3] ? insetY : -insetY)],
      ]
      if (edges[1] && x < COLUMNS) link(ports[1], [left + TILE_WIDTH - reach, ports[1][1]])
      if (edges[2] && y < MAZE.length) link(ports[2], [ports[2][0], top + TILE_HEIGHT - reach])
      function join(a: number, b: number) {
        const from = ports[a]
        const to = ports[b]
        if (a % 2 === b % 2) return link(from, to)
        const corner: Point = a % 2 ? [to[0], from[1]] : [from[0], to[1]]
        link(from, corner)
        link(corner, to)
      }
      const joins = [0, 1, 2, 3].filter(i => edges[i])
      if (joins.length === 2) join(joins[0], joins[1])
      if (joins.length === 4) cells.forEach((blocked, i) => { if (blocked) join((i + 3) % 4, i) })
    }
  }

  const paths: Point[][] = []
  const nodes = [...vertices.values()]
  // Walk the open tunnel edges first, then the closed outlines.
  for (const start of [...nodes.filter(node => node.links.size === 1), ...nodes]) {
    if (!start.links.size) continue
    const path = [start.point]
    let current = start
    while (current.links.size) {
      const next = current.links.values().next().value!
      current.links.delete(next)
      next.links.delete(current)
      path.push(next.point)
      current = next
      if (current === start) break
    }
    paths.push(path)
  }
  return paths
}

export const wallPaths = traceWalls()
