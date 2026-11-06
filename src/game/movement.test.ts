import { describe, expect, it } from 'vitest'
import { createGame, MAZE, RUN_MS, stepGame, TICK_MS } from './index'
import { DIRECTIONS, HOME_TILE, nextTile, START_TILE, VAULT_TILE, WIDTH } from './maze'
import { createActor } from './movement'

describe('maze and movement', () => {
  it('connects public floor tiles, excludes the ghost room, and gives the vault one entrance', () => {
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
    expect(nextTile(HOME_TILE - 2, 'right')).toBeNull()
    expect(nextTile(HOME_TILE + 2, 'left')).toBeNull()
    expect(DIRECTIONS.map(direction => nextTile(VAULT_TILE, direction, true))).toEqual([
      VAULT_TILE - WIDTH, null, null, null,
    ])
    expect(nextTile(VAULT_TILE - WIDTH, 'down')).toBeNull()
  })

  it('buffers a corner turn without diagonals or clipping the inner wall', () => {
    const state = createGame(1)
    stepGame(state, 'left')
    stepGame(state, 'up')
    expect(state.player.x).toBeCloseTo(10.88)
    expect(state.player.y).toBe(13)
    for (let i = 0; i < 31; i++) stepGame(state)
    expect(state.player.x).toBeCloseTo(9.02)
    expect(state.player.y).toBe(13)
    stepGame(state)
    expect(state.player.x).toBe(9)
    expect(state.player.y).toBeCloseTo(12.96)
  })

  it('stops at a wall and reverses immediately between centers', () => {
    const state = createGame(1)
    stepGame(state, 'up')
    expect(state.player).toMatchObject({ x: 11, y: 13 })
    stepGame(state, 'down')
    expect(state.player.y).toBeCloseTo(13.06)
    stepGame(state, 'up')
    expect(state.player).toMatchObject({ x: 11, y: 13 })
  })

  it('wraps smoothly across either tunnel edge', () => {
    const state = createGame(1)
    state.player = createActor(HOME_TILE - 11)
    stepGame(state, 'left')
    for (let i = 0; i < 15; i++) stepGame(state)
    expect(state.player.x).toBeCloseTo(22.04)
    expect(state.player.y).toBe(9)
    stepGame(state, 'right')
    for (let i = 0; i < 15; i++) stepGame(state)
    expect(state.player).toMatchObject({ x: 0, y: 9 })
  })

  it('ends exactly at the 90-second tick and ignores later inputs', () => {
    const state = createGame(1)
    state.elapsedMs = RUN_MS - TICK_MS
    stepGame(state)
    stepGame(state, 'down')
    expect(state).toMatchObject({ elapsedMs: RUN_MS, status: 'timeout' })
    expect(state.player).toMatchObject({ x: 11, y: 13 })
  })
})
