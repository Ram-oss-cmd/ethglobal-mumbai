import type { Address, Hex } from 'viem'
import type { MatchRecord, PrizeState } from '../competition/protocol.ts'

export interface PrizeCompetition {
  variableStake?: boolean
  admit(token: string | undefined): Address | undefined
  open(matchId: string, wallets: [Address, Address], stakeUnits: number): Promise<{
    matchKey: Hex; transactionHash: Hex; depositDeadline: number; refundAfter: number
  }>
  canStart(matchKey: Hex, wallets: [Address, Address], stakeUnits: number): Promise<boolean>
  complete(matchKey: Hex, record: MatchRecord, wallets: [Address, Address], stakeUnits: number): Promise<
    Pick<PrizeState, 'settlementTx' | 'deferredPayouts' | 'historyKey' | 'archiveTx' | 'message'>
  >
}
