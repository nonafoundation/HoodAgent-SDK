import { parseAbi, type Address, type Hex, type PublicClient } from "viem";

/**
 * Raeto stock vault accounting (verified on-chain, see https://hoodagent.xyz/whitepaper):
 *  - the vault posts the stock as collateral on Morpho Blue (position.collateral, in stock base units)
 *  - it borrows USDG against it (position.borrowShares) and lends that USDG into the sink (Morpho Vault V2, steakUSDG)
 *  - a user owns sharesOf(user) / totalShares of all of it
 *
 * Net value of a position = collateral × price − debt + lent, all pro-rata.
 * On withdraw the vault repays the user's share of the loan from the lent USDG; if debt > lent the user tops up
 * the difference in USDG (the "shortfall").
 */
export const stockVaultReadAbi = parseAbi([
  "function morpho() view returns (address)",
  "function marketId() view returns (bytes32)",
  "function sink() view returns (address)",
  "function totalShares() view returns (uint256)",
  "function sharesOf(address) view returns (uint256)",
]);
const morphoAbi = parseAbi([
  "function position(bytes32, address) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
  "function market(bytes32) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
]);
const erc4626Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function convertToAssets(uint256) view returns (uint256)",
]);

export interface StockVaultTotals {
  totalShares: bigint;
  /** Stock posted as collateral (stock base units). */
  collateral: bigint;
  /** USDG owed to Morpho (USDG base units, rounded up). */
  debt: bigint;
  /** USDG lent into the sink (USDG base units). */
  lent: bigint;
}

export interface StockPosition {
  shares: bigint;
  /** Pro-rata stock tokens (stock base units). */
  tokens: bigint;
  /** Pro-rata USDG debt and lent amounts (USDG base units). */
  debt: bigint;
  lent: bigint;
  /** USDG the user would have to add on full withdrawal (0 if lent ≥ debt). */
  shortfall: bigint;
}

/** Morpho rounds borrow assets up (in favour of the protocol). */
export function borrowSharesToAssets(shares: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  if (shares === 0n || totalShares === 0n) return 0n;
  return (shares * totalAssets + totalShares - 1n) / totalShares;
}

/** Pure pro-rata split of vault totals to one holder. Debt rounds up, assets round down (conservative). */
export function proRata(t: StockVaultTotals, shares: bigint): StockPosition {
  if (shares === 0n || t.totalShares === 0n) return { shares, tokens: 0n, debt: 0n, lent: 0n, shortfall: 0n };
  const down = (x: bigint) => (x * shares) / t.totalShares;
  const up = (x: bigint) => (x * shares + t.totalShares - 1n) / t.totalShares;
  const debt = up(t.debt);
  const lent = down(t.lent);
  return { shares, tokens: down(t.collateral), debt, lent, shortfall: debt > lent ? debt - lent : 0n };
}

export async function readStockVaultTotals(client: PublicClient, vault: Address): Promise<StockVaultTotals> {
  const [morpho, marketId, sink, totalShares] = await Promise.all([
    client.readContract({ address: vault, abi: stockVaultReadAbi, functionName: "morpho" }),
    client.readContract({ address: vault, abi: stockVaultReadAbi, functionName: "marketId" }) as Promise<Hex>,
    client.readContract({ address: vault, abi: stockVaultReadAbi, functionName: "sink" }),
    client.readContract({ address: vault, abi: stockVaultReadAbi, functionName: "totalShares" }),
  ]);
  const [pos, market, sinkShares] = await Promise.all([
    client.readContract({ address: morpho, abi: morphoAbi, functionName: "position", args: [marketId, vault] }),
    client.readContract({ address: morpho, abi: morphoAbi, functionName: "market", args: [marketId] }),
    client.readContract({ address: sink, abi: erc4626Abi, functionName: "balanceOf", args: [vault] }),
  ]);
  const lent =
    sinkShares > 0n ? await client.readContract({ address: sink, abi: erc4626Abi, functionName: "convertToAssets", args: [sinkShares] }) : 0n;
  return {
    totalShares,
    collateral: pos[2],
    debt: borrowSharesToAssets(pos[1], market[2], market[3]),
    lent,
  };
}

export async function readStockPosition(client: PublicClient, vault: Address, user: Address): Promise<StockPosition> {
  const [shares, totals] = await Promise.all([
    client.readContract({ address: vault, abi: stockVaultReadAbi, functionName: "sharesOf", args: [user] }),
    readStockVaultTotals(client, vault),
  ]);
  return proRata(totals, shares);
}
