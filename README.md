# Wallet Rush

Collect. Escape. Bank. Win.

An original arcade maze game for ETHGlobal Mumbai 2026. Practice is a solo, 90-second run with three lives. It runs locally with no accounts or credentials.

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

1. Open the app in two browser sessions. Select **Two players** in each and join the same room ID, or share the invite link.
2. Both players click **Ready**. Each client controls its own maze and sees both runs. The server starts them on the same tick with the same seed.
3. After the result, use the replay controls to reconstruct either player's run or download the match record.

For two laptops on the same trusted Wi-Fi or LAN, run `npm run dev -- --host 0.0.0.0` on one laptop and leave it running. On both laptops, open the **Network** URL Vite prints, such as `http://192.168.1.23:5173`. Use `ipconfig` on the host to find its IPv4 address if needed. If Windows Firewall prompts, allow Node.js on private networks. Create the match on one laptop, share the room code or invite link, and click **Ready** on both. For two sessions on the same laptop, use `http://localhost:5173` in a regular window and a private window. [Vite LAN options](https://vite.dev/config/server-options.html#server-host), [Windows ipconfig](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/ipconfig)

The Node WebSocket server runs alongside Vite in dev and preview. For a custom host, set the server process's `WALLET_RUSH_ORIGIN` to the exact browser origin and forward WebSocket upgrades on `/ws`.

The server applies direction inputs at 10 ms ticks. It owns both scores and checks the final states against deterministic replays before publishing a result. A player who runs out of lives can spectate. A full clear ends the match immediately, with simultaneous clears on the same tick counted as a draw. Otherwise the final banked scores decide the result.

An active player's disconnect pauses both clocks for up to 10 seconds of cumulative grace per seat. Reopen the room in the same browser tab to resume. If grace expires, the match is canceled and marked refund-eligible. Score ties are draws. This chunk records outcomes and moves no funds. Rooms and replay records live in server memory, and completed records expire after 10 minutes. Download the JSON to keep a copy. SHA-256 digests detect discrepancies when replaying a record. Trust in the origin of a result comes from the authoritative server.

## Play

- Click **Start practice**. Steer with the arrow keys, WASD, or the on-screen pad on touch devices. Tap before a turn to buffer it.
- Move **down** from spawn for a quick first deposit. Crossing the green line at the bottom transfers all carried points. Ghosts stay outside the vault, and the clock keeps running inside.
- Find the four blinking Ethereum diamonds scattered through the corridors. Practice restarts roll a new layout, and both players in a match share one layout. Catching a frightened ghost freezes movement for 350 ms while preserving the remaining power-up.
- A hit costs one life and drops your carried points. Everyone holds their position for 1.5 seconds, then the wallet respawns and the ghosts resume from their positions. The match timer keeps running. Dots return to random spots on your route after staggered 0.9–1.2 second delays. An occupied spot waits until clear. Banked points stay secured for the run.

## Checks

```sh
npm test
npm run lint
npm run build
```

## Engine and artwork

`src/game/` owns the rules. `createGame(seed)` creates a fresh run, and `stepGame(state, direction?)` advances it by one 10 ms tick. Replays need the seed, matching engine version, and direction changes indexed by tick. Use commit `0685a24` to verify previously exported `wallet-rush-2` records. The same inputs reproduce the scores, ghost states, and respawn schedule. Terminal score and time stay frozen while any scheduled dots finish returning.

Phaser reads the simulation to draw the maze and handles steering. React displays the HUD and run controls. The original placeholder sprites are SVGs in `src/ui/assets/`. Replace the asset files or change the texture imports in `src/ui/arcade.ts`, preserving each ghost's texture key.

## Hackathon provenance

The starting commit contained a text note. Codex implemented this practice chunk from the team's gameplay specification, including the simulation, UI, placeholder art, and tests. Phaser, React, Vite, and the development tools are open-source dependencies. [ETHGlobal Mumbai submission rules](https://ethglobal.com/events/mumbai/info/details)
