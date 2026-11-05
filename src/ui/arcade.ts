import Phaser from 'phaser'
import {
  createGame, GHOST_HOME, MAZE, RUN_MS, stepGame, TICK_MS, VAULT,
  type Direction, type GameState,
} from '../game'
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
const BACKGROUND = 0x0b111c
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
  notice: string
}

function drawMaze(g: Phaser.GameObjects.Graphics) {
  MAZE.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const left = x * TILE
      const top = y * TILE
      if (row[x] === '#') {
        g.fillStyle((x + y) % 2 ? 0x1b2942 : 0x1a273d).fillRect(left, top, TILE, TILE)
        g.fillStyle(0x28374f).fillRect(left + 5, top + 5, TILE - 10, 1)
        g.fillStyle(0x3b5276)
        if (x === 0 || row[x - 1] !== '#') g.fillRect(left, top, 2, TILE)
        if (y === 0 || MAZE[y - 1][x] !== '#') g.fillRect(left, top, TILE, 2)
        g.fillStyle(0x476289)
        if (x === row.length - 1 || row[x + 1] !== '#') g.fillRect(left + TILE - 2, top, 2, TILE)
        if (y === MAZE.length - 1 || MAZE[y + 1][x] !== '#') g.fillRect(left, top + TILE - 2, TILE, 2)
      } else if (row[x] === 'V') {
        g.fillStyle(0x123831).fillRect(left, top, TILE, TILE)
        g.fillStyle(0x235b4c).fillRect(left + 2, top + 5, TILE - 4, TILE - 7)
      } else {
        g.fillStyle(0x142033).fillRect(left + TILE / 2 - 1, top + TILE / 2 - 1, 2, 2)
        if (x === 0 || x === row.length - 1) {
          const edge = x === 0 ? left : left + TILE - 3
          g.fillStyle(0x50708d).fillRect(edge, top + 3, 3, 4).fillRect(edge, top + TILE - 7, 3, 4)
        }
      }
    }
  })

  const vaultX = VAULT.x * TILE
  const threshold = VAULT.y * TILE
  g.fillStyle(0xa9ff98).fillRect(vaultX, threshold - 1, TILE, 3)
  g.fillStyle(0x4cc696)
    .fillRect(vaultX, threshold + 2, 2, TILE - 3)
    .fillRect(vaultX + TILE - 2, threshold + 2, 2, TILE - 3)
  g.fillStyle(0x98f5b3)
    .fillRect(vaultX + 9, threshold + 13, 10, 8)
    .fillRect(vaultX + 12, threshold + 9, 4, 2)
    .fillRect(vaultX + 10, threshold + 11, 2, 2)
    .fillRect(vaultX + 16, threshold + 11, 2, 2)
  g.fillStyle(0x123831).fillRect(vaultX + 13, threshold + 15, 2, 4)

  const homeX = GHOST_HOME.x * TILE
  const homeY = GHOST_HOME.y * TILE
  g.lineStyle(1, 0x435779).strokeRect(homeX + 3, homeY + 3, TILE - 6, TILE - 6)
}

function drawPickups(g: Phaser.GameObjects.Graphics, state: GameState) {
  g.clear()
  for (const dot of state.dots) {
    const x = (dot.x + 0.5) * TILE
    const y = (dot.y + 0.5) * TILE
    g.fillStyle(0x8e612c).fillRect(x - 3, y - 3, 6, 6)
    g.fillStyle(0xffd478).fillRect(x - 2, y - 2, 4, 4)
  }
  for (const pellet of state.pellets) {
    const x = (pellet.x + 0.5) * TILE
    const y = (pellet.y + 0.5) * TILE
    g.fillStyle(0xe0d1ff).fillTriangle(x, y - 9, x - 6, y + 1, x, y + 4)
    g.fillStyle(0x9f7bff).fillTriangle(x, y - 9, x + 6, y + 1, x, y + 4)
    g.fillStyle(0xbda7ff).fillTriangle(x - 6, y + 3, x, y + 6, x, y + 9)
    g.fillStyle(0x7959d4).fillTriangle(x + 6, y + 3, x, y + 6, x, y + 9)
  }
}

