import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { setImmediate } from 'node:timers/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { MATCH_SOCKET_PATH, type ServerMessage } from '../competition/protocol'
import { verifyMatchRecord } from '../competition/replay'
import { RUN_MS, TICK_MS } from '../game'
import { attachCompetition } from './competition'

type Packet<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>

function peer(socket: WebSocket) {
  const inbox: ServerMessage[] = []
  socket.on('message', data => inbox.push(JSON.parse(data.toString())))
  return {
    socket,
    send(message: unknown) {
      socket.send(JSON.stringify(message))
    },
    async barrier() {
      // A pong arrives after the server's handlers for previously sent frames.
      const pong = once(socket, 'pong')
      socket.ping()
      await pong
    },
    async receive<T extends ServerMessage['type']>(
      type: T,
      accept: (packet: Packet<T>) => boolean = () => true,
    ): Promise<Packet<T>> {
      for (;;) {
        const index = inbox.findIndex(packet => packet.type === type && accept(packet as Packet<T>))
        if (index !== -1) return inbox.splice(index, 1)[0] as Packet<T>
        await once(socket, 'message')
      }
    },
    async disconnect() {
      const closed = once(socket, 'close')
      socket.close()
      await closed
    },
  }
}

describe('authoritative two-player competition over WebSocket', () => {
  let server: Server
  let runtime: ReturnType<typeof attachCompetition>
  let now: number
  let origin: string
  let sockets: WebSocket[]

  beforeEach(async () => {
    now = 0
    sockets = []
    server = createServer()
    runtime = attachCompetition(server, { now: () => now })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    for (const socket of sockets) socket.terminate()
    runtime.close()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  })

  async function advance(ms: number) {
    const end = now + ms
    while (now < end) {
      now = Math.min(end, now + 100)
      runtime.advance()
      if (now % 1000 === 0) await setImmediate()
    }
  }

  function socketWithOrigin(requestOrigin = origin) {
    const socket = new WebSocket(origin.replace('http:', 'ws:') + MATCH_SOCKET_PATH, { origin: requestOrigin })
    sockets.push(socket)
    return socket
  }

  async function connect() {
    const socket = socketWithOrigin()
    await once(socket, 'open')
    return peer(socket)
  }

  async function join(resumeToken?: string) {
    const client = await connect()
    client.send({ type: 'join', matchId: 'test-room', resumeToken })
    const identity = await client.receive('joined')
    return { ...client, identity }
  }

  async function startPair() {
    const a = await join()
    const b = await join()
    expect([a.identity.seat, b.identity.seat]).toEqual([0, 1])
    a.send({ type: 'ready' })
    const waiting = await b.receive('state', packet => packet.seats[0]?.ready === true)
    expect(waiting).toMatchObject({ phase: 'lobby', tick: 0 })
    await advance(1000)
    b.send({ type: 'ready' })
    const [startA, startB] = await Promise.all([
      a.receive('state', packet => packet.phase === 'running'),
      b.receive('state', packet => packet.phase === 'running'),
    ])
    expect(startA).toEqual(startB)
    expect(startA.tick).toBe(0)
    expect(startA.seats[0]?.run).toEqual(startA.seats[1]?.run)
    expect(JSON.stringify(startA)).not.toContain(a.identity.resumeToken)
    expect(JSON.stringify(startB)).not.toContain(b.identity.resumeToken)
    return { a, b }
  }

  it('treats a disconnect during the last hit as a spectator disconnect and verifies the winner', async () => {
    const { a, b } = await startPair()
    a.send({ type: 'input', direction: 'down' })
    await a.barrier()
    await advance(18_400)
    const lastHit = await b.receive('state', packet => packet.seats[1]?.run?.lives === 0)
    expect(lastHit.seats[1]?.run?.status).toBe('playing')
    await b.disconnect()
    const disconnected = await a.receive('state', packet => packet.seats[1]?.connected === false)
    expect(disconnected.phase).toBe('running')

    await advance(1600)
    const early = await a.receive('state', packet => packet.tick === 2000)
    expect(early.phase).toBe('running')
    expect(early.seats[0]?.run).toMatchObject({ banked: 3, lives: 3, status: 'playing' })
    expect(early.seats[1]?.run).toMatchObject({ banked: 0, lives: 0, status: 'out-of-lives' })

    await advance(1000)
    const spectator = await join(b.identity.resumeToken)
    expect(spectator.identity.seat).toBe(1)
    const resumed = await spectator.receive('state', packet => packet.phase === 'running')
    expect(resumed.seats[1]?.run).toEqual(early.seats[1]?.run)
    expect(resumed.seats[0]?.run?.elapsedMs).toBe(21_000)

    await advance(RUN_MS - 21_000)
    const { record } = await spectator.receive('record')
    expect(record.result).toEqual({ kind: 'win', winner: 0, reason: 'banked' })
    expect(record.runs[0]).toMatchObject({ finalBanked: 3, status: 'timeout', outcome: 'win' })
    expect(record.runs[1]).toMatchObject({ finalBanked: 0, status: 'out-of-lives', outcome: 'loss' })
    expect(record.runs[0].ticks).toBe(RUN_MS / TICK_MS)
    expect(record.runs[1].ticks).toBeLessThan(record.runs[0].ticks)
    expect(record.runs[1].deaths.map(death => death.lives)).toEqual([2, 1, 0])
    expect(record.runs[0].banking).toEqual([{ tick: 59, banked: 3 }])
    expect(record.runs[0].seed).toBe(record.runs[1].seed)
    const replay = verifyMatchRecord(record)
    expect(replay[0].banked).toBe(3)
    expect(replay[1].elapsedMs).toBe(record.runs[1].ticks * TICK_MS)
    const tampered = structuredClone(record)
    tampered.runs[0].finalBanked++
    expect(() => verifyMatchRecord(tampered)).toThrow()

    await spectator.disconnect()
    const reconnected = await join(b.identity.resumeToken)
    expect((await reconnected.receive('record')).record).toEqual(record)
  })

  it('resolves both runs finishing on the same tick as a draw when banked scores tie', async () => {
    const { a, b } = await startPair()
    for (const client of [a, b]) client.send({ type: 'input', direction: 'down' })
    await Promise.all([a.barrier(), b.barrier()])
    await advance(RUN_MS)
    const [{ record }, other] = await Promise.all([a.receive('record'), b.receive('record')])
    expect(record).toEqual(other.record)
    expect(record.result).toEqual({ kind: 'draw', reason: 'banked' })
    expect(record.runs.map(({ ticks, finalBanked, outcome }) => [ticks, finalBanked, outcome])).toEqual([
      [RUN_MS / TICK_MS, 3, 'draw'],
      [RUN_MS / TICK_MS, 3, 'draw'],
    ])
    expect(verifyMatchRecord(record).map(run => run.elapsedMs)).toEqual([RUN_MS, RUN_MS])
  })

  it('pauses both clocks for a live disconnect, resumes the seat, and cancels after cumulative grace', async () => {
    const { a, b } = await startPair()
    const duplicate = await connect()
    const duplicateClosed = once(duplicate.socket, 'close')
    duplicate.send({ type: 'join', matchId: 'test-room', resumeToken: b.identity.resumeToken })
    expect((await duplicate.receive('error')).fatal).toBe(false)
    expect((await duplicateClosed)[0]).toBe(1013)

    await advance(100)
    await b.disconnect()
    const paused = await a.receive('state', packet => packet.phase === 'paused')
    await advance(6000)
    const resumed = await join(b.identity.resumeToken)
    const resumedState = await a.receive('state', packet => packet.phase === 'running' && packet.tick === paused.tick)
    expect(resumed.identity.seat).toBe(b.identity.seat)
    expect(resumedState.seats.map(seat => seat?.playerId)).toEqual(paused.seats.map(seat => seat?.playerId))
    expect(resumedState.seats.map(seat => seat?.run?.elapsedMs)).toEqual([100, 100])

    await advance(100)
    await resumed.disconnect()
    await a.receive('state', packet => packet.phase === 'paused' && packet.tick > paused.tick)
    await advance(4100)
    const { record } = await a.receive('record')
    expect(record.result).toEqual({ kind: 'canceled', reason: 'disconnect', refundEligible: true })
    expect(record.runs.map(run => run.outcome)).toEqual(['canceled', 'canceled'])
    expect(verifyMatchRecord(record).map(run => run.elapsedMs)).toEqual([200, 200])
  })

  it('rejects forged authority, seat theft, malformed input, and an input flood', async () => {
    const { a, b } = await startPair()
    for (const message of [
      { type: 'score', banked: 999 },
      { type: 'input', direction: 'down', elapsedMs: RUN_MS, playerId: b.identity.seat },
      { type: 'input', direction: 'teleport' },
    ]) {
      a.send(message)
      await a.receive('error')
    }
    const intruder = await connect()
    intruder.send({ type: 'join', matchId: 'test-room', resumeToken: 'A'.repeat(43) })
    await intruder.receive('error')
    await b.disconnect()
    await a.receive('state', packet => packet.phase === 'paused')
    const stranger = await connect()
    stranger.send({ type: 'join', matchId: 'test-room' })
    await stranger.receive('error')
    const resumed = await join(b.identity.resumeToken)
    await resumed.receive('state', packet => packet.phase === 'running')

    now += 1000 // A packet arrives while the server's tick callback is delayed.
    for (const direction of ['up', 'right', 'down']) a.send({ type: 'input', direction })
    await a.barrier()
    const overdue = await resumed.receive('state', packet => packet.tick === 100)
    expect(overdue.seats[0]?.run?.player.y).toBe(13)
    await advance(100)
    const live = await resumed.receive('state', packet => packet.tick === 110)
    expect(live.seats[0]?.run).toMatchObject({ elapsedMs: 1100, banked: 0 })
    expect(live.seats[0]?.run?.player.y).toBeCloseTo(13.6)
    expect(live.seats[1]?.run?.player.y).toBe(13)

    const closed = once(a.socket, 'close')
    for (let i = 0; i < 30; i++) a.send({ type: 'input', direction: 'left' })
    await a.receive('error', packet => packet.fatal === true)
    expect((await closed)[0]).toBe(1008)
    const paused = await resumed.receive('state', packet => packet.phase === 'paused')
    expect(paused.seats[0]?.run).toEqual(live.seats[0]?.run)
    await advance(10_000)
    const { record } = await resumed.receive('record')
    expect(record.runs[0].inputs).toEqual([{ tick: 101, direction: 'down' }])
    expect(record.runs[1].inputs).toEqual([])
  })

  it('rejects WebSocket upgrades from a cross-origin browser', async () => {
    const foreign = socketWithOrigin('https://example.org')
    await expect(once(foreign, 'open')).rejects.toThrow(/403/)
  })

  it('closes oversized frames before accepting their contents', async () => {
    const client = await connect()
    const closed = once(client.socket, 'close')
    client.send({ type: 'join', matchId: 'x'.repeat(64 * 1024) })
    const [code] = await closed
    expect(code).toBe(1009)
  })
})
