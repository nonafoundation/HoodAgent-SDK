import { parseAbi, type Address, type PublicClient } from "viem";
import { STATIC_VAULTS } from "../registry.js";

/**
 * Stock Token prices from the Morpho Blue oracle of the market each Raeto stock vault borrows against.
 * Morpho oracle `price()` = value of 1 collateral base unit in loan base units, scaled by 1e36.
 * Loan token is USDG (≈ USD). This is the price Morpho uses for liquidations — a reasonable on-chain mark,
 * not an exchange quote. See https://hoodagent.xyz/whitepaper (D5).
 */
const stockVaultAbi = parseAbi(["function morpho() view returns (address)", "function marketId() view returns (bytes32)"]);
const morphoAbi = parseAbi([
  "function idToMarketParams(bytes32) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)",
]);
const oracleAbi = parseAbi(["function price() view returns (uint256)"]);
const erc20DecAbi = parseAbi(["function decimals() view returns (uint8)"]);

export interface TokenPrice {
  symbol: string;
  usd: number;
  source: "morpho-oracle" | "peg";
  oracle?: Address;
}

/** Environment-agnostic (Node + browser) price reader. */
export function createPriceReader(client: PublicClient) {
  const PRICE_TTL_MS = 60_000;
  const oracleCache = new Map<string, { oracle: Address; loanDec: number; collDec: number }>();
  const priceCache = new Map<string, { at: number; usd: number }>();

  async function resolveOracle(symbol: string) {
    const hit = oracleCache.get(symbol);
    if (hit) return hit;
    const vault = STATIC_VAULTS.find((v) => v.kind === "stock" && !v.legacy && v.symbol === symbol);
    if (!vault) return null;
    const [morpho, id] = await Promise.all([
      client.readContract({ address: vault.address, abi: stockVaultAbi, functionName: "morpho" }),
      client.readContract({ address: vault.address, abi: stockVaultAbi, functionName: "marketId" }),
    ]);
    const [loanToken, collateralToken, oracle] = await client.readContract({
      address: morpho, abi: morphoAbi, functionName: "idToMarketParams", args: [id],
    });
    const [loanDec, collDec] = await Promise.all([
      client.readContract({ address: loanToken, abi: erc20DecAbi, functionName: "decimals" }),
      client.readContract({ address: collateralToken, abi: erc20DecAbi, functionName: "decimals" }),
    ]);
    const entry = { oracle, loanDec, collDec };
    oracleCache.set(symbol, entry);
    return entry;
  }

  /** USD price for one whole token, or null if no on-chain price source exists for it. */
  async function getPriceUsd(symbol: string): Promise<TokenPrice | null> {
    const sym = symbol.toUpperCase();
    if (sym === "USDG" || sym === "RCREDIT") return { symbol: sym, usd: 1, source: "peg" };

    const o = await resolveOracle(sym);
    if (!o) return null;
    const cached = priceCache.get(sym);
    if (cached && Date.now() - cached.at < PRICE_TTL_MS) return { symbol: sym, usd: cached.usd, source: "morpho-oracle", oracle: o.oracle };

    const raw = await client.readContract({ address: o.oracle, abi: oracleAbi, functionName: "price" });
    // whole-collateral → whole-loan: raw / 1e36 * 10^collDec / 10^loanDec
    const usd = (Number(raw) / 1e36) * 10 ** (o.collDec - o.loanDec);
    priceCache.set(sym, { at: Date.now(), usd });
    return { symbol: sym, usd, source: "morpho-oracle", oracle: o.oracle };
  }

  return { getPriceUsd };
}
