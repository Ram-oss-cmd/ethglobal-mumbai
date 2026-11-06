# Wallet Rush Arkiv schema

The Rabdi entity schema is `wallet-rush.matches.v1`. Each entity is created by the configured testnet writer and is immutable after creation. Its lifetime is one year.

| Field | Type | Purpose |
| --- | --- | --- |
| matchId | indexed string | Public replay lookup |
| playerA, playerB | indexed address | Prize-wallet references |
| result | indexed string | Win A, win B, draw, or canceled |
| engineVersion | string | Shared engine compatibility |
| seed, publishedAt | u64 | Initial match seed and history ordering |
| bankedA, bankedB | i32 | Verified final banked scores |
| settlementTx | optional string | Confirmed Arc settlement transaction when available |
| replay | bytes | Gzip JSON of both runs, including layout variant, inputs, banking, deaths, and digests |

The application filters by both creator and owner, then selects metadata for history. A replay fetch retrieves the selected entity's compressed record and checks that its reconstructed runs agree with the indexed summary. Wallet ownership challenges and World nullifiers stay private.
