import Phaser from 'phaser'
import {
  createGame, RUN_MS, stepGame, TICK_MS,
  type Direction, type GameState,
} from '../game'
import type { RunView } from '../competition/protocol'
import type { MazeId } from '../game/maze'
import {
  board, boards, GHOST_SIZE, interpolateActor, TILE_WIDTH, WALL_STROKE,
} from './mazeGeometry'

import redLeft from './assets/red elon left.jpg'
import redRight from './assets/red elon right.jpg'
import pinkLeft from './assets/pink elon left.jpg'
import pinkRight from './assets/pink elon right.jpg'
import blueLeft from './assets/blue elon left.jpg'
import blueRight from './assets/blue elon right.jpg'
import yellowLeft from './assets/yellow elon left.jpg'
import yellowRight from './assets/yellow elon right.jpg'
import sad from './assets/elon sad.png'
import normalLeft from './assets/normal_looking left-Photoroom.png'
import normalRight from './assets/normal_looking right-Photoroom.png'
import hitLeft from './assets/hit_looking left-Photoroom.png'
import hitRight from './assets/hit_looking right-Photoroom.png'
import starVideo from './assets/star.mp4'

export { BOARD_ASPECT } from './mazeGeometry'

const ghostPhotos = {
  red_left: redLeft,
  red_right: redRight,
  pink_left: pinkLeft,
  pink_right: pinkRight,
  blue_left: blueLeft,
  blue_right: blueRight,
  yellow_left: yellowLeft,
  yellow_right: yellowRight,
}
const ghostColors = { tracer: 'red', snare: 'pink', relay: 'blue', warden: 'yellow' } as const
type Facing = 'left' | 'right'

const sprites = {
  sad,
  normal_left: normalLeft,
  normal_right: normalRight,
  hit_left: hitLeft,
  hit_right: hitRight,
}

const BACKGROUND = 0x000000
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

