# Wallet Rush demo

## Rehearse before recording

Complete the [sponsor setup](sponsor-setup.md) and open two browser profiles with different funded Arc Testnet player accounts. Keep the referee account separate. Set `WORLD_ENVIRONMENT=staging` for the official World simulator and label it on screen. Use a fresh browser profile without a wallet for public replay.

1. Cancel one World prompt, then verify successfully. For the duplicate check, attempt verification using the same World identity and a different wallet in the same tournament. Confirm that wallet cannot enter.
2. For a predictable winner, have player A press down to bank three points and stay in the vault. Player B can collect or lose lives while leaving their banked score at zero. Use clips from practice or another round to show a lost dot returning and a frightened ghost being eaten.
3. Test a draw separately. Both players can bank three and wait out the clock. Check that each gets 10 test USDC back.
4. Test cancellation separately. Start a fully funded match, close one active player's tab, and wait past the reconnect grace. Check that both deposits are returned and no winner is recorded. For the independent timeout path, leave one match partially funded and use the recovery form after its deposit deadline.

Each wallet may enter once per tournament. Use a fresh staging `WORLD_ACTION` per rehearsal and restart the server between runs, or use a new pair of staging identities and wallets. Keep the action fixed for both players within a run. Allow enough test USDC for each stake plus gas. [World action scoping](https://docs.world.org/world-id/idkit/integrate)

## Video script, about 2 minutes 40 seconds

| Time | Show and say |
| --- | --- |
| 0:00–0:15 | Open Wallet Rush. Explain that coins count only once banked and that arcade points are separate from test USDC. |
| 0:15–0:40 | Show two connected player wallets and World ID eligibility. Show the canceled or duplicate attempt and the successful staging flow. |
| 0:40–1:00 | Show the escrow connected inside Arc Studio and both 10 test USDC deposit receipts in Wallet Rush. |
| 1:00–1:45 | Show the two mazes, banking across the green line, a death and staggered route dots, and eating a frightened ghost. Trim waiting time. |
| 1:45–2:15 | Show the verified banked score and open the actual settlement receipt. Point to the 20 test USDC winner transfer. Show the draw or cancellation receipt if captured. |
| 2:15–2:40 | Open the public replay link in a fresh browser, locate the same record in Arkiv match history, and scrub both runs. Explain that the server verifies the replay and the escrow trusts its bounded signature. |

## Evidence for submission

- **Already verified** · Arc Studio escrow deployment on Arc Testnet. [Address and creation receipt](arc-deployment.md)
- **Record after live testing** · World success and failure, two player deposits, a winner transfer, a draw refund, a cancellation refund, and the Arkiv archive transaction, public writer address, and replay URL.
- **Verify judge access** · Open the Arc Studio project link in a private window, check the GitHub default branch contains the submitted version, and supply the public game URL if hosted. Record the demo and submit it with the source and AI disclosure in the Hacker Dashboard. [ETHGlobal Mumbai submission rules](https://ethglobal.com/events/mumbai/info/details)
