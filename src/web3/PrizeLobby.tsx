import { useEffect, useState } from 'react'
import { formatUnits, type Address, type Hex } from 'viem'
import { ARC_TESTNET, arcTxUrl, matchKeyFor } from '../arc/chain.ts'
import Competition from '../ui/Competition'
import { WorldGate } from '../world/WorldGate'
import type { WorldChallenge } from '../world/types.ts'
import { prizeRequest, type PrizeConfig, type PrizeMember } from './api'
import DeferredClaim from './DeferredClaim'
import { arc, checkedWallet, injectedWallet, refundUSDC, switchToArc } from './wallet'

const STORAGE = 'wallet-rush:prize-session'
type Session = { wallet: Address; token: string; expires: number }

export default function PrizeLobby({ account }: { account: Address }) {
  const [config, setConfig] = useState<PrizeConfig>()
  const [chain, setChain] = useState<number>()
  const [balance, setBalance] = useState<{ wallet: Address; value: string }>()
  const [session, setSession] = useState<Session | undefined>(() => {
    try { return JSON.parse(sessionStorage.getItem(STORAGE) ?? 'null') ?? undefined } catch { return undefined }
  })
  const [verification, setVerification] = useState<{ challenge: WorldChallenge; session: Session }>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [refundCode, setRefundCode] = useState('')
  const [refundHash, setRefundHash] = useState<Hex>()
  const [refundStatus, setRefundStatus] = useState('')

  useEffect(() => {
    const lifetime = new AbortController()
    void prizeRequest<PrizeConfig>('config').then(config => {
      if (!lifetime.signal.aborted) setConfig(config)
    }).catch(() => {
      if (!lifetime.signal.aborted) setError('The prize server is unavailable.')
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
      if (!lifetime.signal.aborted) setBalance({ wallet: account, value: formatUnits(value, ARC_TESTNET.nativeCurrency.decimals) })
    }).catch(() => {
      if (!lifetime.signal.aborted) setBalance(undefined)
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

  const onArc = chain === ARC_TESTNET.id
  const eligible = session?.wallet.toLowerCase() === account.toLowerCase()
  const member: PrizeMember | undefined = onArc && eligible && session && config?.enabled && config.escrowAddress
    ? { address: account, token: session.token, escrow: config.escrowAddress, version: config.escrowVersion ?? '1' } : undefined
  const worldGate = onArc && verification?.session.wallet.toLowerCase() === account.toLowerCase() ? verification : undefined

  return (
    <>
      <section className="lobby prize-panel" aria-label="Prize wallet and eligibility">
        <h2>Arc Testnet prize matches</h2>
        <p>{config?.escrowVersion === '2' ? 'Each player stakes the smaller of the two offers, after both confirm.' : 'Entry is 10 test USDC per player.'}
          {' '}Maze points are a separate game score. Prize wallet addresses, match scores and replay inputs are public on Arkiv.</p>
        {config?.worldEnvironment === 'staging' && <p>World ID staging · simulator proofs are for testing.</p>}
        {config && !config.enabled && <p>Prize rooms await sponsor setup. Casual matches remain available.</p>}
        <div className="match-actions">
          {!onArc && <button type="button" disabled={busy} onClick={() => perform(async () => {
            await switchToArc()
            setChain(await injectedWallet().client.getChainId())
          })}>Switch to Arc Testnet</button>}
          {onArc && config?.worldEnvironment && (
            <button type="button" disabled={busy || Boolean(worldGate)} onClick={verify}>
              {eligible ? 'Refresh eligibility session' : 'Verify prize eligibility'}
            </button>
          )}
        </div>
        <p className="wallet-address"><a href={new URL(`/address/${account}`, ARC_TESTNET.blockExplorers.default.url).href}>{account}</a>
          <br />Arc Testnet balance · {balance?.wallet === account ? `${balance.value} test USDC` : 'Unavailable'}
          <br />Wallet network · {onArc ? 'Arc Testnet' : `Network ${chain ?? 'unknown'}`}</p>
        {eligible && <p role="status">Wallet eligible for prize entry.</p>}
        {busy && <p role="status">Waiting for wallet or server confirmation…</p>}
        {error && <p role="alert">{error}</p>}
        {onArc && config?.escrowAddress && (
          <DeferredClaim key={`${account}:${config.escrowAddress}`} account={account} escrow={config.escrowAddress} />
        )}
        {worldGate && <WorldGate challenge={worldGate.challenge}
          verify={async proof => { await prizeRequest('world-verify', { proof }, worldGate.session.token) }}
          onSuccess={() => save(worldGate.session)}
          onCancel={() => {
            setVerification(undefined)
            void prizeRequest('world-cancel', { nonce: worldGate.challenge.rp_context.nonce }, worldGate.session.token).catch(() => {})
          }} />}
        {onArc && config?.escrowAddress && (
          <details>
            <summary>Recover test USDC from an expired match</summary>
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
              <input aria-label="Expired prize match code" placeholder="prize-…" value={refundCode}
                onChange={event => setRefundCode(event.target.value.trim().toLowerCase())} />
              <button disabled={busy || !/^prize-[a-z0-9-]{3,26}$/.test(refundCode)}>Request timeout refund</button>
            </form>
            {refundHash && <p><a href={arcTxUrl(refundHash)}>{refundStatus || 'Submitted timeout refund'}</a></p>}
          </details>
        )}
      </section>
      {member && <Competition key={member.address} prize={member} />}
    </>
  )
}
