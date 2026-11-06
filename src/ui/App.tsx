import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { Address } from 'viem'
import { injectedWallet, selectedWalletAccount, WALLET_ACCOUNT_KEY } from '../web3/wallet'
import { BOARD_ASPECT, createArcade, steeringKey, type Hud } from './arcade'
import { ArenaFooter, endings, initialHud, Scoreboard, TouchControls } from './CabinetHud'
import './style.css'

const History = lazy(() => import('../history/History'))
const Multiplayer = lazy(() => import('../web3/Multiplayer'))
type Mode = 'practice' | 'multiplayer' | 'history'

export default function App() {
  const replayId = /^\/replay\/([a-z0-9-]{3,32})\/?$/.exec(location.pathname)?.[1]
  const [wallet, setWallet] = useState<ReturnType<typeof injectedWallet>>()
  const [accounts, setAccounts] = useState<Address[]>([])
  const [preferred, setPreferred] = useState(() => sessionStorage.getItem(WALLET_ACCOUNT_KEY))
  const account = selectedWalletAccount(accounts, preferred)
  const [connecting, setConnecting] = useState(false)
  const [walletError, setWalletError] = useState('')
  const [mode, setMode] = useState<Mode>(() => {
    const match = new URLSearchParams(location.search).get('match')
    if (replayId || location.pathname === '/history') return 'history'
    return match ? 'multiplayer' : 'practice'
  })

  useEffect(() => {
    let active: ReturnType<typeof injectedWallet>
    try { active = wallet ?? injectedWallet() } catch { return }
    let initial = true
    const changed = (addresses: Address[]) => {
      initial = false
      setAccounts(addresses)
    }
    const disconnected = () => changed([])
    active.provider.on('accountsChanged', changed)
    active.provider.on('disconnect', disconnected)
    void active.client.getAddresses().then(addresses => {
      if (initial) changed(addresses)
    }, () => {})
    return () => {
      initial = false
      active.provider.removeListener('accountsChanged', changed)
      active.provider.removeListener('disconnect', disconnected)
    }
  }, [wallet])

  async function connect(manageAccounts = false) {
    setConnecting(true)
    setWalletError('')
    try {
      const active = wallet ?? injectedWallet()
      if (manageAccounts) await active.provider.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] })
      const addresses = await (manageAccounts ? active.client.getAddresses() : active.client.requestAddresses())
      if (addresses.length === 0) throw new Error('Select an account in MetaMask to continue.')
      setWallet(active)
      setAccounts(addresses)
    } catch (error) {
      setWalletError(error instanceof Error ? error.message.split('\n')[0] : 'MetaMask connection failed.')
    } finally {
      setConnecting(false)
    }
  }

  function changeMode(next: Mode) {
    if (next === mode) return
    history.replaceState(null, '', next === 'history' ? '/history' : '/')
    setMode(next)
  }

  if (!account && mode !== 'history') return (
    <main className="cabinet">
      <section className="lobby wallet-entry" aria-labelledby="wallet-entry-title">
        <h1 id="wallet-entry-title">Wallet Rush</h1>
        <p>Connect your wallet to enter the arcade.</p>
        <div className="match-actions">
          <button type="button" className="play" disabled={connecting} onClick={() => void connect()}>
            {connecting ? 'Connecting…' : 'Connect MetaMask'}
          </button>
          <button type="button" disabled>Rabby Wallet</button>
          <button type="button" disabled>Coinbase Wallet</button>
          <button type="button" disabled>Trust Wallet</button>
        </div>
        {walletError && <p role="alert">{walletError}</p>}
      </section>
    </main>
  )

  const multiplayer = mode === 'multiplayer'
  return (
    <main className={`cabinet${multiplayer ? ' cabinet-live' : ''}`}>
      <h1 className="sr-only">Wallet Rush</h1>
      {account ? <nav className="mode-switch" aria-label="Game mode">
        <button type="button" aria-pressed={mode === 'practice'} onClick={() => changeMode('practice')}>Single player</button>
        <button type="button" aria-pressed={multiplayer} onClick={() => changeMode('multiplayer')}>Multiplayer</button>
        <button type="button" aria-pressed={mode === 'history'} onClick={() => changeMode('history')}>Match history</button>
      </nav> : <a href="/">Back to Wallet Rush</a>}
      {account && multiplayer && (
        <div className="match-actions wallet-picker">
          <label htmlFor="player-wallet">Player wallet</label>
          <select id="player-wallet" value={account.toLowerCase()} onChange={event => {
            const selected = event.target.value
            sessionStorage.setItem(WALLET_ACCOUNT_KEY, selected)
            setPreferred(selected)
          }}>
            {accounts.map(address => <option key={address} value={address.toLowerCase()}>{address.slice(0, 8)}…{address.slice(-4)}</option>)}
          </select>
          <button type="button" disabled={connecting} onClick={() => void connect(true)}>Manage MetaMask accounts</button>
          {walletError && <p role="alert">{walletError}</p>}
        </div>
      )}
      <Suspense fallback={<p role="status">Loading…</p>}>
        {mode === 'practice' && <Practice />}
        {multiplayer && account && <Multiplayer key={account} account={account} />}
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
