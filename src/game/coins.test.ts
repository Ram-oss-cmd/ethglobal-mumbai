import { describe, expect, it } from 'vitest'
import { RESPAWN_MAX_MS, RESPAWN_MIN_MS } from './coins'
import { createGame, type Direction, type GameState, loseLife, MAZE, stepGame, TICK_MS, TOTAL_DOTS } from './index'
import { HOME_TILE, START_TILE, TUNNEL_ROW, VAULT_TILE, WIDTH } from './maze'
import { createActor } from './movement'

function advance(state: GameState, ticks: number, direction?: Direction) {
  stepGame(state, direction)
  for (let tick = 1; tick < ticks; tick++) stepGame(state)
}

function collectAndBank(state: GameState) {
  advance(state, 54, 'down')
  expect(state.carried).toBe(3)
  expect(state.banked).toBe(0)
  expect(state.player.y).toBeCloseTo(16.456)
  stepGame(state)
  expect(state.carried).toBe(0)
  expect(state.banked).toBe(3)
  expect(state.player.y).toBeCloseTo(16.52)
}

function unbankedIds(state: GameState) {
  return [...state.dots, ...state.queuedDots, ...state.carriedDots].map(dot => dot.id)
}

function expectConserved(state: GameState) {
  const ids = unbankedIds(state)
  expect(ids.length + state.banked).toBe(TOTAL_DOTS)
  expect(new Set(ids).size).toBe(ids.length)
  expect(state.carriedDots.length).toBe(state.carried)
  const occupied = [...state.dots, ...state.queuedDots].map(dot => dot.y * WIDTH + dot.x)
  expect(new Set(occupied).size).toBe(occupied.length)
}

describe('collecting and banking', () => {
  it('banks on threshold entry and never counts those dots on another trip', () => {
    const state = createGame(1)
    collectAndBank(state)
    advance(state, 50, 'up')
    advance(state, 50, 'down')
    expect(state).toMatchObject({ carried: 0, banked: 3 })
    expectConserved(state)
  })

  it('keeps banked points and permanently removes their identities after death', () => {
    const state = createGame(5)
    advance(state, 54, 'down')
    const bankedIds = state.carriedDots.map(dot => dot.id)
    stepGame(state)
    advance(state, 55, 'up')
    advance(state, 32, 'left')
    expect(state.carried).toBe(2)
    loseLife(state)
    expect(state).toMatchObject({ lives: 2, carried: 0, banked: 3 })
    expect(state.player).toEqual(createActor(START_TILE))
    expect(state.queuedDots).toHaveLength(2)
    expectConserved(state)
    advance(state, RESPAWN_MAX_MS / TICK_MS)
    expect(state.queuedDots).toHaveLength(0)
    for (const id of bankedIds) expect(unbankedIds(state)).not.toContain(id)
    expectConserved(state)
  })

  it('randomizes only available traversed cells and releases at reproducible seeded times', () => {
    function run(seed: number) {
      const state = createGame(seed)
      state.ghosts = []
      state.player = createActor(TUNNEL_ROW * WIDTH + 4)
      state.route = [state.player.tile]
      advance(state, 94, 'left')
      expect(state.carried).toBe(4)
      const lost = state.carriedDots.map(dot => ({ ...dot }))
      loseLife(state)
      expect(state.queuedDots.map(dot => dot.id)).toEqual(lost.map(dot => dot.id))
      expectConserved(state)
      return { state, lost }
    }

    const { state, lost } = run(3)
    const schedule = state.queuedDots.map(dot => ({ ...dot }))
    expect(run(3).state).toEqual(state)
    expect(run(7).state.queuedDots).not.toEqual(schedule)
    expect(new Set(schedule.map(dot => dot.atMs)).size).toBeGreaterThan(1)
    expect(schedule.some(dot => !lost.some(previous => previous.x === dot.x && previous.y === dot.y))).toBe(true)

    const deathMs = state.elapsedMs
    for (const dot of schedule) {
      const tile = dot.y * WIDTH + dot.x
      expect(state.route).toContain(tile)
      expect([START_TILE, HOME_TILE, VAULT_TILE]).not.toContain(tile)
      expect(MAZE[dot.y][dot.x]).toMatch(/[. ]/)
      expect(dot.atMs - deathMs).toBeGreaterThanOrEqual(RESPAWN_MIN_MS)
      expect(dot.atMs - deathMs).toBeLessThanOrEqual(RESPAWN_MAX_MS)
    }

    while (state.queuedDots.length > 0) {
      stepGame(state)
      expectConserved(state)
      for (const dot of schedule) {
        expect(state.dots.some(active => active.id === dot.id)).toBe(dot.atMs <= state.elapsedMs)
      }
    }
  })

  it('releases final-life respawns without changing the terminal run clock', () => {
    const state = createGame(2)
    state.lives = 1
    advance(state, 32, 'down')
    expect(state.carried).toBe(2)
    loseLife(state)
    expect(state).toMatchObject({ elapsedMs: 320, lives: 0, status: 'out-of-lives' })
    advance(state, RESPAWN_MAX_MS / TICK_MS, 'left')
    expect(state).toMatchObject({ elapsedMs: 320, lives: 0, carried: 0, status: 'out-of-lives' })
    expect(state.player).toEqual(createActor(START_TILE))
    expect(state.queuedDots).toHaveLength(0)
    expectConserved(state)
  })

  it('holds a due dot until its reserved tile is vacant', () => {
    const state = createGame(2)
    advance(state, 16, 'down')
    loseLife(state)
    expect(state.queuedDots).toHaveLength(1)
    const dot = state.queuedDots[0]
    state.ghosts = [{
      ...state.ghosts[0], ...createActor(dot.y * WIDTH + dot.x), mode: 'recovering', readyAtMs: Infinity,
    }]
    advance(state, (dot.atMs - state.elapsedMs) / TICK_MS)
    expect(state.queuedDots).toEqual([dot])
    expectConserved(state)

    state.ghosts = []
    stepGame(state)
    expect(state.queuedDots).toHaveLength(0)
    expect(state.dots).toContainEqual({ id: dot.id, x: dot.x, y: dot.y })
    expectConserved(state)
  })

  it('requires the last coin to cross into the vault and locks the full-clear tick', () => {
    const state = createGame(3)
    state.dots = state.dots.filter(dot => dot.x === 11 && dot.y === 16)
    state.banked = TOTAL_DOTS - 1
    advance(state, 54, 'down')
    expect(state).toMatchObject({ status: 'playing', carried: 1, banked: TOTAL_DOTS - 1 })
    advance(state, 50, 'down')
    expect(state).toMatchObject({ status: 'full-clear', carried: 0, banked: TOTAL_DOTS, elapsedMs: 550 })
    expect(state.player.y).toBe(16.5)
    expectConserved(state)
  })
})
