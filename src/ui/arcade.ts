import Phaser from 'phaser'
import {
  createGame, MAZE, RUN_MS, stepGame, TICK_MS, VAULT,
  type Direction, type GameState,
} from '../game'
import type { RunView } from '../competition/protocol'
import wallet from './assets/wallet.svg'
import tracer from './assets/tracer.svg'
import snare from './assets/snare.svg'
import relay from './assets/relay.svg'
import warden from './assets/warden.svg'
import frightened from './assets/frightened.svg'
import returning from './assets/returning.svg'

const sprites = { wallet, tracer, snare, relay, warden, frightened, returning }
const TILE = 28
const WIDTH = MAZE[0].length * TILE
const HEIGHT = MAZE.length * TILE
const BACKGROUND = 0x000000
const PRACTICE_SEED = 0x57525553
export const BOARD_ASPECT = WIDTH / HEIGHT

const keys = new Map<string, Direction>([
  ['arrowup', 'up'], ['w', 'up'],
  ['arrowleft', 'left'], ['a', 'left'],
  ['arrowdown', 'down'], ['s', 'down'],
  ['arrowright', 'right'], ['d', 'right'],
])

export type Hud = {
  status: 'ready' | GameState['status']
  carried: number
  banked: number
  lives: number
  seconds: number
  powerSeconds: number
}

/** Draws the contour of the solid maze tiles without changing collisions. */
function drawMaze(scene: Phaser.Scene) {
  const texture = scene.textures.createCanvas('walls', WIDTH, HEIGHT)!
  const ctx = texture.context
  const columns = MAZE[0].length
  const radius = 8
  const ports = [[0, -radius], [radius, 0], [0, radius], [-radius, 0]]
  // Extend each side's last tile so the open tunnel keeps its open ends.
  const wall = (x: number, y: number) => (MAZE[y]?.[Math.max(0, Math.min(x, columns - 1))] ?? '#') === '#'

  ctx.beginPath()
  for (let y = 0; y <= MAZE.length; y++) {
    for (let x = 0; x <= columns; x++) {
      const left = x * TILE
      const top = y * TILE
      const cells = [wall(x - 1, y - 1), wall(x, y - 1), wall(x, y), wall(x - 1, y)]
      const edges = cells.map((cell, i) => cell !== cells[(i + 1) % 4])
      if (edges[1] && x < columns) {
        ctx.moveTo(left + radius, top)
        ctx.lineTo(left + TILE - radius, top)
      }
      if (edges[2] && y < MAZE.length) {
        ctx.moveTo(left, top + radius)
        ctx.lineTo(left, top + TILE - radius)
      }
      const joins = ports.filter((_, i) => edges[i])
      const connect = ([ax, ay]: number[], [bx, by]: number[]) => {
        ctx.moveTo(left + ax, top + ay)
        ctx.lineTo(left, top)
        ctx.lineTo(left + bx, top + by)
      }
      if (joins.length === 2) connect(joins[0], joins[1])
      if (joins.length === 4) {
        cells.forEach((cell, i) => { if (cell) connect(ports[(i + 3) % 4], ports[i]) })
      }
    }
  }
  // House edges adjoining public corridors are solid except for the ghost door.
  MAZE.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== 'G') continue
      const left = x * TILE
      const top = y * TILE
      const right = left + TILE
      const bottom = top + TILE
      function boundary(cell: string | undefined, x1: number, y1: number, x2: number, y2: number) {
        if (cell === undefined || cell === '#' || cell === 'G' || cell === 'D') return
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
      }
      boundary(row[x - 1], left, top, left, bottom)
      boundary(row[x + 1], right, top, right, bottom)
      boundary(MAZE[y - 1]?.[x], left, top, right, top)
      boundary(MAZE[y + 1]?.[x], left, bottom, right, bottom)
    }
  })
  ctx.lineCap = 'square'
  ctx.lineWidth = 6
  ctx.strokeStyle = '#131d83'
  ctx.stroke()
  ctx.lineWidth = 2.5
  ctx.strokeStyle = '#5362ff'
  ctx.stroke()
  scene.add.image(0, 0, texture).setOrigin(0)

  const g = scene.add.graphics()
  MAZE.forEach((row, y) => {
    const door = row.indexOf('D')
    if (door >= 0) g.fillStyle(0xffa8ce).fillRect(door * TILE + 2, y * TILE - 1, TILE - 4, 3)
  })
  const vaultX = VAULT.x * TILE
  const threshold = VAULT.y * TILE
  g.fillStyle(0xafff65).fillRect(vaultX + 1, threshold - 1, TILE - 2, 3)
  g.fillStyle(0xafff65)
    .fillRect(vaultX + 9, threshold + 13, 10, 8)
    .fillRect(vaultX + 12, threshold + 9, 4, 2)
    .fillRect(vaultX + 10, threshold + 11, 2, 2)
    .fillRect(vaultX + 16, threshold + 11, 2, 2)
  g.fillStyle(BACKGROUND).fillRect(vaultX + 13, threshold + 15, 2, 4)
}

