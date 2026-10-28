/**
 * Wallet-side deposit for a cross-chain XAU Route (NEAR Intents venue).
 *
 * Target path: apps/web/src/lib/near-intents/deposit.ts
 * NOT tested in the router repo (needs a wallet). Type-checked against @solana/web3.js 1.x.
 *
 * The backend returns unsigned DepositInstructions from POST /swap/cross-chain/build. This file only
 * turns them into a wallet request. The user's wallet shows and signs it; nothing here holds keys.
 *   EVM:    pass wagmi's sendTransactionAsync (the same call executeCompositeCrossChain already uses).
 *   Solana: build a Transaction, wallet signTransaction, then the existing POST /swap/submit-solana path.
 */
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID, TOKEN_PROGRAM_ID, createAtaIdempotentData, splTransferCheckedData,
} from "./solana-deposit-ix";

/** Subset of backend DepositInstructions used by the wallet. */
export interface DepositInstructions {
  quoteId: string;
  chain: string;
  depositAddress: string;
  amount: string;
  deadline?: string;
  evm?: { to: string; data: string; value: string };
  solana?: { kind: "system-transfer" | "spl-transfer"; to: string; mint?: string; amount: string; decimals: number };
}

type Hex = `0x${string}`;
export type SendEvmTx = (tx: { to: Hex; data: Hex; value: bigint }) => Promise<Hex>;

export function assertNotExpired(ins: DepositInstructions, now = Date.now()): void {
  if (ins.deadline && Date.parse(ins.deadline) - now < 60_000) throw new Error("This route is about to expire. Refresh the quote.");
}

/** EVM: one wallet prompt. ERC-20 deposits are a plain transfer() to the token, so no approval is needed. */
export async function sendEvmDeposit(ins: DepositInstructions, sendTransaction: SendEvmTx): Promise<Hex> {
  if (!ins.evm) throw new Error("not an EVM deposit");
  assertNotExpired(ins);
  return sendTransaction({ to: ins.evm.to as Hex, data: ins.evm.data as Hex, value: BigInt(ins.evm.value) });
}

function ata(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), new PublicKey(TOKEN_PROGRAM_ID).toBuffer(), mint.toBuffer()], new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID))[0];
}

/**
 * Solana: unsigned Transaction moving exactly ins.solana.amount to the deposit address.
 * SPL: creates the deposit address's associated token account if missing (idempotent), then TransferChecked.
 * Classic SPL Token program only (USDC/USDT on Solana); Token-2022 mints are rejected by the venue's token list.
 */
export function buildSolanaDepositTx(ins: DepositInstructions, payer: PublicKey, recentBlockhash: string): Transaction {
  const s = ins.solana;
  if (!s) throw new Error("not a Solana deposit");
  assertNotExpired(ins);
  const to = new PublicKey(s.to);
  const tx = new Transaction({ feePayer: payer, recentBlockhash });
  if (s.kind === "system-transfer") {
    tx.add(SystemProgram.transfer({ fromPubkey: payer, toPubkey: to, lamports: BigInt(s.amount) }));
    return tx;
  }
  if (!s.mint) throw new Error("SPL deposit without mint");
  const mint = new PublicKey(s.mint);
  const tokenProgram = new PublicKey(TOKEN_PROGRAM_ID);
  const source = ata(payer, mint);
  const dest = ata(to, mint);
  tx.add(new TransactionInstruction({
    programId: new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID),
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: to, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(SYSTEM_PROGRAM_ID), isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(createAtaIdempotentData()),
  }));
  tx.add(new TransactionInstruction({
    programId: tokenProgram,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(splTransferCheckedData(s.amount, s.decimals)),
  }));
  return tx;
}

/**
 * Solana end to end: build -> wallet signs -> existing submit path.
 * `submitSigned` should call the existing POST /swap/submit-solana client with the base64 tx and return the signature.
 */
export async function sendSolanaDeposit(
  ins: DepositInstructions,
  p: { payer: PublicKey; getLatestBlockhash: () => Promise<string>; signTransaction: (tx: Transaction) => Promise<Transaction>; submitSigned: (base64Tx: string) => Promise<string> },
): Promise<string> {
  const tx = buildSolanaDepositTx(ins, p.payer, await p.getLatestBlockhash());
  const signed = await p.signTransaction(tx);
  return p.submitSigned(Buffer.from(signed.serialize()).toString("base64"));
}

/** Optional: tell the backend the deposit hash so the route starts sooner. */
export async function reportDeposit(apiBase: string, quoteId: string, txHash: string): Promise<{ status: string }> {
  const r = await fetch(`${apiBase}/swap/cross-chain/submit-deposit`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quoteId, txHash, confirm: true }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Could not report the deposit");
  return r.json();
}
