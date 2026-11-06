import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { attachCompetition } from './src/server/competition.ts'
import { createPrize } from './src/server/prize.ts'

function competition(): Plugin {
  let matchServer: ReturnType<typeof attachCompetition> | undefined
  return {
    name: 'wallet-rush-competition',
    configureServer(server) {
      const prize = createPrize()
      server.middlewares.use(prize.handle)
      if (server.httpServer) matchServer = attachCompetition(server.httpServer, { prize: prize.competition })
    },
    configurePreviewServer(server) {
      const prize = createPrize()
      server.middlewares.use(prize.handle)
      matchServer = attachCompetition(server.httpServer, { prize: prize.competition })
    },
    closeBundle() {
      matchServer?.close()
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['WALLET_RUSH_', 'WORLD_', 'ARC_', 'ARKIV_', 'VITE_ARKIV_', 'PRIZE_'])
  for (const [name, value] of Object.entries(env)) process.env[name] ??= value
  const configuredOrigin = process.env.WALLET_RUSH_ORIGIN
  const allowedHosts = configuredOrigin ? [new URL(configuredOrigin).hostname] : []
  return { plugins: [react(), competition()], server: { allowedHosts }, preview: { allowedHosts } }
})
