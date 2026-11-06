import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { hashSignal } from '@worldcoin/idkit/hashing'
import { signRequest } from '@worldcoin/idkit/signing'
import type { WorldChallenge, WorldEnvironment } from './types.ts'

const VERIFY_API = 'https://developer.world.org/api/v4/verify'
const CHALLENGE_TTL = 300
const MAX_PENDING = 1_000
const WALLET = /^0x[0-9a-f]{40}$/i
const FIELD = /^(?:0x[0-9a-f]{1,64}|[0-9]{1,78})$/i

type Registration = { wallet: string; nullifierDigest: string }
type Request = { context: WorldChallenge['rp_context']; verifying: boolean }

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function field(value: unknown) {
  if (typeof value !== 'string' || !FIELD.test(value)) return undefined
  const parsed = BigInt(value)
  if (parsed < 2n ** 256n) return parsed
}

function walletKey(wallet: string) {
  if (!WALLET.test(wallet)) throw new Error('Invalid verified wallet address')
  return wallet.toLowerCase()
}

function readRegistrations(path: string, scope: string): Registration[] {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    if (object(error)?.code === 'ENOENT') return []
    throw error
  }

  const store = object(raw)
  if (store?.scope !== scope || !Array.isArray(store.registrations)) {
    throw new Error('World ID eligibility file has a different tournament scope or invalid contents')
  }
  const registrations: Registration[] = []
  const wallets = new Set<string>()
  const digests = new Set<string>()
  for (const value of store.registrations) {
    const entry = object(value)
    if (typeof entry?.wallet !== 'string' || !WALLET.test(entry.wallet) ||
        typeof entry.nullifierDigest !== 'string' || !/^[0-9a-f]{64}$/.test(entry.nullifierDigest)) {
      throw new Error('Invalid World ID eligibility registration')
    }
    const wallet = entry.wallet.toLowerCase()
    if (wallets.has(wallet) || digests.has(entry.nullifierDigest)) {
      throw new Error('Conflicting World ID eligibility registrations')
    }
    wallets.add(wallet)
    digests.add(entry.nullifierDigest)
    registrations.push({ wallet, nullifierDigest: entry.nullifierDigest })
  }
  return registrations
}

function saveRegistrations(path: string, scope: string, registrations: Registration[]) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify({ scope, registrations }), { flag: 'wx', mode: 0o600, flush: true })
  try {
    renameSync(temporary, path)
  } catch (error) {
    unlinkSync(temporary)
    throw error
  }
}

/** Validate Proof of Human after the caller authenticates control of the wallet. */
export function createWorldEligibility(env: NodeJS.ProcessEnv = process.env) {
  const { WORLD_APP_ID: app, WORLD_RP_ID: rpId, WORLD_RP_SIGNING_KEY: signingKey, WORLD_ACTION: action } = env
  if (!app || !rpId || !signingKey || !action) return
  if (!/^app_[a-z0-9_]+$/i.test(app) || !/^rp_[a-z0-9]+$/i.test(rpId) ||
      !/^(?:0x)?[0-9a-f]{64}$/i.test(signingKey) || !/^[a-z0-9_-]{1,128}$/i.test(action)) {
    throw new Error('Invalid World ID developer credentials or action')
  }
  const environment: WorldEnvironment = env.WORLD_ENVIRONMENT === 'production' ? 'production' : 'staging'
  if (env.WORLD_ENVIRONMENT && env.WORLD_ENVIRONMENT !== environment) {
    throw new Error('WORLD_ENVIRONMENT must be staging or production')
  }
  const appId = app as WorldChallenge['app_id']
  const scope = JSON.stringify([environment, appId, rpId, action])
  const path = resolve(env.WORLD_ELIGIBILITY_FILE || '.env.world-eligibility.json')
  const pending = new Map<string, Request>()

  function challenge(wallet: string): WorldChallenge {
    const signal = walletKey(wallet)
    const now = Math.floor(Date.now() / 1_000)
    for (const [address, request] of pending) {
      if (request.context.expires_at <= now) pending.delete(address)
    }
    if (!pending.has(signal) && pending.size >= MAX_PENDING) throw new Error('World ID is busy, try again shortly')
    const { nonce, sig, createdAt, expiresAt } = signRequest({ signingKeyHex: signingKey!, action, ttl: CHALLENGE_TTL })
    const rp_context = { rp_id: rpId!, nonce, signature: sig, created_at: createdAt, expires_at: expiresAt }
    pending.set(signal, { context: rp_context, verifying: false })
    return { app_id: appId, action: action!, environment, rp_context, signal }
  }

  async function verify(wallet: string, proof: unknown) {
    const address = walletKey(wallet)
    const request = pending.get(address)
    const result = object(proof)
    const response = Array.isArray(result?.responses) && result.responses.length === 1
      ? object(result.responses[0])
      : undefined
    const nullifier = field(response?.nullifier)
    if (!request || request.verifying || request.context.expires_at <= Math.floor(Date.now() / 1_000) ||
        result?.protocol_version !== '4.0' || result.action !== action || result.environment !== environment ||
        result.nonce !== request.context.nonce || result.session_id !== undefined ||
        response?.identifier !== 'proof_of_human' || response.issuer_schema_id !== 1 ||
        field(response.signal_hash) !== field(hashSignal(address)) ||
        nullifier === undefined || nullifier === 0n || response.session_nullifier !== undefined ||
        !Array.isArray(response.proof) || response.proof.length !== 5 ||
        response.proof.some(part => field(part) === undefined) || !Number.isSafeInteger(response.expires_at_min)) {
      throw new Error('Invalid, mismatched, or expired World ID proof')
    }

    // Only one verification may use the challenge; cancel or restart can supersede it.
    request.verifying = true
    try {
      const verified = await fetch(`${VERIFY_API}/${rpId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(proof),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      })
      if (!verified.ok) throw new Error('World rejected this Proof of Human')
      const body = object(await verified.json())
      const accepted = Array.isArray(body?.results) && body.results.length === 1
        ? object(body.results[0])
        : undefined
      if (body?.success !== true || body.environment !== environment ||
          (body.action !== undefined && body.action !== action) ||
          accepted?.success !== true || accepted.identifier !== 'proof_of_human' ||
          field(accepted.nullifier) !== nullifier) throw new Error('World rejected this Proof of Human')
      if (pending.get(address) !== request || request.context.expires_at <= Math.floor(Date.now() / 1_000)) {
        throw new Error('World ID challenge expired or was canceled')
      }
    } finally {
      if (pending.get(address) === request) pending.delete(address)
    }

    const nullifierDigest = createHash('sha256').update(scope).update(':').update(nullifier.toString(10)).digest('hex')
    // No await between check and atomic rename. This ledger is for one server process.
    const registrations = readRegistrations(path, scope)
    if (registrations.some(entry => entry.nullifierDigest === nullifierDigest && entry.wallet !== address)) {
      throw new Error('This human is already registered with another wallet for this tournament')
    }
    const previous = registrations.find(entry => entry.wallet === address)
    if (previous && previous.nullifierDigest !== nullifierDigest) {
      throw new Error('This wallet is already registered for this tournament')
    }
    if (!previous) saveRegistrations(path, scope, [...registrations, { wallet: address, nullifierDigest }])
  }

  return {
    environment,
    challenge,
    verify,
    cancel(wallet: string) { pending.delete(walletKey(wallet)) },
    eligible(wallet: string) {
      const address = walletKey(wallet)
      return readRegistrations(path, scope).some(entry => entry.wallet === address)
    },
  }
}