function addWalls(parent: HTMLDivElement, layout: typeof board) {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`)
  svg.classList.add('maze-walls')
  // Cap the screen-space stroke on small boards before opposing wall edges can merge.
  svg.style.strokeWidth = `min(${WALL_STROKE}px, .20cqw)`
  function path(data: string, color: string) {
    const line = document.createElementNS(ns, 'path')
    line.setAttribute('d', data)
    line.setAttribute('fill', 'none')
    line.setAttribute('stroke', color)
    line.setAttribute('vector-effect', 'non-scaling-stroke')
    svg.append(line)
  }
  path(layout.wallPaths.map(points => {
    const closed = points[0] === points.at(-1)
    const tail = points.slice(1, closed ? -1 : undefined)
    return `M${points[0].join(' ')} L${tail.map(point => point.join(' ')).join(' ')}${closed ? ' Z' : ''}`
  }).join(' '), layout.wallColor)
  path(`M${layout.gate[0].join(' ')} L${layout.gate[1].join(' ')}`, '#ffa8ce')
  parent.append(svg)
  return svg
}

function drawVault(scene: Phaser.Scene, VAULT: typeof board.vault, TILE_HEIGHT: number) {
  const g = scene.add.graphics()
  const vaultX = VAULT.x * TILE_WIDTH
  const threshold = VAULT.y * TILE_HEIGHT
  g.fillStyle(0xafff65).fillRect(vaultX + 1, threshold - WALL_STROKE / 2, TILE_WIDTH - 2, WALL_STROKE)

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

function drawPickups(dots: Phaser.GameObjects.Graphics, pellets: Phaser.GameObjects.Graphics, state: RunView, TILE_HEIGHT: number) {
  dots.clear().fillStyle(0xffba9d)
  for (const dot of state.dots) {
    const x = (dot.x + 0.5) * TILE_WIDTH
    const y = (dot.y + 0.5) * TILE_HEIGHT
    dots.fillCircle(x, y, 6)
  }
  pellets.clear()
  for (const pellet of state.pellets) {
    const x = (pellet.x + 0.5) * TILE_WIDTH
    const y = (pellet.y + 0.5) * TILE_HEIGHT

    pellets.fillStyle(0x627eea, 0.35).fillCircle(x, y, 29)
    pellets.fillStyle(0x9ec7ff, 0.4).fillCircle(x, y, 20)

    pellets.fillStyle(0xffffff).fillTriangle(x, y - 25, x - 17, y + 1, x, y + 9)
    pellets.fillStyle(0xdbe9ff).fillTriangle(x, y - 25, x + 17, y + 1, x, y + 9)

    pellets.fillStyle(0x94c5ff).fillTriangle(x - 17, y + 6, x, y + 14, x, y + 25)
    pellets.fillStyle(0x5b93f8).fillTriangle(x + 17, y + 6, x, y + 14, x, y + 25)

    pellets.fillStyle(0xffffff, 0.95).fillRect(x - 12, y + 3, 24, 2)
  }
}

function prepareGhostPhotos(textures: Phaser.Textures.TextureManager) {
  for (const name of Object.keys(ghostPhotos)) {
    const source = textures.get(`${name}_photo`).getSourceImage() as HTMLImageElement
    const texture = textures.createCanvas(name, source.width, source.height)!
    const context = texture.getContext()
    context.drawImage(source, 0, 0)
    const frame = context.getImageData(0, 0, source.width, source.height)
    const { data } = frame
    // Key out the JPEG's white backing while keeping the tinted face and soft edges.
    for (let i = 0; i < data.length; i += 4) {
      const whiteLevel = Math.min(data[i], data[i + 1], data[i + 2])
      data[i + 3] = Math.max(0, (248 - whiteLevel) * 16)
    }
    context.putImageData(frame, 0, 0)
    texture.refresh()
    textures.remove(`${name}_photo`)
  }
}

function actor(scene: Phaser.Scene, texture: string, WIDTH: number, TILE_HEIGHT: number, baseSize = GHOST_SIZE) {
  const size = baseSize * 2
  const image = scene.add.image(0, 0, texture).setDisplaySize(size, size).setAlpha(0)
  const wrap = scene.add.image(0, 0, texture).setDisplaySize(size, size).setAlpha(0)
  return (position: GameState['player'], nextTexture: string, alpha = 1) => {
    const x = Math.round((position.x + 0.5) * TILE_WIDTH)
    const y = Math.round((position.y + 0.5) * TILE_HEIGHT)
    image.setPosition(x, y).setTexture(nextTexture).setDisplaySize(size, size).setAlpha(alpha)
    wrap.setVisible(x < size / 2 || x > WIDTH - size / 2)
      .setPosition(x + (x < WIDTH / 2 ? WIDTH : -WIDTH), y)
      .setTexture(nextTexture).setDisplaySize(size, size).setAlpha(alpha)
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

export function createBoard(parent: HTMLDivElement, onReady?: () => void, onFrame?: (now: number) => void, mazeId: MazeId = 'classic') {
  const layout = boards[mazeId]
  const { width: WIDTH, height: HEIGHT, vault: VAULT, tileHeight: TILE_HEIGHT, playerSize } = layout
  const columns = WIDTH / TILE_WIDTH
  const walls = addWalls(parent, layout)
  const reducedEffects = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let state: RunView | null = null
  let previous: RunView | null = null
  let spritesVisible = false
  let changed = false
  let receivedAt = 0
  let lastBanked = 0
  let bankFlashUntil = 0
  let draw: ((now: number) => void) | undefined
  let playerFacing: Facing = 'left'
  const ghostFacing = new Map<keyof typeof ghostColors, Facing>()
  const starRadius = playerSize * .575

  const domStar = document.createElement('video')
  domStar.src = starVideo
  domStar.muted = true
  domStar.loop = true
  domStar.preload = 'none'
  domStar.playsInline = true
  domStar.setAttribute('aria-hidden', 'true')
  domStar.className = 'star-video-overlay'
  domStar.style.width = `${2 * starRadius / WIDTH * 100}%`
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
        for (const [name, source] of Object.entries(ghostPhotos)) this.load.image(`${name}_photo`, source)
      },
      create(this: Phaser.Scene) {
        prepareGhostPhotos(this.textures)
        this.game.canvas.setAttribute('aria-hidden', 'true')
        this.game.canvas.style.imageRendering = 'auto'
        for (const key of ['normal_left', 'normal_right', 'hit_left', 'hit_right']) {
          this.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR)
        }
        drawVault(this, VAULT, TILE_HEIGHT)
        const dots = this.add.graphics()
        const pellets = this.add.graphics()
        const bankFlash = this.add.rectangle((VAULT.x + 0.5) * TILE_WIDTH, VAULT.y * TILE_HEIGHT, TILE_WIDTH - 2, WALL_STROKE, 0xeaffd9)
          .setVisible(false)
        const ghosts = Object.values(ghostColors).map(color => actor(this, `${color}_left`, WIDTH, TILE_HEIGHT))
        const player = actor(this, 'normal_left', WIDTH, TILE_HEIGHT, playerSize)

        draw = (now) => {
          if (!state) return
          if (changed) {
            drawPickups(dots, pellets, state, TILE_HEIGHT)
            changed = false
          }
          pellets.setAlpha(reducedEffects || Math.floor(now / 250) % 2 === 0 ? 1 : 0)
          bankFlash.setVisible(!reducedEffects && now < bankFlashUntil)
          const duration = previous ? state.elapsedMs - previous.elapsedMs : 0
          const ratio = duration > 0 ? Math.min(1, (now - receivedAt) / Math.min(duration, 80)) : 1
          const { elapsedMs, frightenedUntilMs, eatenGhostId, ghostPauseUntilMs, status } = state
          state.ghosts.forEach((ghost, i) => {
            if (ghost.direction === 'left' || ghost.direction === 'right') ghostFacing.set(ghost.id, ghost.direction)
            const facing = ghostFacing.get(ghost.id) ?? 'left'
            const color = elapsedMs < frightenedUntilMs && ghost.mode !== 'returning' ? 'blue' : ghostColors[ghost.id]
            const eaten = ghost.id === eatenGhostId && elapsedMs < ghostPauseUntilMs && status === 'playing'
            const texture = eaten ? 'sad' : `${color}_${facing}`
            ghosts[i](interpolateActor(previous?.ghosts[i], ghost, ratio, columns), texture, Number(spritesVisible))
          })

          if (state.player.direction === 'left') playerFacing = 'left'
          else if (state.player.direction === 'right') playerFacing = 'right'

          const isEaten = state.respawnAtMs > elapsedMs || state.status === 'out-of-lives'
          const pos = interpolateActor(previous?.player, state.player, ratio, columns)
          const protectedPlayer = state.invulnerableUntilMs > elapsedMs
          const dimPlayer = protectedPlayer && (reducedEffects || Math.floor(elapsedMs / 150) % 2 === 1)
          player(pos, `${isEaten ? 'hit' : 'normal'}_${playerFacing}`, spritesVisible ? (dimPlayer ? 0.6 : 1) : 0)

          if (!reducedEffects && isEaten && spritesVisible) {
            const x = Phaser.Math.Clamp((pos.x + 0.5) * TILE_WIDTH, starRadius, WIDTH - starRadius)
            const y = Math.max(starRadius, (pos.y + 0.5) * TILE_HEIGHT - playerSize * .8)
            domStar.style.display = 'block'
            domStar.style.left = `${x / WIDTH * 100}%`
            domStar.style.top = `${y / HEIGHT * 100}%`
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
      if (!next.elapsedMs || (state && next.elapsedMs < state.elapsedMs)) ghostFacing.clear()
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
      walls.remove()
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
