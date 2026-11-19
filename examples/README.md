# Examples

| File | What it shows | Run |
|---|---|---|
| [`read-vaults.ts`](read-vaults.ts) | Live vault table: APY, price, status | `pnpm example:vaults` |
| [`positions.ts`](positions.ts) | A wallet's positions and earned credits | `npx tsx examples/positions.ts 0xWallet` |
| [`deposit-with-viem.ts`](deposit-with-viem.ts) | Prepare a deposit and sign it with a viem wallet client | import into your app |

Set `RPC_URL` to use your own endpoint; the public RPC is rate-limited.
