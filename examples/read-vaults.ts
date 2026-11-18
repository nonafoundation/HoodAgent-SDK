// pnpm example:vaults  (set RPC_URL to use your own endpoint)
import { createHoodAgent } from "../src/index.js";

const hood = createHoodAgent({ rpcUrl: process.env.RPC_URL });

const vaults = await hood.getVaults();
console.table(
  vaults.map((v) => ({
    vault: v.symbol,
    kind: v.kind,
    apy: v.apy == null ? "–" : `${(v.apy * 100).toFixed(2)}%`,
    price: v.priceUsd == null ? "–" : `$${v.priceUsd.toFixed(2)}`,
    status: v.paused ? "paused" : v.inLoss ? "in loss" : "active",
  })),
);
