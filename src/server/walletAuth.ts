import { randomBytes } from 'node:crypto'
import { getAddress, isAddress, isHex, verifyMessage, type Address } from 'viem'

const CHALLENGE_MS = 5 * 60_000
const SESSION_MS = 60 * 60_000
const MAX_PENDING = 1_024
export const PRIZE_TOKEN = /^[A-Za-z0-9_-]{43}$/

export function createWalletAuth(now = Date.now) {
  const challenges = new Map<string, { wallet: Address; message: string; expires: number }>()
  const sessions = new Map<string, { wallet: Address; expires: number }>()

  function prune(store: Map<string, { expires: number }>) {
    for (const [id, entry] of store) if (entry.expires <= now()) store.delete(id)
  }

  return {
    challenge(rawWallet: unknown, origin: string) {
      if (typeof rawWallet !== 'string' || !isAddress(rawWallet)) throw new Error('Enter a valid EVM wallet address.')
      prune(challenges)
      if (challenges.size >= MAX_PENDING) throw new Error('Too many wallet requests. Try again shortly.')
      const wallet = getAddress(rawWallet)
      const nonce = randomBytes(32).toString('base64url')
      const expires = now() + CHALLENGE_MS
      // The signature proves ownership for this site and nonce, and cannot move funds.
      const message = `Wallet Rush prize competition\n\nVerify ownership of ${wallet}. This signs a message only.\n\nOrigin: ${origin}\nNonce: ${nonce}\nExpires: ${new Date(expires).toISOString()}`
      challenges.set(nonce, { wallet, message, expires })
      return { nonce, message }
    },
    async authenticate(nonce: unknown, signature: unknown) {
      if (typeof nonce !== 'string' || !PRIZE_TOKEN.test(nonce) ||
          typeof signature !== 'string' || !isHex(signature) || signature.length !== 132) {
        throw new Error('Invalid wallet signature.')
      }
      const challenge = challenges.get(nonce)
      challenges.delete(nonce)
      if (!challenge || challenge.expires <= now() || !await verifyMessage({
        address: challenge.wallet, message: challenge.message, signature,
      }).catch(() => false)) throw new Error('Wallet signature was rejected or expired.')
      prune(sessions)
      if (sessions.size >= MAX_PENDING) throw new Error('Too many wallet sessions. Try again shortly.')
      const token = randomBytes(32).toString('base64url')
      sessions.set(token, { wallet: challenge.wallet, expires: now() + SESSION_MS })
      return { token, wallet: challenge.wallet }
    },
    wallet(token: unknown) {
      const session = typeof token === 'string' && PRIZE_TOKEN.test(token) ? sessions.get(token) : undefined
      return session && session.expires > now() ? session.wallet : undefined
    },
  }
}
