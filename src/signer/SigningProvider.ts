import { PublicKey, Transaction } from '@bsv/sdk'
import type { PendingStorageInput } from '../Wallet'

/**
 * Delegation seam for transaction-input signing and change locking-script
 * derivation. Mirrors the Rust reference trait
 * (rust-wallet-toolbox src/signer/signing_provider.rs) 1:1 so provider
 * implementations port across the two stacks.
 *
 * Scope: BRC-29/SABPPP change-input signing and change-output locking scripts
 * ONLY. Identity keys, BRC-2 encrypt/decrypt, HMAC and certificates never
 * route through this interface.
 */
export interface SigningProvider {
  /**
   * Derive the BRC-29 change output locking script (25-byte P2PKH).
   * Public-key data only — implementations never need the private key here.
   */
  deriveChangeLockingScript: (derivationPrefix: string, derivationSuffix: string) => Promise<number[]>

  /**
   * Produce the COMPLETE unlocking script for one input:
   * `<push DER-sig+hashtypeByte> <push 33-byte compressed pubkey>`.
   *
   * `sighash` is the 32-byte double-SHA256 (`hash256`) of the sighash
   * preimage. Implementations MUST sign these bytes raw — adding another hash
   * produces never-valid signatures. Signatures MUST be low-S and use
   * `sighashType` (`SIGHASH_ALL | SIGHASH_FORKID`); the script interpreter
   * (`Spend.validate`) rejects anything else.
   */
  signInput: (
    sighash: number[],
    sighashType: number,
    derivationPrefix: string,
    derivationSuffix: string,
    unlockerPubKey: PublicKey
  ) => Promise<number[]>

  /**
   * Optional pre-signing hook, called once per action with the full unsigned
   * transaction and every pending input BEFORE any signInput call. Lets a
   * remote/MPC cosigner recompute expected sighashes from real transaction
   * data and refuse blind-signing. Local providers omit it.
   */
  prepareSpendContexts?: (tx: Transaction, pendingInputs: PendingStorageInput[]) => Promise<void>

  /** The wallet identity public key (root public key). */
  identityPublicKey: () => PublicKey
}
