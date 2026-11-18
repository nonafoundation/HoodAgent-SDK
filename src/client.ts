import { createPublicClient, encodeFunctionData, erc20Abi, http, isAddress, type Address, type Hex, type PublicClient } from "viem";
import { robinhoodChain, ROBINHOOD_CHAIN_ID } from "./chain.js";
import { readHistory, type HistoryOptions } from "./core/history.js";
import { createMorphoReader } from "./core/morpho.js";
import { createPriceReader } from "./core/price.js";
import { EARNED_DECIMALS, parseAmountStrict, vaultAbi } from "./core/raeto.js";
import { proRata, readStockPosition, readStockVaultTotals, type StockPosition } from "./core/stockVault.js";
import { HoodAgentError } from "./errors.js";
import { ACTIVE_VAULTS, MORPHO, STATIC_VAULTS, USDG, findVault, type StaticVault } from "./registry.js";

export interface HoodAgentOptions {
  /** Your own viem PublicClient (recommended in apps that already have one). */
  client?: PublicClient;
  /** RPC URL used when no client is given. Defaults to the public Robinhood Chain RPC (rate-limited). */
  rpcUrl?: string;
}

/** One unsigned transaction step. HoodAgent never signs or sends. */
export interface UnsignedTx {
  step: number;
  description: string;
  to: Address;
  data: Hex;
  value: 0n;
  chainId: typeof ROBINHOOD_CHAIN_ID;
}

export interface VaultInfo extends StaticVault {
  paused: boolean;
  inLoss: boolean;
  minDeposit: bigint;
  depositCap: bigint;
  /** Credits APY as a fraction (0.0382 = 3.82%), or null if it could not be computed. */
  apy: number | null;
  /** USD price of one whole asset token (USDG = 1), or null. */
  priceUsd: number | null;
}

export interface Position {
  vault: StaticVault;
  /** USDG vault: principal (asset units). Stock vault: vault shares. */
  amount: bigint;
  /** Credits earned, 6-decimal USD. */
  earned: bigint;
  /** Stock vaults: pro-rata collateral and loan accounting. */
  stock?: StockPosition | undefined;
}

export interface Simulation {
  ok: boolean | null;
  error?: string;
  note?: string;
}

export interface PreparedDeposit {
  action: "deposit";
  vault: StaticVault;
  amount: bigint;
  transactions: UnsignedTx[];
  simulation: Simulation;
  warnings: string[];
}

export interface PreparedWithdraw {
  action: "withdraw";
  vault: StaticVault;
  amount: bigint;
  position: bigint;
  stock?: StockPosition | undefined;
  transactions: UnsignedTx[];
  simulation: Simulation;
  warnings: string[];
}

const BASE_WARNINGS = [
  "HoodAgent does not sign or send transactions. Review each step and sign it in your own wallet.",
  "Yield and credits are variable and not guaranteed. Not financial advice.",
];

function assertAddress(a: string, what = "wallet"): Address {
  if (!isAddress(a)) throw new HoodAgentError(`Invalid ${what} address '${a}'.`, "INVALID_ADDRESS");
  return a as Address;
}

function toUnits(amount: string, decimals: number): bigint {
  try {
    return parseAmountStrict(amount, decimals);
  } catch (e) {
    throw new HoodAgentError((e as Error).message, "INVALID_AMOUNT");
  }
}

export interface HoodAgent {
  /** The viem PublicClient used for every read. */
  client: PublicClient;
  /** Active vaults with live pause/loss status, minimum, cap, credits APY and price. */
  getVaults(): Promise<VaultInfo[]>;
  /** Credits APY of an active vault as a fraction (0.0382 = 3.82%), or null if unavailable. */
  getApy(symbol: string): Promise<number | null>;
  /** USD price of one whole token (Morpho oracle; USDG = 1), or null. */
  getPrice(symbol: string): Promise<number | null>;
  /** Non-empty positions of a wallet across active and legacy vaults. */
  getPositions(wallet: string): Promise<Position[]>;
  /** Unsigned approve (exact, if needed) + deposit, with pre-flight checks and simulation. */
  prepareDeposit(p: { account: string; asset: string; amount: string }): Promise<PreparedDeposit>;
  /** Unsigned withdraw (active or legacy vault), simulated. `amount` may be "max". */
  prepareWithdraw(p: { account: string; asset: string; amount: string; vault?: string }): Promise<PreparedWithdraw>;
  /** Deposit/withdraw history, newest first, paged by block range. */
  getHistory(wallet: string, options?: HistoryOptions): ReturnType<typeof readHistory>;
}

/**
 * Create a HoodAgent client.
 *
 * ```ts
 * const hood = createHoodAgent();
 * const vaults = await hood.getVaults();
 * const tx = await hood.prepareDeposit({ account, asset: "USDG", amount: "100" });
 * ```
 */
