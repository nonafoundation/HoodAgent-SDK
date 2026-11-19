# How the numbers work

All figures are computed from Robinhood Chain state at call time — there is no HoodAgent API.

## Credits APY

**USDG vault.** Raeto supplies USDG to *Steakhouse USDG* (Morpho Vault V2), which allocates across Morpho Blue markets. The Morpho API does not index chain 4663 and the public RPC has no archive state, so the APY is derived instantaneously from each market's interest-rate model:

```
APY = Σ allocation_m × borrowRate_m × utilization_m × (1 − fee_m)   (then net of vault fees)
```

**Stock vaults.** The vault posts the stock as collateral, borrows USDG at the target LTV (~30%) and lends it to Steakhouse USDG:

```
APY = max(0, lendAPY − borrowAPY) × targetLTV
```

This can be 0% when borrowing costs more than lending earns. Rates move every block; treat them as current, not guaranteed.

## Prices

From the Morpho Blue oracle of each stock vault's market:

```
price (USDG per token) = oracle.price() / 1e36 × 10^(collateralDecimals − loanDecimals)
```

These are the prices Morpho uses for liquidations — a sound on-chain mark, not an exchange quote. USDG is pegged to 1.

## Stock-vault positions

A stock-vault share is a pro-rata claim on the vault's Morpho position:

```
tokens    = shares / totalShares × collateral
debt      = shares / totalShares × borrowed USDG   (rounded up, as Morpho does)
lent      = shares / totalShares × USDG supplied to the sink
shortfall = max(0, debt − lent)                     (USDG to add on withdrawal)
```

## Caching

Readers cache Morpho vault structure for 1 hour, Morpho rates for 60 seconds (served stale for up to 10 minutes while refreshing), and oracle prices for 60 seconds. Create one client and reuse it.
