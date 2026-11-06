import { useEffect, useState } from 'react'
import { formatUnits, isAddressEqual, parseUnits, type Hex } from 'viem'
import { arcTxUrl, ENTRY_AMOUNT, ESCROW_ABI, USDC_DECIMALS, validStakeUnits } from '../arc/chain.ts'
import type { MatchResult, PrizeState, Seat } from '../competition/protocol.ts'
import type { PrizeMember } from './api'
import { arc, depositUSDC } from './wallet'

export default function PrizeFunding({ member, prize, seat, ready, onReady, matchId, result, opponentConnected, onOffer, onConfirm }: {
  member: PrizeMember; prize?: PrizeState; seat: Seat; ready: boolean; onReady: () => void; matchId: string; result?: MatchResult
  opponentConnected: boolean; onOffer: (units: number) => void; onConfirm: (revision: number) => void
}) {
  const [funded, setFunded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [hash, setHash] = useState<Hex>()
  const [depositReceipt, setDepositReceipt] = useState<Hex>()
  const [error, setError] = useState('')
  const matchKey = prize?.matchKey
  const stakeUnits = prize?.stakeUnits ?? Number(ENTRY_AMOUNT)
  const stake = BigInt(stakeUnits)
  const ownPayout = prize?.settlementTx && result && !prize.deferredPayouts?.some(payout => isAddressEqual(payout.player, member.address))
    ? (result.kind === 'win' ? result.winner === seat ? 2n * stake : 0n : stake) : 0n

  useEffect(() => {
    if (!matchKey || prize.stage !== 'funding') return
    const lifetime = new AbortController()
    const refresh = () => void arc.readContract({
      address: member.escrow, abi: ESCROW_ABI, functionName: 'getMatch', args: [matchKey],
    }).then(match => {
      if (!lifetime.signal.aborted) {
        setFunded(isAddressEqual(match[seat], member.address) && match[seat === 0 ? 4 : 5] && !match[6])
      }
    }).catch(() => {})
    refresh()
    const interval = window.setInterval(refresh, 3_000)
    return () => { lifetime.abort(); window.clearInterval(interval) }
  }, [matchKey, prize?.stage, member.address, member.escrow, seat])

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
          opponentConnected={opponentConnected} onOffer={onOffer} onConfirm={onConfirm} />
      )}
      {prize?.stage === 'waiting' && !prize.offers && (
        <div className="match-actions">
          <button type="button" disabled={ready} onClick={onReady}>{ready ? 'Entry confirmed' : 'Confirm prize entry'}</button>
        </div>
      )}
      {prize?.stage === 'opening' && <p role="status">Opening escrow on Arc Testnet…</p>}
      {prize?.stage === 'funding' && (
        <div className="match-actions">
          {funded ? <button type="button" disabled={ready} onClick={onReady}>{ready ? 'Ready' : 'Ready after deposit'}</button>
            : <button type="button" disabled={busy} onClick={deposit}>{busy ? 'Confirming on Arc…' : `Deposit ${formatUnits(stake, USDC_DECIMALS)} test USDC`}</button>}
        </div>
      )}
      {prize?.stage === 'funding' && prize.depositDeadline && (
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
          {' '}{isAddressEqual(player, member.address) ? 'your wallet. Check “Claim deferred test USDC” above.' : 'the other wallet.'}</p>
      ))}
      {prize?.historyKey && <a href={`/replay/${matchId}`}>Public Arkiv replay</a>}
      {prize?.archiveTx && <a href={`https://rabdi.explorer.arkiv.network/tx/${prize.archiveTx}`}>Arkiv archive receipt</a>}
      {(error || prize?.message) && <p role="alert">{error || prize?.message}</p>}
    </section>
  )
}

function StakeOffer({ offers, seat, ready, opponentConnected, onOffer, onConfirm }: {
  offers: NonNullable<PrizeState['offers']>; seat: Seat; ready: boolean; opponentConnected: boolean
  onOffer: (units: number) => void; onConfirm: (revision: number) => void
}) {
  const ownOffer = offers.units[seat]
  const [draft, setDraft] = useState(() => formatUnits(BigInt(ownOffer), USDC_DECIMALS))
  const units = /^\d{1,3}(?:\.\d{1,6})?$/.test(draft) ? Number(parseUnits(draft, USDC_DECIMALS)) : undefined
  const agreed = formatUnits(BigInt(Math.min(...offers.units)), USDC_DECIMALS)
  const opponent = formatUnits(BigInt(offers.units[seat === 0 ? 1 : 0]), USDC_DECIMALS)

  return (
    <div>
      <form className="match-actions" onSubmit={event => {
        event.preventDefault()
        if (validStakeUnits(units) && units !== ownOffer) onOffer(units)
      }}>
        <label htmlFor="stake-offer">Your offer in test USDC</label>
        <input id="stake-offer" inputMode="decimal" maxLength={10} value={draft} onChange={event => setDraft(event.target.value)} />
        <button type="submit" disabled={!validStakeUnits(units) || units === ownOffer}>Update offer</button>
      </form>
      <p>{opponentConnected ? `Opponent offers ${opponent} test USDC.` : 'Set your offer and share the invite.'}</p>
      <p>Matched stake <strong>{agreed} test USDC each</strong></p>
      <div className="match-actions">
        <button type="button" disabled={!opponentConnected || ready || units !== ownOffer} onClick={() => onConfirm(offers.revision)}>
          {ready ? 'Stake confirmed' : `Confirm ${agreed} test USDC stake`}
        </button>
      </div>
    </div>
  )
}
