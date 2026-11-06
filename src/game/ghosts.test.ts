import { describe, expect, it } from 'vitest'
import { createGame, DEATH_PAUSE_MS, type Direction, type GameState, GHOST_EAT_PAUSE_MS, GHOST_HOME, stepGame, TICK_MS, VAULT } from './index'
import { START_TILE, VAULT_TILE, WIDTH } from './maze'
import { createActor, occupiedTile } from './movement'

function advance(state: GameState, ticks: number, direction?: Direction) {
  stepGame(state, direction)
  for (let tick = 1; tick < ticks; tick++) stepGame(state)
}

describe('ghost behavior', () => {
  it('scatters then pursues the wallet while respecting the vault threshold', () => {
    const state = createGame(5)
    advance(state, 499, 'down')
    expect(state.ghosts.map(ghost => ghost.mode)).toEqual(Array(4).fill('scatter'))
    stepGame(state)
    expect(state.ghosts.map(ghost => ghost.mode)).toEqual(Array(4).fill('chase'))
    expect(new Set(state.ghosts.map(ghost => ghost.id)).size).toBe(4)

    let approached = false
    let crossed = false
    for (let tick = 0; tick < 2_500; tick++) {
      stepGame(state)
      for (const ghost of state.ghosts) {
        approached ||= Math.abs(ghost.x - VAULT.x) < 0.3 && ghost.y > VAULT.y - 1.1
        crossed ||= occupiedTile(ghost) === VAULT_TILE
      }
    }
    expect(approached).toBe(true)
    expect(crossed).toBe(false)
    expect(state).toMatchObject({ elapsedMs: 30_000, lives: 3, carried: 0, banked: 3 })
  })

  it('freezes both sides at contact, then respawns only the wallet', () => {
    const state = createGame(1)
    advance(state, 59, 'down')
    advance(state, 59, 'up')
    advance(state, 34, 'left')
    expect(state).toMatchObject({ carried: 2, banked: 3 })

    const ghosts = state.ghosts
    const waveBeforeDeath = state.waveMs
    const collisionTile = state.player.tile
    Object.assign(ghosts[0], createActor(collisionTile), { mode: 'scatter' })
    stepGame(state)
    expect(state).toMatchObject({ lives: 2, carried: 0, banked: 3 })
    expect(state.queuedDots).toHaveLength(2)
    expect(state.player).not.toEqual(createActor(START_TILE))
    expect(state.ghosts).toBe(ghosts)
    expect(ghosts[0].tile).toBe(collisionTile)
    const actorsAtDeath = structuredClone([state.player, ...ghosts])
    advance(state, DEATH_PAUSE_MS / TICK_MS - 1, 'down')
    expect([state.player, ...ghosts]).toEqual(actorsAtDeath)
    expect(state.waveMs).toBe(waveBeforeDeath + TICK_MS)
    stepGame(state, 'down')
    expect(state.player).toEqual(createActor(START_TILE))
    expect(ghosts).toEqual(actorsAtDeath.slice(1))
    stepGame(state, 'down')
    expect(ghosts[0]).not.toEqual(actorsAtDeath[1])
    expect(state.waveMs).toBe(waveBeforeDeath + 2 * TICK_MS)
    expect(state.player.y).toBeCloseTo(13.06)
    expect(state.lives).toBe(2)
  })

  it('freezes every actor briefly after a ghost catch, preserves the power-up, and restores normal behavior', () => {
    const state = createGame(4)
    const pellet = state.pellets[1]
    const tile = pellet.y * WIDTH + pellet.x
    state.player = createActor(tile - 1)
    const [tracer, snare] = state.ghosts
    state.ghosts = [tracer, snare]
    Object.assign(tracer, createActor(tile), { readyAtMs: 170 })
    Object.assign(snare, createActor(WIDTH * 16 + 1), { readyAtMs: 0 })

    advance(state, 16, 'right')
    expect(state.frightenedUntilMs).toBe(0)
    stepGame(state)
    expect(state.pellets).toHaveLength(3)
    expect(state.ghostPauseUntilMs - state.elapsedMs).toBe(GHOST_EAT_PAUSE_MS)
    expect(tracer.mode).toBe('returning')
    expect(snare.mode).toBe('frightened')
    expect(state).toMatchObject({ carried: 0, banked: 0, lives: 3 })

    const actorsAtCatch = structuredClone([state.player, ...state.ghosts])
    advance(state, GHOST_EAT_PAUSE_MS / TICK_MS, 'left')
    expect([state.player, ...state.ghosts]).toEqual(actorsAtCatch)
    expect(state.frightenedUntilMs - state.elapsedMs).toBe(7_000)
    expect(state.ghostPauseUntilMs).toBe(0)
    stepGame(state)
    expect(tracer).not.toEqual(actorsAtCatch[1])

    for (let tick = 0; tick < 400 && tracer.mode !== 'recovering'; tick++) stepGame(state)
    expect(tracer).toMatchObject({ ...GHOST_HOME, mode: 'recovering' })
    expect(state.elapsedMs).toBeLessThan(state.frightenedUntilMs)
    advance(state, (state.frightenedUntilMs - state.elapsedMs) / TICK_MS - 1)
    expect(tracer).toMatchObject({ ...GHOST_HOME, mode: 'recovering' })
    stepGame(state)
    expect(state.elapsedMs).toBe(state.frightenedUntilMs)
    expect(tracer.mode).toBe('scatter')
    expect(state.ghosts.every(ghost => ghost.mode !== 'frightened')).toBe(true)
  })

  it('replays the same seed and timed inputs through power-up, collisions and dot respawn', () => {
    const moves = new Map<number, Direction>([[0, 'down'], [10, 'left']])
    const first = createGame(7)
    const second = createGame(7)
    let sawPower = false
    let sawLoss = false
    for (let tick = 0; tick < 2_500; tick++) {
      stepGame(first, moves.get(tick))
      stepGame(second, moves.get(tick))
      sawPower ||= first.ghosts.some(ghost => ghost.mode === 'frightened')
      sawLoss ||= first.queuedDots.length > 0
      if (tick % 250 === 0) expect(second).toEqual(first)
    }
    expect(sawPower).toBe(true)
    expect(sawLoss).toBe(true)
    expect(second).toEqual(first)
  })
})
