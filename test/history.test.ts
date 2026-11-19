import { describe, expect, it } from "vitest";
import type { PublicClient } from "viem";
import { readHistory } from "../src/core/history.js";
import type { StaticVault } from "../src/registry.js";

const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER = "0x9999999999999999999999999999999999999999";
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const NVDA = "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec";
const V_USDG = "0xd39f20d9dd7708b7d77f1c0addc3579c167a2b09";
const V_USDG_OLD = "0x6f9c9bd7f89d230ec2ee34037e09b27848e4bd6b";
const V_NVDA = "0xc1df676eb8c2715f4f9f337d53a10b10582baa51";

const vaults: StaticVault[] = [
  { address: V_USDG, symbol: "USDG", kind: "token", decimals: 6, asset: USDG, targetLtv: null },
  { address: V_USDG_OLD, symbol: "USDG", kind: "token", decimals: 6, asset: USDG, targetLtv: null, legacy: true },
  { address: V_NVDA, symbol: "NVDA", kind: "stock", decimals: 18, asset: NVDA, targetLtv: 0.3 },
];

type Log = { address: string; from: string; to: string; value: bigint; block: bigint; hash: string };
const LOGS: Log[] = [
  { address: USDG, from: WALLET, to: V_USDG, value: 1_000_000n, block: 950n, hash: "0xa1" }, // deposit
  { address: USDG, from: V_USDG_OLD, to: WALLET, value: 9_000_000_000n, block: 500n, hash: "0xa2" }, // legacy withdraw
  { address: NVDA, from: WALLET, to: V_NVDA, value: 10n ** 18n, block: 800n, hash: "0xa3" }, // stock deposit
  { address: USDG, from: WALLET, to: OTHER, value: 5n, block: 900n, hash: "0xa4" }, // unrelated transfer → ignored
  { address: NVDA, from: WALLET, to: V_USDG, value: 7n, block: 700n, hash: "0xa5" }, // wrong token for that vault → ignored
];

function mockClient() {
  const calls: { address: string; fromBlock: bigint; toBlock: bigint; args: Record<string, string> }[] = [];
  const client = {
    getBlockNumber: async () => 1_000n,
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: 1_700_000_000n + blockNumber }),
    getLogs: async ({ address, args, fromBlock, toBlock }: { address: string; args: { from?: string; to?: string }; fromBlock: bigint; toBlock: bigint }) => {
      calls.push({ address, fromBlock, toBlock, args: args as Record<string, string> });
      // Each call must be single-valued (public RPC limit): one address, one topic value.
      expect(typeof address).toBe("string");
      expect(Object.keys(args)).toHaveLength(1);
      return LOGS.filter(
        (l) =>
          l.address === address &&
          l.block >= fromBlock &&
          l.block <= toBlock &&
          (args.from ? l.from === args.from : l.to === args.to),
      ).map((l) => ({ address: l.address, args: { from: l.from, to: l.to, value: l.value }, transactionHash: l.hash, blockNumber: l.block }));
    },
  };
  return { client: client as unknown as PublicClient, calls };
}

describe("readHistory", () => {
  it("classifies deposits/withdrawals, ignores unrelated transfers, newest first, with timestamps", async () => {
    const { client } = mockClient();
    const h = await readHistory(client, WALLET, { vaults, lookbackBlocks: 1_000n, chunk: 400n });
    expect(h.items.map((i) => [i.hash, i.type, i.vault.address, i.vault.legacy ?? false])).toEqual([
      ["0xa1", "deposit", V_USDG, false],
      ["0xa3", "deposit", V_NVDA, false],
      ["0xa2", "withdraw", V_USDG_OLD, true],
    ]);
    expect(h.items[0]!.timestamp).toBe(1_700_000_950);
    expect(h.items[1]!.amount).toBe(10n ** 18n);
  });

  it("splits the window into chunks and one query per (token, direction)", async () => {
    const { client, calls } = mockClient();
    await readHistory(client, WALLET, { vaults, lookbackBlocks: 1_000n, chunk: 400n });
    // window 1..1000 → chunks [601,1000] [201,600] [1,200]; 2 tokens × 2 directions × 3 chunks
    expect(calls).toHaveLength(12);
    const windows = [...new Set(calls.map((c) => `${c.fromBlock}-${c.toBlock}`))];
    expect(windows).toEqual(["601-1000", "201-600", "1-200"]);
  });

  it("pages backwards via toBlock", async () => {
    const { client } = mockClient();
    const p1 = await readHistory(client, WALLET, { vaults, lookbackBlocks: 300n });
    expect(p1.fromBlock).toBe(701n);
    expect(p1.items.map((i) => i.hash)).toEqual(["0xa1", "0xa3"]);
    const p2 = await readHistory(client, WALLET, { vaults, lookbackBlocks: 300n, toBlock: p1.fromBlock - 1n });
    expect(p2.toBlock).toBe(700n);
    expect(p2.items.map((i) => i.hash)).toEqual(["0xa2"]);
  });
});
