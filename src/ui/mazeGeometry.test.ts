import { describe, expect, it } from 'vitest'
import { DIRECTIONS, MAZE, nextTile, point, VECTORS } from '../game/maze.ts'
import { createActor, moveActor } from '../game/movement.ts'
import { board, GHOST_SIZE, interpolateActor, TILE_WIDTH } from './mazeGeometry'

const { width: BOARD_WIDTH, gate, wallPaths } = board
const walls = wallPaths.flatMap(path => path.slice(1).map((end, i) => [path[i], end] as const))
const barriers = [...walls, gate]
const publicTiles = [...MAZE.join('')].flatMap((cell, tile) => '#GD'.includes(cell) ? [] : [tile])

function intersectsWall(
  x: number, y: number, nextX: number, nextY: number, halfX: number, halfY: number, segments: typeof barriers,
) {
  const left = Math.min(x, nextX) - halfX
  const right = Math.max(x, nextX) + halfX
  const top = Math.min(y, nextY) - halfY
  const bottom = Math.max(y, nextY) + halfY
  // Check both sides of a wrapping movement against their local walls.
  return segments.some(([a, b]) => [-BOARD_WIDTH, 0, BOARD_WIDTH].some(offset =>
    Math.max(a[0], b[0]) + offset >= left && Math.min(a[0], b[0]) + offset <= right &&
    Math.max(a[1], b[1]) >= top && Math.min(a[1], b[1]) <= bottom))
}

describe('maze geometry', () => {
  it('interpolates both legs of a corner without cutting through the wall', () => {
    const from = { ...createActor(0), x: 4, y: 4.25 }
    const to = { ...from, x: 4.25, y: 4, direction: 'right' } as const
    expect(interpolateActor(from, to, .25, 33)).toMatchObject({ x: 4, y: 4.125 })
    expect(interpolateActor(from, to, .75, 33)).toMatchObject({ x: 4.125, y: 4 })
  })

  it('traces each wall stroke once, including the corner bevels and tunnel mouths', () => {
    const lines = new Map<string, [number, number][]>()
    for (const [start, end] of walls) {
      const dx = end[0] - start[0]
      const dy = end[1] - start[1]
      expect(dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)).toBe(true)
      const axis = dx === 0 ? 1 : 0
      const key = dx && dy ? `diagonal:${dy / dx}:${start[1] - start[0] * dy / dx}` : `${axis}:${start[1 - axis]}`
      const intervals = lines.get(key) ?? []
      intervals.push([Math.min(start[axis], end[axis]), Math.max(start[axis], end[axis])])
      lines.set(key, intervals)
    }
    for (const intervals of lines.values()) {
      intervals.sort(([a], [b]) => a - b)
      for (let i = 1; i < intervals.length; i++) {
        expect(intervals[i][0]).toBeGreaterThanOrEqual(intervals[i - 1][1])
      }
    }
    const openPaths = wallPaths.filter(path => path[0] !== path.at(-1))
    expect(openPaths).toHaveLength(4)
    for (const path of openPaths) {
      for (const [x] of [path[0], path.at(-1)!]) {
        expect(x <= 0 || x >= BOARD_WIDTH).toBe(true)
      }
    }
    for (const [x, y] of gate) {
      expect(walls.some(([a, b]) =>
        Math.min(a[0], b[0]) <= x && Math.max(a[0], b[0]) >= x &&
        Math.min(a[1], b[1]) <= y && Math.max(a[1], b[1]) >= y,
      )).toBe(true)
    }
  })

  it('leaves clearance around legal player centerlines and marks each blocked step', () => {
    // Measure the base footprint. The renderer can enlarge artwork beyond these lanes.
    const halfX = Math.ceil(board.playerSize * .39) + 3
    const halfY = Math.ceil(board.playerSize * .44) + 3
    for (const tile of publicTiles) {
      const p = point(tile)
      const x = (p.x + .5) * TILE_WIDTH
      const y = (p.y + .5) * board.tileHeight
      for (const direction of DIRECTIONS) {
        const [dx, dy] = VECTORS[direction]
        const destination = nextTile(tile, direction, true)
        const legal = destination !== null
        const nextX = x + dx * TILE_WIDTH * (legal ? 1 : 1.2)
        const nextY = y + dy * board.tileHeight * (legal ? 1 : 1.2)
        const actor = createActor(tile)
        moveActor(actor, 1_000, () => direction, true)
        expect(actor.tile).toBe(destination ?? tile)
        expect(actor.destination).toBeNull()
        const intersects = intersectsWall(x, y, nextX, nextY, halfX, halfY, barriers)
        expect(intersects, `tile ${p.x},${p.y} ${direction}`).toBe(!legal)
      }
    }
  })

  it('leaves clearance around ghost centerlines, including both tiles of the house gate', () => {
    const cells = MAZE.join('')
    const half = GHOST_SIZE / 2 + 3
    for (let tile = 0; tile < cells.length; tile++) {
      if ('#V'.includes(cells[tile])) continue
      const p = point(tile)
      const x = (p.x + .5) * TILE_WIDTH
      const y = (p.y + .5) * board.tileHeight
      for (const direction of DIRECTIONS) {
        if (nextTile(tile, direction) === null) continue
        const [dx, dy] = VECTORS[direction]
        const intersects = intersectsWall(x, y, x + dx * TILE_WIDTH, y + dy * board.tileHeight, half, half, walls)
        expect(intersects, `ghost tile ${p.x},${p.y} ${direction}`).toBe(false)
      }
    }
  })
})
