/**
 * @hoodagent/sdk — read Raeto vaults on Robinhood Chain and build unsigned, simulated deposit/withdraw
 * transactions. Non-custodial: nothing in this package signs or sends a transaction.
 */
export { createHoodAgent, type HoodAgent, type HoodAgentOptions, type UnsignedTx, type VaultInfo, type Position, type Simulation, type PreparedDeposit, type PreparedWithdraw } from "./client.js";
export { HoodAgentError, type HoodAgentErrorCode } from "./errors.js";
export { robinhoodChain, ROBINHOOD_CHAIN_ID } from "./chain.js";
export { STATIC_VAULTS, ACTIVE_VAULTS, TOKENS, STOCK_TOKENS, USDG, RCREDIT, MORPHO, MULTICALL3, findVault, isRaetoVault, type Vault, type StaticVault, type Token } from "./registry.js";

// Lower-level building blocks
export { vaultAbi, erc20Abi, parseAmountStrict, EARNED_DECIMALS } from "./core/raeto.js";
export { createMorphoReader, type MorphoReader, type MarketRates } from "./core/morpho.js";
export { createPriceReader, type TokenPrice } from "./core/price.js";
export { readStockVaultTotals, readStockPosition, proRata, borrowSharesToAssets, type StockVaultTotals, type StockPosition } from "./core/stockVault.js";
export { readHistory, type HistoryItem, type HistoryOptions } from "./core/history.js";
