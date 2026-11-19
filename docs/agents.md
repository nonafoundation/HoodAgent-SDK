# Using with AI agents

The SDK's methods map directly onto LLM tools. Keep the model on the **prepare** side only: it can propose a transaction, the user signs it.

## Example tool definitions

```ts
const tools = {
  get_vaults: { description: "List Raeto vaults on Robinhood Chain with live credits APY and price.", run: () => hood.getVaults() },
  get_positions: { description: "A wallet's Raeto positions, including legacy vaults.", run: ({ wallet }) => hood.getPositions(wallet) },
  prepare_deposit: {
    description: "Build an UNSIGNED deposit (exact approval + deposit). The user must sign in their wallet.",
    run: ({ account, asset, amount }) => hood.prepareDeposit({ account, asset, amount }),
  },
};
```

`bigint` values are not JSON-serializable; convert with `JSON.stringify(x, (_, v) => typeof v === "bigint" ? v.toString() : v)` before returning to a model.

## Guardrails

- Always take `account` from the connected wallet, never from model output.
- Re-check prepared transactions on the client before signing: every `to` is a Raeto vault (`isRaetoVault`) or, for an approval, that vault's asset token (`STATIC_VAULTS`), `value` is 0, `chainId` is 4663, approval amount equals the deposit.
- Never give the agent a key or a signing function.

## Prefer a ready-made server?

The HoodAgent MCP server exposes the same capabilities to Claude, Cursor and other MCP clients — see [hoodagent.xyz/agents](https://hoodagent.xyz/agents).
