import { Hash, PublicKey, Script, Transaction, TransactionSignature, UnlockingScript } from '@bsv/sdk'
import { SigningProvider } from './SigningProvider'

/**
 * Bridges the sdk's duck-typed unlocking-script-template contract
 * (Transaction.sign() awaits template.sign(tx, i)) to a SigningProvider.
 * Preimage construction mirrors P2PKH.unlock() exactly; the provider receives
 * hash256(preimage) — the raw 32-byte digest, hashed exactly twice total —
 * and returns the complete unlocking script bytes.
 */
export function makeProviderUnlockTemplate (
  provider: SigningProvider,
  derivationPrefix: string,
  derivationSuffix: string,
  unlockerPubKey: PublicKey,
  sourceSatoshis: number,
  lockingScript: Script
): {
    sign: (tx: Transaction, inputIndex: number) => Promise<UnlockingScript>
    estimateLength: () => Promise<108>
  } {
  return {
    sign: async (tx: Transaction, inputIndex: number) => {
      const signatureScope = TransactionSignature.SIGHASH_FORKID | TransactionSignature.SIGHASH_ALL
      const input = tx.inputs[inputIndex]
      const otherInputs = tx.inputs.filter((_, index) => index !== inputIndex)
      const sourceTXID = input.sourceTXID ?? input.sourceTransaction?.id('hex')
      if (sourceTXID == null || sourceTXID === '') {
        throw new Error('The input sourceTXID or sourceTransaction is required for transaction signing.')
      }
      const preimage = TransactionSignature.format({
        sourceTXID,
        sourceOutputIndex: input.sourceOutputIndex,
        sourceSatoshis,
        transactionVersion: tx.version,
        otherInputs,
        inputIndex,
        outputs: tx.outputs,
        inputSequence: input.sequence ?? 0xffffffff,
        subscript: lockingScript,
        lockTime: tx.lockTime,
        scope: signatureScope
      })
      const sighash = Hash.hash256(preimage)
      let scriptBytes: number[]
      try {
        scriptBytes = await provider.signInput(
          sighash,
          signatureScope,
          derivationPrefix,
          derivationSuffix,
          unlockerPubKey
        )
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        throw new Error(`SigningProvider.signInput failed for input ${inputIndex} of ${sourceTXID}: ${msg}`)
      }
      return UnlockingScript.fromBinary(scriptBytes)
    },
    estimateLength: async () => 108
  }
}
