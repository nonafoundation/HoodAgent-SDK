import { parseAbi, type Address, type Hex, type PublicClient } from "viem";

/**
 * On-chain APY for the Morpho positions Raeto uses (Morpho API does not index Robinhood Chain,
 * and the public RPC has no archive state — so we compute instantaneous rates from the IRMs).
 * See https://hoodagent.xyz/whitepaper (D6).
 */

const SECONDS_PER_YEAR = 365 * 86_400;
const WAD = 1e18;
const toApy = (ratePerSecond: number) => Math.expm1(ratePerSecond * SECONDS_PER_YEAR);

export const vaultV2Abi = parseAbi([
  "function totalAssets() view returns (uint256)",
  "function adaptersLength() view returns (uint256)",
  "function adapters(uint256) view returns (address)",
  "function performanceFee() view returns (uint96)",
  "function managementFee() view returns (uint96)",
]);
export const adapterAbi = parseAbi([
  "function morpho() view returns (address)",
  "function marketIdsLength() view returns (uint256)",
  "function marketIds(uint256) view returns (bytes32)",
]);
export const morphoAbi = parseAbi([
  "function idToMarketParams(bytes32) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)",
  "function market(bytes32) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
  "function position(bytes32, address) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
]);
export const irmAbi = parseAbi([
  "struct MarketParams { address loanToken; address collateralToken; address oracle; address irm; uint256 lltv; }",
  "struct Market { uint128 totalSupplyAssets; uint128 totalSupplyShares; uint128 totalBorrowAssets; uint128 totalBorrowShares; uint128 lastUpdate; uint128 fee; }",
  "function borrowRateView(MarketParams marketParams, Market market) view returns (uint256)",
]);
export const stockVaultAbi = parseAbi([
  "function morpho() view returns (address)",
  "function sink() view returns (address)",
  "function marketId() view returns (bytes32)",
]);

export interface MarketRates {
  marketId: Hex;
  collateralToken: Address;
  borrowApy: number;
  supplyApy: number;
  utilization: number;
}

/**
 * Environment-agnostic (Node + browser) Morpho reader. Pass any viem PublicClient.
 * Each instance has its own cache.
 */
