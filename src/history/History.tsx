import { useEffect, useState } from 'react'
import type { MatchRecord, Seat } from '../competition/protocol'
import { Replay } from '../ui/Competition'
import { createHistoryReader, type HistoryRow } from './reader'

type HistoryResult = { rows: readonly HistoryRow[]; record?: MatchRecord }

function outcome(row: HistoryRow) {
  switch (row.result.value) {
    case 'win-a': return 'Player A won'
    case 'win-b': return 'Player B won'
    case 'draw': return 'Draw'
    case 'canceled': return 'Canceled'
    default: return 'Outcome unavailable'
  }
}

export default function History({ matchId }: { matchId?: string }) {
  const writer = import.meta.env.VITE_ARKIV_WRITER_ADDRESS?.trim()
  const [data, setData] = useState<HistoryResult>()
  const [error, setError] = useState('')
  const [seat, setSeat] = useState<Seat>()

  useEffect(() => {
    if (!writer) return
    const lifetime = new AbortController()
    async function load() {
      const reader = createHistoryReader(writer!, import.meta.env.VITE_ARKIV_ACCESS_KEY)
      if (!matchId) return { rows: (await reader.recent()).entities }
      const result = await reader.match(matchId)
      return result ? { rows: [result.row], record: result.record } : { rows: [] }
    }
    load().then(result => {
      if (!lifetime.signal.aborted) setData(result)
    }, err => {
      if (!lifetime.signal.aborted) setError(err instanceof Error ? err.message : 'Unable to query Arkiv')
    })
    return () => lifetime.abort()
  }, [writer, matchId])

  if (!writer) return <p>Match history requires a configured Arkiv writer address.</p>
  if (error) return <p role="alert">Arkiv history unavailable. {error}</p>
  if (!data) return <p role="status">Reading match history from Arkiv Rabdi…</p>

  if (data.record && seat !== undefined) {
    return <Replay key={seat} record={data.record} seat={seat} leave={() => setSeat(undefined)} />
  }

  return (
    <section className="lobby" aria-labelledby="history-title">
      <h2 id="history-title">{matchId ? 'Public replay' : 'Match history'}</h2>
      <p>Prize matches recorded on Arkiv Rabdi</p>
      {data.rows.length === 0 && <p>{matchId ? 'Match not found or its archive expired.' : 'No archived matches yet.'}</p>}
      {data.rows.map(row => (
        <article key={row.$key}>
          <h3><a href={`/replay/${encodeURIComponent(row.matchId.value)}`}>{row.matchId.value}</a></h3>
          <p>{outcome(row)} · {row.bankedA.value}–{row.bankedB.value} banked</p>
          <p title={row.playerA.value}>Player A · {row.playerA.value.slice(0, 8)}…{row.playerA.value.slice(-4)}</p>
          <p title={row.playerB.value}>Player B · {row.playerB.value.slice(0, 8)}…{row.playerB.value.slice(-4)}</p>
          {row.settlementTx && /^0x[0-9a-f]{64}$/i.test(row.settlementTx.value) && (
            <p><a href={`https://testnet.arcscan.app/tx/${row.settlementTx.value}`}>Arc settlement transaction</a></p>
          )}
          {data.record && (
            <div className="match-actions">
              <button type="button" onClick={() => setSeat(0)}>Replay player A</button>
              <button type="button" onClick={() => setSeat(1)}>Replay player B</button>
            </div>
          )}
        </article>
      ))}
      {matchId && <p><a href="/history">Back to match history</a></p>}
    </section>
  )
}
