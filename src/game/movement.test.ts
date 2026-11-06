import { describe, expect, it } from 'vitest'
import { createGame, MAZE, RUN_MS, stepGame, TICK_MS } from './index'
import { CURRENT_MAZE, DIRECTIONS, HOME_TILE, nextTile, point, START_TILE, VAULT_TILE, WIDTH } from './maze'
import { createActor } from './movement'

describe('maze and movement', () => {
  it('connects public floor tiles, excludes the ghost room, and gives the vault one entrance', () => {
    expect(MAZE).toHaveLength(33)
    expect(WIDTH).toBe(28)
    expect(MAZE.every(row => row.length === WIDTH)).toBe(true)
    const reached = new Set([START_TILE])
    for (const tile of reached) {
      for (const direction of DIRECTIONS) {
        const next = nextTile(tile, direction, true)
        if (next !== null) reached.add(next)
      }
    }
    expect(reached.size).toBe([...MAZE.join('')].filter(cell => !'#GD'.includes(cell)).length)
    const door = HOME_TILE - WIDTH
    expect(reached.has(door)).toBe(false)
    expect(reached.has(HOME_TILE)).toBe(false)
    expect(nextTile(door - WIDTH, 'down', true)).toBeNull()
    expect(nextTile(door - WIDTH, 'down')).toBe(door)
    expect(nextTile(door, 'down')).toBe(HOME_TILE)
    expect(nextTile(HOME_TILE + WIDTH - 4, 'right')).toBeNull()
    expect(nextTile(HOME_TILE + WIDTH + 5, 'left')).toBeNull()
    expect(DIRECTIONS.map(direction => nextTile(VAULT_TILE, direction, true))).toEqual([
      VAULT_TILE - WIDTH, null, null, null,
    ])
    expect(nextTile(VAULT_TILE - WIDTH, 'down')).toBeNull()
  })

  it('buffers a corner turn without diagonals or clipping the inner wall', () => {
    const state = createGame(1)
    const start = point(START_TILE)
    stepGame(state, 'down')
    stepGame(state, 'right')
    expect(state.player.x).toBe(start.x)
    expect(state.player.y).toBeCloseTo(start.y + .12)
    for (let i = 0; i < 31; i++) stepGame(state)
    expect(state.player.x).toBe(start.x)
    expect(state.player.y).toBeCloseTo(start.y + 1.98)
    stepGame(state)
    expect(state.player.x).toBeCloseTo(start.x + .04)
    expect(state.player.y).toBe(start.y + 2)
  })

  it('stops at a wall and reverses immediately between centers', () => {
    const state = createGame(1)
    const start = point(START_TILE)
    stepGame(state, 'left')
    expect(state.player).toMatchObject(start)
    stepGame(state, 'down')
    expect(state.player.y).toBeCloseTo(start.y + .06)
    stepGame(state, 'up')
    expect(state.player).toMatchObject(start)
  })

  it('wraps smoothly across either mouth of the side tunnel', () => {
    expect(CURRENT_MAZE.tunnels).toEqual([14])
    for (const y of CURRENT_MAZE.tunnels) {
      const state = createGame(1)
      state.ghosts = []
      state.player = createActor(y * WIDTH)
      stepGame(state, 'left')
      for (let i = 0; i < 15; i++) stepGame(state)
      expect(state.player.x).toBeCloseTo(WIDTH - .96)
      expect(state.player.y).toBe(y)
      stepGame(state, 'right')
      for (let i = 0; i < 15; i++) stepGame(state)
      expect(state.player).toMatchObject({ x: 0, y })
    }
  })

  it('ends exactly at the 90-second tick and ignores later inputs', () => {
    const state = createGame(1)
    state.elapsedMs = RUN_MS - TICK_MS
    stepGame(state)
    stepGame(state, 'down')
    expect(state).toMatchObject({ elapsedMs: RUN_MS, status: 'timeout' })
    expect(state.player).toMatchObject(point(START_TILE))
  })
})
