import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'node:http'
import { isIP } from 'node:net'
import type { Duplex } from 'node:stream'
import { isDeepStrictEqual } from 'node:util'
import { WebSocket, WebSocketServer } from 'ws'
import { createGame, stepGame, TICK_MS, type Direction, type GameState } from '../game'
import { DIRECTIONS } from '../game/maze'
import {
  MATCH_SOCKET_PATH, type ClientMessage, type MatchRecord, type MatchResult, type PlayerView,
  type RunRecord, type Seat, type ServerMessage,
} from '../competition/protocol'
import { buildMatchRecord, decideMatch, verifyMatchRecord } from '../competition/replay'

const SEATS = [0, 1] as const
const MATCH_ID = /^[a-z0-9-]{3,32}$/i
const TOKEN = /^[a-zA-Z0-9_-]{43}$/
const GRACE_MS = 10_000
const LOBBY_MS = 300_000
const RETENTION_MS = 600_000
const JOIN_MS = 5_000
const MAX_CONNECTIONS = 128
const MAX_ROOMS = 64
const SNAPSHOT_TICKS = 5
const INPUT_RATE = 40
const MESSAGE_BURST = 20
const MAX_BUFFERED_BYTES = 512 * 1024

type StateMessage = Extract<ServerMessage, { type: 'state' }>
type Player = {
  id: string
  token: string
  socket?: WebSocket
  disconnectedAt?: number
  graceMs: number
  ready: boolean
  pending?: Direction
  run: GameState
  inputs: RunRecord['inputs']
  ticks: number
}
type Room = {
  id: string
  seed: number
  createdAt: number
  seats: [Player | null, Player | null]
  phase: StateMessage['phase']
  tick: number
  nextTickAt: number
  lastSnapshotTick: number
  finishedAt?: number
  record?: MatchRecord
}

function parseMessage(raw: string): ClientMessage | undefined {
  let value: unknown
  try { value = JSON.parse(raw) } catch { return }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const message = value as Record<string, unknown>
  const keys = Object.keys(message).length
  if (message.type === 'ready' && keys === 1) return { type: 'ready' }
  if (message.type === 'input' && keys === 2 && DIRECTIONS.includes(message.direction as Direction)) {
    return { type: 'input', direction: message.direction as Direction }
  }
  if (message.type !== 'join' || typeof message.matchId !== 'string' || !MATCH_ID.test(message.matchId)) return
  const matchId = message.matchId.toLowerCase()
  if (keys === 2) return { type: 'join', matchId }
  if (keys === 3 && typeof message.resumeToken === 'string' && TOKEN.test(message.resumeToken)) {
    return { type: 'join', matchId, resumeToken: message.resumeToken }
  }
}

function send(socket: WebSocket, message: ServerMessage) {
  if (socket.readyState !== WebSocket.OPEN) return
  if (socket.bufferedAmount > MAX_BUFFERED_BYTES) socket.terminate()
  else socket.send(JSON.stringify(message))
}

function reject(socket: WebSocket, message: string, fatal = false) {
  send(socket, { type: 'error', message, fatal })
  if (fatal) socket.close(1008)
}

function allowedOrigin(request: IncomingMessage, configuredOrigin?: string) {
  const { origin, host } = request.headers
  if (!origin) return false
  if (configuredOrigin) return origin === configuredOrigin
  try {
    const scheme = 'encrypted' in request.socket && request.socket.encrypted ? 'https' : 'http'
    const expected = new URL(`${scheme}://${host}`)
    const hostname = expected.hostname.replace(/^\[|\]$/g, '')
    // Default to local hostnames and literal IPs so a rebinding hostname cannot authorize itself.
    return origin === expected.origin && (hostname === 'localhost' || hostname.endsWith('.localhost') || isIP(hostname) !== 0)
  } catch {
    return false
  }
}

function playerView(player: Player | null, phase: Room['phase']): PlayerView | null {
  if (!player) return null
  const { elapsedMs, lives, status, carried, banked, player: actor, ghosts, dots, pellets,
    frightenedUntilMs, invulnerableUntilMs, respawnAtMs } = player.run
  return {
    playerId: player.id,
    ready: player.ready,
    connected: !!player.socket,
    run: phase === 'lobby' ? null : { elapsedMs, lives, status, carried, banked, player: actor, ghosts, dots,
      pellets, frightenedUntilMs, invulnerableUntilMs, respawnAtMs },
  }
}

function isContending(player: Player) {
  return player.run.status === 'playing' && player.run.lives > 0
}

function reconnectDeadline(room: Room) {
  let deadline = Infinity
  for (const player of room.seats) {
    if (player?.disconnectedAt !== undefined && isContending(player)) {
      deadline = Math.min(deadline, player.disconnectedAt + player.graceMs)
    }
  }
  return deadline
}

