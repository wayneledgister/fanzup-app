/**
 * Money is always an integer number of cents ("minor units") — PRD 01a ledger convention.
 * Never use floats for amounts. Postgres stores these as bigint.
 */
export type Minor = number;

export function assertMinor(n: number, label = "amount"): asserts n is Minor {
  if (!Number.isSafeInteger(n)) throw new Error(`${label} must be an integer number of cents, got ${n}`);
}

export const dollarsToMinor = (d: number): Minor => Math.round(d * 100);
