import { useEffect, useState } from 'react'
import { formatUnits, isAddressEqual, type Hex } from 'viem'
import { arcTxUrl, ENTRY_AMOUNT, ESCROW_ABI, parseStakeOffer, USDC_DECIMALS, validStakeOffer } from '../arc/chain.ts'
import type { MatchResult, PrizeState, Seat } from '../competition/protocol.ts'
import type { PrizeMember } from './api'
import { arc, depositUSDC } from './wallet'

export default function PrizeFunding({ member, prize, seat, ready, lobby, online, onReady, matchId, result, opponentConnected, onOffer, onConfirm, balance }: {
  member: PrizeMember; prize?: PrizeState; seat: Seat; ready: boolean; lobby: boolean; online: boolean
  onReady: () => void; matchId: string; result?: MatchResult
  opponentConnected: boolean; onOffer: (units: number) => void; onConfirm: (revision: number) => void
  balance?: bigint | null
}) {
  const [funded, setFunded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [hash, setHash] = useState<Hex>()
  const [depositReceipt, setDepositReceipt] = useState<Hex>()
  const [error, setError] = useState('')
  const matchKey = prize?.matchKey
  const funding = lobby && prize?.stage === 'funding'
  const fundingMessage = prize?.message
  const stakeUnits = prize?.stakeUnits ?? Number(ENTRY_AMOUNT)
  const stake = BigInt(stakeUnits)
  const lowBalance = typeof balance === 'bigint' && balance < stake
  const ownPayout = prize?.settlementTx && result && !prize.deferredPayouts?.some(payout => isAddressEqual(payout.player, member.address))
    ? (result.kind === 'win' ? result.winner === seat ? 2n * stake : 0n : stake) : 0n

  useEffect(() => {
    if (!matchKey || !funding) return
    const lifetime = new AbortController()
    const refresh = () => void arc.readContract({
      address: member.escrow, abi: ESCROW_ABI, functionName: 'getMatch', args: [matchKey],
    }).then(match => {
      if (!lifetime.signal.aborted) {
        if (isAddressEqual(match[seat], member.address) && match[seat === 0 ? 4 : 5] && !match[6]) setFunded(true)
      }
    }).catch(() => {})
    refresh()
    const interval = window.setInterval(refresh, 3_000)
    return () => { lifetime.abort(); window.clearInterval(interval) }
  }, [matchKey, funding, member.address, member.escrow, seat])

  useEffect(() => {
    if (funding && online && funded && !ready && !fundingMessage) onReady()
  }, [funding, fundingMessage, online, funded, ready, onReady])

  function deposit() {
    if (!matchKey) return
    setBusy(true)
    setError('')
    void depositUSDC(member.address, member.escrow, matchKey, setHash, stakeUnits, member.version)
      .then(receipt => { setDepositReceipt(receipt); setFunded(true) })
      .catch(failure => setError(failure instanceof Error ? failure.message.split('\n')[0] : 'Deposit failed.'))
      .finally(() => setBusy(false))
  }

  return (
    <section className="match-status" aria-label="Test USDC escrow">
      {prize?.stage === 'waiting' && prize.offers && (
        <StakeOffer key={prize.offers.units[seat]} offers={prize.offers} seat={seat} ready={ready}
          variable={member.version === '2'} opponentConnected={opponentConnected} onOffer={onOffer} onConfirm={onConfirm} />
      )}
      {prize?.stage === 'free' && lobby && (
        <div className="match-actions">
          <p>Free match · 0 test USDC</p>
          <button type="button" disabled={ready} onClick={onReady}>{ready ? 'Ready' : 'Ready to play'}</button>
        </div>
      )}
      {prize?.stage === 'opening' && <p role="status">Preparing your match on Arc Testnet…</p>}
      {funding && (
        <div className="match-actions">
          {funded ? (fundingMessage && !ready
            ? <button type="button" disabled={!online} onClick={onReady}>Check deposits again</button>
            : <p role="status">Stake confirmed. {opponentConnected ? 'The match starts when both stakes are confirmed.' : 'Waiting for your opponent to reconnect.'}</p>)
            : <>
              <button type="button" disabled={busy || !online || lowBalance} onClick={deposit}>{busy ? 'Confirming on Arc…' : `Deposit ${formatUnits(stake, USDC_DECIMALS)} test USDC & play`}</button>
              {lowBalance && <p role="status">Insufficient test USDC for this stake.</p>}
            </>}
        </div>
      )}
      {funding && prize.depositDeadline && (
        <p>Deposit deadline {new Date(prize.depositDeadline * 1000).toLocaleTimeString()} local time.</p>
      )}
      {prize?.stage === 'settling' && <p role="status">Verifying testnet settlement and publishing the replay…</p>}
      {prize?.openTx && <a href={arcTxUrl(prize.openTx)}>Arc escrow receipt</a>}
      {depositReceipt ? <a href={arcTxUrl(depositReceipt)}>Arc deposit receipt</a>
        : hash && <a href={arcTxUrl(hash)}>Submitted Arc transaction</a>}
      {prize?.settlementTx && <a href={arcTxUrl(prize.settlementTx)}>Arc settlement receipt</a>}
      {ownPayout > 0n && <p role="status">{formatUnits(ownPayout, USDC_DECIMALS)} test USDC {result?.kind === 'win' ? 'transferred to' : 'refunded to'} your wallet.</p>}
      {prize?.deferredPayouts?.map(({ player, amount }) => (
        <p key={player} role="status">{formatUnits(BigInt(amount), USDC_DECIMALS)} test USDC was deferred for
          {' '}{isAddressEqual(player, member.address) ? 'your wallet. Open Wallet → Advanced to claim it.' : 'the other wallet.'}</p>
      ))}
      {prize?.historyKey && <a href={`/replay/${matchId}`}>Public Arkiv replay</a>}
      {prize?.archiveTx && <a href={`https://rabdi.explorer.arkiv.network/tx/${prize.archiveTx}`}>Arkiv archive receipt</a>}
      {(error || prize?.message) && <p role="alert">{error || prize?.message}</p>}
    </section>
  )
}

function StakeOffer({ offers, seat, ready, variable, opponentConnected, onOffer, onConfirm }: {
  offers: NonNullable<PrizeState['offers']>; seat: Seat; ready: boolean; variable: boolean; opponentConnected: boolean
  onOffer: (units: number) => void; onConfirm: (revision: number) => void
}) {
  const ownOffer = offers.units[seat]
  const [draft, setDraft] = useState(() => formatUnits(BigInt(ownOffer), USDC_DECIMALS))
  const units = parseStakeOffer(draft)
  const agreed = formatUnits(BigInt(Math.min(...offers.units)), USDC_DECIMALS)
  const opponent = formatUnits(BigInt(offers.units[seat === 0 ? 1 : 0]), USDC_DECIMALS)

  return (
    <div>
      <form className="match-actions" onSubmit={event => {
        event.preventDefault()
        if (validStakeOffer(units, variable) && units !== ownOffer) onOffer(units)
      }}>
        <label htmlFor="stake-offer">Your offer in test USDC</label>
        <input id="stake-offer" inputMode="decimal" maxLength={10} value={draft} onChange={event => setDraft(event.target.value)} />
        <button type="submit" disabled={!validStakeOffer(units, variable) || units === ownOffer}>Update offer</button>
      </form>
      <p>{opponentConnected ? `Opponent offers ${opponent} test USDC.` : 'Set your offer and share the invite.'}</p>
      <p>Matched stake <strong>{agreed} test USDC each</strong></p>
      <div className="match-actions">
        <button type="button" disabled={!opponentConnected || ready || units !== ownOffer} onClick={() => onConfirm(offers.revision)}>
          {ready ? 'Stake confirmed' : agreed === '0' ? 'Confirm free match' : `Confirm ${agreed} test USDC stake`}
        </button>
      </div>
    </div>
  )
}
