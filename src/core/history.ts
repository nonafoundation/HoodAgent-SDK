import { parseAbiItem, type Address, type Hash, type PublicClient } from "viem";
import { STATIC_VAULTS, type StaticVault } from "../registry.js";

/**
 * Deposit / withdraw history for a wallet, reconstructed from ERC-20 Transfer logs between the wallet and Raeto
 * vault addresses. (Raeto vaults emit no Deposit/Withdraw events — see https://hoodagent.xyz/whitepaper.)
 *  - deposit:  asset Transfer  wallet → vault
 *  - withdraw: asset Transfer  vault  → wallet
 * Public-RPC limits shape the queries: multi-value filters are capped at 100k blocks and address-less ones at 30k, but
 * ONE token address + ONE topic value may span ~5M blocks. So: one query per (token, direction, 5M-block chunk),
 * filtering on the wallet; vault matching happens client-side. A wallet's transfers of one token are a small set.
 */
const transfer = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

export interface HistoryItem {
  type: "deposit" | "withdraw";
  vault: StaticVault;
  /** Asset base units (USDG 6 dp, stock tokens 18 dp). */
  amount: bigint;
  hash: Hash;
  blockNumber: bigint;
  /** Unix seconds; null if the block could not be fetched. */
  timestamp: number | null;
}

export interface HistoryOptions {
  /** Scan window end (inclusive). Defaults to the latest block. Pass the previous page's fromBlock - 1 to page back. */
  toBlock?: bigint;
  /** Blocks per page. Robinhood Chain ≈ 0.11 s/block → 8M ≈ 10 days (~24 eth_getLogs calls). */
  lookbackBlocks?: bigint;
  /** Blocks per eth_getLogs call (public RPC accepts ranges up to ~5M with indexed filters). */
  chunk?: bigint;
  /** Max items returned (newest first). */
  limit?: number;
  vaults?: StaticVault[];
  /** Parallel eth_getLogs calls (the public RPC returns 429 above a few concurrent requests). */
  concurrency?: number;
}

/** Run tasks with bounded concurrency; retry each on 429 / transient errors with backoff. */
async function pool<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const out = new Array<T>(tasks.length);
  let next = 0;
  const attempt = async (fn: () => Promise<T>): Promise<T> => {
    for (let i = 0; ; i++) {
      try {
        return await fn();
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        if (i >= 6 || !/429|Too Many|timeout|fetch failed|rate/i.test(msg)) throw e;
        await new Promise((r) => setTimeout(r, 400 * 2 ** i));
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++;
        out[i] = await attempt(tasks[i]!);
      }
    }),
  );
  return out;
}

export async function readHistory(client: PublicClient, wallet: Address, opts: HistoryOptions = {}): Promise<{ items: HistoryItem[]; fromBlock: bigint; toBlock: bigint }> {
  const vaults = opts.vaults ?? STATIC_VAULTS;
  const chunk = opts.chunk ?? 4_000_000n;
  const lookback = opts.lookbackBlocks ?? 8_000_000n;
  const limit = opts.limit ?? 50;

  const head = opts.toBlock ?? (await client.getBlockNumber());
  const start = head >= lookback ? head - lookback + 1n : 0n; // window is exactly `lookback` blocks
  const assets = [...new Set(vaults.map((v) => v.asset.toLowerCase() as Address))];
  const byAddr = new Map(vaults.map((v) => [v.address.toLowerCase(), v]));

  const ranges: [bigint, bigint][] = [];
  for (let to = head; to >= start; to -= chunk) {
    const from = to - chunk + 1n > start ? to - chunk + 1n : start;
    ranges.push([from, to]);
    if (from === start) break;
  }

  const logs = (
    await pool(
      ranges.flatMap(([fromBlock, toBlock]) =>
        assets.flatMap((address) => [
          () => client.getLogs({ address, event: transfer, args: { from: wallet }, fromBlock, toBlock }),
          () => client.getLogs({ address, event: transfer, args: { to: wallet }, fromBlock, toBlock }),
        ]),
      ),
      opts.concurrency ?? 2,
    )
  ).flat();

  const items: Omit<HistoryItem, "timestamp">[] = [];
  for (const l of logs) {
    const from = l.args.from!.toLowerCase();
    const to = l.args.to!.toLowerCase();
    const deposit = from === wallet.toLowerCase();
    const vault = byAddr.get(deposit ? to : from);
    // The log's token must be the vault's asset (guards against unrelated tokens sent to a vault address).
    if (!vault || vault.asset.toLowerCase() !== l.address.toLowerCase()) continue;
    items.push({ type: deposit ? "deposit" : "withdraw", vault, amount: l.args.value!, hash: l.transactionHash!, blockNumber: l.blockNumber! });
  }
  items.sort((a, b) => (a.blockNumber === b.blockNumber ? 0 : a.blockNumber > b.blockNumber ? -1 : 1));
  const top = items.slice(0, limit);

  const blocks = [...new Set(top.map((i) => i.blockNumber))];
  const times = new Map(
    await pool(
      blocks.map((n) => async () => [n, await client.getBlock({ blockNumber: n }).then((b) => Number(b.timestamp)).catch(() => null)] as const),
      opts.concurrency ?? 2,
    ),
  );
  return { items: top.map((i) => ({ ...i, timestamp: times.get(i.blockNumber) ?? null })), fromBlock: start, toBlock: head };
}
