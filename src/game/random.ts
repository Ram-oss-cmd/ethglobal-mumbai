// Mulberry32 uses uint32 arithmetic so a seed and tick inputs reproduce the same draws.
export function randomIndex(state: { randomState: number }, length: number) {
  state.randomState = (state.randomState + 0x6d2b79f5) >>> 0
  let value = state.randomState
  value = Math.imul(value ^ (value >>> 15), value | 1)
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
  const unit = ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000
  return Math.floor(unit * length)
}