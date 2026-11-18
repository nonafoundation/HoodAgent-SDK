// tsx examples/positions.ts 0xYourWallet
import { formatUnits } from "viem";
import { createHoodAgent, EARNED_DECIMALS } from "../src/index.js";

const wallet = process.argv[2];
if (!wallet) throw new Error("usage: tsx examples/positions.ts <wallet>");

const hood = createHoodAgent({ rpcUrl: process.env.RPC_URL });
for (const p of await hood.getPositions(wallet)) {
  const unit = p.vault.kind === "stock" ? "shares" : p.vault.symbol;
  console.log(
    `${p.vault.symbol}${p.vault.legacy ? " (legacy)" : ""}: ${formatUnits(p.amount, p.vault.decimals)} ${unit}, ` +
      `earned $${formatUnits(p.earned, EARNED_DECIMALS)}`,
  );
}