function publish(room: Room, now: number) {
  const message: StateMessage = {
    type: 'state',
    phase: room.phase,
    tick: room.tick,
    seats: [playerView(room.seats[0], room.phase), playerView(room.seats[1], room.phase)],
    reconnectBy: room.phase === 'paused' ? Date.now() + Math.max(0, reconnectDeadline(room) - now) : undefined,
    result: room.record?.result,
  }
  for (const player of room.seats) {
    if (player?.socket) send(player.socket, message)
  }
  room.lastSnapshotTick = room.tick
}

function finish(room: Room, now: number, result: MatchResult) {
  const [first, second] = room.seats
  if (!first || !second) throw new Error('A started room must have two seats')
  room.phase = 'finished'
  room.finishedAt = now
  try {
    const record = buildMatchRecord(room.id, [first.id, second.id], room.seed,
      [first.inputs, second.inputs], [first.ticks, second.ticks], result)
    const replay = verifyMatchRecord(record)
    if (!isDeepStrictEqual(replay, [first.run, second.run])) throw new Error('Match replay diverged from live state')
    room.record = record
  } catch (error) {
    console.error('Wallet Rush match verification failed', error)
    for (const player of [first, second]) {
      if (player.socket) reject(player.socket, 'Match verification failed.', true)
    }
    return
  }
  publish(room, now)
  for (const player of [first, second]) {
    if (player.socket) send(player.socket, { type: 'record', record: room.record })
  }
}

function runDueTicks(room: Room, now: number) {
  const [first, second] = room.seats
  if (!first || !second) throw new Error('A started room must have two seats')
  let changed = false
  while (room.nextTickAt <= now) {
    room.tick++
    room.nextTickAt += TICK_MS
    for (const player of [first, second]) {
      if (player.run.status !== 'playing') continue
      const { status, lives, banked } = player.run
      player.ticks++
      if (player.pending) player.inputs.push({ tick: player.ticks, direction: player.pending })
      stepGame(player.run, player.pending)
      player.pending = undefined
      changed ||= status !== player.run.status || lives !== player.run.lives || banked !== player.run.banked
    }
    // Evaluate after both runs advance so a same-tick full-clear is a draw.
    const result = decideMatch([first.run, second.run])
    if (result) {
      finish(room, now, result)
      return
    }
  }
  if (changed || room.tick - room.lastSnapshotTick >= SNAPSHOT_TICKS) publish(room, now)
}

