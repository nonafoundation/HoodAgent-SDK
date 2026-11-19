# Changelog

All notable changes are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added
- Guides in `docs/` (getting started, transactions, how the numbers work, AI agents) and an examples index.
- Tests for Morpho APY math, stock-vault pro-rata accounting and history paging (36 tests).
- Issue and PR templates, Code of Conduct, CODEOWNERS, EditorConfig.
- CI on Node 20/22/24 with a package-contents check, CodeQL scanning, Dependabot, and a tag-driven GitHub release workflow.

### Changed
- Published build no longer ships source maps that point at unshipped sources.

## [0.1.0] - 2026-11-18

### Added
- `createHoodAgent()` client: `getVaults`, `getApy`, `getPrice`, `getPositions`, `prepareDeposit`, `prepareWithdraw`, `getHistory`.
- Verified registry of Raeto vaults (active and legacy), tokens and Morpho contracts on Robinhood Chain.
- On-chain Morpho APY and oracle-price readers, stock-vault loan accounting, transfer-based history.
- `HoodAgentError` with stable error codes.
- Offline test suite and examples.
