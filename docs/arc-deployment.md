# Arc Studio deployment record

| Item | Evidence |
| --- | --- |
| Target | Arc Testnet, chain ID 5042002 |
| Token | Official USDC ERC-20 interface at `0x3600000000000000000000000000000000000000`, six decimal places |
| Studio project | [Wallet Rush Escrow](https://studio.arc.io/app/d82bb4c4-a861-489d-8820-200c8df0324c?thread=67ee57c4-3783-42d0-8112-d7c22ef962b6). Judge access to the workspace URL has not been confirmed. |
| Reviewed Studio export | [Solidity](../contracts/WalletRushEscrow.sol), [tests](../contracts/test), [ABI](../contracts/abi/WalletRushEscrow.json), and [typed data](../contracts/abi/WalletRushEscrow.typed-data.json) |
| Contract address | [`0xCd8BD94B8f6C79E82F0e63Fa3743bf70d5cc2623`](https://explorer.testnet.arc.io/address/0xcd8bd94b8f6c79e82f0e63fa3743bf70d5cc2623) |
| Deployment receipt | [Successful transaction in block 71012145](https://explorer.testnet.arc.io/tx/0x5d267e4f926fea22b2dabd202c9292369007be27817a0b3d12c6c335b01458df) |
| Immutable referee | `0x772A9e1709DeB62179621EB81d539256a19Bd2F8` |
| Deployed runtime hash | `0x36bb04d072cbac50ce0c5e992b71c3295bf95841482d8fcba75cc9680b868a63` |
| Local contract verification | 119 Foundry tests passed on the Studio export. The local creation and runtime bytecode templates matched the exported artifact. |
| Player approvals, deposits and settlement or refund | Pending the funded demo |

The Arc Testnet RPC confirmed the successful deployment, exact creation bytecode and referee constructor argument in the transaction, the CREATE2 address, and the deployed runtime against the reviewed artifact after masking Solidity immutable slots. Onchain reads confirmed the referee, six-decimal USDC, 10 USDC stake and EIP-712 domain. The escrow balance was zero at verification.

To reproduce the local contract suite using Foundry 1.7.1 and the pinned OpenZeppelin dependency:

```sh
npm ci
forge install foundry-rs/forge-std@v1.16.2 --no-git
forge test
```

The Studio export was imported selectively. Local environment files, generated deployment scripts, logs, and compiler outputs are excluded.
