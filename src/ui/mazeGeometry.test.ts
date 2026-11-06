import { describe, expect, it } from 'vitest'
import { DIRECTIONS, MAZE, nextTile, point, VECTORS } from '../game/maze.ts'
import { createActor, moveActor } from '../game/movement.ts'
import { BOARD_WIDTH, gate, PLAYER_SIZE, TILE_HEIGHT, TILE_WIDTH, wallPaths, WALL_STROKE } from './mazeGeometry'

const walls = wallPaths.flatMap(path => path.slice(1).map((end, i) => [path[i], end] as const))
const barriers = [...walls, gate]
const publicTiles = [...MAZE.join('')].flatMap((cell, tile) => '#GD'.includes(cell) ? [] : [tile])

describe('maze geometry', () => {
  it('traces unique orthogonal wall segments with only the wrap tunnel ends open', () => {
    const lines = new Map<string, [number, number][]>()
    for (const [start, end] of walls) {
      expect(start[0] === end[0] || start[1] === end[1]).toBe(true)
      const axis = start[0] === end[0] ? 1 : 0
      const key = `${axis}:${start[1 - axis]}`
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
    expect(openPaths).toHaveLength(2)
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

  it('clears the dog art on every legal player lane and marks each blocked step', () => {
    // The four PNG poses extend at most 39% horizontally and 44% vertically from center.
    const halfX = Math.ceil(PLAYER_SIZE * .39) + WALL_STROKE / 2
    const halfY = Math.ceil(PLAYER_SIZE * .44) + WALL_STROKE / 2
    for (const tile of publicTiles) {
      const p = point(tile)
      const x = (p.x + .5) * TILE_WIDTH
      const y = (p.y + .5) * TILE_HEIGHT
      for (const direction of DIRECTIONS) {
        const [dx, dy] = VECTORS[direction]
        const nextX = x + dx * TILE_WIDTH
        const nextY = y + dy * TILE_HEIGHT
        const destination = nextTile(tile, direction, true)
        const legal = destination !== null
        const actor = createActor(tile)
        moveActor(actor, 1_000, () => direction, true)
        expect(actor.tile).toBe(destination ?? tile)
        expect(actor.destination).toBeNull()
        const marginX = legal ? halfX : 0
        const marginY = legal ? halfY : 0
        const left = Math.min(x, nextX) - marginX
        const right = Math.max(x, nextX) + marginX
        const top = Math.min(y, nextY) - marginY
        const bottom = Math.max(y, nextY) + marginY
        const intersects = barriers.some(([a, b]) => {
          // Check both sides of a wrapping movement against their local walls.
          return [-BOARD_WIDTH, 0, BOARD_WIDTH].some(offset =>
            Math.max(a[0], b[0]) + offset >= left && Math.min(a[0], b[0]) + offset <= right &&
            Math.max(a[1], b[1]) >= top && Math.min(a[1], b[1]) <= bottom)
        })
        expect(intersects, `tile ${p.x},${p.y} ${direction}`).toBe(!legal)
      }
    }
  })
})
