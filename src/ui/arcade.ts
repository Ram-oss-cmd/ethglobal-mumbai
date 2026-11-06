import Phaser from 'phaser'
import {
  createGame, MAZE, RUN_MS, stepGame, TICK_MS, VAULT,
  type Direction, type GameState,
} from '../game'
import type { RunView } from '../competition/protocol'
import tracer from './assets/tracer.svg'
import snare from './assets/snare.svg'
import relay from './assets/relay.svg'
import warden from './assets/warden.svg'
import frightened from './assets/frightened.svg'
import returning from './assets/returning.svg'
import normalLeft from './assets/normal_looking left-Photoroom.png'
import normalRight from './assets/normal_looking right-Photoroom.png'
import hitLeft from './assets/hit_looking left-Photoroom.png'
import hitRight from './assets/hit_looking right-Photoroom.png'
import starVideo from './assets/star.mp4'

const sprites = {
  tracer,
  snare,
  relay,
  warden,
  frightened,
  returning,
  normal_left: normalLeft,
  normal_right: normalRight,
  hit_left: hitLeft,
  hit_right: hitRight,
}

const TILE_WIDTH = 60
const TILE_HEIGHT = 54
const PLAYER_SIZE = 106
const GHOST_SIZE = 38
const WIDTH = MAZE[0].length * TILE_WIDTH
const HEIGHT = MAZE.length * TILE_HEIGHT
const BACKGROUND = 0x000000
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

function drawMaze(scene: Phaser.Scene) {
  const texture = scene.textures.createCanvas('walls', WIDTH, HEIGHT)!
  const ctx = texture.context
  const columns = MAZE[0].length
  const reach = 24
  const inset = 22
  // Offset contours into blocked cells, leaving simulation tile centers unchanged.
  const wall = (x: number, y: number) => {
    const cell = MAZE[y]?.[Math.max(0, Math.min(x, columns - 1))] ?? '#'
    return cell === '#' || cell === 'G'
  }

  ctx.beginPath()
  for (let y = 0; y <= MAZE.length; y++) {
    for (let x = 0; x <= columns; x++) {
      const left = x * TILE_WIDTH
      const top = y * TILE_HEIGHT
      const cells = [wall(x - 1, y - 1), wall(x, y - 1), wall(x, y), wall(x - 1, y)]
      const edges = cells.map((cell, i) => cell !== cells[(i + 1) % 4])
      const ports = [
        [cells[0] ? -inset : inset, -reach],
        [reach, cells[1] ? -inset : inset],
        [cells[2] ? inset : -inset, reach],
        [-reach, cells[3] ? inset : -inset],
      ]
      if (edges[1] && x < columns) {
        ctx.moveTo(left + reach, top + ports[1][1])
        ctx.lineTo(left + TILE_WIDTH - reach, top + ports[1][1])
      }
      if (edges[2] && y < MAZE.length) {
        ctx.moveTo(left + ports[2][0], top + reach)
        ctx.lineTo(left + ports[2][0], top + TILE_HEIGHT - reach)
      }
      const connect = (a: number, b: number) => {
        const [ax, ay] = ports[a]
        const [bx, by] = ports[b]
        ctx.moveTo(left + ax, top + ay)
        if (a % 2 !== b % 2) ctx.lineTo(left + (a % 2 ? bx : ax), top + (a % 2 ? ay : by))
        ctx.lineTo(left + bx, top + by)
      }
      const joins = [0, 1, 2, 3].filter(i => edges[i])
      if (joins.length === 2) connect(joins[0], joins[1])
      if (joins.length === 4) {
        cells.forEach((cell, i) => { if (cell) connect((i + 3) % 4, i) })
      }
    }
  }
  ctx.lineCap = 'square'
  ctx.lineWidth = 5
  ctx.strokeStyle = '#131d83'
  ctx.stroke()
  ctx.lineWidth = 2.5
  ctx.strokeStyle = '#5362ff'
  ctx.stroke()
  scene.add.image(0, 0, texture).setOrigin(0)

  const g = scene.add.graphics()
  MAZE.forEach((row, y) => {
    const door = row.indexOf('D')
    if (door >= 0) g.fillStyle(0xffa8ce).fillRect(door * TILE_WIDTH + 4, y * TILE_HEIGHT - 1, TILE_WIDTH - 8, 5)
  })
  const vaultX = VAULT.x * TILE_WIDTH
  const threshold = VAULT.y * TILE_HEIGHT
  g.fillStyle(0xafff65).fillRect(vaultX + 1, threshold - 1, TILE_WIDTH - 2, 5)

  const cx = vaultX + Math.round(TILE_WIDTH / 2)
  const cy = threshold + Math.round(TILE_HEIGHT * 0.54)

  g.fillStyle(0xafff65)
  g.beginPath()
  g.moveTo(cx - 11, cy - 13)
  g.lineTo(cx, cy - 13)
  g.lineTo(cx, cy + 14)
  g.lineTo(cx - 11, cy - 1)
  g.closePath()
  g.fillPath()

  g.fillStyle(0x6ddb26)
  g.beginPath()
  g.moveTo(cx, cy - 13)
  g.lineTo(cx + 11, cy - 13)
  g.lineTo(cx + 11, cy - 1)
  g.lineTo(cx, cy + 14)
  g.closePath()
  g.fillPath()

  g.lineStyle(3.5, BACKGROUND)
  g.beginPath()
  g.moveTo(cx - 6, cy)
  g.lineTo(cx - 1.8, cy + 5)
  g.lineTo(cx + 6, cy - 4)
  g.strokePath()
}

