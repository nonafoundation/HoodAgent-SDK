// Prepare with HoodAgent, sign with YOUR wallet. HoodAgent itself never signs or sends.
import { createWalletClient, custom, type EIP1193Provider } from "viem";
import { createHoodAgent, robinhoodChain } from "../src/index.js";

export async function depositUsdg(provider: EIP1193Provider, account: `0x${string}`, amount: string) {
  const hood = createHoodAgent();
  const prepared = await hood.prepareDeposit({ account, asset: "USDG", amount });

  const wallet = createWalletClient({ account, chain: robinhoodChain, transport: custom(provider) });
  for (const tx of prepared.transactions) {
    console.log(`Step ${tx.step}: ${tx.description}`);
    const hash = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value, chain: robinhoodChain });
    await hood.client.waitForTransactionReceipt({ hash });
  }
}