export function createMorphoReader(client: PublicClient, opts: { rateTtlMs?: number } = {}) {
  const RATE_TTL_MS = Math.max(opts.rateTtlMs ?? 60_000, 60_000);
  const STRUCTURE_TTL_MS = 60 * 60_000; // adapters / market ids / market params rarely change

  /** Rates older than this are never served, even stale. */
  const MAX_STALE_MS = 10 * 60_000;

  /**
   * Promise cache:
   *  - concurrent callers share one in-flight computation
   *  - stale-while-revalidate: after `ttl`, the last good value is returned immediately and refreshed in the background
   *    (up to MAX_STALE_MS), so steady-state tool calls never wait on the slow public RPC (~1s per round trip)
   *  - failures are never cached
   */
  type Entry = { at: number; value: Promise<unknown>; settled?: unknown; refreshing?: boolean };
  const cache = new Map<string, Entry>();
  function cached<T>(key: string, fn: () => Promise<T>, ttl = RATE_TTL_MS): Promise<T> {
    const hit = cache.get(key);
    const age = hit ? Date.now() - hit.at : Infinity;
    if (hit && age < ttl) return hit.value as Promise<T>;

    if (hit && hit.settled !== undefined && age < Math.max(ttl, MAX_STALE_MS)) {
      if (!hit.refreshing) {
        hit.refreshing = true;
        fn()
          .then((v) => cache.set(key, { at: Date.now(), value: Promise.resolve(v), settled: v }))
          .catch(() => { hit.refreshing = false; });
      }
      return Promise.resolve(hit.settled as T);
    }

    const entry: Entry = { at: Date.now(), value: fn() };
    entry.value.then((v) => { entry.settled = v; }, () => { if (cache.get(key) === entry) cache.delete(key); });
    cache.set(key, entry);
    return entry.value as Promise<T>;
  }

  function marketParams(morpho: Address, id: Hex) {
    return cached(
      `params:${morpho}:${id}`,
      () => client.readContract({ address: morpho, abi: morphoAbi, functionName: "idToMarketParams", args: [id] }),
      STRUCTURE_TTL_MS,
    );
  }

  async function readMarket(morpho: Address, id: Hex) {
    const [params, m] = await Promise.all([
      marketParams(morpho, id),
      client.readContract({ address: morpho, abi: morphoAbi, functionName: "market", args: [id] }),
    ]);
    const [loanToken, collateralToken, oracle, irm, lltv] = params;
    const [totalSupplyAssets, totalSupplyShares, totalBorrowAssets, totalBorrowShares, lastUpdate, fee] = m;

    let borrowRate = 0;
    if (totalBorrowAssets > 0n && irm !== "0x0000000000000000000000000000000000000000") {
      const r = await client.readContract({
        address: irm, abi: irmAbi, functionName: "borrowRateView",
        args: [
          { loanToken, collateralToken, oracle, irm, lltv },
          { totalSupplyAssets, totalSupplyShares, totalBorrowAssets, totalBorrowShares, lastUpdate, fee },
        ],
      });
      borrowRate = Number(r) / WAD;
    }
    const utilization = totalSupplyAssets > 0n ? Number(totalBorrowAssets) / Number(totalSupplyAssets) : 0;
    const rates: MarketRates = {
      marketId: id,
      collateralToken,
      borrowApy: toApy(borrowRate),
      supplyApy: toApy(borrowRate * utilization * (1 - Number(fee) / WAD)),
      utilization,
    };
    return { rates, totalSupplyAssets, totalSupplyShares };
  }

  /** Adapter → (morpho, marketIds) layout of a Vault V2. Cached for an hour. */
  function vaultStructure(vault: Address) {
    return cached(
      `struct:${vault}`,
      async () => {
        const n = await client.readContract({ address: vault, abi: vaultV2Abi, functionName: "adaptersLength" });
        const adapters = await Promise.all(
          Array.from({ length: Number(n) }, (_, i) =>
            client.readContract({ address: vault, abi: vaultV2Abi, functionName: "adapters", args: [BigInt(i)] }),
          ),
        );
        return Promise.all(
          adapters.map(async (adapter) => {
            const [morpho, len] = await Promise.all([
              client.readContract({ address: adapter, abi: adapterAbi, functionName: "morpho" }),
              client.readContract({ address: adapter, abi: adapterAbi, functionName: "marketIdsLength" }),
            ]);
            const ids = await Promise.all(
              Array.from({ length: Number(len) }, (_, i) =>
                client.readContract({ address: adapter, abi: adapterAbi, functionName: "marketIds", args: [BigInt(i)] }),
              ),
            );
            await Promise.all(ids.map((id) => marketParams(morpho, id))); // warm params cache
            return { adapter, morpho, ids };
          }),
        );
      },
      STRUCTURE_TTL_MS,
    );
  }

  /** Net APY of a Morpho Vault V2 (e.g. Steakhouse USDG): asset-weighted supply APY of its markets, idle cash earns 0. */
  function getVaultV2Apy(vault: Address) {
    return cached(`v2:${vault}`, async () => {
      const [totalAssets, perfFee, mgmtFee, structure] = await Promise.all([
        client.readContract({ address: vault, abi: vaultV2Abi, functionName: "totalAssets" }),
        client.readContract({ address: vault, abi: vaultV2Abi, functionName: "performanceFee" }),
        client.readContract({ address: vault, abi: vaultV2Abi, functionName: "managementFee" }),
        vaultStructure(vault),
      ]);

      let weighted = 0;
      const markets: Array<MarketRates & { allocation: number }> = [];
      const rows = await Promise.all(
        structure.flatMap(({ adapter, morpho, ids }) =>
          ids.map(async (id) => {
            const [mk, pos] = await Promise.all([
              readMarket(morpho, id),
              client.readContract({ address: morpho, abi: morphoAbi, functionName: "position", args: [id, adapter] }),
            ]);
            const assets = mk.totalSupplyShares > 0n ? (pos[0] * mk.totalSupplyAssets) / mk.totalSupplyShares : 0n;
            return { ...mk.rates, assets };
          }),
        ),
      );
      for (const r of rows) {
        weighted += Number(r.assets) * r.supplyApy;
        const { assets, ...rest } = r;
        markets.push({ ...rest, allocation: totalAssets > 0n ? Number(assets) / Number(totalAssets) : 0 });
      }

      // Vault V2 fees are WAD-scaled; performance fee applies to interest, management fee per second on assets.
      const gross = totalAssets > 0n ? weighted / Number(totalAssets) : 0;
      const net = gross * (1 - Number(perfFee) / WAD) - toApy(Number(mgmtFee) / WAD);
      return {
        apy: net,
        grossApy: gross,
        totalAssets,
        markets: markets.filter((m) => m.allocation > 0.0001).sort((x, y) => y.allocation - x.allocation),
      };
    });
  }

  /**
   * Raeto stock vault: borrows USDG against the stock (target LTV ~30%) and lends it into the sink vault.
   * Credit rate on the stock's USD value = max(0, sinkApy − borrowApy) × LTV.
   */
  function getStockVaultApy(stockVault: Address, targetLtv: number, currentLtv: number | null) {
    return cached(`stock:${stockVault}:${targetLtv}:${currentLtv}`, async () => {
      const [morpho, sink, marketId] = await cached(
        `stockptr:${stockVault}`,
        () =>
          Promise.all([
            client.readContract({ address: stockVault, abi: stockVaultAbi, functionName: "morpho" }),
            client.readContract({ address: stockVault, abi: stockVaultAbi, functionName: "sink" }),
            client.readContract({ address: stockVault, abi: stockVaultAbi, functionName: "marketId" }),
          ]),
        STRUCTURE_TTL_MS,
      );
      const [{ rates }, sinkApy] = await Promise.all([readMarket(morpho, marketId), getVaultV2Apy(sink)]);
      const spread = Math.max(0, sinkApy.apy - rates.borrowApy);
      return {
        sink,
        marketId,
        lendApy: sinkApy.apy,
        borrowApy: rates.borrowApy,
        spread,
        apyAtTargetLtv: spread * targetLtv,
        apyAtCurrentLtv: currentLtv == null ? null : spread * currentLtv,
      };
    });
  }

  return { getVaultV2Apy, getStockVaultApy };
}

export type MorphoReader = ReturnType<typeof createMorphoReader>;