function drawPickups(dots: Phaser.GameObjects.Graphics, pellets: Phaser.GameObjects.Graphics, state: RunView) {
  dots.clear().fillStyle(0xffba9d)
  for (const dot of state.dots) {
    const x = (dot.x + 0.5) * TILE_WIDTH
    const y = (dot.y + 0.5) * TILE_HEIGHT
    dots.fillCircle(x, y, 4.5)
  }
  pellets.clear()
  for (const pellet of state.pellets) {
    const x = (pellet.x + 0.5) * TILE_WIDTH
    const y = (pellet.y + 0.5) * TILE_HEIGHT

    pellets.fillStyle(0x627eea, 0.35).fillCircle(x, y, 26)
    pellets.fillStyle(0x9ec7ff, 0.4).fillCircle(x, y, 18)

    pellets.fillStyle(0xffffff).fillTriangle(x, y - 22, x - 15, y + 1, x, y + 8)
    pellets.fillStyle(0xdbe9ff).fillTriangle(x, y - 22, x + 15, y + 1, x, y + 8)

    pellets.fillStyle(0x94c5ff).fillTriangle(x - 15, y + 5, x, y + 12, x, y + 22)
    pellets.fillStyle(0x5b93f8).fillTriangle(x + 15, y + 5, x, y + 12, x, y + 22)

    pellets.fillStyle(0xffffff, 0.95).fillRect(x - 11, y + 2.5, 22, 2)
  }
}