function actor(scene: Phaser.Scene, texture: string) {
  const image = scene.add.image(0, 0, texture).setDisplaySize(26, 26)
  const wrap = scene.add.image(0, 0, texture).setDisplaySize(26, 26)
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

export function createArcade(parent: HTMLDivElement, onHud: (hud: Hud) => void) {
  const reducedEffects = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let state = createGame(PRACTICE_SEED)
  let startedAt: number | undefined
  let input: Direction | undefined
  let notice = 'Enter the maze when you are ready.'
  let previous: Hud | undefined
  let draw: (() => void) | undefined

  function syncHud() {
    const hud: Hud = {
      status: startedAt === undefined ? 'ready' : state.status,
      carried: state.carried,
      banked: state.banked,
      lives: state.lives,
      seconds: Math.ceil((RUN_MS - state.elapsedMs) / 1000),
      powerSeconds: Math.max(0, Math.ceil((state.frightenedUntilMs - state.elapsedMs) / 1000)),
      notice,
    }
    if (!previous || previous.status !== hud.status || previous.carried !== hud.carried ||
        previous.banked !== hud.banked || previous.lives !== hud.lives ||
        previous.seconds !== hud.seconds || previous.powerSeconds !== hud.powerSeconds ||
        previous.notice !== hud.notice) {
      previous = hud
      onHud(hud)
    }
  }

  function steer(direction: Direction) {
    if (startedAt !== undefined && state.status === 'playing') input = direction
  }

  const game = new Phaser.Game({
    type: Phaser.CANVAS,
    parent,
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: BACKGROUND,
    pixelArt: true,
    input: { keyboard: { target: parent } },
    audio: { noAudio: true },
    banner: false,
    scene: {
      preload(this: Phaser.Scene) {
        for (const [name, source] of Object.entries(sprites)) this.load.image(name, source)
      },
      create(this: Phaser.Scene) {
        this.game.canvas.setAttribute('aria-hidden', 'true')
        drawMaze(this.add.graphics())
        const pickups = this.add.graphics()
        const ghosts = state.ghosts.map((ghost) => actor(this, ghost.id))
        const player = actor(this, 'wallet')

        draw = () => {
          drawPickups(pickups, state)
          state.ghosts.forEach((ghost, i) => {
            const remainingPower = state.frightenedUntilMs - state.elapsedMs
            const flashing = !reducedEffects && remainingPower <= 1400 && Math.floor(remainingPower / 160) % 2 === 0
            let texture: keyof typeof sprites = ghost.id
            if (ghost.mode === 'returning' || ghost.mode === 'recovering') texture = 'returning'
            if (ghost.mode === 'frightened' && !flashing) texture = 'frightened'
            ghosts[i](ghost, texture)
          })
          const protectedPlayer = state.invulnerableUntilMs > state.elapsedMs
          const dimPlayer = protectedPlayer && (reducedEffects || Math.floor(state.elapsedMs / 150) % 2 === 1)
          player(state.player, 'wallet', dimPlayer ? 0.6 : 1)
        }

        this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
          const direction = keys.get(event.key.toLowerCase())
          if (!direction || event.altKey || event.ctrlKey || event.metaKey ||
              startedAt === undefined || state.status !== 'playing') return
          event.preventDefault()
          if (!event.repeat) steer(direction)
        })
        draw()
      },
      update() {
        if (startedAt === undefined || (state.status !== 'playing' && state.queuedDots.length === 0)) return
        const target = performance.now() - startedAt
        if (state.elapsedMs + state.terminalRespawnMs + TICK_MS > target) return

        const lives = state.lives
        const banked = state.banked
        // Pending dots still animate after the scoreboard freezes.
        while (state.elapsedMs + state.terminalRespawnMs + TICK_MS <= target &&
               (state.status === 'playing' || state.queuedDots.length > 0)) {
          stepGame(state, input)
          input = undefined
        }
        if (state.lives < lives) notice = 'Life lost. Carried coins return to your route.'
        if (state.banked > banked) notice = `+${state.banked - banked} secured at the vault.`
        draw?.()
        syncHud()
      },
    },
  })

  syncHud()
  return {
    start() {
      state = createGame(PRACTICE_SEED)
      input = undefined
      startedAt = performance.now()
      notice = 'Run live. Collect coins and bring them to the vault.'
      draw?.()
      syncHud()
    },
    steer,
    destroy: () => game.destroy(true),
  }
}
