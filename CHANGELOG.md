# Changelog

All notable changes are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning: [SemVer](https://semver.org/).

## [0.1.0] - 2026-11-18

### Added
- `createHoodAgent()` client: `getVaults`, `getApy`, `getPrice`, `getPositions`, `prepareDeposit`, `prepareWithdraw`, `getHistory`.
- Verified registry of Raeto vaults (active and legacy), tokens and Morpho contracts on Robinhood Chain.
- On-chain Morpho APY and oracle-price readers, stock-vault loan accounting, transfer-based history.
- `HoodAgentError` with stable error codes.
- Offline test suite and examples.
