# How Wallet Rush uses Arkiv

After the server verifies a prize match, it submits the Arc result and writes an immutable Rabdi entity with the verified summary and compressed replay. The archive includes the Arc transaction hash once confirmed. The browser queries Rabdi directly for history and loads the replay by match ID, then verifies and reconstructs it with the same engine used by the server.

The trusted writer filter lets viewers distinguish the project's archive from other entities with the same fields. The 30-day expiration leaves time for judges to replay the demo. Downloads provide a portable copy before expiration.

The integration and codec are tested locally. Live publication and a public read of that published entity require a funded writer.
