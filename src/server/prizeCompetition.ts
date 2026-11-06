import type { Address, Hex } from 'viem'
import type { MatchRecord } from '../competition/protocol.ts'

export interface PrizeCompetition {
  admit(token: string | undefined): Address | undefined
  open(matchId: string, wallets: [Address, Address]): Promise<{
    matchKey: Hex; transactionHash: Hex; depositDeadline: number; refundAfter: number
  }>
  canStart(matchKey: Hex, wallets: [Address, Address]): Promise<boolean>
  complete(matchKey: Hex, record: MatchRecord, wallets: [Address, Address]): Promise<{
    settlementTx?: Hex; historyKey?: string; archiveTx?: Hex; message?: string
  }>
}
