# World IDKit integration debrief

Prize eligibility is the trust moment. Each human may register one wallet for a tournament. Proof of Human supplies a uniqueness credential without requesting a passport or personal attributes. The wallet signs a separate one-time ownership challenge. The backend binds the World proof to that wallet, the tournament action and the RP nonce, checks it through the World verify API, and records the scoped nullifier digest and wallet. Casual duels and practice remain open.

## Verification evidence

Automated tests exercise the successful backend branch with a controlled World API response, cancellation, malformed and mismatched proofs, and duplicate registration after a server restart. A live staging proof requires a Developer Portal app and the official simulator. First live success and its elapsed time are pending that setup.

## Friction and improvement

The integration guide shows the legacy Orb example alongside the v4 uniqueness shape. The credential guide and API reference were both needed to confirm the v4 Proof of Human issuer, nonce, signal, and per-credential verifier response. A complete v4-only example with a simulator transcript and explicit server-side signal and nullifier checks would save the most time.

[Mumbai World bounty](https://ethglobal.com/events/mumbai/prizes/world) · [IDKit setup](https://docs.world.org/world-id/idkit/integrate) · [Verify API](https://docs.world.org/api-reference/developer-portal/verify)
