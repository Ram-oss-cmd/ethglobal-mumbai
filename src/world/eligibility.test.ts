import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generatePrivateKey } from 'viem/accounts'
import { hashSignal } from '@worldcoin/idkit/hashing'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createWorldEligibility } from './eligibility.ts'
import type { WorldChallenge } from './types.ts'

const a = '0x0000000000000000000000000000000000000001'
const b = '0x0000000000000000000000000000000000000002'
let dir: string
let env: NodeJS.ProcessEnv
const verifier = vi.fn()

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wallet-rush-world-'))
  env = {
    WORLD_APP_ID: 'app_test', WORLD_RP_ID: 'rp_test', WORLD_RP_SIGNING_KEY: generatePrivateKey(),
    WORLD_ACTION: 'test-tournament', WORLD_ENVIRONMENT: 'staging', WORLD_ELIGIBILITY_FILE: join(dir, 'world.json'),
  }
  verifier.mockReset()
  vi.stubGlobal('fetch', verifier)
})

afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(dir, { force: true, recursive: true })
})

function proof(challenge: WorldChallenge, wallet = challenge.signal, nullifier = '0x11') {
  return {
    protocol_version: '4.0', nonce: challenge.rp_context.nonce, action: challenge.action, environment: challenge.environment,
    responses: [{
      identifier: 'proof_of_human', issuer_schema_id: 1, expires_at_min: 1_900_000_000,
      proof: Array(5).fill('0x1'), nullifier, signal_hash: hashSignal(wallet),
    }],
  }
}

function accept(nullifier = '0x11') {
  verifier.mockImplementation(async () => Response.json({
    success: true, environment: 'staging', results: [{ success: true, identifier: 'proof_of_human', nullifier }],
  }))
}

it('registers a remotely accepted proof and blocks the same nullifier on another wallet after restart', async () => {
  accept()
  const world = createWorldEligibility(env)!
  await world.verify(a, proof(world.challenge(a)))
  expect(world.eligible(a)).toBe(true)
  const restarted = createWorldEligibility(env)!
  expect(restarted.eligible(a)).toBe(true)
  await expect(restarted.verify(b, proof(restarted.challenge(b), b, '0x0011'))).rejects.toThrow('another wallet')
  expect(restarted.eligible(b)).toBe(false)
  expect(verifier).toHaveBeenCalledTimes(2)
  expect(verifier.mock.calls[0][0]).toBe('https://developer.world.org/api/v4/verify/rp_test')
})

it('rejects invalid client fields, canceled requests and an unsuccessful provider response', async () => {
  const world = createWorldEligibility(env)!
  const challenge = world.challenge(a)
  await expect(world.verify(a, proof(challenge, b))).rejects.toThrow('mismatched')
  await expect(world.verify(a, { ...proof(challenge), environment: 'production' })).rejects.toThrow('mismatched')
  world.cancel(a)
  await expect(world.verify(a, proof(challenge))).rejects.toThrow('mismatched')
  expect(verifier).not.toHaveBeenCalled()
  verifier.mockResolvedValueOnce(Response.json({ success: false, environment: 'staging' }, { status: 400 }))
  await expect(world.verify(a, proof(world.challenge(a)))).rejects.toThrow('World rejected')
  expect(world.eligible(a)).toBe(false)
})