function actor(scene: Phaser.Scene, texture: string, size = GHOST_SIZE, mirror = true) {
  const image = scene.add.image(0, 0, texture).setDisplaySize(size, size).setAlpha(0)
  const wrap = scene.add.image(0, 0, texture).setDisplaySize(size, size).setAlpha(0)
  return (position: GameState['player'], nextTexture: string, alpha = 1) => {
    const x = Math.round((position.x + 0.5) * TILE_WIDTH)
    const y = Math.round((position.y + 0.5) * TILE_HEIGHT)
    const flip = mirror && position.direction === 'left'
    image.setPosition(x, y).setTexture(nextTexture).setDisplaySize(size, size).setAlpha(alpha).setFlipX(flip)
    wrap.setVisible(x < size / 2 || x > WIDTH - size / 2)
      .setPosition(x + (x < WIDTH / 2 ? WIDTH : -WIDTH), y)
      .setTexture(nextTexture).setDisplaySize(size, size).setAlpha(alpha).setFlipX(flip)
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
  let lastBanked = 0
  let bankFlashUntil = 0
  let draw: ((now: number) => void) | undefined
  let playerFacing: 'left' | 'right' = 'left'

  const domStar = document.createElement('video')
  domStar.src = starVideo
  domStar.muted = true
  domStar.loop = true
  domStar.preload = 'none'
  domStar.playsInline = true
  domStar.setAttribute('aria-hidden', 'true')
  domStar.className = 'star-video-overlay'
  domStar.style.display = 'none'
  parent.appendChild(domStar)

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
        for (const key of ['normal_left', 'normal_right', 'hit_left', 'hit_right']) {
          this.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR)
        }
        drawMaze(this)
        const dots = this.add.graphics()
        const pellets = this.add.graphics()
        const bankFlash = this.add.rectangle((VAULT.x + 0.5) * TILE_WIDTH, VAULT.y * TILE_HEIGHT, TILE_WIDTH - 2, 7, 0xeaffd9)
          .setVisible(false)
        const ghosts = (['tracer', 'snare', 'relay', 'warden'] as const).map(id => actor(this, id))
        const player = actor(this, 'normal_left', PLAYER_SIZE, false)

        draw = (now) => {
          if (!state) return
          if (changed) {
            drawPickups(dots, pellets, state)
            changed = false
          }
          pellets.setAlpha(reducedEffects || Math.floor(now / 250) % 2 === 0 ? 1 : 0)
          bankFlash.setVisible(!reducedEffects && now < bankFlashUntil)
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

          if (state.player.direction === 'left') playerFacing = 'left'
          else if (state.player.direction === 'right') playerFacing = 'right'

          const isEaten = state.respawnAtMs > elapsedMs || state.status === 'out-of-lives'
          const pos = interpolate(previous?.player, state.player, ratio)
          const protectedPlayer = state.invulnerableUntilMs > elapsedMs
          const dimPlayer = protectedPlayer && (reducedEffects || Math.floor(elapsedMs / 150) % 2 === 1)
          player(pos, `${isEaten ? 'hit' : 'normal'}_${playerFacing}`, spritesVisible ? (dimPlayer ? 0.6 : 1) : 0)

          if (!reducedEffects && isEaten && spritesVisible) {
            domStar.style.display = 'block'
            domStar.style.left = `${(pos.x + 0.5) * TILE_WIDTH / WIDTH * 100}%`
            domStar.style.top = `${((pos.y + 0.5) * TILE_HEIGHT - 52) / HEIGHT * 100}%`
            if (domStar.paused) void domStar.play().catch(() => {})
          } else {
            domStar.style.display = 'none'
            if (!domStar.paused) domStar.pause()
          }
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
      if (next.elapsedMs === 0 || (state?.respawnAtMs && next.respawnAtMs === 0 && next.status === 'playing')) {
        playerFacing = 'left'
      }
      // Show the ghost catch immediately so interpolation cannot slide actors during the freeze.
      previous = smooth && state?.lives === next.lives && next.status === 'playing' &&
        state.ghostPauseUntilMs === next.ghostPauseUntilMs ? state : null
      state = next
      spritesVisible = visible
      changed = true
      receivedAt = performance.now()
      if (next.banked > lastBanked) bankFlashUntil = receivedAt + 350
      else if (next.banked < lastBanked) bankFlashUntil = 0
      lastBanked = next.banked
    },
    destroy: () => {
      domStar.remove()
      game.destroy(true)
    },
  }
}

export function createArcade(parent: HTMLDivElement, onHud: (hud: Hud) => void) {
  const newRun = () => createGame(crypto.getRandomValues(new Uint32Array(1))[0])
  let state = newRun()
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
      if (startedAt !== undefined) state = newRun()
      input = 'left'
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
