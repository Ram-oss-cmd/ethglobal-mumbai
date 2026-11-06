import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { attachCompetition } from './src/server/competition'

const configuredOrigin = process.env.WALLET_RUSH_ORIGIN
const allowedHosts = configuredOrigin ? [new URL(configuredOrigin).hostname] : []

function competition(): Plugin {
  let matchServer: ReturnType<typeof attachCompetition> | undefined
  return {
    name: 'wallet-rush-competition',
    configureServer(server) {
      if (server.httpServer) matchServer = attachCompetition(server.httpServer)
    },
    configurePreviewServer(server) {
      matchServer = attachCompetition(server.httpServer)
    },
    closeBundle() {
      matchServer?.close()
    },
  }
}

export default defineConfig({
  plugins: [react(), competition()],
  server: { allowedHosts },
  preview: { allowedHosts },
})
