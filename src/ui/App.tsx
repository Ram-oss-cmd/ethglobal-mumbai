import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { BOARD_ASPECT, createArcade, steeringKey, type Hud } from './arcade'
import { ArenaFooter, endings, initialHud, Scoreboard, TouchControls } from './CabinetHud'
import Competition from './Competition'
import './style.css'

const History = lazy(() => import('../history/History'))
const PrizeLobby = lazy(() => import('../web3/PrizeLobby'))
type Mode = 'practice' | 'casual' | 'prize' | 'history'

export default function App() {
  const replayId = /^\/replay\/([a-z0-9-]{3,32})\/?$/.exec(location.pathname)?.[1]
  const [mode, setMode] = useState<Mode>(() => {
    const match = new URLSearchParams(location.search).get('match')
    if (replayId || location.pathname === '/history') return 'history'
    if (match?.startsWith('prize-')) return 'prize'
    return match ? 'casual' : 'practice'
  })
  function changeMode(next: Mode) {
    if (next === mode) return
    history.replaceState(null, '', next === 'history' ? '/history' : '/')
    setMode(next)
  }

  return (
    <main className={`cabinet${mode === 'casual' || mode === 'prize' ? ' cabinet-live' : ''}`}>
      <h1 className="sr-only">Wallet Rush</h1>
      <nav className="mode-switch" aria-label="Game mode">
        <button type="button" aria-pressed={mode === 'practice'} onClick={() => changeMode('practice')}>Practice</button>
        <button type="button" aria-pressed={mode === 'casual'} onClick={() => changeMode('casual')}>Two players</button>
        <button type="button" aria-pressed={mode === 'prize'} onClick={() => changeMode('prize')}>Prize match</button>
        <button type="button" aria-pressed={mode === 'history'} onClick={() => changeMode('history')}>Match history</button>
      </nav>
      <Suspense fallback={<p role="status">Loading…</p>}>
        {mode === 'practice' && <Practice />}
        {mode === 'casual' && <Competition />}
        {mode === 'prize' && <PrizeLobby />}
        {mode === 'history' && <History key={replayId ?? 'history'} matchId={replayId} />}
      </Suspense>
    </main>
  )
}

function Practice() {
  const board = useRef<HTMLDivElement>(null)
  const engine = useRef<ReturnType<typeof createArcade> | null>(null)
  const [hud, setHud] = useState<Hud>()
  const { status } = hud ?? initialHud
  const live = status === 'playing'
  const ready = status === 'ready'

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
    <>
      <Scoreboard {...(hud ?? initialHud)} />

      <div className="maze-shell">
        <div
          className="maze"
          ref={board}
          tabIndex={0}
          role="region"
          aria-label="Wallet Rush maze"
          aria-description="Move with the arrow keys or WASD. Cross the green line to bank coins."
          style={{ aspectRatio: BOARD_ASPECT }}
          onKeyDown={event => {
            const direction = steeringKey(event.nativeEvent)
            if (!direction || !live) return
            event.preventDefault()
            if (!event.repeat) engine.current?.steer(direction)
          }}
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

      <ArenaFooter {...(hud ?? initialHud)} onRestart={live ? start : undefined} />
      <TouchControls disabled={!live} steer={direction => engine.current?.steer(direction)} />
    </>
  )
}
