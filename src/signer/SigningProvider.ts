import { PublicKey, Transaction } from '@bsv/sdk'
import type { PendingStorageInput } from '../Wallet'

/**
 * Delegation seam for transaction-input signing and change locking-script
 * derivation. Required members mirror the Rust reference trait
 * (rust-wallet-toolbox src/signer/signing_provider.rs) 1:1 so provider
 * implementations port across the two stacks.
 * `deriveWalletPaymentLockingScript` is optional in TS and maps to the Rust
 * trait's defaulted method (`Ok(None)` = not delegated); until upstream
 * `bsv-wallet-toolbox` releases the trait addition (tracked in
 * https://github.com/b1narydt/rust-wallet-toolbox/issues/31), this member is a
 * fork-side extension.
 *
 * Scope: BRC-29/SABPPP change-input signing, change-output locking scripts,
 * and internalize-action wallet-payment script verification ONLY. Identity
 * keys, BRC-2 encrypt/decrypt, HMAC and certificates never route through this
 * interface.
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

  /**
   * OPTIONAL. Derive the expected BRC-29 P2PKH locking script for an INCOMING
   * wallet-payment output (internalizeAction verification). Counterparty is the
   * SENDER's identity key; the derivation is for self (the receiver's own child
   * key), so implementations need public-key data only.
   * When absent, internalizeAction falls back to the legacy local
   * keyDeriver.derivePrivateKey path unchanged.
   */
  deriveWalletPaymentLockingScript?: (
    derivationPrefix: string,
    derivationSuffix: string,
    senderIdentityKey: string
  ) => Promise<number[]>
}
