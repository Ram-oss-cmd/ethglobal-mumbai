import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, resolve } from 'node:path'
import { isAddress, type Address, type Hex } from 'viem'
import { createEscrow } from '../arc/escrow.ts'
import type { DeferredPayout } from '../arc/chain.ts'
import { createHistoryWriter } from '../history/writer.ts'
import { createWorldEligibility } from '../world/eligibility.ts'
import { allowedOrigin } from './competition.ts'
import type { PrizeCompetition } from './prizeCompetition.ts'
import { createWalletAuth } from './walletAuth.ts'

const API = '/api/prize/'
const MAX_BODY = 16_384

export function reservePrizeEntry(path: string, scope: string, matchId: string, wallets: [Address, Address]) {
  mkdirSync(dirname(path), { recursive: true })
  const ledger = readFileSync(path, { encoding: 'utf8', flag: 'a+' })
  const entrants = wallets.map(wallet => wallet.toLowerCase())
  for (const line of ledger.split('\n').filter(Boolean)) {
    const entry = JSON.parse(line) as { scope: string; matchId: string; wallets: string[] }
    if (entry.scope === scope && (entry.matchId === matchId || entry.wallets.some(wallet => entrants.includes(wallet)))) {
      throw new Error('A wallet or match ID has already been used for this tournament.')
    }
  }
  // Reserve before submitting any transaction so competing rooms cannot reuse a wallet.
  appendFileSync(path, JSON.stringify({ scope, matchId, wallets: entrants }) + '\n', { mode: 0o600, flush: true })
}

async function body(req: IncomingMessage) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new Error('Expected JSON.')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk)
    size += bytes.length
    if (size > MAX_BODY) throw new Error('Request is too large.')
    chunks.push(bytes)
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a JSON object.')
  return parsed as Record<string, unknown>
}

export function createPrize() {
  function configured<T>(name: string, create: () => T) {
    try { return create() } catch {
      console.warn(`Wallet Rush: ${name} configuration is invalid. Prize entry is disabled.`)
    }
  }
  const world = configured('World ID', createWorldEligibility)
  const escrow = configured('Arc escrow', createEscrow)
  const history = configured('Arkiv writer', createHistoryWriter)
  const auth = createWalletAuth()
  const expectedWriter = process.env.VITE_ARKIV_WRITER_ADDRESS
  const studio = process.env.ARC_STUDIO_PROJECT_URL
  const studioValid = studio?.startsWith('https://studio.arc.io/')
  const writerValid = expectedWriter && isAddress(expectedWriter) &&
    history?.address.toLowerCase() === expectedWriter.toLowerCase()
  const enabled = Boolean(world && escrow && history && writerValid && studioValid)
  const quota = new Map<string, { count: number; expires: number }>()
  const ledger = resolve(process.env.PRIZE_ENTRY_FILE || '.env.prize-entries.jsonl')
  const scope = JSON.stringify([world?.environment, process.env.WORLD_APP_ID, process.env.WORLD_RP_ID, process.env.WORLD_ACTION])

  const competition: PrizeCompetition | undefined = enabled && world && escrow && history ? {
    variableStake: escrow.version === '2',
    admit(token) {
      const wallet = auth.wallet(token)
      if (!wallet) return
      try { return world.eligible(wallet) ? wallet : undefined } catch { return }
    },
    async open(matchId, wallets, stakeUnits) {
      try { await escrow.verifyDeployment() } catch {
        throw new Error('Arc escrow configuration could not be verified. Check the deployment, version, and referee.')
      }
      reservePrizeEntry(ledger, scope, matchId, wallets)
      try {
        return await escrow.openMatch(matchId, wallets, stakeUnits)
      } catch {
        throw new Error('Arc escrow could not be confirmed. Ask the organizer to inspect the match before retrying.')
      }
    },
    canStart: escrow.canStart,
    async complete(matchKey, record, wallets, stakeUnits) {
      let settlementTx: Hex | undefined
      let deferredPayouts: DeferredPayout[] | undefined
      let historyKey: string | undefined
      let archiveTx: Hex | undefined
      const errors: string[] = []
      try {
        const settlement = await escrow.settle(matchKey, record, wallets, stakeUnits)
        settlementTx = settlement.transactionHash
        deferredPayouts = settlement.deferredPayouts
      } catch {
        errors.push('Arc settlement was not confirmed. Check the escrow and use its timeout refund if still unsettled.')
      }
      try {
        const archive = await history.publish(record, wallets, settlementTx)
        historyKey = archive.entityKey
        archiveTx = archive.transactionHash
      } catch {
        errors.push('Arkiv publication was not confirmed. Save the verified match record.')
      }
      return { settlementTx, deferredPayouts, historyKey, archiveTx, message: errors.join(' ') || undefined }
    },
  } : undefined

  function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const pathname = req.url?.split('?')[0]
    if (!pathname?.startsWith(API)) return next()
    function reply(code: number, payload: unknown) {
      res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify(payload))
    }
    if (pathname === API + 'config' && req.method === 'GET') {
      return reply(200, { enabled, worldEnvironment: world?.environment, escrowAddress: escrow?.address, escrowVersion: escrow?.version })
    }
    if (req.method !== 'POST' || !allowedOrigin(req, process.env.WALLET_RUSH_ORIGIN)) {
      return reply(403, { error: 'Open the game from the configured origin.' })
    }
    const time = Date.now()
    for (const [ip, limit] of quota) if (limit.expires <= time) quota.delete(ip)
    const ip = req.socket.remoteAddress ?? 'unknown'
    const limit = quota.get(ip) ?? { count: 0, expires: time + 60_000 }
    if (limit.count >= 40 || (!quota.has(ip) && quota.size >= 1_024)) return reply(429, { error: 'Try again shortly.' })
    limit.count++
    quota.set(ip, limit)

    void (async () => {
      const input = await body(req)
      switch (pathname.slice(API.length)) {
        case 'wallet-challenge':
          return reply(200, auth.challenge(input.wallet, req.headers.origin!))
        case 'wallet-verify':
          return reply(200, await auth.authenticate(input.nonce, input.signature))
        default: {
          const wallet = auth.wallet(req.headers.authorization?.replace(/^Bearer /, ''))
          if (!wallet) return reply(401, { error: 'Verify ownership of your wallet first.' })
          if (!world) return reply(503, { error: 'World ID setup is pending.' })
          switch (pathname.slice(API.length)) {
            case 'world-challenge':
              return reply(200, world.eligible(wallet) ? { eligible: true } : { challenge: world.challenge(wallet) })
            case 'world-verify':
              await world.verify(wallet, input.proof)
              return reply(200, { eligible: true })
            case 'world-cancel':
              world.cancel(wallet, input.nonce)
              return reply(200, { eligible: false })
            default:
              return reply(404, { error: 'Unknown prize action.' })
          }
        }
      }
    })().catch(error => {
      // SDK/network errors can contain URLs or credentials, so only report controlled messages.
      const message = error instanceof Error ? error.message : ''
      const safe = /^(Invalid|Enter a valid|Too many|Wallet signature|World rejected|World ID challenge|World ID is busy|This human|This wallet|Expected JSON|Expected a JSON|Request is too large)/.test(message)
      reply(400, { error: safe ? message : 'Prize request failed. Check configuration or try again.' })
    })
  }

  return { competition, handle }
}
