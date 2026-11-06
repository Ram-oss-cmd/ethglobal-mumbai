import { IDKitRequestWidget, proofOfHuman } from '@worldcoin/idkit'
import { useRef, useState } from 'react'
import type { WorldChallenge } from './types.ts'

type Props = {
  challenge: WorldChallenge
  verify: (proof: unknown) => Promise<void>
  onSuccess: () => void
  onCancel: () => void
}

export function WorldGate({ challenge, verify, onSuccess, onCancel }: Props) {
  const [open, setOpen] = useState(true)
  const [error, setError] = useState('')
  const completed = useRef(false)

  return (
    <>
      {challenge.environment === 'staging' && (
        <p>World ID staging verification. Simulator proofs are for test competitions only.</p>
      )}
      {error && <p role="alert">{error}</p>}
      <IDKitRequestWidget
        open={open}
        onOpenChange={next => {
          setOpen(next)
          if (!next && !completed.current) onCancel()
        }}
        app_id={challenge.app_id}
        action={challenge.action}
        environment={challenge.environment}
        rp_context={challenge.rp_context}
        allow_legacy_proofs={false}
        preset={proofOfHuman({ signal: challenge.signal })}
        handleVerify={async proof => {
          try {
            await verify(proof)
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : 'World ID verification failed')
            throw failure
          }
        }}
        onSuccess={() => {
          completed.current = true
          onSuccess()
        }}
        onError={code => {
          if (code !== 'failed_by_host_app') {
            setError(code === 'user_rejected' || code === 'cancelled'
              ? 'World ID verification was canceled.'
              : 'World ID verification could not be completed.')
          }
        }}
      />
    </>
  )
}
