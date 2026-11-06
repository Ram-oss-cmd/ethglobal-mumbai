import type { RpContext } from '@worldcoin/idkit'

export type WorldEnvironment = 'staging' | 'production'

export type WorldChallenge = {
  app_id: `app_${string}`
  action: string
  environment: WorldEnvironment
  rp_context: RpContext
  signal: string
}
