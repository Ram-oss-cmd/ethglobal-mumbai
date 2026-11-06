import { RUN_MS, type Direction } from '../game'
import type { Hud } from './arcade'
import wallet from './assets/wallet.svg'
import walletOutline from './assets/wallet-outline.svg'

export const initialHud: Hud = {
  status: 'ready', carried: 0, banked: 0, lives: 3, seconds: RUN_MS / 1000, powerSeconds: 0,
}

export const endings: Record<Hud['status'], string> = {
  ready: '', playing: '', timeout: 'Time up', 'out-of-lives': 'Game over', 'full-clear': 'Vault cleared',
}

const arrows: Record<Direction, string> = { up: '↑', left: '←', down: '↓', right: '→' }

export function Scoreboard({ carried, banked, seconds }: Hud) {
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  return (
    <dl className="scoreboard">
      <div><dt>Carried</dt><dd className="score-carried">{carried}</dd></div>
      <div><dt>Banked</dt><dd>{banked}</dd></div>
      <div><dt>Time</dt><dd className={seconds <= 10 ? 'score-urgent' : undefined}>{clock}</dd></div>
    </dl>
  )
}

export function ArenaFooter({ lives, powerSeconds, onRestart }: Hud & { onRestart?: () => void }) {
  return (
    <div className="arena-footer">
      <div className="life-meter" role="img" aria-label={`${lives} lives remaining`}>
        {[1, 2, 3].map(life => <img key={life} src={life <= lives ? wallet : walletOutline} alt="" />)}
      </div>
      <span className="power" role="status">{powerSeconds > 0 && `◆ ${powerSeconds}s`}</span>
      {onRestart && <button className="restart" type="button" aria-label="Restart run" title="Restart run" onClick={onRestart}>↻</button>}
    </div>
  )
}

export function TouchControls({ disabled, steer }: { disabled: boolean; steer: (direction: Direction) => void }) {
  return (
    <div className="dpad" role="group" aria-label="Touch movement controls">
      {(Object.keys(arrows) as Direction[]).map(direction => (
        <button
          key={direction}
          type="button"
          className={`dpad-${direction}`}
          aria-label={`Move ${direction}`}
          disabled={disabled}
          onClick={() => steer(direction)}
        >{arrows[direction]}</button>
      ))}
    </div>
  )
}
