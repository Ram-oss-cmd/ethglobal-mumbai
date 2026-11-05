import { useEffect, useRef, useState } from 'react'
import { RUN_MS, type Direction } from '../game'
import { BOARD_ASPECT, createArcade, type Hud } from './arcade'
import wallet from './assets/wallet.svg'
import walletOutline from './assets/wallet-outline.svg'
import './style.css'

const initialHud: Hud = {
  status: 'ready', carried: 0, banked: 0, lives: 3, seconds: RUN_MS / 1000, powerSeconds: 0,
}

const endings = {
  ready: '',
  playing: '',
  timeout: 'Time up',
  'out-of-lives': 'Game over',
  'full-clear': 'Vault cleared',
} as const

const arrows: Record<Direction, string> = { up: '↑', left: '←', down: '↓', right: '→' }

export default function App() {
  const board = useRef<HTMLDivElement>(null)
  const engine = useRef<ReturnType<typeof createArcade> | null>(null)
  const [hud, setHud] = useState<Hud>()
  const { status, carried, banked, lives, seconds, powerSeconds } = hud ?? initialHud
  const live = status === 'playing'
  const ready = status === 'ready'
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

  useEffect(() => {
    // Wait until after React's development setup/cleanup pass to boot the canvas.
    const frame = requestAnimationFrame(() => {
      if (board.current) engine.current = createArcade(board.current, setHud)
    })
    return () => {
      cancelAnimationFrame(frame)
      engine.current?.destroy()
      engine.current = null
    }
  }, [])

  function start() {
    engine.current?.start()
    board.current?.focus({ preventScroll: true })
  }

  return (
    <main className="cabinet">
      <h1 className="sr-only">Wallet Rush</h1>
      <dl className="scoreboard">
        <div><dt>Carried</dt><dd className="score-carried">{carried}</dd></div>
        <div><dt>Banked</dt><dd>{banked}</dd></div>
        <div><dt>Time</dt><dd className={seconds <= 10 ? 'score-urgent' : undefined}>{clock}</dd></div>
      </dl>

      <div className="maze-shell">
        <div
          className="maze"
          ref={board}
          tabIndex={0}
          role="region"
          aria-label="Wallet Rush maze"
          aria-description="Move with the arrow keys or WASD. Cross the green line to bank coins."
          style={{ aspectRatio: BOARD_ASPECT }}
        />
        {!live && (
          <div className="run-screen">
            {endings[status] && <h2 role="status">{endings[status]}</h2>}
            <button className="play" type="button" onClick={start} disabled={!hud}>
              {ready ? 'Start practice' : 'Play again'}
            </button>
          </div>
        )}
      </div>

      <div className="arena-footer">
        <div className="life-meter" role="img" aria-label={`${lives} lives remaining`}>
          {[1, 2, 3].map((life) => <img key={life} src={life <= lives ? wallet : walletOutline} alt="" />)}
        </div>
        <span className="power" role="status">{powerSeconds > 0 && `◆ ${powerSeconds}s`}</span>
        {live && <button className="restart" type="button" aria-label="Restart run" title="Restart run" onClick={start}>↻</button>}
      </div>

      <div className="dpad" role="group" aria-label="Touch movement controls">
        {(Object.keys(arrows) as Direction[]).map((direction) => (
          <button
            key={direction}
            type="button"
            className={`dpad-${direction}`}
            aria-label={`Move ${direction}`}
            disabled={!live}
            onClick={() => engine.current?.steer(direction)}
          >{arrows[direction]}</button>
        ))}
      </div>
    </main>
  )
}