export function createHoodAgent(opts: HoodAgentOptions = {}): HoodAgent {
  const client: PublicClient =
    opts.client ??
    (createPublicClient({
      chain: robinhoodChain,
      transport: http(opts.rpcUrl, { retryCount: 3, retryDelay: 400 }),
      batch: { multicall: true },
    }) as PublicClient);
  const morpho = createMorphoReader(client);
  const prices = createPriceReader(client);

  async function simulate(account: Address, to: Address, data: Hex): Promise<Simulation> {
    try {
      await client.call({ account, to, data });
      return { ok: true };
    } catch (e) {
      const msg = (e as { shortMessage?: string }).shortMessage ?? "execution reverted";
      return { ok: false, error: msg.split("\n")[0] };
    }
  }

  /** Credits APY for one vault as a fraction, or null. */
  async function getApy(symbol: string): Promise<number | null> {
    const v = findVault(symbol);
    if (!v) throw new HoodAgentError(`No active Raeto vault for '${symbol}'.`, "UNKNOWN_VAULT");
    try {
      if (v.kind === "token") return (await morpho.getVaultV2Apy(MORPHO.steakUSDG)).apy;
      return (await morpho.getStockVaultApy(v.address, v.targetLtv ?? 0.3, null)).apyAtTargetLtv;
    } catch {
      return null;
    }
  }

  /** USD price of one whole token from the Morpho oracle (USDG = 1), or null. */
  async function getPrice(symbol: string): Promise<number | null> {
    return (await prices.getPriceUsd(symbol).catch(() => null))?.usd ?? null;
  }

  /** Active vaults with live status, APY and price. */
  async function getVaults(): Promise<VaultInfo[]> {
    return Promise.all(
      ACTIVE_VAULTS.map(async (v) => {
        const [paused, inLoss, minDeposit, depositCap, apy, priceUsd] = await Promise.all([
          client.readContract({ address: v.address, abi: vaultAbi, functionName: "depositsPaused" }),
          client.readContract({ address: v.address, abi: vaultAbi, functionName: "inLoss" }),
          client.readContract({ address: v.address, abi: vaultAbi, functionName: "minDeposit" }),
          client.readContract({ address: v.address, abi: vaultAbi, functionName: "depositCap" }),
          getApy(v.symbol),
          getPrice(v.symbol),
        ]);
        return { ...v, paused, inLoss, minDeposit, depositCap, apy, priceUsd };
      }),
    );
  }

  /** A wallet's positions across every vault, including legacy ones. Empty positions are omitted. */
  async function getPositions(wallet: string): Promise<Position[]> {
    const owner = assertAddress(wallet);
    const rows = await Promise.all(
      STATIC_VAULTS.map(async (vault): Promise<Position | null> => {
        const isStock = vault.kind === "stock";
        const [amount, earned] = await Promise.all([
          client.readContract({ address: vault.address, abi: vaultAbi, functionName: isStock ? "sharesOf" : "principalOf", args: [owner] }),
          client
            .readContract({ address: vault.address, abi: vaultAbi, functionName: isStock ? "earned" : "earnedIncludingPending", args: [owner] })
            .catch(() => 0n),
        ]);
        if (amount === 0n && earned === 0n) return null;
        const stock = isStock && amount > 0n ? await readStockPosition(client, vault.address, owner).catch(() => undefined) : undefined;
        return { vault, amount, earned, stock };
      }),
    );
    return rows.filter((r): r is Position => r !== null);
  }

  /**
   * Unsigned approve (exact amount, only if needed) + deposit for an active vault.
   * Checks pause state, minimum, balance and allowance, and simulates the deposit when no approval is pending.
   */
  async function prepareDeposit(p: { account: string; asset: string; amount: string }): Promise<PreparedDeposit> {
    const account = assertAddress(p.account);
    const vault = findVault(p.asset);
    if (!vault) throw new HoodAgentError(`No active Raeto vault for '${p.asset}'.`, "UNKNOWN_VAULT");
    const units = toUnits(p.amount, vault.decimals);

    const [paused, minDeposit, balance, allowance] = await Promise.all([
      client.readContract({ address: vault.address, abi: vaultAbi, functionName: "depositsPaused" }),
      client.readContract({ address: vault.address, abi: vaultAbi, functionName: "minDeposit" }),
      client.readContract({ address: vault.asset, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
      client.readContract({ address: vault.asset, abi: erc20Abi, functionName: "allowance", args: [account, vault.address] }),
    ]);
    if (paused) throw new HoodAgentError(`Deposits into the ${vault.symbol} vault are paused.`, "VAULT_PAUSED");
    if (units < minDeposit) throw new HoodAgentError(`Below the vault minimum deposit.`, "BELOW_MINIMUM", { minDeposit });
    if (balance < units) throw new HoodAgentError(`Insufficient ${vault.symbol} balance.`, "INSUFFICIENT_BALANCE", { balance });

    const transactions: UnsignedTx[] = [];
    const needsApprove = allowance < units;
    if (needsApprove) {
      transactions.push({
        step: 1,
        description: `Approve the Raeto ${vault.symbol} vault to spend exactly ${p.amount} ${vault.symbol}`,
        to: vault.asset,
        data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [vault.address, units] }),
        value: 0n,
        chainId: ROBINHOOD_CHAIN_ID,
      });
    }
    const data = encodeFunctionData({ abi: vaultAbi, functionName: "deposit", args: [units] });
    transactions.push({
      step: transactions.length + 1,
      description: `Deposit ${p.amount} ${vault.symbol} into the Raeto ${vault.symbol} vault`,
      to: vault.address,
      data,
      value: 0n,
      chainId: ROBINHOOD_CHAIN_ID,
    });

    const simulation: Simulation = needsApprove
      ? { ok: null, note: "The deposit can only be simulated after the approval is mined." }
      : await simulate(account, vault.address, data);

    return {
      action: "deposit",
      vault,
      amount: units,
      transactions,
      simulation,
      warnings: [
        ...BASE_WARNINGS,
        ...(vault.kind === "stock" ? ["Stock vaults borrow USDG against your shares (target LTV ~30%); a sharp price drop can trigger liquidation."] : []),
      ],
    };
  }

  /**
   * Unsigned withdraw from an active or legacy vault. `amount` is asset units for USDG vaults and shares for
   * stock vaults; pass "max" for the whole position. If the wallet holds the asset in several vaults, pass `vault`.
   */
  async function prepareWithdraw(p: { account: string; asset: string; amount: string; vault?: string }): Promise<PreparedWithdraw> {
    const account = assertAddress(p.account);
    const sym = p.asset.toUpperCase();
    const candidates = STATIC_VAULTS.filter((v) => v.symbol === sym && (!p.vault || v.address.toLowerCase() === p.vault.toLowerCase()));
    if (!candidates.length) throw new HoodAgentError(`No Raeto vault for '${p.asset}'.`, "UNKNOWN_VAULT");

    const held = await Promise.all(
      candidates.map(async (v) => ({
        v,
        units: await client.readContract({ address: v.address, abi: vaultAbi, functionName: v.kind === "stock" ? "sharesOf" : "principalOf", args: [account] }),
      })),
    );
    const withPos = held.filter((h) => h.units > 0n);
    if (withPos.length > 1 && !p.vault)
      throw new HoodAgentError(`Positions in ${withPos.length} ${sym} vaults; pass \`vault\` to choose one.`, "AMBIGUOUS_VAULT", {
        vaults: withPos.map((h) => h.v.address),
      });
    const chosen = withPos[0] ?? held[0]!;
    if (chosen.units === 0n) throw new HoodAgentError(`No ${sym} position in any Raeto vault.`, "NO_POSITION");

    const vault = chosen.v;
    const units = p.amount.toLowerCase() === "max" ? chosen.units : toUnits(p.amount, vault.decimals);
    if (units > chosen.units) throw new HoodAgentError(`Amount exceeds the position.`, "EXCEEDS_POSITION", { position: chosen.units });

    const data = encodeFunctionData({ abi: vaultAbi, functionName: "withdraw", args: [units] });
    const [simulation, stock] = await Promise.all([
      simulate(account, vault.address, data),
      vault.kind === "stock" ? readStockVaultTotals(client, vault.address).then((t) => proRata(t, units)).catch(() => undefined) : undefined,
    ]);

    return {
      action: "withdraw",
      vault,
      amount: units,
      position: chosen.units,
      stock,
      transactions: [
        { step: 1, description: `Withdraw from the Raeto ${vault.symbol} vault${vault.legacy ? " (legacy)" : ""}`, to: vault.address, data, value: 0n, chainId: ROBINHOOD_CHAIN_ID },
      ],
      simulation,
      warnings: [
        ...BASE_WARNINGS,
        "Earned AI credits are not part of the withdrawal; they stay in your Raeto account.",
        ...(stock && stock.shortfall > 0n ? ["This withdrawal needs a USDG top-up to repay your share of the vault loan."] : []),
        ...(simulation.ok === false ? ["Simulation reverted — do not sign until the cause is understood."] : []),
      ],
    };
  }

  /** Deposits and withdrawals for a wallet, reconstructed from token transfers (paged, public-RPC friendly). */
  function getHistory(wallet: string, options?: HistoryOptions) {
    return readHistory(client, assertAddress(wallet), options);
  }

  return { client, getVaults, getApy, getPrice, getPositions, prepareDeposit, prepareWithdraw, getHistory };
}

export { EARNED_DECIMALS, USDG };
