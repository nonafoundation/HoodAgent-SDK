import { erc20Abi, parseAbi, parseUnits } from "viem";

/**
 * Raeto vault ABIs and pure helpers shared by the MCP server and the dApp.
 * Semantics verified on-chain (https://hoodagent.xyz/whitepaper, "v0.2"):
 *  - token (USDG) vault: deposit(uint256 assets), withdraw(uint256 assets) where assets <= principalOf(user)
 *  - stock vault:        deposit(uint256 tokens), withdraw(uint256 shares) where shares <= sharesOf(user)
 */
export const vaultAbi = parseAbi([
  "function deposit(uint256 amount)",
  "function withdraw(uint256 amount) returns (uint256)",
  "function minDeposit() view returns (uint256)",
  "function depositsPaused() view returns (bool)",
  "function inLoss() view returns (bool)",
  "function depositCap() view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function totalShares() view returns (uint256)",
  "function principalOf(address) view returns (uint256)",
  "function sharesOf(address) view returns (uint256)",
  "function earned(address) view returns (uint256)",
  "function earnedIncludingPending(address) view returns (uint256)",
  "function previewWithdraw(address, uint256) view returns (uint256)",
]);

export { erc20Abi };

/** Credits earned in Raeto vaults are 6-decimal USD (rCREDIT). */
export const EARNED_DECIMALS = 6;

/**
 * Parse a decimal string to base units, rejecting (not rounding) extra decimals,
 * so a signed amount is exactly what the user asked for.
 */
export function parseAmountStrict(amount: string, decimals: number): bigint {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error(`Invalid amount '${amount}'.`);
  const frac = trimmed.split(".")[1] ?? "";
  if (frac.length > decimals) throw new Error(`Too many decimals: max ${decimals}.`);
  const units = parseUnits(trimmed, decimals);
  if (units <= 0n) throw new Error("Amount must be greater than 0.");
  return units;
}
