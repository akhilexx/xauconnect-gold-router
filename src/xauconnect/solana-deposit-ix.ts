/**
 * Byte-exact instruction data for a Solana deposit into a 1Click deposit address.
 *
 * Target path in the XAUConnect repo: apps/web/src/lib/near-intents/solana-deposit-ix.ts
 * Self-contained, no dependencies. deposit.ts wraps these into @solana/web3.js
 * TransactionInstructions; the user's wallet signs, then the existing
 * POST /swap/submit-solana path broadcasts.
 */

export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

function u64le(v: bigint): Uint8Array {
  if (v < 0n || v >= 1n << 64n) throw new Error("u64 out of range");
  const b = new Uint8Array(8);
  for (let i = 0; i < 8; i++) b[i] = Number((v >> BigInt(8 * i)) & 0xffn);
  return b;
}

/** SystemProgram::Transfer { lamports } = u32 LE 2 + u64 LE lamports (12 bytes). */
export function systemTransferData(lamports: bigint | string): Uint8Array {
  const out = new Uint8Array(12);
  out.set([2, 0, 0, 0], 0);
  out.set(u64le(BigInt(lamports)), 4);
  return out;
}

/** SPL Token TransferChecked { amount, decimals } = u8 12 + u64 LE + u8 (10 bytes). */
export function splTransferCheckedData(amount: bigint | string, decimals: number): Uint8Array {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error("bad decimals");
  const out = new Uint8Array(10);
  out[0] = 12;
  out.set(u64le(BigInt(amount)), 1);
  out[9] = decimals;
  return out;
}

/** Idempotent ATA create (so the deposit address's token account exists) = u8 1. */
export function createAtaIdempotentData(): Uint8Array {
  return new Uint8Array([1]);
}
