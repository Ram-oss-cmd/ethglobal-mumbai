import { type CSSProperties, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { formatUnits, type Address } from 'viem'
import { ARC_TESTNET, USDC_DECIMALS } from '../arc/chain.ts'
import { useArcBalance } from '../web3/useArcBalance'
import { injectedWallet, PRIZE_SESSION_KEY, selectedWalletAccount, WALLET_ACCOUNT_KEY, WALLET_SIGN_IN_KEY } from '../web3/wallet'
import { BOARD_ASPECT, createArcade, steeringKey, type Hud } from './arcade'
import { ArenaFooter, endings, initialHud, Scoreboard, TouchControls } from './CabinetHud'
import WalletEntry from './WalletEntry'
import './style.css'

const History = lazy(() => import('../history/History'))
const Multiplayer = lazy(() => import('../web3/Multiplayer'))
type Mode = 'practice' | 'multiplayer' | 'history'

export default function App() {
  const replayId = /^\/replay\/([a-z0-9-]{3,32})\/?$/.exec(location.pathname)?.[1]
  const [signedIn, setSignedIn] = useState(() => localStorage.getItem(WALLET_SIGN_IN_KEY) === '1')
  const [wallet, setWallet] = useState<ReturnType<typeof injectedWallet>>()
  const [accounts, setAccounts] = useState<Address[]>([])
  const [preferred, setPreferred] = useState(() => sessionStorage.getItem(WALLET_ACCOUNT_KEY))
  const account = signedIn ? selectedWalletAccount(accounts, preferred) : undefined
  const [connecting, setConnecting] = useState(false)
  const [walletError, setWalletError] = useState('')
  const [mode, setMode] = useState<Mode>(() => {
    const match = new URLSearchParams(location.search).get('match')
    if (replayId || location.pathname === '/history') return 'history'
    return match || location.pathname === '/multiplayer' ? 'multiplayer' : 'practice'
  })
  const [walletActions, setWalletActions] = useState<HTMLDivElement | null>(null)
  const balance = useArcBalance(mode === 'multiplayer' ? account : undefined)

  const signOut = useCallback(() => {
    localStorage.removeItem(WALLET_SIGN_IN_KEY)
    sessionStorage.removeItem(WALLET_ACCOUNT_KEY)
    sessionStorage.removeItem(PRIZE_SESSION_KEY)
    setPreferred(null)
    setAccounts([])
    setWallet(undefined)
    setSignedIn(false)
    setWalletError('')
  }, [])

  useEffect(() => {
    if (!signedIn) return
    let initial = true
    let active: ReturnType<typeof injectedWallet>
    try { active = wallet ?? injectedWallet() } catch {
      queueMicrotask(() => { if (initial) signOut() })
      return () => { initial = false }
    }
    const changed = (addresses: Address[]) => {
      initial = false
      if (addresses.length) setAccounts(addresses)
      else signOut()
    }
    const disconnected = () => { initial = false; signOut() }
    const storageChanged = (event: StorageEvent) => {
      if (event.storageArea === localStorage && (event.key === WALLET_SIGN_IN_KEY || event.key === null) &&
          localStorage.getItem(WALLET_SIGN_IN_KEY) !== '1') disconnected()
    }
    active.provider.on('accountsChanged', changed)
    active.provider.on('disconnect', disconnected)
    window.addEventListener('storage', storageChanged)
    void active.client.getAddresses().then(addresses => {
      if (initial) changed(addresses)
    }, () => { if (initial) disconnected() })
    return () => {
      initial = false
      active.provider.removeListener('accountsChanged', changed)
      active.provider.removeListener('disconnect', disconnected)
      window.removeEventListener('storage', storageChanged)
    }
  }, [signedIn, wallet, signOut])

  async function connect(manageAccounts = false) {
    if (connecting) return
    setConnecting(true)
    setWalletError('')
    try {
      const active = wallet ?? injectedWallet()
      if (manageAccounts) await active.provider.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] })
      const addresses = await (manageAccounts ? active.client.getAddresses() : active.client.requestAddresses())
      if (addresses.length === 0) throw new Error('Select an account in MetaMask to continue.')
      if (manageAccounts && localStorage.getItem(WALLET_SIGN_IN_KEY) !== '1') return
      if (!manageAccounts) {
        sessionStorage.removeItem(WALLET_ACCOUNT_KEY)
        sessionStorage.removeItem(PRIZE_SESSION_KEY)
        setPreferred(null)
        localStorage.setItem(WALLET_SIGN_IN_KEY, '1')
        setSignedIn(true)
      }
      setWallet(active)
      setAccounts(addresses)
    } catch (error) {
      setWalletError(error instanceof Error && error.name === 'UserRejectedRequestError'
        ? 'Connection canceled. Choose MetaMask to try again.'
        : error instanceof Error ? error.message.split('\n')[0] : 'Could not connect to MetaMask. Try again.')
    } finally {
      setConnecting(false)
    }
  }

  function changeMode(next: Mode) {
    if (next === mode) return
    history.replaceState(null, '', next === 'history' ? '/history' : next === 'multiplayer' ? '/multiplayer' : '/')
    setMode(next)
  }

  if (!account && mode !== 'history') {
    return signedIn ? <main className="wallet-screen"><p role="status">Checking MetaMask…</p></main>
      : <WalletEntry connect={() => void connect()} connecting={connecting} error={walletError} />
  }

  const multiplayer = mode === 'multiplayer'
  return (
    <main className={`cabinet${multiplayer ? ' cabinet-live' : ''}`} style={{ '--board-aspect': BOARD_ASPECT } as CSSProperties}>
      <h1 className="sr-only">Wallet Rush</h1>
      {account ? <header className="arcade-header">
        <nav className="mode-switch" aria-label="Game mode">
          <button type="button" aria-pressed={mode === 'practice'} onClick={() => changeMode('practice')}>Single player</button>
          <button type="button" aria-pressed={multiplayer} onClick={() => changeMode('multiplayer')}>Multiplayer</button>
          <button type="button" aria-pressed={mode === 'history'} onClick={() => changeMode('history')}>Match history</button>
        </nav>
        <details className="wallet-menu" key={mode}>
          <summary><span>{account.slice(0, 6)}…{account.slice(-4)}</span>
            {multiplayer && <span className="wallet-menu-balance">{balance === undefined ? 'Loading…' : balance === null ? 'Balance unavailable'
              : `${formatUnits(balance, USDC_DECIMALS)} test USDC`}</span>}
          </summary>
          <div className="wallet-menu-panel match-actions" aria-label="Wallet settings">
            <label htmlFor="player-wallet"><span className="sr-only">Player </span>Wallet</label>
            <select id="player-wallet" value={account.toLowerCase()} onChange={event => {
              const selected = event.target.value
              sessionStorage.setItem(WALLET_ACCOUNT_KEY, selected)
              setPreferred(selected)
            }}>
              {accounts.map(address => <option key={address} value={address.toLowerCase()}>{address.slice(0, 8)}…{address.slice(-4)}</option>)}
            </select>
            <button type="button" aria-label="Manage accounts" disabled={connecting} onClick={() => void connect(true)}>Accounts</button>
            <button type="button" onClick={() => {
              history.replaceState(null, '', '/')
              setMode('practice')
              signOut()
            }}>Sign out</button>
            {multiplayer && <>
              <a href={`${ARC_TESTNET.blockExplorers.default.url}/address/${account}`} target="_blank" rel="noreferrer">View on Arc Explorer</a>
              <div className="wallet-advanced" ref={setWalletActions} />
            </>}
            {walletError && <p className="wallet-picker-error" role="alert">{walletError}</p>}
          </div>
        </details>
      </header> : <a href="/">Back to Wallet Rush</a>}
      <Suspense fallback={<p role="status">Loading…</p>}>
        {mode === 'practice' && <Practice />}
        {multiplayer && account && <Multiplayer key={account} account={account} balance={balance} walletActions={walletActions} />}
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
