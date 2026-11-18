import { decodeFunctionData, erc20Abi, isAddress, type PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { createHoodAgent, HoodAgentError, parseAmountStrict, STATIC_VAULTS, ACTIVE_VAULTS, findVault, isRaetoVault, USDG, vaultAbi } from "../src/index.js";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const USDG_VAULT = findVault("USDG")!;
const NVDA_VAULT = findVault("NVDA")!;
const USDG_LEGACY = STATIC_VAULTS.find((v) => v.symbol === "USDG" && v.legacy)!;

type Reads = Record<string, unknown>;
/** Minimal fake PublicClient: answers readContract by "<address>:<function>" and records simulations. */
function fakeClient(reads: Reads, opts: { revert?: boolean } = {}) {
  const calls: unknown[] = [];
  const client = {
    async readContract({ address, functionName }: { address: string; functionName: string }) {
      const k = `${address.toLowerCase()}:${functionName}`;
      if (!(k in reads)) throw new Error(`unexpected read ${k}`);
      return reads[k];
    },
    async call(args: unknown) {
      calls.push(args);
      if (opts.revert) throw Object.assign(new Error("reverted"), { shortMessage: "execution reverted: too much" });
      return { data: "0x" };
    },
  };
  return { client: client as unknown as PublicClient, calls };
}

const depositReads = (o: { paused?: boolean; min?: bigint; balance?: bigint; allowance?: bigint } = {}): Reads => ({
  [`${USDG_VAULT.address}:depositsPaused`]: o.paused ?? false,
  [`${USDG_VAULT.address}:minDeposit`]: o.min ?? 1_000_000n,
  [`${USDG.address}:balanceOf`]: o.balance ?? 500_000_000n,
  [`${USDG.address}:allowance`]: o.allowance ?? 0n,
});

describe("registry", () => {
  it("has valid, unique addresses and one active vault per asset", () => {
    for (const v of STATIC_VAULTS) expect(isAddress(v.address) && isAddress(v.asset)).toBe(true);
    expect(new Set(STATIC_VAULTS.map((v) => v.address.toLowerCase())).size).toBe(STATIC_VAULTS.length);
    const syms = ACTIVE_VAULTS.map((v) => v.symbol);
    expect(new Set(syms).size).toBe(syms.length);
    expect(syms.sort()).toEqual(["AAPL", "GOOGL", "NVDA", "SPCX", "TSLA", "USDG"]);
    expect(isRaetoVault(USDG_LEGACY.address.toUpperCase().replace("0X", "0x"))).toBe(true);
    expect(isRaetoVault(ACCOUNT)).toBe(false);
  });
});

describe("parseAmountStrict", () => {
  it("parses exact amounts and rejects extra decimals instead of rounding", () => {
    expect(parseAmountStrict("1.5", 6)).toBe(1_500_000n);
    expect(() => parseAmountStrict("1.1234567", 6)).toThrow(/decimals/);
    expect(() => parseAmountStrict("0", 6)).toThrow();
    expect(() => parseAmountStrict("-1", 6)).toThrow();
    expect(() => parseAmountStrict("1e6", 6)).toThrow();
  });
});

describe("prepareDeposit", () => {
  it("adds an exact-amount approval when allowance is short, on Robinhood Chain, with no value", async () => {
    const { client, calls } = fakeClient(depositReads());
    const r = await createHoodAgent({ client }).prepareDeposit({ account: ACCOUNT, asset: "usdg", amount: "100" });
    expect(r.transactions).toHaveLength(2);
    const [approve, deposit] = r.transactions;
    expect(approve!.to).toBe(USDG.address);
    const a = decodeFunctionData({ abi: erc20Abi, data: approve!.data });
    expect(a.functionName).toBe("approve");
    expect(String(a.args[0]).toLowerCase()).toBe(USDG_VAULT.address);
    expect(a.args[1]).toBe(100_000_000n);
    const d = decodeFunctionData({ abi: vaultAbi, data: deposit!.data });
    expect(d).toMatchObject({ functionName: "deposit", args: [100_000_000n] });
    for (const t of r.transactions) expect(t).toMatchObject({ chainId: 4663, value: 0n });
    expect(r.simulation.ok).toBeNull(); // cannot simulate before the approval is mined
    expect(calls).toHaveLength(0);
  });

  it("skips the approval and simulates when allowance already covers the amount", async () => {
    const { client, calls } = fakeClient(depositReads({ allowance: 10n ** 12n }));
    const r = await createHoodAgent({ client }).prepareDeposit({ account: ACCOUNT, asset: "USDG", amount: "100" });
    expect(r.transactions.map((t) => t.step)).toEqual([1]);
    expect(r.simulation.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it.each([
    [{ paused: true }, "VAULT_PAUSED"],
    [{ min: 200_000_000n }, "BELOW_MINIMUM"],
    [{ balance: 1n }, "INSUFFICIENT_BALANCE"],
  ])("rejects %o with %s", async (o, code) => {
    const { client } = fakeClient(depositReads(o));
    await expect(createHoodAgent({ client }).prepareDeposit({ account: ACCOUNT, asset: "USDG", amount: "100" })).rejects.toMatchObject({ code });
  });

  it("rejects bad input before touching the chain", async () => {
    const { client } = fakeClient({});
    const hood = createHoodAgent({ client });
    await expect(hood.prepareDeposit({ account: "0x123", asset: "USDG", amount: "1" })).rejects.toMatchObject({ code: "INVALID_ADDRESS" });
    await expect(hood.prepareDeposit({ account: ACCOUNT, asset: "DOGE", amount: "1" })).rejects.toMatchObject({ code: "UNKNOWN_VAULT" });
    await expect(hood.prepareDeposit({ account: ACCOUNT, asset: "USDG", amount: "1.0000001" })).rejects.toBeInstanceOf(HoodAgentError);
  });
});

describe("prepareWithdraw", () => {
  const held = (active: bigint, legacy: bigint): Reads => ({
    [`${USDG_VAULT.address}:principalOf`]: active,
    [`${USDG_LEGACY.address}:principalOf`]: legacy,
  });

  it("withdraws the whole position with 'max', including from a legacy vault", async () => {
    const { client } = fakeClient(held(0n, 930_000_000n));
    const r = await createHoodAgent({ client }).prepareWithdraw({ account: ACCOUNT, asset: "USDG", amount: "max" });
    expect(r.vault.address).toBe(USDG_LEGACY.address);
    expect(decodeFunctionData({ abi: vaultAbi, data: r.transactions[0]!.data })).toMatchObject({ functionName: "withdraw", args: [930_000_000n] });
    expect(r.simulation.ok).toBe(true);
  });

  it("refuses to withdraw more than the position, and asks which vault when ambiguous", async () => {
    const one = fakeClient(held(5_000_000n, 0n));
    await expect(createHoodAgent({ client: one.client }).prepareWithdraw({ account: ACCOUNT, asset: "USDG", amount: "6" })).rejects.toMatchObject({ code: "EXCEEDS_POSITION" });
    const two = fakeClient(held(5_000_000n, 7_000_000n));
    await expect(createHoodAgent({ client: two.client }).prepareWithdraw({ account: ACCOUNT, asset: "USDG", amount: "1" })).rejects.toMatchObject({ code: "AMBIGUOUS_VAULT" });
    const r = await createHoodAgent({ client: two.client }).prepareWithdraw({ account: ACCOUNT, asset: "USDG", amount: "1", vault: USDG_LEGACY.address });
    expect(r.vault.legacy).toBe(true);
  });

  it("surfaces a reverted simulation as a warning instead of hiding it", async () => {
    const { client } = fakeClient(held(5_000_000n, 0n), { revert: true });
    const r = await createHoodAgent({ client }).prepareWithdraw({ account: ACCOUNT, asset: "USDG", amount: "1" });
    expect(r.simulation).toMatchObject({ ok: false, error: "execution reverted: too much" });
    expect(r.warnings.join(" ")).toMatch(/do not sign/);
  });

  it("errors when the wallet has no position", async () => {
    const { client } = fakeClient(held(0n, 0n));
    await expect(createHoodAgent({ client }).prepareWithdraw({ account: ACCOUNT, asset: "USDG", amount: "max" })).rejects.toMatchObject({ code: "NO_POSITION" });
  });

  it("knows stock vaults use shares", () => {
    expect(NVDA_VAULT.kind).toBe("stock");
  });
});
