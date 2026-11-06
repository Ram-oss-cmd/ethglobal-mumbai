# Wallet Rush

Collect. Escape. Bank. Win.

An original arcade maze game for ETHGlobal Mumbai 2026. Connect MetaMask to enter the arcade. Single player is a solo, 90-second run with three lives and uses virtual maze points only.

## Run locally

Use Node.js 22.12 or later on a supported release line.

```sh
npm ci
npm run dev
```

Open `http://localhost:5173`.

```sh
npm run preview   # Serve the production build after npm run build
```

## Two-player competition

1. Open the app in two MetaMask-enabled browser sessions. In **Multiplayer**, choose **Free Match** and click **Create match**. Share the invite link or have the other player enter the same code with **Join match**.
2. Both players click **Ready**. Each client controls the left maze and sees the opponent on the right. Both runs start on the same tick with a shared seed and distinct, replayable pellet layouts.
3. After the result, use the replay controls to reconstruct either player's run or download the match record.

For two laptops on the same trusted Wi-Fi or LAN, run `npm run dev -- --host 0.0.0.0` on one laptop and leave it running. On both laptops, open the **Network** URL Vite prints, such as `http://192.168.1.23:5173`. Use `ipconfig` on the host to find its IPv4 address if needed. If Windows Firewall prompts, allow Node.js on private networks. Create the match on one laptop, share the room code or invite link, and click **Ready** on both. For two sessions on the same laptop, use `http://localhost:5173` in two browser profiles with MetaMask. [Vite LAN options](https://vite.dev/config/server-options.html#server-host), [Windows ipconfig](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/ipconfig)

The Node WebSocket server runs alongside Vite in dev and preview. For a custom host, set the server process's `WALLET_RUSH_ORIGIN` to the exact browser origin and forward WebSocket upgrades on `/ws`.

The server applies direction inputs at 10 ms ticks. It owns both scores and checks the final states against deterministic replays before publishing a result. A player who runs out of lives can spectate. A full clear ends the match immediately, with simultaneous clears on the same tick counted as a draw. Otherwise the final banked scores decide the result.

An active player's disconnect pauses both clocks for up to 10 seconds of cumulative grace per seat. Reopen the room in the same browser tab to resume. If grace expires, the match is canceled. Score ties are draws. Casual duels use virtual points only. Rooms and replay records live in server memory, and completed records expire after 10 minutes. Download the JSON to keep a copy. SHA-256 digests detect discrepancies when replaying a record. Trust in the origin of a result comes from the authoritative server.

## Play

- Click **Start practice**. Steer with the arrow keys, WASD, or the on-screen pad on touch devices. Tap before a turn to buffer it.
- Move **down** from spawn for a quick first deposit. Crossing the green line at the bottom transfers all carried points. Ghosts stay outside the vault, and the clock keeps running inside.
- Find the four blinking Ethereum diamonds scattered through the corridors. Practice restarts roll a new layout. In duels the players get different diamond locations. Catching a frightened ghost freezes movement for 350 ms while preserving the remaining power-up.
- A hit costs one life and drops your carried points. Everyone holds their position for 1.5 seconds, then the wallet respawns and the ghosts resume from their positions. The match timer keeps running. Dots are scheduled to return to random spots on your route after staggered 600–900 ms delays. An occupied spot waits until clear. Banked points stay secured for the run.

## Checks

```sh
npm test
npm run lint
npm run typecheck
npm run build
git diff --check
```

## Engine and artwork

`src/game/` owns the rules. `createGame(seed)` creates a fresh run, and `stepGame(state, direction?)` advances it by one 10 ms tick. Replays need the seed, layout variant, matching engine version, and direction changes indexed by tick. Use commit `0685a24` for previously exported `wallet-rush-2` records, `856e559` for `wallet-rush-3`, or `87ef940` for `wallet-rush-4`. The same inputs reproduce the scores, ghost states, and respawn schedule. Terminal score and time stay frozen while any scheduled dots finish returning.

Phaser reads the simulation to draw the maze and handles steering. React displays the HUD and run controls. The dog and ghost sprites are in `src/ui/assets/`. To swap artwork, update the texture imports in `src/ui/arcade.ts` and the life icon in `src/ui/CabinetHud.tsx`.

## Hackathon provenance

The starting commit `abefc40` contains a text note. The team's contributions include the game specification and tuning feedback, the Arc Studio deployment, and the funded referee wallet. Codex assisted with the TypeScript simulation, React and Phaser UI, SVG placeholder sprites, server, sponsor wiring, tests, and documentation. Arc Studio generated the escrow and Solidity tests under `contracts/`. Git preserves the original implementation history. Confirm the actual kickoff and disclose any earlier project-specific work and the development prompts in the submission. [ETHGlobal Mumbai submission rules](https://ethglobal.com/events/mumbai/info/details)

Wallet Rush project files are under the [MIT License](LICENSE). Dependencies such as React, Phaser, viem, IDKit, Arkiv SDK, and OpenZeppelin retain their own licenses and notices.

Wallet marks identify their respective providers. [MetaMask brand kit](https://metamask.com/assets) · [Rabby brand assets](https://github.com/RabbyHub/logo) · [Coinbase Wallet SDK artwork](https://github.com/coinbase/coinbase-wallet-sdk/blob/v4.3.0/packages/wallet-sdk/src/assets/wallet-logo.ts) · [Trust Wallet press kit](https://trustwallet.com/press)

## Sponsor demo

See [manual setup and architecture](docs/sponsor-setup.md) for World IDKit, Arkiv Rabdi, and the Arc Studio Testnet escrow. Choose a positive stake in **Multiplayer** to enter the funded flow when sponsor settings are configured. Use the [demo script and evidence checklist](docs/demo.md) to record the live flow. The [Arc Studio deployment record](docs/arc-deployment.md) links the verified testnet contract and receipt. The funded sponsor demo and public game URL are pending.

The actual Arkiv writer address will be recorded after the first confirmed write. For now, pass your configured public writer address to the query below. It reads the latest immutable match summaries owned and created by that address directly from Rabdi.

```sh
node --experimental-strip-types --input-type=module -e "import { createHistoryReader } from './src/history/reader.ts'; const rows = await createHistoryReader(process.argv[1], process.env.ARKIV_ACCESS_KEY).recent(); console.log(rows.entities)" YOUR_PUBLIC_WRITER_ADDRESS
```
