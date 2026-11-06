import { useEffect, useState } from 'react'
import { isAddressEqual, type Hex } from 'viem'
import { arcTxUrl, ESCROW_ABI } from '../arc/chain.ts'
import type { PrizeState, Seat } from '../competition/protocol.ts'
import type { PrizeMember } from './api'
import { arc, depositUSDC } from './wallet'

export default function PrizeFunding({ member, prize, seat, ready, onReady, matchId }: {
  member: PrizeMember; prize?: PrizeState; seat: Seat; ready: boolean; onReady: () => void; matchId: string
}) {
  const [funded, setFunded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [hash, setHash] = useState<Hex>()
  const [error, setError] = useState('')
  const matchKey = prize?.matchKey

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
    void depositUSDC(member.address, member.escrow, matchKey, setHash)
      .then(() => setFunded(true))
      .catch(failure => setError(failure instanceof Error ? failure.message.split('\n')[0] : 'Deposit failed.'))
      .finally(() => setBusy(false))
  }

  return (
    <section className="match-status" aria-label="Test USDC escrow">
      {prize?.stage === 'waiting' && (
        <div className="match-actions">
          <button type="button" disabled={ready} onClick={onReady}>{ready ? 'Entry confirmed' : 'Confirm prize entry'}</button>
        </div>
      )}
      {prize?.stage === 'opening' && <p role="status">Opening escrow on Arc Testnet…</p>}
      {prize?.stage === 'funding' && (
        <div className="match-actions">
          {funded ? <button type="button" disabled={ready} onClick={onReady}>{ready ? 'Ready' : 'Ready after deposit'}</button>
            : <button type="button" disabled={busy} onClick={deposit}>{busy ? 'Confirming on Arc…' : 'Deposit 10 test USDC'}</button>}
        </div>
      )}
      {prize?.stage === 'settling' && <p role="status">Verifying testnet settlement and publishing the replay…</p>}
      {prize?.openTx && <a href={arcTxUrl(prize.openTx)}>Arc escrow receipt</a>}
      {hash && <a href={arcTxUrl(hash)}>{funded ? 'Arc deposit receipt' : 'Submitted Arc transaction'}</a>}
      {prize?.settlementTx && <a href={arcTxUrl(prize.settlementTx)}>Arc settlement receipt</a>}
      {prize?.historyKey && <a href={`/replay/${matchId}`}>Public Arkiv replay</a>}
      {prize?.archiveTx && <a href={`https://rabdi.explorer.arkiv.network/tx/${prize.archiveTx}`}>Arkiv archive receipt</a>}
      {(error || prize?.message) && <p role="alert">{error || prize?.message}</p>}
    </section>
  )
}
