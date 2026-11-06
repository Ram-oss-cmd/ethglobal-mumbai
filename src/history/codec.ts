import { MAX_ENTITY_BYTES } from '@arkiv-network/sdk/schema'
import type { MatchRecord } from '../competition/protocol.ts'
import { verifyMatchRecord } from '../competition/replay.ts'

const MAX_JSON_BYTES = 1024 * 1024

export async function encodeReplay(record: MatchRecord): Promise<Uint8Array> {
  verifyMatchRecord(record)
  const payload = new TextEncoder().encode(JSON.stringify(record))
  if (payload.length > MAX_JSON_BYTES) throw new Error('Replay exceeds the uncompressed limit')
  const gzip = new Blob([payload]).stream().pipeThrough(new CompressionStream('gzip'))
  const bytes = new Uint8Array(await new Response(gzip).arrayBuffer())
  if (bytes.length > MAX_ENTITY_BYTES) throw new Error('Replay exceeds the Arkiv entity limit')
  return bytes
}

export async function decodeReplay(bytes: Uint8Array): Promise<MatchRecord> {
  if (bytes.length > MAX_ENTITY_BYTES) throw new Error('Replay exceeds the Arkiv entity limit')
  const stream = new Blob([Uint8Array.from(bytes)]).stream().pipeThrough(new DecompressionStream('gzip'))
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let size = 0
  let json = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_JSON_BYTES) throw new Error('Replay exceeds the uncompressed limit')
      json += decoder.decode(value, { stream: true })
    }
  } finally {
    await reader.cancel()
  }
  const record = JSON.parse(json + decoder.decode()) as MatchRecord
  verifyMatchRecord(record)
  return record
}
