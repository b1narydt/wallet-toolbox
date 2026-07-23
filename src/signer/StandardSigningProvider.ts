import {
  BigNumber,
  ECDSA,
  KeyDeriverApi,
  P2PKH,
  PublicKey,
  TransactionSignature,
  UnlockingScript
} from '@bsv/sdk'
import { brc29ProtocolID } from '../utility/ScriptTemplateBRC29'
import { SigningProvider } from './SigningProvider'

/**
 * Local-key SigningProvider: derives per-input BRC-29 keys from the wallet's
 * KeyDeriver and signs in-process. Produces byte-identical results to the
 * historical ScriptTemplateBRC29 path (deterministic-k ECDSA).
 * Mirrors the Rust StandardSigningProvider (standard_provider.rs).
 */
export class StandardSigningProvider implements SigningProvider {
  constructor (public keyDeriver: KeyDeriverApi) {}

  identityPublicKey (): PublicKey {
    return this.keyDeriver.rootKey.toPublicKey()
  }

  async deriveChangeLockingScript (derivationPrefix: string, derivationSuffix: string): Promise<number[]> {
    const keyID = `${derivationPrefix} ${derivationSuffix}`
    const address = this.keyDeriver
      .derivePublicKey(brc29ProtocolID, keyID, this.keyDeriver.identityKey, false)
      .toAddress()
    return new P2PKH().lock(address).toBinary()
  }

  async deriveWalletPaymentLockingScript (
    derivationPrefix: string,
    derivationSuffix: string,
    senderIdentityKey: string
  ): Promise<number[]> {
    const keyID = `${derivationPrefix} ${derivationSuffix}`
    const address = this.keyDeriver
      .derivePublicKey(brc29ProtocolID, keyID, senderIdentityKey, true)
      .toAddress()
    return new P2PKH().lock(address).toBinary()
  }

  async signInput (
    sighash: number[],
    sighashType: number,
    derivationPrefix: string,
    derivationSuffix: string,
    unlockerPubKey: PublicKey
  ): Promise<number[]> {
    if (sighash.length !== 32) {
      throw new Error(`sighash must be 32 bytes, got ${sighash.length}`)
    }
    const keyID = `${derivationPrefix} ${derivationSuffix}`
    const derivedPrivKey = this.keyDeriver.derivePrivateKey(brc29ProtocolID, keyID, unlockerPubKey.toString())
    // Sign the digest RAW — it is already hash256(preimage). forceLowS MUST be
    // true: ECDSA.sign defaults to false and Spend.validate rejects high-S.
    const rawSignature = ECDSA.sign(new BigNumber(sighash), derivedPrivKey, true)
    const sig = new TransactionSignature(rawSignature.r, rawSignature.s, sighashType)
    const sigForScript = sig.toChecksigFormat()
    const pubkeyForScript = derivedPrivKey.toPublicKey().encode(true) as number[]
    return new UnlockingScript([
      { op: sigForScript.length, data: sigForScript },
      { op: pubkeyForScript.length, data: pubkeyForScript }
    ]).toBinary()
  }
}
