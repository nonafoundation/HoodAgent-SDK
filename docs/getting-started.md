# Getting started

## Install

```bash
npm install @hoodagent/sdk viem
```

`viem` is a peer dependency so the SDK shares your app's version. Node ≥ 20 and all modern browsers are supported.

## Create a client

```ts
import { createHoodAgent } from "@hoodagent/sdk";

// 1. Zero config — public Robinhood Chain RPC (rate-limited; fine for scripts and prototypes)
const hood = createHoodAgent();

// 2. Your own RPC provider (recommended in production)
const hood2 = createHoodAgent({ rpcUrl: "https://<your-provider>/<key>" });

// 3. Reuse an existing viem client (e.g. from wagmi)
import { createPublicClient, http } from "viem";
import { robinhoodChain } from "@hoodagent/sdk";
const client = createPublicClient({ chain: robinhoodChain, transport: http(), batch: { multicall: true } });
const hood3 = createHoodAgent({ client });
```

Enable `batch: { multicall: true }` on your own client: the SDK issues many small reads and Multicall3 is deployed on Robinhood Chain.

## Read data

```ts
const vaults = await hood.getVaults();            // live status, APY (fraction), price
const apy = await hood.getApy("USDG");            // 0.0382 → 3.82%
const nvda = await hood.getPrice("NVDA");         // USD per token (Morpho oracle)
const positions = await hood.getPositions(addr);  // active + legacy vaults
const { items } = await hood.getHistory(addr);    // deposits & withdrawals, newest first
```

Amounts are `bigint` base units. Use viem's `formatUnits(value, vault.decimals)` to display them; earned credits use `EARNED_DECIMALS` (6).

## Next

- [Transactions](transactions.md) — prepare, check and sign deposits and withdrawals
- [How the numbers work](data.md) — APY, prices and stock-vault accounting
- [Using with AI agents](agents.md)
