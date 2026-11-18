<p align="center">
  <a href="https://hoodagent.xyz"><img src="https://hoodagent.xyz/logo-96.webp" alt="HoodAgent" height="56"></a>
</p>

<h1 align="center">@hoodagent/sdk</h1>

<p align="center">
  TypeScript SDK for <b>Raeto vaults on Robinhood Chain</b> — live Morpho APY, oracle prices, positions,<br>
  and <b>unsigned, simulated</b> deposit &amp; withdraw transactions. Non-custodial by design.
</p>

<p align="center">
  <a href="https://github.com/nonafoundation/HoodAgent-SDK/actions/workflows/ci.yml"><img src="https://github.com/nonafoundation/HoodAgent-SDK/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT">
  <img src="https://img.shields.io/badge/chain-Robinhood%20Chain%20(4663)-0b8f31" alt="Robinhood Chain">
  <a href="https://x.com/HoodAgent_xyz"><img src="https://img.shields.io/badge/X-@HoodAgent__xyz-000" alt="X"></a>
</p>

<p align="center">
  <a href="https://hoodagent.xyz">App</a> ·
  <a href="https://hoodagent.xyz/whitepaper">Whitepaper</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#api">API</a> ·
  <a href="#security-model">Security</a>
</p>

---

## Why

[Raeto](https://raeto.cc) vaults turn Morpho lending interest on USDG and tokenized stocks (NVDA, AAPL, TSLA, GOOGL, SPCX) into AI credits. This SDK gives apps and AI agents everything needed to build on them:

- **Live data, from the chain.** Credits APY is computed from Morpho's interest-rate models; prices come from Morpho oracles. No private API.
- **Safe transactions.** Exact-amount approvals (never unlimited), strict amount parsing (no silent rounding), pre-flight checks and simulation — returned as unsigned calldata for the user's own wallet.
- **Legacy-aware.** Positions and withdrawals cover legacy vaults where many users still hold funds.
- **Small and portable.** One peer dependency (`viem`), runs in Node and the browser, fully typed.

It is the same engine that powers [hoodagent.xyz](https://hoodagent.xyz), its AI assistant and the HoodAgent MCP server.

## Install

```bash
npm install @hoodagent/sdk viem
# or: pnpm add @hoodagent/sdk viem
```

## Quick start

```ts
import { createHoodAgent } from "@hoodagent/sdk";

const hood = createHoodAgent(); // or createHoodAgent({ rpcUrl }) / createHoodAgent({ client })

// Vaults with live APY and prices
for (const v of await hood.getVaults()) {
  console.log(v.symbol, v.apy != null ? `${(v.apy * 100).toFixed(2)}%` : "–", v.priceUsd);
}

// A wallet's positions (active + legacy vaults)
const positions = await hood.getPositions("0xYourWallet");
```

```
┌─────────┬─────────┬─────────┬───────────┬──────────┐
│ vault   │ kind    │ apy     │ price     │ status   │
├─────────┼─────────┼─────────┼───────────┼──────────┤
│ USDG    │ token   │ 3.82%   │ $1.00     │ active   │
│ NVDA    │ stock   │ 0.64%   │ $157.98   │ active   │
│ AAPL    │ stock   │ 1.14%   │ $350.35   │ active   │
│ …       │         │         │           │          │
└─────────┴─────────┴─────────┴───────────┴──────────┘
```

### Deposit — prepare here, sign in the user's wallet

```ts
import { createWalletClient, custom } from "viem";
import { createHoodAgent, robinhoodChain } from "@hoodagent/sdk";

const hood = createHoodAgent();
const prepared = await hood.prepareDeposit({ account, asset: "USDG", amount: "100" });
// prepared.transactions: [approve (exact, only if needed), deposit] — unsigned, chainId 4663, value 0
// prepared.simulation:   { ok: true } once no approval is pending

const wallet = createWalletClient({ account, chain: robinhoodChain, transport: custom(window.ethereum!) });
for (const tx of prepared.transactions) {
  const hash = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value, chain: robinhoodChain });
  await hood.client.waitForTransactionReceipt({ hash });
}
```

### Withdraw

```ts
const w = await hood.prepareWithdraw({ account, asset: "USDG", amount: "max" });
// Stock vaults take shares; w.stock reports collateral out, loan repaid and any USDG top-up needed.
if (w.simulation.ok === false) throw new Error(w.simulation.error);
```

## API

### `createHoodAgent(options?)`

| Option | Type | Description |
|---|---|---|
| `client` | `PublicClient` | Use your own viem client (recommended in apps). |
| `rpcUrl` | `string` | RPC used when no client is given. Defaults to the public Robinhood Chain RPC, which is rate-limited — use a provider in production. |

Returns a `HoodAgent`:

| Method | Returns |
|---|---|
| `getVaults()` | Active vaults with `paused`, `inLoss`, `minDeposit`, `depositCap`, `apy` (fraction), `priceUsd`. |
| `getApy(symbol)` | Credits APY as a fraction (`0.0382` = 3.82%), or `null`. |
| `getPrice(symbol)` | USD price of one whole token (Morpho oracle; USDG = 1), or `null`. |
| `getPositions(wallet)` | Non-empty positions across active **and legacy** vaults, with earned credits and stock-vault loan accounting. |
| `prepareDeposit({ account, asset, amount })` | `{ transactions, simulation, warnings }` — exact approve (if needed) + deposit. |
| `prepareWithdraw({ account, asset, amount, vault? })` | Withdraw from the vault holding the position; `amount: "max"` for all. |
| `getHistory(wallet, options?)` | Deposits and withdrawals, newest first, paged by block range. |
| `client` | The underlying viem `PublicClient`. |

### Errors

Expected failures throw `HoodAgentError` with a stable `code`:

`INVALID_ADDRESS` · `INVALID_AMOUNT` · `UNKNOWN_VAULT` · `VAULT_PAUSED` · `BELOW_MINIMUM` · `INSUFFICIENT_BALANCE` · `AMBIGUOUS_VAULT` · `NO_POSITION` · `EXCEEDS_POSITION`

RPC failures are rethrown from viem unchanged.

### Building blocks

Everything the client uses is exported for advanced use:

- **Registry:** `STATIC_VAULTS`, `ACTIVE_VAULTS`, `TOKENS`, `USDG`, `RCREDIT`, `MORPHO`, `findVault`, `isRaetoVault`
- **Chain:** `robinhoodChain`, `ROBINHOOD_CHAIN_ID`
- **ABIs & parsing:** `vaultAbi`, `erc20Abi`, `parseAmountStrict`
- **Readers:** `createMorphoReader`, `createPriceReader`, `readStockVaultTotals`, `readStockPosition`, `proRata`, `readHistory`

## How the numbers are computed

- **USDG vault** — supplies to Steakhouse USDG (Morpho Vault V2). APY = Σ allocation × borrowRate × utilization × (1 − fee), from each market's IRM `borrowRateView`, net of vault fees.
- **Stock vaults** — borrow USDG against the stock at ~30% LTV and lend it: APY = max(0, lend − borrow) × LTV. Can be 0%.
- **Prices** — Morpho oracle `price() / 1e36 × 10^(collDec − loanDec)`, in USDG per token. These are liquidation-oracle prices, not exchange quotes.

Details and contract addresses: [whitepaper](https://hoodagent.xyz/whitepaper).

## Security model

- **Nothing signs.** The SDK has no key handling and never sends transactions.
- **Exact approvals only**, for the deposit amount — never `maxUint256`.
- **Strict amounts:** more decimals than the token supports is an error, not a rounding.
- **Pinned chain:** every transaction carries `chainId: 4663`; pass it to your wallet so it refuses other networks.
- **Simulation first:** `eth_call` from the user's address before you ask for a signature; a revert is reported, never hidden.
- **Verified registry:** every address was checked on-chain before inclusion.

Found a vulnerability? See [SECURITY.md](SECURITY.md).

## Examples

```bash
pnpm install
pnpm example:vaults                         # live vault table
RPC_URL=https://… npx tsx examples/positions.ts 0xWallet
```

See [`examples/`](examples) for deposit signing with viem.

## Development

```bash
pnpm install
pnpm check      # typecheck + tests (offline) + build
```

Tests run offline against a fake client — no RPC needed in CI.

## Disclaimer

Independent software, not affiliated with Raeto, Morpho, Steakhouse or Robinhood. Interacting with smart contracts carries risk, including total loss. Yields are variable. Not financial advice.

## License

[MIT](LICENSE)
