import { describe, expect, it } from 'vitest'
import { createGame, DEATH_PAUSE_MS, type Direction, type GameState, loseLife, MAZE, stepGame, TICK_MS, TOTAL_DOTS, VAULT } from './index'
import { HOME_TILE, START_TILE, TUNNEL_ROW, VAULT_TILE, WIDTH } from './maze'
import { createActor } from './movement'

function advance(state: GameState, ticks: number, direction?: Direction) {
  stepGame(state, direction)
  for (let tick = 1; tick < ticks; tick++) stepGame(state)
}

function collectAndBank(state: GameState) {
  advance(state, 58, 'down')
  expect(state.carried).toBe(3)
  expect(state.banked).toBe(0)
  expect(state.player.y).toBeCloseTo(VAULT.y - .52)
  stepGame(state)
  expect(state.carried).toBe(0)
  expect(state.banked).toBe(3)
  expect(state.player.y).toBeCloseTo(VAULT.y - .46)
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
  it('places four seeded power pellets on separate corridor tiles without changing the bankable total', () => {
    const layouts = new Set<string>()
    for (let seed = 0; seed < 20; seed++) {
      const state = createGame(seed)
      expect(createGame(seed).pellets).toEqual(state.pellets)
      expect(state.pellets).toHaveLength(4)
      expect(new Set(state.pellets.map(({ x, y }) => (y < MAZE.length / 2 ? 0 : 2) + Number(x > WIDTH / 2))).size).toBe(4)
      for (const { x, y } of state.pellets) {
        expect([1, WIDTH - 2]).toContain(x)
        expect(MAZE[y][x]).toBe('o')
        expect(state.dots.some(dot => dot.x === x && dot.y === y)).toBe(false)
      }
      expectConserved(state)
      layouts.add(JSON.stringify(state.pellets))
    }
    expect(layouts.size).toBeGreaterThan(1)
  })

  it('banks on threshold entry and never counts those dots on another trip', () => {
    const state = createGame(1)
    collectAndBank(state)
    advance(state, 50, 'up')
    advance(state, 50, 'down')
    expect(state).toMatchObject({ carried: 0, banked: 3 })
    expectConserved(state)
  })

  it('keeps points carried when reversing just before the vault line', () => {
    const state = createGame(1)
    advance(state, 58, 'down')
    advance(state, 8, 'up')
    expect(state.player.y).toBeCloseTo(VAULT.y - 1)
    expect(state).toMatchObject({ carried: 3, banked: 0 })
    advance(state, 9, 'down')
    expect(state).toMatchObject({ carried: 0, banked: 3 })
  })

  it('keeps banked points and permanently removes their identities after death', () => {
    const state = createGame(5)
    advance(state, 58, 'down')
    const bankedIds = state.carriedDots.map(dot => dot.id)
    stepGame(state)
    state.player = createActor(TUNNEL_ROW * WIDTH + 5)
    advance(state, 34, 'left')
    expect(state.carried).toBe(2)
    loseLife(state)
    expect(state).toMatchObject({ lives: 2, carried: 0, banked: 3 })
    expect(state.player).not.toEqual(createActor(START_TILE))
    expect(state.queuedDots).toHaveLength(2)
    expectConserved(state)
    advance(state, DEATH_PAUSE_MS / TICK_MS)
    expect(state.player).toEqual(createActor(START_TILE))
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
      advance(state, 100, 'left')
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
      expect(dot.atMs - deathMs).toBeGreaterThanOrEqual(600)
      expect(dot.atMs - deathMs).toBeLessThanOrEqual(900)
    }

    while (state.queuedDots.length > 0) {
      stepGame(state)
      expectConserved(state)
      for (const dot of schedule) {
        const sameTile = dot.x === Math.round(state.player.x) && dot.y === Math.round(state.player.y)
        expect(state.dots.some(active => active.id === dot.id)).toBe(dot.atMs <= state.elapsedMs && !sameTile)
      }
    }
  })

  it('conserves unique dots across repeated losses after banking with either seat layout', () => {
    for (let seed = 0; seed < 32; seed++) {
      const state = createGame(seed, seed % 2 === 1)
      state.ghosts = []
      advance(state, 58, 'down')
      const bankedIds = new Set(state.carriedDots.map(dot => dot.id))
      stepGame(state)
      for (let life = 2; life >= 0; life--) {
        state.player = createActor(TUNNEL_ROW * WIDTH + [5, 8, 26][2 - life])
        advance(state, 34, 'left')
        expect(state.carried).toBeGreaterThan(0)
        const lost = state.carriedDots.map(dot => dot.id)
        loseLife(state)
        expect(state).toMatchObject({ lives: life, banked: 3, carried: 0 })
        expect(state.queuedDots.map(dot => dot.id)).toEqual(lost)
        for (const dot of state.queuedDots) {
          expect(state.route).toContain(dot.y * WIDTH + dot.x)
          expect(dot.atMs - state.elapsedMs).toBeGreaterThanOrEqual(600)
          expect(dot.atMs - state.elapsedMs).toBeLessThanOrEqual(900)
        }
        advance(state, DEATH_PAUSE_MS / TICK_MS)
        expect(state.queuedDots).toHaveLength(0)
        expect(unbankedIds(state).some(id => bankedIds.has(id))).toBe(false)
        expectConserved(state)
      }
    }
  })

  it('releases final-life respawns without changing the terminal run clock', () => {
    const state = createGame(2)
    state.lives = 1
    advance(state, 34, 'down')
    expect(state.carried).toBe(2)
    loseLife(state)
    const hitPosition = { ...state.player }
    expect(state).toMatchObject({ elapsedMs: 340, lives: 0, status: 'playing' })
    advance(state, DEATH_PAUSE_MS / TICK_MS + 1, 'left')
    expect(state).toMatchObject({ elapsedMs: 340 + DEATH_PAUSE_MS, lives: 0, carried: 0, status: 'out-of-lives' })
    expect(state.player).toEqual(hitPosition)
    expect(state.queuedDots).toHaveLength(0)
    expectConserved(state)
  })

  it('holds a due dot until its reserved tile is vacant', () => {
    const state = createGame(2)
    advance(state, 17, 'down')
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
    advance(state, DEATH_PAUSE_MS / TICK_MS)
    expect(state.queuedDots).toHaveLength(0)
    expect(state.dots).toContainEqual({ id: dot.id, x: dot.x, y: dot.y })
    expectConserved(state)
  })

  it('requires the last coin to cross into the vault and locks the full-clear tick', () => {
    const state = createGame(3)
    state.dots = state.dots.filter(dot => dot.x === VAULT.x && dot.y === VAULT.y - 1)
    state.banked = TOTAL_DOTS - 1
    advance(state, 58, 'down')
    expect(state).toMatchObject({ status: 'playing', carried: 1, banked: TOTAL_DOTS - 1 })
    advance(state, 50, 'down')
    expect(state).toMatchObject({ status: 'full-clear', carried: 0, banked: TOTAL_DOTS, elapsedMs: 590 })
    expect(state.player.y).toBe(VAULT.y - .5)
    expectConserved(state)
  })
})
