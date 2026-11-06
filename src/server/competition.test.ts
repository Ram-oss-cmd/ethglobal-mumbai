import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { setImmediate } from 'node:timers/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { MATCH_SOCKET_PATH, type ServerMessage } from '../competition/protocol'
import { verifyMatchRecord } from '../competition/replay'
import { RUN_MS, TICK_MS } from '../game'
import { point, START_TILE } from '../game/maze'
import { attachCompetition } from './competition'
import type { PrizeCompetition } from './prizeCompetition'

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
    expect(startA.seats[0]?.run?.player).toEqual(startA.seats[1]?.run?.player)
    const [first, second] = startA.seats.map(seat => seat!.run!.pellets)
    expect(first).toHaveLength(4)
    expect(second).toHaveLength(4)
    for (const pellet of first) expect(second).not.toContainEqual(pellet)
    expect(JSON.stringify(startA)).not.toContain(a.identity.resumeToken)
    expect(JSON.stringify(startB)).not.toContain(b.identity.resumeToken)
    return { a, b }
  }

  it('treats a disconnect during the last hit as a spectator disconnect and verifies the winner', async () => {
    const { a, b } = await startPair()
    a.send({ type: 'input', direction: 'down' })
    await a.barrier()
    await advance(20_200)
    const lastHit = await b.receive('state', packet => packet.seats[1]?.run?.lives === 0)
    expect(lastHit.seats[1]?.run?.status).toBe('playing')
    await b.disconnect()
    const disconnected = await a.receive('state', packet => packet.seats[1]?.connected === false)
    expect(disconnected.phase).toBe('running')

    await advance(1_800)
    const early = await a.receive('state', packet => packet.tick === 2200)
    expect(early.phase).toBe('running')
    expect(early.seats[0]?.run).toMatchObject({ banked: 3, lives: 3, status: 'playing' })
    expect(early.seats[1]?.run).toMatchObject({ banked: 0, lives: 0, status: 'out-of-lives' })

    await advance(1000)
    const spectator = await join(b.identity.resumeToken)
    expect(spectator.identity.seat).toBe(1)
    const resumed = await spectator.receive('state', packet => packet.phase === 'running')
    expect(resumed.seats[1]?.run).toEqual(early.seats[1]?.run)
    expect(resumed.seats[0]?.run?.elapsedMs).toBe(23_000)

    await advance(RUN_MS - 23_000)
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

  it('requires eligible wallet seats and confirmed deposits before starting a prize room', async () => {
    const wallets = [
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
    ] as const
    const key = `0x${'1'.repeat(64)}` as const
    let funded = false
    const prize: PrizeCompetition = {
      admit: token => token === 'a'.repeat(43) ? wallets[0] : token === 'b'.repeat(43) ? wallets[1] : undefined,
      open: vi.fn(async () => ({
        matchKey: key, transactionHash: key, depositDeadline: 0, refundAfter: 0,
      })),
      canStart: vi.fn(async () => funded),
      complete: vi.fn(async () => ({
        settlementTx: key, deferredPayouts: [{ player: wallets[0], amount: '10000000' }],
      })),
    }
    runtime.close()
    runtime = attachCompetition(server, { now: () => now, prize })
    const outsider = await connect()
    outsider.send({ type: 'join', matchId: 'prize-test-room' })
    expect((await outsider.receive('error')).fatal).toBe(true)

    const a = await connect()
    a.send({ type: 'join', matchId: 'prize-test-room', prizeToken: 'a'.repeat(43) })
    await a.receive('joined')
    const duplicate = await connect()
    duplicate.send({ type: 'join', matchId: 'prize-test-room', prizeToken: 'a'.repeat(43) })
    expect((await duplicate.receive('error')).fatal).toBe(true)
    const b = await connect()
    b.send({ type: 'join', matchId: 'prize-test-room', prizeToken: 'b'.repeat(43) })
    const joined = await b.receive('joined')
    expect(prize.open).not.toHaveBeenCalled()
    a.send({ type: 'confirm-stake', revision: 0 })
    await b.receive('state', state => state.seats[0]?.ready === true)
    expect(prize.open).not.toHaveBeenCalled()
    b.send({ type: 'confirm-stake', revision: 0 })
    await a.receive('state', state => state.prize?.stage === 'funding')
    expect(prize.open).toHaveBeenCalledOnce()
    expect(prize.open).toHaveBeenCalledWith('prize-test-room', wallets, 10_000_000)
    a.send({ type: 'ready' })
    b.send({ type: 'ready' })
    const blocked = await a.receive('state', state => Boolean(state.prize?.message))
    expect(blocked.phase).toBe('lobby')
    expect(blocked.seats.map(seat => seat?.ready)).toEqual([false, false])

    funded = true
    a.send({ type: 'ready' })
    b.send({ type: 'ready' })
    const started = await a.receive('state', state => state.phase === 'running')
    expect(started.seats.map(seat => seat?.playerId)).toEqual(wallets)
    await b.disconnect()
    await a.receive('state', state => state.phase === 'paused')
    const stolen = await connect()
    stolen.send({ type: 'join', matchId: 'prize-test-room', prizeToken: 'a'.repeat(43), resumeToken: joined.resumeToken })
    expect(await stolen.receive('error')).toMatchObject({ fatal: true, discardResume: true })
    const expired = await connect()
    expired.send({ type: 'join', matchId: 'prize-test-room', prizeToken: 'c'.repeat(43), resumeToken: joined.resumeToken })
    const authError = await expired.receive('error')
    expect(authError.fatal).toBe(true)
    expect(authError.discardResume).toBeUndefined()
    const resumed = await connect()
    resumed.send({ type: 'join', matchId: 'prize-test-room', prizeToken: 'b'.repeat(43), resumeToken: joined.resumeToken })
    expect((await resumed.receive('joined')).seat).toBe(joined.seat)
    await a.receive('state', state => state.phase === 'running')
    await resumed.disconnect()
    await a.receive('state', state => state.phase === 'paused')
    await advance(10_000)
    const { record } = await a.receive('record')
    expect(record.result.kind).toBe('canceled')
    expect(prize.complete).toHaveBeenCalledWith(key, record, wallets, 10_000_000)
    const settled = await a.receive('state', state => state.prize?.stage === 'settled')
    expect(settled.prize?.deferredPayouts).toEqual([{ player: wallets[0], amount: '10000000' }])
  })

  it('prefills a guest stake and opens only after both players confirm the current offer revision', async () => {
    const wallets = [
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
    ] as const
    const matchId = 'prize-variable'
    const key = `0x${'2'.repeat(64)}` as const
    const prize: PrizeCompetition = {
      variableStake: true,
      admit: token => token === 'a'.repeat(43) ? wallets[0] : token === 'b'.repeat(43) ? wallets[1] : undefined,
      open: vi.fn(async () => ({ matchKey: key, transactionHash: key, depositDeadline: 0, refundAfter: 0 })),
      canStart: vi.fn(async () => true),
      complete: vi.fn(async () => ({ settlementTx: key })),
    }
    runtime.close()
    runtime = attachCompetition(server, { now: () => now, prize })
    const a = await connect()
    a.send({ type: 'join', matchId, prizeToken: 'a'.repeat(43), initialStakeUnits: 5_000_000 })
    await a.receive('joined')

    const b = await connect()
    b.send({ type: 'join', matchId, prizeToken: 'b'.repeat(43) })
    await b.receive('joined')
    const prefilled = await b.receive('state', state => state.prize?.offers?.revision === 0)
    expect(prefilled.prize?.offers?.units).toEqual([5_000_000, 5_000_000])
    expect(prefilled.seats.map(seat => seat?.ready)).toEqual([false, false])
    b.send({ type: 'stake-offer', stakeUnits: 10_000_000 })
    await a.receive('state', state => state.prize?.offers?.revision === 1)
    a.send({ type: 'confirm-stake', revision: 1 })
    await b.receive('state', state => state.seats[0]?.ready === true)

    b.send({ type: 'stake-offer', stakeUnits: 7_250_000 })
    const changed = await a.receive('state', state => state.prize?.offers?.revision === 2)
    expect(changed.seats.map(seat => seat?.ready)).toEqual([false, false])
    b.send({ type: 'confirm-stake', revision: 1 })
    expect((await b.receive('error')).message).toContain('offers changed')
    b.send({ type: 'ready' })
    expect((await b.receive('error')).message).toContain('Confirm the current stake')
    b.send({ type: 'stake-offer', stakeUnits: 100_000_001 })
    expect((await b.receive('error')).message).toContain('Invalid match message')
    expect(prize.open).not.toHaveBeenCalled()

    a.send({ type: 'confirm-stake', revision: 2 })
    b.send({ type: 'confirm-stake', revision: 2 })
    const funding = await a.receive('state', state => state.prize?.stage === 'funding')
    expect(funding.prize?.stakeUnits).toBe(5_000_000)
    expect(prize.open).toHaveBeenCalledExactlyOnceWith(matchId, wallets, 5_000_000)
    b.send({ type: 'stake-offer', stakeUnits: 9_000_000 })
    expect((await b.receive('error')).message).toContain('no longer taking stake offers')
    for (const player of [a, b]) player.send({ type: 'ready' })
    await a.receive('state', state => state.phase === 'running')
    expect(prize.canStart).toHaveBeenCalledExactlyOnceWith(key, wallets, 5_000_000)
    await advance(RUN_MS)
    const { record } = await a.receive('record')
    expect(prize.complete).toHaveBeenCalledExactlyOnceWith(key, record, wallets, 5_000_000)
  })

  it('turns a staked room into a free match after both confirm a zero offer without calling escrow', async () => {
    const wallets = [
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
    ] as const
    const matchId = 'prize-counter-zero'
    const prize: PrizeCompetition = {
      admit: token => token === 'a'.repeat(43) ? wallets[0] : token === 'b'.repeat(43) ? wallets[1] : undefined,
      open: vi.fn(), canStart: vi.fn(), complete: vi.fn(),
    }
    runtime.close()
    runtime = attachCompetition(server, { now: () => now, prize })
    const a = await connect()
    const b = await connect()
    a.send({ type: 'join', matchId, prizeToken: 'a'.repeat(43) })
    await a.receive('joined')
    b.send({ type: 'join', matchId, prizeToken: 'b'.repeat(43) })
    await b.receive('joined')
    b.send({ type: 'stake-offer', stakeUnits: 5_000_000 })
    expect((await b.receive('error')).message).toContain('does not support that stake')
    b.send({ type: 'stake-offer', stakeUnits: 0 })
    await a.receive('state', state => state.prize?.offers?.revision === 1)
    a.send({ type: 'confirm-stake', revision: 1 })
    b.send({ type: 'confirm-stake', revision: 1 })
    const free = await a.receive('state', state => state.prize?.stage === 'free')
    expect(free.prize?.stakeUnits).toBe(0)
    expect(free.phase).toBe('lobby')
    a.send({ type: 'ready' })
    b.send({ type: 'ready' })
    await a.receive('state', state => state.phase === 'running')
    await advance(RUN_MS)
    await a.receive('record')
    expect(prize.open).not.toHaveBeenCalled()
    expect(prize.canStart).not.toHaveBeenCalled()
    expect(prize.complete).not.toHaveBeenCalled()
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
    const startY = point(START_TILE).y
    expect(overdue.seats[0]?.run?.player.y).toBe(startY)
    await advance(100)
    const live = await resumed.receive('state', packet => packet.tick === 110)
    expect(live.seats[0]?.run).toMatchObject({ elapsedMs: 1100, banked: 0 })
    expect(live.seats[0]?.run?.player.y).toBeCloseTo(startY + .6)
    expect(live.seats[1]?.run?.player.y).toBe(startY)

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
