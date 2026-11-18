# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private reporting:
**Security → Report a vulnerability** on this repository. We aim to acknowledge reports within 72 hours.

In scope: anything that could make the SDK produce a transaction different from what the caller asked for
(wrong target, amount, chain, approval size), hide a failed simulation, or misreport balances or rates.

## Design guarantees

- The SDK never handles private keys and never signs or sends transactions.
- Approvals are exact-amount only; unlimited approvals are never produced.
- Every prepared transaction targets Robinhood Chain (chain ID 4663) with zero native value.
