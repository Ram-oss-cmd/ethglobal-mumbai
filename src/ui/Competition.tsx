import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MATCH_SOCKET_PATH, type ClientMessage, type MatchRecord, type MatchResult, type RunView,
  type Seat, type ServerMessage,
} from '../competition/protocol'
import { replayRun } from '../competition/run'
import { TICK_MS } from '../game'
import { createBoard, hudFor, steeringKey } from './arcade'
import { boards } from './mazeGeometry'
import type { MazeId } from '../game/maze'
import { ArenaFooter, endings, initialHud, Scoreboard, TouchControls } from './CabinetHud'
import PrizeFunding from '../web3/PrizeFunding'
import type { PrizeMember } from '../web3/api'

type MatchState = Extract<ServerMessage, { type: 'state' }>
type Join = Extract<ServerMessage, { type: 'joined' }>

export default function Competition({ matchId, leave, prize, initialStakeUnits, balance }: {
  matchId: string; leave: () => void; prize?: PrizeMember; initialStakeUnits?: number; balance?: bigint | null
}) {
  const ws = useRef<WebSocket | null>(null)
  const [join, setJoin] = useState<Join | null>(null)
  const [snapshot, setSnapshot] = useState<MatchState | null>(null)
  const [record, setRecord] = useState<MatchRecord | null>(null)
  const [replay, setReplay] = useState<Seat | null>(null)
  const [connection, setConnection] = useState<'connecting' | 'online' | 'reconnecting' | 'closed'>('connecting')
  const [error, setError] = useState('')
  const [invite, setInvite] = useState<'copied' | 'unavailable'>()
  const prizeToken = prize?.token
  const prizeWallet = prize?.address.toLowerCase()

  useEffect(() => {
    const storageKey = prizeWallet ? `wallet-rush:seat:${prizeWallet}:${matchId}` : `wallet-rush:seat:${matchId}`
    let resumeToken = sessionStorage.getItem(storageKey) ?? undefined
    let retry = 0
    let retryUntil = 0
    const lifetime = new AbortController()
    let fatal = false
    const url = new URL(MATCH_SOCKET_PATH, location.href)
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'

    function connect() {
      const socket = new WebSocket(url)
      ws.current = socket
      socket.addEventListener('open', () => {
        if (lifetime.signal.aborted) return
        socket.send(JSON.stringify({ type: 'join', matchId, resumeToken, prizeToken,
          initialStakeUnits: resumeToken ? undefined : initialStakeUnits } satisfies ClientMessage))
      })
      socket.addEventListener('message', event => {
        if (lifetime.signal.aborted) return
        const message = JSON.parse(event.data) as ServerMessage
        switch (message.type) {
          case 'joined':
            resumeToken = message.resumeToken
            sessionStorage.setItem(storageKey, resumeToken)
            retryUntil = 0
            setJoin(message)
            setConnection('online')
            setError('')
            break
          case 'state':
            setSnapshot(message)
            break
          case 'record':
            setRecord(message.record)
            break
          case 'error':
            fatal = message.fatal === true
            if (message.discardResume) sessionStorage.removeItem(storageKey)
            if (fatal) setConnection('closed')
            setError(message.message)
            break
        }
      })
      socket.addEventListener('close', event => {
        if (lifetime.signal.aborted || fatal) return
        if (event.code === 1008) {
          setConnection('closed')
          setError('The server closed this seat. Return to the lobby to try again.')
          return
        }
        retryUntil ||= Date.now() + 15_000
        if (Date.now() >= retryUntil) {
          setConnection('closed')
          setError('Reconnection timed out. Return to the lobby to try again.')
          return
        }
        setConnection('reconnecting')
        retry = window.setTimeout(connect, 750)
      })
    }

    // Defer until StrictMode has finished its development mount probe.
    retry = window.setTimeout(connect, 0)
    return () => {
      lifetime.abort()
      window.clearTimeout(retry)
      ws.current?.close()
      ws.current = null
    }
  }, [matchId, prizeToken, prizeWallet, initialStakeUnits])

  const send = useCallback((message: ClientMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(message))
  }, [])
  const sendReady = useCallback(() => send({ type: 'ready' }), [send])

  const seat = join?.seat ?? 0
  const other: Seat = seat === 0 ? 1 : 0
  const own = snapshot?.seats[seat]
  const opponent = snapshot?.seats[other]
  const running = connection === 'online' && snapshot?.phase === 'running'
  const contending = running && own?.run?.status === 'playing'
  const canSteer = contending && own?.run?.respawnAtMs === 0
  const result = snapshot?.result
  const status = connection === 'closed' ? 'Connection closed'
    : connection === 'connecting' ? 'Joining match…'
    : connection === 'reconnecting' ? 'Connection lost · Reconnecting…'
    : result ? undefined
    : snapshot?.phase === 'paused' ? 'Match paused · Waiting for reconnection'
    : running ? (contending ? (canSteer ? 'Match live' : 'Match live · Respawning') : 'Run finished · Spectating')
    : !opponent?.connected ? 'Waiting for opponent'
    : prize && snapshot?.prize?.stage === 'funding' ? undefined
    : own?.ready ? 'Waiting for opponent to ready up' : 'Ready when you are'

  useEffect(() => {
    if (!canSteer) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('input, select, textarea')) return
      const direction = steeringKey(event)
      if (!direction) return
      event.preventDefault()
      if (!event.repeat && ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ type: 'input', direction } satisfies ClientMessage))
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [canSteer])

  return (
    <>
      <header className="match-bar">
        <span>Match <strong>{matchId}</strong>{!prize && ' · 0 test USDC'}</span>
        <div className="match-actions">
          <button type="button" onClick={async () => {
            try {
              await navigator.clipboard.writeText(matchId)
              setInvite('copied')
            } catch {
              setInvite('unavailable')
            }
          }}>{invite === 'copied' ? 'Match code copied' : 'Copy match code'}</button>
          {invite === 'unavailable' && (
            <input aria-label="Match code" readOnly value={matchId} onFocus={event => event.target.select()} />
          )}
          <button type="button" onClick={leave}>Leave match</button>
        </div>
      </header>
      <div className="match-status">
        {status && <p role="status">{status}</p>}
        {error && <p role="alert">{error}</p>}
        {!prize && connection === 'online' && snapshot?.phase === 'lobby' && !own?.ready && (
          <button className="play" type="button" onClick={sendReady}>Ready</button>
        )}
      </div>
      {result && replay === null && (
        <section className="result-panel" aria-label="Match result">
          <p>Game over</p>
          <h2 role="status">{result.kind === 'win' ? (result.winner === seat ? 'Congratulations, you win!' : 'Opponent wins')
            : result.kind === 'draw' ? 'Draw' : 'Match canceled'}</h2>
          <p>{resultReason(result)}{result.kind === 'win' && result.winner !== seat && ' Try again next time.'}</p>
        </section>
      )}
      {prize && join && <PrizeFunding member={prize} prize={snapshot?.prize} seat={seat} ready={Boolean(own?.ready)}
        lobby={snapshot?.phase === 'lobby'} online={connection === 'online'} balance={balance}
        matchId={matchId} result={result} opponentConnected={Boolean(opponent?.connected)}
        onOffer={stakeUnits => send({ type: 'stake-offer', stakeUnits })}
        onConfirm={revision => send({ type: 'confirm-stake', revision })} onReady={sendReady} />}
      {record && replay !== null ? (
        <Replay key={replay} record={record} seat={replay} leave={() => setReplay(null)} />
      ) : (
        <div className="duel-scroll" role="region" aria-label="Match boards" tabIndex={0}>
          <div className="duel">
            <MatchBoard title="You" run={own?.run} smooth={running} />
            <MatchBoard title={opponent?.connected ? 'Opponent' : 'Opponent · Offline'} run={opponent?.run} smooth={running} />
          </div>
        </div>
      )}
      {canSteer && <TouchControls disabled={false} steer={direction => send({ type: 'input', direction })} />}
      {record && replay === null && (
        <div className="match-actions replay-actions">
          <button type="button" onClick={() => setReplay(seat)}>Replay your run</button>
          <button type="button" onClick={() => setReplay(other)}>Replay opponent</button>
          <button type="button" onClick={() => downloadRecord(record)}>Download verified record</button>
        </div>
      )}
    </>
  )
}

