import type { Address } from 'viem'
import type { WorldEnvironment } from '../world/types.ts'

export type PrizeConfig = { enabled: boolean; escrowAddress?: Address; worldEnvironment?: WorldEnvironment }
export type PrizeMember = { address: Address; token: string; escrow: Address }

export async function prizeRequest<T>(action: string, data?: object, token?: string): Promise<T> {
  const response = await fetch(`/api/prize/${action}`, data && {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: JSON.stringify(data),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? 'Prize service unavailable.')
  return result
}
