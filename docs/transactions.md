# Transactions

The SDK **prepares** transactions; your user's wallet **signs** them. Nothing in the package can sign or send.

## Deposit

```ts
const p = await hood.prepareDeposit({ account, asset: "USDG", amount: "250.5" });
```

Before returning, the SDK checks:

| Check | Error code |
|---|---|
| Address is valid | `INVALID_ADDRESS` |
| Amount is a positive decimal with ≤ token decimals (no rounding) | `INVALID_AMOUNT` |
| An active vault exists for the asset | `UNKNOWN_VAULT` |
| Deposits are not paused | `VAULT_PAUSED` |
| Amount ≥ vault minimum | `BELOW_MINIMUM` |
| Wallet balance covers the amount | `INSUFFICIENT_BALANCE` |

`p.transactions` is one or two steps:

1. `approve(vault, amount)` on the asset — **only if** the current allowance is too low, and **only** for the exact amount.
2. `deposit(amount)` on the vault.

Every step has `chainId: 4663` and `value: 0n`. If no approval is needed, the deposit is simulated (`p.simulation.ok`). With a pending approval, simulation is deferred (`ok: null`) — re-simulate after the approval is mined, or call `prepareDeposit` again.

## Withdraw

```ts
const w = await hood.prepareWithdraw({ account, asset: "NVDA", amount: "max" });
```

- USDG vaults take an **asset amount**; stock vaults take **shares** (see `getPositions`).
- Legacy vaults are included. If the wallet has positions in several vaults for the same asset, the call fails with `AMBIGUOUS_VAULT` and `details.vaults`; pass `vault` to choose.
- For stock vaults, `w.stock` reports the pro-rata collateral, USDG debt, USDG lent and any `shortfall` the user must top up.
- The withdrawal is always simulated. A revert is returned as `simulation.ok === false` with the reason, plus a warning — never hidden.

## Signing (viem)

```ts
const wallet = createWalletClient({ account, chain: robinhoodChain, transport: custom(window.ethereum!) });
for (const tx of p.transactions) {
  const hash = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value, chain: robinhoodChain });
  await hood.client.waitForTransactionReceipt({ hash });
}
```

Pass `chain: robinhoodChain` so the wallet refuses to send on another network.

## Show users what they sign

Use `tx.description` and `p.warnings` in your UI. For stock vaults, surface the liquidation warning and any `shortfall`.
