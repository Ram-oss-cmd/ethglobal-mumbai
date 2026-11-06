import { formatUnits, parseUnits, verifyTypedData, type Address } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildMatchRecord } from '../competition/replay.ts'
import { RUN_MS, TICK_MS } from '../game/index.ts'
import { ARC_TESTNET, ENTRY_AMOUNT, USDC_DECIMALS, matchKeyFor } from './chain.ts'
import { createEscrow, matchCanStart, resultTypedData } from './escrow.ts'

const playerA = '0x1000000000000000000000000000000000000000'
const playerB = '0x2000000000000000000000000000000000000000'
const escrow = '0x3000000000000000000000000000000000000000'
const wallets: [Address, Address] = [playerA, playerB]
const matchId = 'escrow-unit-test'
const matchKey = matchKeyFor(matchId)

afterEach(() => vi.unstubAllEnvs())

describe('Arc escrow application adapter', () => {
  it('uses six decimal units and leaves the escrow disabled when it is not configured', () => {
    vi.stubEnv('ARC_ESCROW_ADDRESS', '')
    vi.stubEnv('ARC_REFEREE_KEY', '')
    expect(createEscrow()).toBeUndefined()
    expect(ARC_TESTNET.id).toBe(5042002)
    expect(ARC_TESTNET.nativeCurrency.decimals).toBe(18)
    expect(ENTRY_AMOUNT).toBe(parseUnits('10', USDC_DECIMALS))
    expect(formatUnits(60_000_000n, USDC_DECIMALS)).toBe('60')
  })

  it('starts only with the exact wallets, both deposits, and enough refund window', () => {
    const active = [playerA, playerB, 600n, 900n, true, true, false] as const
    expect(matchCanStart(active, wallets, 700n)).toBe(true)
    expect(matchCanStart(active, [playerB, playerA], 700n)).toBe(false)
    expect(matchCanStart([playerA, playerB, 600n, 900n, true, false, false], wallets, 700n)).toBe(false)
    expect(matchCanStart([playerA, playerB, 600n, 900n, true, true, true], wallets, 700n)).toBe(false)
    expect(matchCanStart(active, wallets, 760n)).toBe(false)
  })

  it('signs a replay-verified result scoped to the exact chain, match and players', async () => {
    const fullRun = RUN_MS / TICK_MS
    const inputs = [{ tick: 1, direction: 'down' }] as const
    const record = buildMatchRecord(matchId, wallets, 1, [[...inputs], [...inputs]],
      [fullRun, fullRun], { kind: 'draw', reason: 'banked' })
    const typedData = resultTypedData(escrow, matchKey, record, wallets, 123n)
    expect(typedData.message).toMatchObject({ outcome: 3, scoreA: 3, scoreB: 3, validUntil: 123n })
    const referee = privateKeyToAccount(generatePrivateKey())
    const signature = await referee.signTypedData(typedData)
    expect(await verifyTypedData({ ...typedData, address: referee.address, signature })).toBe(true)
    expect(await verifyTypedData({ ...typedData, address: referee.address, signature,
      domain: { ...typedData.domain, chainId: 1 } })).toBe(false)
    expect(await verifyTypedData({ ...typedData, address: referee.address, signature,
      message: { ...typedData.message, validUntil: 124n } })).toBe(false)
    expect(() => resultTypedData(escrow, matchKeyFor('another-match'), record, wallets, 123n)).toThrow(/belong/)
    expect(() => resultTypedData(escrow, matchKey, record, [playerB, playerA], 123n)).toThrow(/belong/)
    record.runs[0].finalBanked++
    expect(() => resultTypedData(escrow, matchKey, record, wallets, 123n)).toThrow(/differs/)
  })
})