function drawPickups(dots: Phaser.GameObjects.Graphics, pellets: Phaser.GameObjects.Graphics, state: RunView) {
  dots.clear().fillStyle(0xffba9d)
  for (const dot of state.dots) {
    const x = (dot.x + 0.5) * TILE
    const y = (dot.y + 0.5) * TILE
    dots.fillCircle(x, y, 2.6)
  }
  pellets.clear()
  for (const pellet of state.pellets) {
    const x = (pellet.x + 0.5) * TILE
    const y = (pellet.y + 0.5) * TILE
    pellets.fillStyle(0xffe5cf).fillTriangle(x, y - 9, x - 6, y + 1, x, y + 4)
    pellets.fillStyle(0xeea078).fillTriangle(x, y - 9, x + 6, y + 1, x, y + 4)
    pellets.fillStyle(0xffd2b5).fillTriangle(x - 6, y + 3, x, y + 6, x, y + 9)
    pellets.fillStyle(0xc77255).fillTriangle(x + 6, y + 3, x, y + 6, x, y + 9)
  }
}

function actor(scene: Phaser.Scene, texture: string) {
  const image = scene.add.image(0, 0, texture).setDisplaySize(26, 26).setAlpha(0)
  const wrap = scene.add.image(0, 0, texture).setDisplaySize(26, 26).setAlpha(0)
  return (position: GameState['player'], nextTexture: string, alpha = 1) => {
    const x = Math.round((position.x + 0.5) * TILE)
    const y = Math.round((position.y + 0.5) * TILE)
    const flip = position.direction === 'left'
    image.setPosition(x, y).setTexture(nextTexture).setAlpha(alpha).setFlipX(flip)
    // The second sprite supplies the half that crosses the opposite tunnel edge.
    wrap.setVisible(x < TILE / 2 || x > WIDTH - TILE / 2)
      .setPosition(x + (x < WIDTH / 2 ? WIDTH : -WIDTH), y)
      .setTexture(nextTexture).setAlpha(alpha).setFlipX(flip)
  }
}

export function steeringKey(event: KeyboardEvent) {
  if (!event.altKey && !event.ctrlKey && !event.metaKey) return keys.get(event.key.toLowerCase())
}

export function hudFor(state: RunView, ready = false): Hud {
  return {
    status: ready ? 'ready' : state.status,
    carried: state.carried,
    banked: state.banked,
    lives: state.lives,
    seconds: Math.ceil((RUN_MS - state.elapsedMs) / 1000),
    powerSeconds: state.status === 'playing' ? Math.max(0, Math.ceil((state.frightenedUntilMs - state.elapsedMs) / 1000)) : 0,
  }
}

type Actor = RunView['player']

function interpolate(from: Actor | undefined, to: Actor, ratio: number): Actor {
  if (!from || ratio === 1) return to
  const columns = MAZE[0].length
  let dx = to.x - from.x
  const dy = to.y - from.y
  if (Math.abs(dx) > columns / 2) dx -= Math.sign(dx) * columns
  // Spawn teleports and long gaps must never animate across walls.
  if (Math.abs(dx) + Math.abs(dy) > 0.65) return to
  const x = ((from.x + ratio * dx + columns + 0.5) % columns) - 0.5
  return { ...to, x, y: from.y + ratio * dy }
}

