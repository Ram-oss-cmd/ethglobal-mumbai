# Arc Studio deployment record

## Version 1 on Arc Testnet

| Item | Evidence |
| --- | --- |
| Target | Arc Testnet, chain ID 5042002 |
| Token | Official USDC ERC-20 interface at `0x3600000000000000000000000000000000000000`, six decimal places |
| Studio project | [Wallet Rush Escrow](https://studio.arc.io/app/d82bb4c4-a861-489d-8820-200c8df0324c?thread=67ee57c4-3783-42d0-8112-d7c22ef962b6). A signed-out request redirected to Circle login. Confirm access from a signed-in account outside the project before submission. |
| Reviewed Studio export | [Version 1 source, tests and ABI](https://github.com/Ram-oss-cmd/ethglobal-mumbai/tree/96af3d7/contracts) |
| Contract address | [`0xCd8BD94B8f6C79E82F0e63Fa3743bf70d5cc2623`](https://explorer.testnet.arc.io/address/0xcd8bd94b8f6c79e82f0e63fa3743bf70d5cc2623) |
| Deployment receipt | [Successful transaction in block 71012145](https://explorer.testnet.arc.io/tx/0x5d267e4f926fea22b2dabd202c9292369007be27817a0b3d12c6c335b01458df) |
| Immutable referee | `0x772A9e1709DeB62179621EB81d539256a19Bd2F8` |
| Deployed runtime hash | `0x36bb04d072cbac50ce0c5e992b71c3295bf95841482d8fcba75cc9680b868a63` |
| Local contract verification | 119 Foundry tests passed on the Studio export. The local creation and runtime bytecode templates matched the exported artifact. |
| Player approvals, deposits and settlement or refund | Pending the funded demo |

The Arc Testnet RPC confirmed the successful deployment, exact creation bytecode and referee constructor argument in the transaction, the CREATE2 address, and the deployed runtime against the reviewed artifact after masking Solidity immutable slots. Onchain reads confirmed the referee, six-decimal USDC, 10 USDC stake and EIP-712 domain. The escrow balance was zero at verification.

To reproduce the version 1 suite, use commit `96af3d7` in a separate checkout and run the commands below. The same commands on the current branch exercise the version 2 source.

```sh
npm ci
forge install foundry-rs/forge-std@v1.16.2 --no-git
forge test
```

The historical version 1 source remains byte-for-byte identical to the reviewed Studio export. The ABI and typed-data export files under `contracts/abi/` document that deployment.

## Version 2 matched stakes

The [version 2 source](../contracts/WalletRushEscrow.sol) uses a fixed stake **per match**, stored when the referee opens the room. Each player deposits that exact amount. The winner receives both deposits. A draw, cancellation, or eligible timeout returns the applicable deposits. Stakes use six USDC decimals and range from 1 to 100 test USDC per player. The EIP-712 domain version is `2`. The Result fields are unchanged and the signature remains bound to the contract, chain, and match ID.

121 local Foundry tests passed, including conservation across independently priced matches. A version 2 Studio deployment is pending.

1. In Arc Studio, open the Wallet Rush workspace in **Smart Contract** mode. Add the [version 2 source](../contracts/WalletRushEscrow.sol) and its [tests](../contracts/test) to the workspace. Ask Studio to compile that exact source and run the tests with Solidity 0.8.28 and OpenZeppelin 5.6.1. Keep the existing deployment record.
2. In **Smart Contract** mode, deploy the reviewed version 2 build on **Arc Testnet** with the same public referee address. Save the new contract address, successful transaction link, and Studio project link. Check that the **Contracts** panel shows domain version `2`, a 1 USDC minimum and a 100 USDC maximum.
3. In **Build** mode, connect the Studio demo to the new escrow. Update the demo opening call to supply the sixth `openMatch` argument in six-decimal USDC units. Use the same `Result` fields and EIP-712 domain version `2` for test signatures.
4. In the game's local `.env`, set `ARC_ESCROW_ADDRESS` to the new address, set `ARC_ESCROW_VERSION=2`, and restart `npm run dev`. A room starts with a 10 test USDC offer. The creator can update it before sharing the invite. The guest gets that amount prefilled and may edit it. Both must confirm the smaller offer before the app opens escrow.

Version 1 remains the default. To recover deposits or claims on the previous deployment after switching, temporarily run the app against its recorded address with `ARC_ESCROW_VERSION=1`.
