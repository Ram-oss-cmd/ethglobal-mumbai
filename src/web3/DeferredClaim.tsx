import { useEffect, useState } from 'react'
import { formatUnits, type Address, type Hex } from 'viem'
import { arcTxUrl, ESCROW_ABI, USDC_DECIMALS } from '../arc/chain.ts'
import { arc, claimUSDC } from './wallet'

export default function DeferredClaim({ account, escrow }: { account: Address; escrow: Address }) {
  const [units, setUnits] = useState(0n)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tx, setTx] = useState<{ hash: Hex; confirmed: boolean }>()

  useEffect(() => {
    const lifetime = new AbortController()
    const refresh = () => void arc.readContract({
      address: escrow, abi: ESCROW_ABI, functionName: 'claimable', args: [account],
    }).then(value => {
      if (!lifetime.signal.aborted) setUnits(value)
    }).catch(() => {})
    refresh()
    const poll = window.setInterval(refresh, 5_000)
    return () => { lifetime.abort(); window.clearInterval(poll) }
  }, [account, escrow])

  function claim() {
    setBusy(true)
    setError('')
    void claimUSDC(account, escrow, hash => setTx({ hash, confirmed: false }))
      .then(hash => {
        setTx({ hash, confirmed: true })
        setUnits(0n)
      })
      .catch(failure => setError(failure instanceof Error ? failure.message.split('\n')[0] : 'Claim failed.'))
      .finally(() => setBusy(false))
  }

  if (units === 0n && !tx && !error) return null
  return (
    <section aria-label="Deferred test USDC">
      {units > 0n && (
        <div className="match-actions">
          <p>{formatUnits(units, USDC_DECIMALS)} test USDC available to claim when the token permits transfer.</p>
          <button type="button" disabled={busy} onClick={claim}>Claim deferred test USDC</button>
        </div>
      )}
      {tx && <a href={arcTxUrl(tx.hash)}>{tx.confirmed ? 'Confirmed Arc claim' : 'Submitted Arc claim'}</a>}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