export function createBoard(parent: HTMLDivElement, onReady?: () => void, onFrame?: (now: number) => void) {
  const reducedEffects = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let state: RunView | null = null
  let previous: RunView | null = null
  let spritesVisible = false
  let changed = false
  let receivedAt = 0
  let draw: ((now: number) => void) | undefined

  const game = new Phaser.Game({
    type: Phaser.CANVAS,
    parent,
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: BACKGROUND,
    pixelArt: true,
    input: { keyboard: false },
    audio: { noAudio: true },
    banner: false,
    scene: {
      preload(this: Phaser.Scene) {
        for (const [name, source] of Object.entries(sprites)) this.load.image(name, source)
      },
      create(this: Phaser.Scene) {
        this.game.canvas.setAttribute('aria-hidden', 'true')
        drawMaze(this)
        const dots = this.add.graphics()
        const pellets = this.add.graphics()
        const ghosts = (['tracer', 'snare', 'relay', 'warden'] as const).map(id => actor(this, id))
        const player = actor(this, 'wallet')

        draw = (now) => {
          if (!state) return
          if (changed) {
            drawPickups(dots, pellets, state)
            changed = false
          }
          pellets.setAlpha(reducedEffects || Math.floor(now / 250) % 2 === 0 ? 1 : 0)
          const duration = previous ? state.elapsedMs - previous.elapsedMs : 0
          const ratio = duration > 0 ? Math.min(1, (now - receivedAt) / Math.min(duration, 80)) : 1
          const { elapsedMs, frightenedUntilMs } = state
          const remainingPower = frightenedUntilMs - elapsedMs
          const flashing = !reducedEffects && remainingPower <= 1400 && Math.floor(remainingPower / 160) % 2 === 0
          state.ghosts.forEach((ghost, i) => {
            let texture: keyof typeof sprites = ghost.id
            if (ghost.mode === 'returning' || ghost.mode === 'recovering') texture = 'returning'
            if (ghost.mode === 'frightened' && !flashing) texture = 'frightened'
            ghosts[i](interpolate(previous?.ghosts[i], ghost, ratio), texture, Number(spritesVisible))
          })
          const protectedPlayer = state.invulnerableUntilMs > elapsedMs
          const dimPlayer = protectedPlayer && (reducedEffects || Math.floor(elapsedMs / 150) % 2 === 1)
          player(interpolate(previous?.player, state.player, ratio), 'wallet', spritesVisible ? (dimPlayer ? 0.6 : 1) : 0)
        }
        onReady?.()
      },
      update() {
        const now = performance.now()
        onFrame?.(now)
        draw?.(now)
      },
    },
  })

  return {
    present(next: RunView, smooth = false, visible = true) {
      previous = smooth && state?.lives === next.lives && next.status === 'playing' ? state : null
      state = next
      spritesVisible = visible
      changed = true
      receivedAt = performance.now()
    },
    destroy: () => game.destroy(true),
  }
}

export function createArcade(parent: HTMLDivElement, onHud: (hud: Hud) => void) {
  let state = createGame(PRACTICE_SEED)
  let startedAt: number | undefined
  let input: Direction | undefined
  let previous: Hud | undefined

  function syncHud() {
    const hud = hudFor(state, startedAt === undefined)
    if (!previous || previous.status !== hud.status || previous.carried !== hud.carried ||
        previous.banked !== hud.banked || previous.lives !== hud.lives ||
        previous.seconds !== hud.seconds || previous.powerSeconds !== hud.powerSeconds) {
      previous = hud
      onHud(hud)
    }
  }

  const board = createBoard(parent, () => {
    board.present(state, false, false)
    syncHud()
  }, now => {
    if (startedAt === undefined || (state.status !== 'playing' && state.queuedDots.length === 0)) return
    const target = now - startedAt
    if (state.elapsedMs + state.terminalRespawnMs + TICK_MS > target) return

    // Pending dots still animate after the scoreboard freezes.
    while (state.elapsedMs + state.terminalRespawnMs + TICK_MS <= target &&
           (state.status === 'playing' || state.queuedDots.length > 0)) {
      stepGame(state, input)
      input = undefined
    }
    board.present(state)
    syncHud()
  })

  return {
    start() {
      state = createGame(PRACTICE_SEED)
      input = undefined
      startedAt = performance.now()
      board.present(state)
      syncHud()
    },
    steer(direction: Direction) {
      if (startedAt !== undefined && state.status === 'playing') input = direction
    },
    destroy: board.destroy,
  }
}
