import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Address, Hex } from 'viem'
import { ARC_TESTNET, arcTxUrl, ENTRY_AMOUNT, matchKeyFor } from '../arc/chain.ts'
import Competition from '../ui/Competition'
import { WorldGate } from '../world/WorldGate'
import type { WorldChallenge } from '../world/types.ts'
import { prizeRequest, type PrizeConfig, type PrizeMember } from './api'
import DeferredClaim from './DeferredClaim'
import { checkedWallet, injectedWallet, PRIZE_SESSION_KEY, refundUSDC, switchToArc } from './wallet'

const MATCH_CODE = /^[a-z0-9-]{3,32}$/
type Session = { wallet: Address; token: string; expires: number }
type Room = { id: string; initialStakeUnits?: number }

function stakeDraftKey(id: string, account: Address) {
  return `wallet-rush:opening-stake:${account.toLowerCase()}:${id}`
}

export default function Multiplayer({ account, balance, walletActions }: {
  account: Address; balance?: bigint | null; walletActions: HTMLDivElement | null
}) {
  const [room, setRoom] = useState<Room | undefined>(() => {
    const id = (new URLSearchParams(location.search).get('match') ?? '').trim().toLowerCase()
    if (!MATCH_CODE.test(id)) return
    const stored = sessionStorage.getItem(stakeDraftKey(id, account))
    return { id, initialStakeUnits: stored === null ? undefined : Number(stored) }
  })
  const [joinCode, setJoinCode] = useState('')
  const [staked, setStaked] = useState(false)
  const [config, setConfig] = useState<PrizeConfig | null>()
  const [chain, setChain] = useState<number>()
  const [session, setSession] = useState<Session | undefined>(() => {
    try { return JSON.parse(sessionStorage.getItem(PRIZE_SESSION_KEY) ?? 'null') ?? undefined } catch { return undefined }
  })
  const [verification, setVerification] = useState<{ challenge: WorldChallenge; session: Session }>()
  const [error, setError] = useState('')
  const [recoveryError, setRecoveryError] = useState('')
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
      if (!lifetime.signal.aborted) setConfig(null)
    })
    const { client, provider } = injectedWallet()
    let chainUpdated = false
    const changed = (chainId: string) => { chainUpdated = true; setChain(Number(chainId)) }
    provider.on('chainChanged', changed)
    void client.getChainId().then(activeChain => {
      if (!lifetime.signal.aborted && !chainUpdated) setChain(activeChain)
    }, () => {})
    return () => {
      lifetime.abort()
      provider.removeListener('chainChanged', changed)
    }
  }, [])

  useEffect(() => {
    if (!session) return
    const timeout = window.setTimeout(() => {
      sessionStorage.removeItem(PRIZE_SESSION_KEY)
      setSession(undefined)
    }, Math.max(0, session.expires - Date.now()))
    return () => window.clearTimeout(timeout)
  }, [session])

  function save(value: Session) {
    sessionStorage.setItem(PRIZE_SESSION_KEY, JSON.stringify(value))
    setSession(value)
    setVerification(undefined)
  }

  function perform(action: () => Promise<unknown>, report = setError) {
    setBusy(true)
    report('')
    void action().catch(failure => {
      const message = failure instanceof Error ? failure.message.split('\n')[0] : 'Wallet request failed.'
      report(/not been authorized|unauthorized/i.test(message)
        ? 'MetaMask did not authorize this account. Select the account shown in the Wallet Rush menu, sign out, sign in again, then continue.' : message)
    }).finally(() => setBusy(false))
  }

  function continueStakedMatch() {
    perform(async () => {
      if (!onArc) {
        await switchToArc()
        setChain(ARC_TESTNET.id)
        if (eligible) return
      }
      // Request account access here so a fresh invitee can approve before the signature prompt.
      const wallet = await checkedWallet(account, true)
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
    }, setRecoveryError)
  }

  function enter(next?: Room) {
    const url = new URL(location.href)
    if (next) url.searchParams.set('match', next.id)
    else url.searchParams.delete('match')
    if (next?.initialStakeUnits !== undefined) sessionStorage.setItem(stakeDraftKey(next.id, account), String(next.initialStakeUnits))
    else if (!next && room) sessionStorage.removeItem(stakeDraftKey(room.id, account))
    history.replaceState(null, '', url)
    setError('')
    setRoom(next)
    if (!next) setVerification(undefined)
  }

  const onArc = chain === ARC_TESTNET.id
  const variable = config?.escrowVersion === '2'
  const lowBalance = typeof balance === 'bigint' && balance < ENTRY_AMOUNT
  const canCreate = !staked || (config?.enabled === true && (variable || !lowBalance))
  const stakedRoom = room?.id.startsWith('prize-') === true
  const eligible = session?.wallet.toLowerCase() === account.toLowerCase()
  const member: PrizeMember | undefined = stakedRoom && onArc && eligible && session && config?.enabled && config.escrowAddress
    ? { address: account, token: session.token, escrow: config.escrowAddress, version: config.escrowVersion ?? '1' } : undefined
  const worldGate = stakedRoom && onArc && verification?.session.wallet.toLowerCase() === account.toLowerCase() ? verification : undefined

  return (
    <>
      {!room && <section className="multiplayer-lobby" aria-label="Multiplayer lobby">
        <form className="lobby-form" aria-labelledby="create-match-title" onSubmit={event => {
          event.preventDefault()
          if (!canCreate) return
          const bytes = crypto.getRandomValues(new Uint8Array(6))
          const code = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
          enter({ id: staked ? `prize-${code}` : code, initialStakeUnits: variable && staked ? Number(ENTRY_AMOUNT) : undefined })
        }}>
          <h2 id="create-match-title">Create Match</h2>
          <fieldset className="match-options">
            <legend className="sr-only">Match type</legend>
            <label><input type="radio" name="stake" checked={!staked} onChange={() => setStaked(false)} /> Free Match <small>0 USDC</small></label>
            <label><input type="radio" name="stake" checked={staked} onChange={() => setStaked(true)} /> Staked Match <small>10 test USDC</small></label>
          </fieldset>
          {staked && config === undefined && <p role="status">Checking staked play…</p>}
          {staked && config !== undefined && !config?.enabled && <p role="status">Staked play is unavailable.</p>}
          {staked && config?.enabled && lowBalance && <p role="status">
            {variable ? 'Balance below 10 test USDC. You can lower your offer in the room.' : 'Insufficient balance. Add at least 10 test USDC to play.'}
          </p>}
          <button type="submit" disabled={!canCreate}>Create match</button>
        </form>
        <form className="lobby-form" aria-labelledby="join-match-title" onSubmit={event => {
          event.preventDefault()
          if (MATCH_CODE.test(joinCode)) enter({ id: joinCode })
        }}>
          <h2 id="join-match-title">Join Match</h2>
          <label className="sr-only" htmlFor="match-code">Match code</label>
          <input id="match-code" value={joinCode} maxLength={32} autoComplete="off" placeholder="Match code"
            onChange={event => setJoinCode(event.target.value.trim().toLowerCase())} />
          <button type="submit" disabled={!MATCH_CODE.test(joinCode)}>Join match</button>
        </form>
      </section>}
      {stakedRoom && (!member || busy || error || worldGate) && <section className={member ? 'entry-refresh' : 'lobby prize-panel'} aria-label="Staked match entry">
        {!member && <h2>Join a staked match</h2>}
        {!member && config?.enabled && <p>Continue with MetaMask using the same account shown in the wallet menu.</p>}
        {!member && config?.worldEnvironment === 'staging' && <p>World ID staging · simulator proofs are for testing.</p>}
        {!member && config === undefined && <p role="status">Checking staked play…</p>}
        {!member && config !== undefined && !config?.enabled && <p role="status">Staked play is unavailable.</p>}
        <div className="match-actions">
          {!member && config?.enabled && (
            <button type="button" disabled={busy || Boolean(worldGate)} onClick={continueStakedMatch}>
              Continue with MetaMask
            </button>
          )}
          {!member && <button type="button" onClick={() => enter()}>Back to lobby</button>}
        </div>
        {busy && <p role="status">Waiting for wallet or server confirmation…</p>}
        {error && <p role="alert">{error}</p>}
        {worldGate && <WorldGate challenge={worldGate.challenge}
          verify={async proof => { await prizeRequest('world-verify', { proof }, worldGate.session.token) }}
          onSuccess={() => save(worldGate.session)}
          onCancel={() => {
            setVerification(undefined)
            void prizeRequest('world-cancel', { nonce: worldGate.challenge.rp_context.nonce }, worldGate.session.token).catch(() => {})
          }} />}
      </section>}
      {walletActions && config?.escrowAddress && createPortal(
        <details onToggle={event => setArcHelp(event.currentTarget.open)}>
          <summary>Advanced · Refunds and claims</summary>
          {member && <div className="match-actions">
            <button type="button" disabled={busy || Boolean(worldGate)} onClick={continueStakedMatch}>Refresh eligibility session</button>
          </div>}
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
              }, setRecoveryError)
            }}>
              <input aria-label="Expired staked match code" placeholder="prize-…" value={refundCode}
                onChange={event => setRefundCode(event.target.value.trim().toLowerCase())} />
              <button disabled={busy || !/^prize-[a-z0-9-]{3,26}$/.test(refundCode)}>Request timeout refund</button>
            </form>
            {refundHash && <p><a href={arcTxUrl(refundHash)}>{refundStatus || 'Submitted timeout refund'}</a></p>}
          </>}
          {arcHelp && recoveryError && <p role="alert">{recoveryError}</p>}
        </details>, walletActions)}
      {room && (!stakedRoom || member) && <Competition key={room.id} matchId={room.id} initialStakeUnits={member?.version === '2' ? room.initialStakeUnits : undefined}
        leave={() => enter()} prize={member} balance={balance} />}
    </>
  )
}
