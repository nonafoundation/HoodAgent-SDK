import { describe, expect, it } from "vitest";
import type { PublicClient } from "viem";
import { parseAmountStrict } from "../src/core/raeto.js";
import { borrowSharesToAssets, proRata } from "../src/core/stockVault.js";
import { createMorphoReader } from "../src/core/morpho.js";

describe("parseAmountStrict", () => {
  it.each([
    ["1", 6, 1_000_000n],
    ["10.5", 6, 10_500_000n],
    ["0.000001", 6, 1n],
    [" 2 ", 6, 2_000_000n],
    ["0.617169541272461800", 18, 617_169_541_272_461_800n],
  ])("parses %s with %i decimals", (input, dec, want) => {
    expect(parseAmountStrict(input, dec)).toBe(want);
  });

  it.each([
    ["1.1234567", 6, /decimals/],
    ["0", 6, /greater than 0/],
    ["0.000000", 6, /greater than 0/],
    ["-1", 6, /Invalid/],
    ["1e3", 6, /Invalid/],
    ["1,5", 6, /Invalid/],
    ["", 6, /Invalid/],
    ["abc", 6, /Invalid/],
  ])("rejects %j", (input, dec, msg) => {
    expect(() => parseAmountStrict(input, dec)).toThrow(msg);
  });
});

describe("stock vault accounting", () => {
  it("rounds Morpho borrow assets up", () => {
    expect(borrowSharesToAssets(0n, 100n, 100n)).toBe(0n);
    expect(borrowSharesToAssets(1n, 10n, 3n)).toBe(4n); // 3.33 → 4
    expect(borrowSharesToAssets(3n, 10n, 3n)).toBe(10n);
  });

  const totals = { totalShares: 1000n, collateral: 1000n, debt: 300n, lent: 310n };

  it("splits collateral/lent down and debt up, pro-rata", () => {
    expect(proRata(totals, 333n)).toEqual({ shares: 333n, tokens: 333n, debt: 100n, lent: 103n, shortfall: 0n });
  });

  it("reports a shortfall when the loan exceeds the lent USDG", () => {
    const p = proRata({ ...totals, lent: 250n }, 500n);
    expect(p.debt).toBe(150n);
    expect(p.lent).toBe(125n);
    expect(p.shortfall).toBe(25n);
  });

  it("handles empty vaults and zero shares", () => {
    expect(proRata({ ...totals, totalShares: 0n }, 5n).tokens).toBe(0n);
    expect(proRata(totals, 0n)).toEqual({ shares: 0n, tokens: 0n, debt: 0n, lent: 0n, shortfall: 0n });
  });

  it("gives the whole vault to the only holder", () => {
    expect(proRata(totals, 1000n)).toEqual({ shares: 1000n, tokens: 1000n, debt: 300n, lent: 310n, shortfall: 0n });
  });
});

describe("Morpho reader (mocked chain)", () => {
  const SEC_PER_YEAR = 365 * 86_400;
  // 4% APR borrow rate per second, WAD-scaled.
  const borrowRatePerSec = BigInt(Math.round((0.04 / SEC_PER_YEAR) * 1e18));
  const M = "0x00000000000000000000000000000000000000a1";
  const ADAPTER = "0x00000000000000000000000000000000000000a2";
  const IRM = "0x00000000000000000000000000000000000000a3";
  const VAULT = "0x00000000000000000000000000000000000000a4";
  const ID = "0x" + "11".repeat(32);

  // Two markets would be realistic; one market with 90% utilization and 50% of vault assets keeps the math checkable.
  const client = {
    readContract: async ({ functionName }: { functionName: string }) => {
      switch (functionName) {
        case "totalAssets": return 2_000n;
        case "performanceFee": return 0n;
        case "managementFee": return 0n;
        case "adaptersLength": return 1n;
        case "adapters": return ADAPTER;
        case "morpho": return M;
        case "marketIdsLength": return 1n;
        case "marketIds": return ID;
        case "idToMarketParams": return [M, M, M, IRM, 0n];
        // supplyAssets 10_000, supplyShares 10_000, borrowAssets 9_000 (90% util), borrowShares 9_000, lastUpdate, fee 0
        case "market": return [10_000n, 10_000n, 9_000n, 9_000n, 0n, 0n];
        case "position": return [1_000n, 0n, 0n]; // vault supplies 1_000 of the 2_000 it holds → 50% allocated
        case "borrowRateView": return borrowRatePerSec;
        default: throw new Error(`unexpected ${functionName}`);
      }
    },
  } as unknown as PublicClient;

  it("computes asset-weighted supply APY with idle cash earning 0", async () => {
    const r = await createMorphoReader(client).getVaultV2Apy(VAULT);
    const borrowApy = Math.expm1(0.04);
    const supplyApy = Math.expm1(0.04 * 0.9);
    expect(r.markets[0]!.borrowApy).toBeCloseTo(borrowApy, 6);
    expect(r.markets[0]!.supplyApy).toBeCloseTo(supplyApy, 6);
    expect(r.markets[0]!.allocation).toBeCloseTo(0.5, 6);
    expect(r.apy).toBeCloseTo(supplyApy * 0.5, 6);
  });

  it("dedupes concurrent calls into one computation", async () => {
    let calls = 0;
    const counting = {
      readContract: async (args: { functionName: string }) => {
        if (args.functionName === "totalAssets") calls++;
        return (client.readContract as unknown as (a: unknown) => Promise<unknown>)(args);
      },
    } as unknown as PublicClient;
    const reader = createMorphoReader(counting);
    await Promise.all([reader.getVaultV2Apy(VAULT), reader.getVaultV2Apy(VAULT), reader.getVaultV2Apy(VAULT)]);
    expect(calls).toBe(1);
  });
});
