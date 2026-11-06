import { useEffect, useState } from 'react'
import { formatUnits, type Address, type Hex } from 'viem'
import { ARC_TESTNET, arcTxUrl, matchKeyFor, parseStakeOffer, validStakeOffer } from '../arc/chain.ts'
import Competition from '../ui/Competition'
import { WorldGate } from '../world/WorldGate'
import type { WorldChallenge } from '../world/types.ts'
import { prizeRequest, type PrizeConfig, type PrizeMember } from './api'
import DeferredClaim from './DeferredClaim'
import { arc, checkedWallet, injectedWallet, refundUSDC, switchToArc } from './wallet'

const STORAGE = 'wallet-rush:prize-session'
const MATCH_CODE = /^[a-z0-9-]{3,32}$/
type Session = { wallet: Address; token: string; expires: number }
type Room = { id: string; initialStakeUnits?: number }

function stakeDraftKey(id: string, account: Address) {
  return `wallet-rush:opening-stake:${account.toLowerCase()}:${id}`
}

export default function Multiplayer({ account }: { account: Address }) {
  const [room, setRoom] = useState<Room | undefined>(() => {
    const id = (new URLSearchParams(location.search).get('match') ?? '').trim().toLowerCase()
    if (!MATCH_CODE.test(id)) return
    const stored = sessionStorage.getItem(stakeDraftKey(id, account))
    return { id, initialStakeUnits: stored === null ? undefined : Number(stored) }
  })
  const [joinCode, setJoinCode] = useState('')
  const [offer, setOffer] = useState('0')
  const [config, setConfig] = useState<PrizeConfig>()
  const [chain, setChain] = useState<number>()
  const [balance, setBalance] = useState<string | null>()
  const [session, setSession] = useState<Session | undefined>(() => {
    try { return JSON.parse(sessionStorage.getItem(STORAGE) ?? 'null') ?? undefined } catch { return undefined }
  })
  const [verification, setVerification] = useState<{ challenge: WorldChallenge; session: Session }>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [arcHelp, setArcHelp] = useState(false)
  const [refundCode, setRefundCode] = useState('')
  const [refundHash, setRefundHash] = useState<Hex>()
  const [refundStatus, setRefundStatus] = useState('')

  useEffect(() => {
    const lifetime = new AbortController()
    void prizeRequest<PrizeConfig>('config').then(config => {
      if (!lifetime.signal.aborted) setConfig(config)
    }).catch(() => {
      if (!lifetime.signal.aborted) setError('The stake settings are unavailable.')
    })
    const { client, provider } = injectedWallet()
    let chainUpdated = false
    const changed = (chainId: string) => { chainUpdated = true; setChain(Number(chainId)) }
    provider.on('chainChanged', changed)
    void client.getChainId().then(activeChain => {
      if (!lifetime.signal.aborted && !chainUpdated) setChain(activeChain)
    }, () => {
      if (!lifetime.signal.aborted && !chainUpdated) setError('Could not read the wallet network.')
    })
    return () => {
      lifetime.abort()
      provider.removeListener('chainChanged', changed)
    }
  }, [])

  useEffect(() => {
    const lifetime = new AbortController()
    const refresh = () => void arc.getBalance({ address: account }).then(value => {
      if (!lifetime.signal.aborted) setBalance(formatUnits(value, ARC_TESTNET.nativeCurrency.decimals))
    }).catch(() => {
      if (!lifetime.signal.aborted) setBalance(null)
    })
    refresh()
    const poll = window.setInterval(refresh, 5_000)
    return () => { lifetime.abort(); window.clearInterval(poll) }
  }, [account])

  useEffect(() => {
    if (!session) return
    const timeout = window.setTimeout(() => {
      sessionStorage.removeItem(STORAGE)
      setSession(undefined)
    }, Math.max(0, session.expires - Date.now()))
    return () => window.clearTimeout(timeout)
  }, [session])

  function save(value: Session) {
    sessionStorage.setItem(STORAGE, JSON.stringify(value))
    setSession(value)
    setVerification(undefined)
  }

  function perform(action: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    void action().catch(failure => {
      setError(failure instanceof Error ? failure.message.split('\n')[0] : 'Wallet request failed.')
    }).finally(() => setBusy(false))
  }

  function verify() {
    perform(async () => {
      const wallet = await checkedWallet(account)
      const challenge = await prizeRequest<{ message: string; nonce: string }>('wallet-challenge', { wallet: account })
      const signature = await wallet.signMessage({ account, message: challenge.message })
      const authenticated = await prizeRequest<{ wallet: Address; token: string }>('wallet-verify', { nonce: challenge.nonce, signature })
      const active = { ...authenticated, expires: Date.now() + 59 * 60_000 }
      const next = await prizeRequest<{ eligible?: boolean; challenge?: WorldChallenge }>('world-challenge', {}, active.token)
      if (next.eligible) save(active)
      else if (next.challenge) setVerification({ challenge: next.challenge, session: active })
    })
  }

  function switchNetwork() {
    perform(async () => {
      await switchToArc()
      setChain(await injectedWallet().client.getChainId())
    })
  }

  function enter(next?: Room) {
    const url = new URL(location.href)
    if (next) url.searchParams.set('match', next.id)
    else url.searchParams.delete('match')
    if (next?.initialStakeUnits !== undefined) sessionStorage.setItem(stakeDraftKey(next.id, account), String(next.initialStakeUnits))
    else if (!next && room) sessionStorage.removeItem(stakeDraftKey(room.id, account))
    history.replaceState(null, '', url)
    setArcHelp(false)
    setRoom(next)
    if (!next) setVerification(undefined)
  }

  const onArc = chain === ARC_TESTNET.id
  const variable = config?.escrowVersion === '2'
  const stakeUnits = parseStakeOffer(offer)
  const canCreate = validStakeOffer(stakeUnits, variable) && (stakeUnits === 0 || config?.enabled)
  const stakedRoom = room?.id.startsWith('prize-') === true
  const eligible = session?.wallet.toLowerCase() === account.toLowerCase()
  const member: PrizeMember | undefined = stakedRoom && onArc && eligible && session && config?.enabled && config.escrowAddress
    ? { address: account, token: session.token, escrow: config.escrowAddress, version: config.escrowVersion ?? '1' } : undefined
  const worldGate = stakedRoom && onArc && verification?.session.wallet.toLowerCase() === account.toLowerCase() ? verification : undefined

  return (
    <>
      <section className="lobby prize-panel" aria-label="Multiplayer lobby">
        <h2>Multiplayer</h2>
        {!room && (
          <>
            <form className="match-actions" onSubmit={event => {
              event.preventDefault()
              if (!canCreate || stakeUnits === undefined) return
              const bytes = crypto.getRandomValues(new Uint8Array(6))
              const code = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
              enter({ id: stakeUnits === 0 ? code : `prize-${code}`, initialStakeUnits: variable && stakeUnits > 0 ? stakeUnits : undefined })
            }}>
              <label htmlFor="room-stake">Stake in test USDC</label>
              <input id="room-stake" inputMode="decimal" maxLength={10} value={offer} onChange={event => setOffer(event.target.value)} />
              <button type="submit" disabled={!canCreate}>Create match</button>
            </form>
            <p>Enter 0 to play free.{config?.enabled && (variable ? ' Staked matches accept 1–100 test USDC.' : ' The current escrow also supports 10 test USDC each.')}</p>
            <form className="match-actions" onSubmit={event => {
              event.preventDefault()
              if (MATCH_CODE.test(joinCode)) enter({ id: joinCode })
            }}>
              <label className="sr-only" htmlFor="match-code">Match code</label>
              <input id="match-code" value={joinCode} maxLength={32} autoComplete="off" placeholder="Match code"
                onChange={event => setJoinCode(event.target.value.trim().toLowerCase())} />
              <button type="submit" disabled={!MATCH_CODE.test(joinCode)}>Join match</button>
            </form>
          </>
        )}
        {stakedRoom && !member && <p>{onArc ? 'Verify your eligibility to join this staked match.' : 'Switch to Arc Testnet to join this staked match.'}</p>}
        {stakedRoom && config?.worldEnvironment === 'staging' && <p>World ID staging · simulator proofs are for testing.</p>}
        {config && !config.enabled && <p>Staked matches await sponsor setup. A stake of 0 is available.</p>}
        <div className="match-actions">
          {stakedRoom && !onArc && <button type="button" disabled={busy} onClick={switchNetwork}>Switch to Arc Testnet</button>}
          {stakedRoom && onArc && config?.enabled && (
            <button type="button" disabled={busy || Boolean(worldGate)} onClick={verify}>
              {eligible ? 'Refresh eligibility session' : 'Verify eligibility'}
            </button>
          )}
          {stakedRoom && !member && <button type="button" onClick={() => enter()}>Back to lobby</button>}
        </div>
        <p className="wallet-address"><a href={new URL(`/address/${account}`, ARC_TESTNET.blockExplorers.default.url).href}
          target="_blank" rel="noreferrer">{account}</a>
          <br />Arc Testnet balance · {balance === undefined ? 'Loading…' : balance === null ? 'Unavailable' : `${balance} test USDC`}
          <br />Wallet network · {onArc ? 'Arc Testnet' : `Network ${chain ?? 'unknown'}`}</p>
        {stakedRoom && eligible && <p role="status">Wallet eligible for staked matches.</p>}
        {busy && <p role="status">Waiting for wallet or server confirmation…</p>}
        {error && <p role="alert">{error}</p>}
        {worldGate && <WorldGate challenge={worldGate.challenge}
          verify={async proof => { await prizeRequest('world-verify', { proof }, worldGate.session.token) }}
          onSuccess={() => save(worldGate.session)}
          onCancel={() => {
            setVerification(undefined)
            void prizeRequest('world-cancel', { nonce: worldGate.challenge.rp_context.nonce }, worldGate.session.token).catch(() => {})
          }} />}
        {!room && config?.escrowAddress && (
          <details onToggle={event => setArcHelp(event.currentTarget.open)}>
            <summary>Arc refunds and claims</summary>
            <p>If a staked match expires without settling, Arc can return deposits to the players.</p>
            {arcHelp && !onArc && <div className="match-actions">
              <button type="button" disabled={busy} onClick={switchNetwork}>Switch to Arc Testnet</button>
            </div>}
            {arcHelp && onArc && <>
              <DeferredClaim account={account} escrow={config.escrowAddress} />
              <form className="match-actions" onSubmit={event => {
                event.preventDefault()
                setRefundHash(undefined)
                setRefundStatus('')
                perform(async () => {
                  const refund = await refundUSDC(account, config.escrowAddress!, matchKeyFor(refundCode), setRefundHash, config.escrowVersion)
                  setRefundHash(refund.transactionHash)
                  setRefundStatus(refund.deferredPayouts.length > 0
                    ? 'Timeout processed with deferred payouts' : 'Timeout processed')
                })
              }}>
                <input aria-label="Expired staked match code" placeholder="prize-…" value={refundCode}
                  onChange={event => setRefundCode(event.target.value.trim().toLowerCase())} />
                <button disabled={busy || !/^prize-[a-z0-9-]{3,26}$/.test(refundCode)}>Request timeout refund</button>
              </form>
              {refundHash && <p><a href={arcTxUrl(refundHash)}>{refundStatus || 'Submitted timeout refund'}</a></p>}
            </>}
          </details>
        )}
      </section>
      {room && (!stakedRoom || member) && <Competition key={room.id} matchId={room.id} initialStakeUnits={member?.version === '2' ? room.initialStakeUnits : undefined}
        leave={() => enter()} prize={member} />}
    </>
  )
}
