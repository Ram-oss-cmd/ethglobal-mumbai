import { createGame, type GameState, RUN_MS, stepGame, TICK_MS } from '../game/index.ts'
import { DIRECTIONS } from '../game/maze.ts'
import type { RunRecord } from './protocol.ts'

/** Reconstruct one run using the exact input applied on each server tick. */
export function replayRun(
  seed: number,
  inputs: RunRecord['inputs'],
  ticks: number,
  onTick?: (state: GameState, tick: number) => void,
) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff ||
      !Number.isInteger(ticks) || ticks < 0 || ticks > RUN_MS / TICK_MS ||
      !Array.isArray(inputs) || inputs.length > ticks) throw new Error('Invalid replay bounds')
  let previous = 0
  for (const input of inputs) {
    if (!input || !Number.isInteger(input.tick) || input.tick <= previous ||
        input.tick > ticks || !DIRECTIONS.includes(input.direction)) throw new Error('Invalid replay input')
    previous = input.tick
  }

  const state = createGame(seed)
  let index = 0
  onTick?.(state, 0)
  for (let tick = 1; tick <= ticks; tick++) {
    if (state.status !== 'playing') throw new Error('Replay advances a finished run')
    const direction = inputs[index]?.tick === tick ? inputs[index++].direction : undefined
    stepGame(state, direction)
    onTick?.(state, tick)
  }
  return state
}
