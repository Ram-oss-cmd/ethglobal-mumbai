import { expect, it, vi } from 'vitest'
import { createHistoryReader } from './reader.ts'

it('returns a Rabdi rate limit promptly even when the retry window is long', async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 429, headers: { 'retry-after': '3600' } }))
  vi.stubGlobal('fetch', fetch)
  try {
    const reader = createHistoryReader('0x0000000000000000000000000000000000000001', 'test-key')
    await expect(reader.recent()).rejects.toMatchObject({ status: 429 })
    expect(fetch).toHaveBeenCalledOnce()
  } finally {
    vi.unstubAllGlobals()
  }
})