function MatchBoard({ title, run, smooth = false, layout = 'classic' }: {
  title: string; run?: RunView | null; smooth?: boolean; layout?: MazeId
}) {
  const board = useRef<HTMLDivElement>(null)
  const engine = useRef<ReturnType<typeof createBoard> | null>(null)
  const frame = useRef({ run, smooth })
  const hud = run ? hudFor(run) : initialHud

  useEffect(() => {
    const handle = requestAnimationFrame(() => {
      if (!board.current) return
      engine.current = createBoard(board.current, undefined, undefined, layout)
      if (frame.current.run) engine.current.present(frame.current.run)
    })
    return () => {
      cancelAnimationFrame(handle)
      engine.current?.destroy()
      engine.current = null
    }
  }, [layout])

  useEffect(() => {
    frame.current = { run, smooth }
    if (run) engine.current?.present(run, smooth)
  }, [run, smooth])

  return (
    <section className="match-board" aria-label={title}>
      <h2>{title}{endings[hud.status] && <small>{endings[hud.status]}</small>}</h2>
      <Scoreboard {...hud} />
      <div className="maze" ref={board} role="region" aria-label={`${title} maze`}
        style={{ aspectRatio: boards[layout].aspect }} />
      <ArenaFooter {...hud} />
    </section>
  )
}

function resultReason(result: MatchResult) {
  if (result.kind === 'canceled') return 'A player’s connection did not recover in time.'
  if (result.kind === 'draw') return result.reason === 'full-clear' ? 'Both players cleared the maze together.' : 'Both players banked the same score.'
  return result.reason === 'full-clear' ? 'The winner banked every dot.' : 'The higher banked score wins.'
}

export function Replay({ record, seat, leave }: { record: MatchRecord; seat: Seat; leave: () => void }) {
  const run = record.runs[seat]
  const [tick, setTick] = useState(run.ticks)
  const view = useMemo(() =>
    replayRun(run.seed, run.inputs.filter(input => input.tick <= tick), tick, undefined, run.alternateLayout, run.engineVersion), [run, tick])
  return (
    <section className="replay">
      <MatchBoard title={`Replay · Seat ${seat + 1}`} run={view} layout={view.layout} />
      <label className="replay-slider">
        Replay time · {(tick * TICK_MS / 1000).toFixed(2)}s
        <input type="range" min={0} max={run.ticks} value={tick} onChange={event => setTick(event.target.valueAsNumber)} />
      </label>
      <div className="match-actions">
        <button type="button" onClick={leave}>Back to results</button>
        <button type="button" onClick={() => downloadRecord(record)}>Download verified record</button>
      </div>
    </section>
  )
}

function downloadRecord(record: MatchRecord) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `wallet-rush-${record.matchId}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
