# Contributing

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Use the issue templates for bugs and features.

1. `pnpm install`, then `pnpm check` (typecheck, offline tests, build) must pass.
2. **Never guess an address.** New registry entries must be verified on-chain; say how in the PR.
3. Keep the SDK free of Node-only APIs in `src/` — it must run in browsers.
4. Transactions stay unsigned and exact: no unlimited approvals, no silent rounding, simulate before signing.
5. Add tests for behaviour changes and an entry under a new version in `CHANGELOG.md`.
