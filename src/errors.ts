export type HoodAgentErrorCode =
  | "INVALID_ADDRESS"
  | "INVALID_AMOUNT"
  | "UNKNOWN_VAULT"
  | "VAULT_PAUSED"
  | "BELOW_MINIMUM"
  | "INSUFFICIENT_BALANCE"
  | "AMBIGUOUS_VAULT"
  | "NO_POSITION"
  | "EXCEEDS_POSITION";

/** Expected, user-facing failures (bad input, paused vault, insufficient balance…). RPC errors are thrown as-is. */
export class HoodAgentError extends Error {
  readonly code: HoodAgentErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(message: string, code: HoodAgentErrorCode, details?: Record<string, unknown>) {
    super(message);
    this.name = "HoodAgentError";
    this.code = code;
    this.details = details;
  }
}
