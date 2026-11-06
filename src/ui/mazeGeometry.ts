import { CURRENT_MAZE, LEGACY_MAZE, MAZES, type Maze } from '../game/maze.ts'
import type { Actor } from '../game/movement.ts'
import { referenceWalls } from './referenceWalls'

export const TILE_WIDTH = 60
export const TILE_HEIGHT = 54
export const WALL_STROKE = 2
export const GHOST_SIZE = 58

const LANE_WIDTH = 92
const insetX = (LANE_WIDTH - TILE_WIDTH) / 2
const insetY = (LANE_WIDTH - TILE_HEIGHT) / 2
const reach = Math.max(insetX, insetY) + 1

type Point = readonly [number, number]
type Vertex = { point: Point; links: Set<Vertex> }

/** Trace the collision grid into continuous wall paths with a shared stroke and lane width. */
function traceWalls(maze: Maze) {
  const { rows: MAZE, width: COLUMNS } = maze
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
    return cell === '#' || (maze === LEGACY_MAZE && cell === 'G')
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

function geometry(maze: Maze) {
  const width = maze.width * TILE_WIDTH
  const height = maze.rows.length * TILE_HEIGHT
  const door = maze.point(maze.door)
  const gateY = door.y * TILE_HEIGHT + insetY
  const gate: readonly [Point, Point] = [
    [door.x * TILE_WIDTH - insetX, gateY],
    [(door.x + 1) * TILE_WIDTH + insetX, gateY],
  ]
  return { width, height, aspect: width / height, tileHeight: TILE_HEIGHT, playerSize: 92, wallColor: '#4657ff',
    gate, wallPaths: traceWalls(maze), vault: maze.vault }
}

function referenceBoard(): ReturnType<typeof geometry> {
  const maze = CURRENT_MAZE
  const width = maze.width * TILE_WIDTH
  const height = maze.rows.length * TILE_WIDTH
  const scale = TILE_WIDTH / 8
  const project = (x: number, y: number): Point => [(x + .5) * scale, (y - 7.5) * scale]
  const vaultX = (maze.vault.x + .5) * 8 - .5
  const wallPaths = referenceWalls.map(source => {
    const closed = source[0][0] === source.at(-1)![0] && source[0][1] === source.at(-1)![1]
    const points = source.flatMap(([x, y], index) => {
      const next = source[index + 1]
      const point = project(x, y)
      if (!closed && (index === 0 || !next)) {
        return [[x === 0 ? 0 : width, point[1]] as Point]
      }
      if (y < 252 || next?.[1] !== y || x >= vaultX || next[0] <= vaultX) return [point]
      // Extend both bottom outlines around the added vault entrance.
      const inset = y === 252 ? 6 : 9
      const bottom = y === 252 ? 267 : 270
      return [point, project(vaultX - inset, y), project(vaultX - inset, bottom),
        project(vaultX + inset, bottom), project(vaultX + inset, y)]
    })
    if (closed) points[points.length - 1] = points[0]
    return points
  })
  return { width, height, aspect: width / height, tileHeight: TILE_WIDTH, playerSize: 82, wallColor: '#0080f8',
    gate: [project(103, 109), project(120, 109)], wallPaths, vault: maze.vault }
}

export const board = referenceBoard()
export const boards = { classic: board, symmetric: geometry(MAZES.symmetric), legacy: geometry(LEGACY_MAZE) }
export const BOARD_ASPECT = board.aspect

export function interpolateActor(from: Actor | undefined, to: Actor, ratio: number, columns: number, maxDistance = .65): Actor {
  if (!from || ratio === 1) return to
  let dx = to.x - from.x
  const dy = to.y - from.y
  if (Math.abs(dx) > columns / 2) dx -= Math.sign(dx) * columns
  const distance = Math.abs(dx) + Math.abs(dy)
  if (distance > maxDistance || (dx && dy && !to.direction)) return to
  // When a snapshot straddles a turn, follow the incoming leg before the outgoing leg.
  const horizontalExit = to.direction === 'left' || to.direction === 'right'
  const travel = ratio * distance
  const advance = (delta: number, after: number) => Math.sign(delta) * Math.min(Math.abs(delta), Math.max(0, travel - after))
  const x = from.x + advance(dx, horizontalExit ? Math.abs(dy) : 0)
  const y = from.y + advance(dy, horizontalExit ? 0 : Math.abs(dx))
  return { ...to, x: ((x + columns + .5) % columns) - .5, y }
}