export function attachCompetition(
  server: EventEmitter,
  { now: testClock, origin = process.env.WALLET_RUSH_ORIGIN }: { now?: () => number; origin?: string } = {},
) {
  const now = testClock ?? (() => performance.now())
  const wss = new WebSocketServer({ noServer: true, maxPayload: 512, perMessageDeflate: false })
  const rooms = new Map<string, Room>()
  const joining = new Map<WebSocket, number>()
  const awaitingPong = new Set<WebSocket>()

  function advanceRoom(room: Room, time: number) {
    if (room.phase === 'lobby') {
      if (time - room.createdAt >= LOBBY_MS) {
        for (const player of room.seats) {
          if (player?.socket) reject(player.socket, 'This lobby expired.', true)
        }
        rooms.delete(room.id)
        return
      }
      let changed = false
      for (const seat of SEATS) {
        const departed = room.seats[seat]?.disconnectedAt
        if (departed !== undefined && time - departed >= GRACE_MS) {
          room.seats[seat] = null
          changed = true
        }
      }
      if (room.seats.every(player => !player)) rooms.delete(room.id)
      else if (changed) publish(room, time)
    } else if (room.phase === 'running') {
      runDueTicks(room, time)
    } else if (room.phase === 'paused' && time >= reconnectDeadline(room)) {
      finish(room, time, { kind: 'canceled', reason: 'disconnect', refundEligible: true })
    } else if (room.finishedAt !== undefined && time - room.finishedAt >= RETENTION_MS) {
      for (const player of room.seats) {
        if (player?.socket) player.socket.close(1000, 'Match expired')
      }
      rooms.delete(room.id)
    }
  }

  function advance() {
    const time = now()
    for (const [socket, deadline] of joining) {
      if (time >= deadline) reject(socket, 'Join a match to stay connected.', true)
    }
    for (const room of rooms.values()) advanceRoom(room, time)
  }

  wss.on('connection', socket => {
    let room: Room | undefined
    let player: Player | undefined
    let budget = MESSAGE_BURST
    let lastMessageAt = now()
    joining.set(socket, lastMessageAt + JOIN_MS)
    socket.on('error', () => {
      // ws closes failed connections itself and preserves protocol close codes.
    })
    socket.on('pong', () => awaitingPong.delete(socket))
    socket.on('message', (data, binary) => {
      if (socket.readyState !== WebSocket.OPEN) return
      const time = now()
      budget = Math.min(MESSAGE_BURST, budget + (time - lastMessageAt) * INPUT_RATE / 1000)
      lastMessageAt = time
      if (budget < 1) return reject(socket, 'Too many messages.', true)
      budget--
      const message = binary ? undefined : parseMessage(data.toString())
      if (!message) return reject(socket, 'Invalid match message.')

      if (message.type === 'join') {
        if (player) return reject(socket, 'Already joined a match.')
        const existing = rooms.get(message.matchId)
        if (existing) advanceRoom(existing, time)
        let target = rooms.get(message.matchId)
        let seat: Seat
        if (message.resumeToken) {
          const resumeRoom = target
          if (!resumeRoom) return reject(socket, 'This match is no longer available.', true)
          const token = Buffer.from(message.resumeToken)
          const found = SEATS.find(index => {
            const candidate = resumeRoom.seats[index]
            return candidate && timingSafeEqual(token, Buffer.from(candidate.token))
          })
          if (found === undefined) return reject(socket, 'Cannot resume this seat.', true)
          if (resumeRoom.seats[found]?.socket) {
            reject(socket, 'Waiting for the previous connection to close.')
            socket.close(1013)
            return
          }
          target = resumeRoom
          seat = found
        } else {
          if (!target) {
            if (rooms.size >= MAX_ROOMS) return reject(socket, 'The match server is full.', true)
            target = {
              id: message.matchId, seed: randomBytes(4).readUInt32LE(), createdAt: time, seats: [null, null],
              phase: 'lobby', tick: 0, nextTickAt: 0, lastSnapshotTick: 0,
            }
            rooms.set(target.id, target)
          }
          const { seats } = target
          const open = SEATS.find(index => seats[index] === null)
          if (target.phase !== 'lobby' || open === undefined) return reject(socket, 'This match has no open seats.', true)
          seat = open
          target.seats[seat] = {
            id: randomUUID(), token: randomBytes(32).toString('base64url'), graceMs: GRACE_MS,
            ready: false, run: createGame(target.seed), ticks: 0, inputs: [],
          }
        }
        room = target
        player = room.seats[seat]!
        if (room.phase === 'paused' && player.disconnectedAt !== undefined && isContending(player)) {
          player.graceMs -= time - player.disconnectedAt
        }
        player.disconnectedAt = undefined
        player.socket = socket
        joining.delete(socket)
        send(socket, { type: 'joined', matchId: room.id, seat, resumeToken: player.token })
        if ((room.phase === 'paused' && reconnectDeadline(room) === Infinity) ||
            (room.phase === 'lobby' && room.seats.every(member => member?.socket && member.ready))) {
          room.phase = 'running'
          room.nextTickAt = time + TICK_MS
        }
        publish(room, time)
        if (room.record) send(socket, { type: 'record', record: room.record })
        return
      }

      if (!room || !player) return reject(socket, 'Join a match first.')
      advanceRoom(room, time)
      if (socket.readyState !== WebSocket.OPEN) return
      if (message.type === 'ready') {
        if (room.phase !== 'lobby' || player.ready) return
        player.ready = true
        if (room.seats.every(member => member?.socket && member.ready)) {
          room.phase = 'running'
          room.nextTickAt = time + TICK_MS
        }
        publish(room, time)
      } else if (room.phase === 'running' && isContending(player) && player.run.respawnAtMs === 0) {
        // Only the latest intent per seat is applied on the next server tick.
        player.pending = message.direction
      }
    })
    socket.on('close', () => {
      joining.delete(socket)
      awaitingPong.delete(socket)
      if (!room || !player || player.socket !== socket || rooms.get(room.id) !== room) return
      const time = now()
      advanceRoom(room, time)
      player.socket = undefined
      player.disconnectedAt = time
      if (room.phase === 'running' && isContending(player)) {
        room.phase = 'paused'
        advanceRoom(room, time)
      }
      publish(room, time)
    })
  })

  function upgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    if (request.url !== MATCH_SOCKET_PATH) return
    if (!allowedOrigin(request, origin) || wss.clients.size >= MAX_CONNECTIONS) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    wss.handleUpgrade(request, socket, head, client => wss.emit('connection', client, request))
  }

  server.on('upgrade', upgrade)
  server.once('close', close)
  const tickTimer = testClock ? undefined : setInterval(advance, TICK_MS).unref()
  const heartbeat = testClock ? undefined : setInterval(() => {
    for (const socket of wss.clients) {
      if (awaitingPong.has(socket)) socket.terminate()
      else if (socket.readyState === WebSocket.OPEN) {
        awaitingPong.add(socket)
        socket.ping()
      }
    }
  }, 2_000).unref()
  let closed = false
  function close() {
    if (closed) return
    closed = true
    clearInterval(tickTimer)
    clearInterval(heartbeat)
    server.off('upgrade', upgrade)
    server.off('close', close)
    rooms.clear()
    for (const socket of wss.clients) socket.terminate()
    wss.close()
  }

  return { advance, close }
}
