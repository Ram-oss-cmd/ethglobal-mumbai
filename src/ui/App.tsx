import { useEffect, useRef, useState } from 'react'
import { RUN_MS, TOTAL_DOTS, type Direction } from '../game'
import { BOARD_ASPECT, createArcade, type Hud } from './arcade'
import wallet from './assets/wallet.svg'
import './style.css'

const initialHud: Hud = {
  status: 'ready',
  carried: 0,
  banked: 0,
  lives: 3,
  seconds: RUN_MS / 1000,
  powerSeconds: 0,
  notice: 'Enter the maze when you are ready.',
}

const endings = {
  ready: '',
  playing: '',
  timeout: 'Time expired.',
  'out-of-lives': 'Out of lives.',
  'full-clear': 'Vault cleared.',
} as const

const arrows: Record<Direction, string> = {
  up: '↑',
  left: '←',
  down: '↓',
  right: '→',
}

export default function App() {
  const board = useRef<HTMLDivElement>(null)
  const engine = useRef<ReturnType<typeof createArcade> | null>(null)
  const [hud, setHud] = useState(initialHud)
  const live = hud.status === 'playing'
  const ready = hud.status === 'ready'

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

  const ending = endings[hud.status]
  const clock = `${Math.floor(hud.seconds / 60)}:${String(hud.seconds % 60).padStart(2, '0')}`

  return (
    <main className="cabinet">
      <header className="masthead">
        <div className="brand">
          <img src={wallet} alt="" width="42" height="42" />
          <div>
            <h1>Wallet Rush</h1>
            <p>Collect. Escape. Bank. Win.</p>
          </div>
        </div>
        <span className="mode-label"><i aria-hidden="true" /> Practice mode</span>
      </header>

      <div className="cabinet-layout">
        <section className="arena" aria-label="Practice arena">
          <dl className="scoreboard">
            <div className="score scoreboard-carried">
              <dt>Carried</dt>
              <dd>{hud.carried}</dd>
            </div>
            <div className="score scoreboard-banked">
              <dt>Banked</dt>
              <dd>{hud.banked}</dd>
            </div>
            <div className="score">
              <dt>Lives</dt>
              <dd>{hud.lives}<span className="life-meter" aria-hidden="true">
                {[1, 2, 3].map((life) => <i key={life} className={life <= hud.lives ? 'life-active' : undefined} />)}
              </span></dd>
            </div>
            <div className={hud.seconds <= 10 ? 'score score-urgent' : 'score'}>
              <dt>Time left</dt>
              <dd>{clock}</dd>
            </div>
          </dl>

          <div className="maze-shell">
            <div
              className="maze"
              ref={board}
              tabIndex={0}
              role="region"
              aria-label="Wallet Rush maze"
              aria-describedby="movement-help"
              style={{ aspectRatio: BOARD_ASPECT }}
            />
            {!live && (
              <div className="run-screen">
                <div className="run-panel">
                  <span className="run-kicker">{ready ? 'SOLO PRACTICE' : 'RUN COMPLETE'}</span>
                  <h2>{ready ? 'Ready to rush?' : ending}</h2>
                  <p>{ready ? 'Three lives. Ninety seconds. One vault.' : `${hud.banked} of ${TOTAL_DOTS} points banked.`}</p>
                  <button className="primary" type="button" onClick={start}>
                    <span aria-hidden="true">{ready ? '▶' : '↻'}</span>
                    {ready ? 'Start practice' : 'Play again'}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="arena-footer">
            <p className={hud.powerSeconds > 0 ? 'power power-active' : 'power'}>
              <span className="power-glyph" aria-hidden="true" />
              {hud.powerSeconds > 0 ? `Power active · ${hud.powerSeconds}s` : 'Power offline'}
            </p>
            <span className="arena-index">MAZE 01</span>
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
        </section>

        <aside className="side-panel" aria-label="Run guide">
          <section className="side-section">
            <p className="eyebrow"><span>01</span> / RUN STATUS</p>
            <div className="status-row">
              <h2>{ready ? 'Standby' : live ? 'Run live' : 'Finished'}</h2>
              <span className={live ? 'status-chip status-live' : 'status-chip'}>
                <i aria-hidden="true" /> {ready ? 'READY' : live ? 'LIVE' : 'END'}
              </span>
            </div>
            <p className="notice" role="status">{ending || hud.notice}</p>
            <label className="progress-label" htmlFor="vault-progress">
              <span>Vault progress</span>
              <strong>{hud.banked} / {TOTAL_DOTS}</strong>
            </label>
            <progress id="vault-progress" value={hud.banked} max={TOTAL_DOTS} />
          </section>

          <section className="side-section">
            <p className="eyebrow"><span>02</span> / CONTROLS</p>
            <h2 id="movement-help">Steer with arrows or WASD</h2>
            <div className="keys" aria-hidden="true">
              {['↑', '←', '↓', '→'].map((key) => <kbd key={key}>{key}</kbd>)}
              <span />
              {['W', 'A', 'S', 'D'].map((key) => <kbd key={key}>{key}</kbd>)}
            </div>
            <p>Tap before a turn to queue it. The side tunnels wrap around.</p>
            {live && <button className="restart" type="button" onClick={start}>↻ &nbsp; Restart run</button>}
          </section>

          <section className="side-section field-guide">
            <p className="eyebrow"><span>03</span> / FIELD GUIDE</p>
            <dl>
              <div><span className="legend legend-coin" aria-hidden="true" /><dt>Coins</dt><dd>Each dot carries one point. A hit drops your carried coins.</dd></div>
              <div><span className="legend legend-vault" aria-hidden="true" /><dt>Vault</dt><dd>Cross the green line at the bottom to bank automatically.</dd></div>
              <div><span className="legend legend-power" aria-hidden="true" /><dt>Power</dt><dd>Grab a purple diamond to make the ghosts vulnerable.</dd></div>
            </dl>
          </section>
        </aside>
      </div>
    </main>
  )
}
