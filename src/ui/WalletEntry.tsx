import { useState } from 'react'
import metamask from './assets/wallets/metamask.svg'
import rabby from './assets/wallets/rabby.svg'
import coinbase from './assets/wallets/coinbase.svg'
import trust from './assets/wallets/trust.svg'

const wallets = [
  { id: 'metamask', name: 'MetaMask', logo: metamask },
  { id: 'rabby', name: 'Rabby Wallet', logo: rabby },
  { id: 'coinbase', name: 'Coinbase Wallet', logo: coinbase },
  { id: 'trust', name: 'Trust Wallet', logo: trust },
]

export default function WalletEntry({ connect, connecting, error }: {
  connect: () => void; connecting: boolean; error: string
}) {
  const [comingSoon, setComingSoon] = useState('')
  return (
    <main className="wallet-screen">
      <section className="wallet-entry" aria-labelledby="wallet-entry-title">
        <p className="wallet-kicker">Wallet Rush Arcade</p>
        <h1 id="wallet-entry-title">WALLET RUSH</h1>
        <p className="wallet-intro">Connect a wallet to enter the arcade.</p>
        <div className="wallet-options">
          {wallets.map(({ id, name, logo }) => (
            <button type="button" className={`wallet-choice wallet-${id}`} key={id}
              aria-busy={id === 'metamask' && connecting}
              onClick={() => {
                setComingSoon(id === 'metamask' ? '' : `${name} · Coming soon`)
                if (id === 'metamask') connect()
              }}>
              <span className="wallet-logo"><img src={logo} width="24" height="24" alt="" /></span>
              <span>{id === 'metamask' && connecting ? 'Connecting…' : name}</span>
              <span className="wallet-choice-arrow" aria-hidden="true">→</span>
            </button>
          ))}
        </div>
        <div className="wallet-feedback">
          {comingSoon ? <p role="status">{comingSoon}</p> : error && <p role="alert">{error}</p>}
        </div>
      </section>
    </main>
  )
}
