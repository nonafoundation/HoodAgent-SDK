import type { Address } from "viem";

/**
 * Verified contract registry for Raeto on Robinhood Chain.
 * Every address was checked on-chain (name/symbol/decimals, bytecode selectors, and simulated
 * deposits/withdrawals from real depositors) before it was added here.
 */

export interface StaticVault {
  address: Address;
  symbol: string;
  kind: "token" | "stock";
  decimals: number;
  /** The ERC-20 deposited into the vault. */
  asset: Address;
  /** Target loan-to-value for stock vaults (they borrow USDG against the stock). */
  targetLtv: number | null;
  /** Old vault: deposits paused, but existing positions can still be withdrawn. */
  legacy?: boolean;
}

/** Alias used in the public API. */
export type Vault = StaticVault;

export interface Token {
  symbol: string;
  name: string;
  address: Address;
  decimals: number;
}

export const USDG: Token = { symbol: "USDG", name: "Global Dollar", address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168", decimals: 6 };
export const RCREDIT: Token = { symbol: "rCREDIT", name: "Raeto AI credit", address: "0xa9799cfe5d25fa52c656596488b610f48655a9cc", decimals: 6 };

export const STOCK_TOKENS: Token[] = [
  { symbol: "NVDA", name: "NVIDIA", address: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec", decimals: 18 },
  { symbol: "AAPL", name: "Apple", address: "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9", decimals: 18 },
  { symbol: "TSLA", name: "Tesla", address: "0x322f0929c4625ed5bad873c95208d54e1c003b2d", decimals: 18 },
  { symbol: "GOOGL", name: "Alphabet Class A", address: "0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3", decimals: 18 },
  { symbol: "SPCX", name: "SpaceX Class A", address: "0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea", decimals: 18 },
];

export const TOKENS: Token[] = [USDG, ...STOCK_TOKENS, RCREDIT];

/** Morpho contracts used by Raeto. */
export const MORPHO = {
  blue: "0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010" as Address,
  /** Steakhouse USDG — the Morpho Vault V2 that Raeto's USDG vault supplies to. */
  steakUSDG: "0xBeEff033F34C046626B8D0A041844C5d1A5409dd" as Address,
};

export const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

/** Active vaults first, then legacy vaults (deposits paused; positions still withdrawable). */
export const STATIC_VAULTS: StaticVault[] = [
  { address: "0xd39f20d9dd7708b7d77f1c0addc3579c167a2b09", symbol: "USDG", kind: "token", decimals: 6, asset: USDG.address, targetLtv: null },
  { address: "0xc1df676eb8c2715f4f9f337d53a10b10582baa51", symbol: "NVDA", kind: "stock", decimals: 18, asset: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec", targetLtv: 0.3 },
  { address: "0x041f889ef9f386269c157bd5502f8792acb62163", symbol: "GOOGL", kind: "stock", decimals: 18, asset: "0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3", targetLtv: 0.3 },
  { address: "0xe940c0efaab995ee5151c9612a95c709afb8cedd", symbol: "AAPL", kind: "stock", decimals: 18, asset: "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9", targetLtv: 0.3 },
  { address: "0x96108e961e792c3942340f98f0e4ca06290cacd0", symbol: "SPCX", kind: "stock", decimals: 18, asset: "0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea", targetLtv: 0.3 },
  { address: "0xd760124940efa1d3d43f70f2b8fb7eb84037c4ea", symbol: "TSLA", kind: "stock", decimals: 18, asset: "0x322f0929c4625ed5bad873c95208d54e1c003b2d", targetLtv: 0.3 },
  { address: "0x6f9c9bd7f89d230ec2ee34037e09b27848e4bd6b", symbol: "USDG", kind: "token", decimals: 6, asset: USDG.address, targetLtv: null, legacy: true },
  { address: "0xc9bb4ddbb6e32c1c361a60840318798091ec5082", symbol: "NVDA", kind: "stock", decimals: 18, asset: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec", targetLtv: 0.3, legacy: true },
  { address: "0x12717098df80c8343517607a7f84f5e6599e2857", symbol: "GOOGL", kind: "stock", decimals: 18, asset: "0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3", targetLtv: 0.3, legacy: true },
  { address: "0x2a60eed21bbaa040183202ec9a00419fab8b8de2", symbol: "AAPL", kind: "stock", decimals: 18, asset: "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9", targetLtv: 0.3, legacy: true },
  { address: "0x8e1885355a2883518f6337077a32dd4e78e6d3d4", symbol: "SPCX", kind: "stock", decimals: 18, asset: "0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea", targetLtv: 0.3, legacy: true },
  { address: "0x1510079e4ffb0cf25be5342db784066fb16ff5eb", symbol: "TSLA", kind: "stock", decimals: 18, asset: "0x322f0929c4625ed5bad873c95208d54e1c003b2d", targetLtv: 0.3, legacy: true },
];

export const ACTIVE_VAULTS = STATIC_VAULTS.filter((v) => !v.legacy);

/** Active vault for a symbol (case-insensitive), or undefined. */
export function findVault(symbol: string): StaticVault | undefined {
  const s = symbol.toUpperCase();
  return ACTIVE_VAULTS.find((v) => v.symbol === s);
}

/** True if `address` is a known Raeto vault (active or legacy). */
export function isRaetoVault(address: string): boolean {
  const a = address.toLowerCase();
  return STATIC_VAULTS.some((v) => v.address.toLowerCase() === a);
}
