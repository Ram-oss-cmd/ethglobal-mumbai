import { useEffect, useState } from 'react'
import type { Address } from 'viem'
import { arc } from './wallet'

export function useArcBalance(account?: Address) {
  const [result, setResult] = useState<{ account: Address; units: bigint | null }>()
  useEffect(() => {
    if (!account) return
    let active = true
    const refresh = () => void arc.getBalance({ address: account }).then(
      units => { if (active) setResult({ account, units }) },
      () => { if (active) setResult({ account, units: null }) },
    )
    refresh()
    const poll = window.setInterval(refresh, 5_000)
    return () => { active = false; window.clearInterval(poll) }
  }, [account])
  return result?.account === account ? result?.units : undefined
}
