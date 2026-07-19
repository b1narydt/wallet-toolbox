import { Curve, P2PKH, PublicKey, Signature, UnlockingScript } from '@bsv/sdk'
import type { SigningProvider } from '@bsv/wallet-toolbox'
import { MpcClient } from './MpcClient'

/** BRC-29 protocol identifier: [2, '3241645161d8'] (EveryAppAndCounterparty). */
const brc29ProtocolID: [0 | 1 | 2, string] = [2, '3241645161d8']

interface GetPublicKeyResponse { publicKey: string }
interface CreateSignatureResponse { signature: number[] }

/**
 * SigningProvider backed by a remote PARAGON rust-mpc backend. The wallet
 * holds NO private key share: change-script derivation and input signing are
 * network calls that return derived public keys and DER signatures.
 *
 * TS twin of the Go MpcSigningProvider/MpcUnlocker
 * (go-wallet-toolbox/pkg/signer/mpc/provider.go): same protocol mapping
 * (BRC-29 [2,"3241645161d8"]), same keyID shape ("<prefix> <suffix>"), same
 * counterparty conventions ("self" for change scripts, the unlocker/sender
 * identity key for input signing, always forSelf=true for our own keys).
 */
export class RemoteMpcSigningProvider implements SigningProvider {
  private readonly identityKeyHex: string
  private readonly client: MpcClient
  /** derived-pubkey cache, keyed `${keyID}|${counterparty}` (mirrors MpcUnlocker.cachedPub) */
  private readonly pubKeyCache = new Map<string, PublicKey>()

  private constructor (client: MpcClient, identityKeyHex: string) {
    this.client = client
    this.identityKeyHex = identityKeyHex
  }

  /**
   * Eagerly fetches the vault identity key from the backend — this doubles as
   * the startup liveness check (mirrors Go NewMpcSigningProvider).
   */
  static async create (client: MpcClient): Promise<RemoteMpcSigningProvider> {
    const { publicKey } = await client.post<GetPublicKeyResponse>('/getPublicKey', { identityKey: true })
    // Parse to validate; keep the hex as canonical.
    PublicKey.fromString(publicKey)
    return new RemoteMpcSigningProvider(client, publicKey)
  }

  identityPublicKey (): PublicKey {
    return PublicKey.fromString(this.identityKeyHex)
  }

  identityKeyHexString (): string {
    return this.identityKeyHex
  }

  /**
   * Derive the BRC-29 change output locking script (25-byte P2PKH) from the
   * backend-derived public key (counterparty="self", forSelf=true — the key
   * createSignature will later sign with).
   */
  async deriveChangeLockingScript (derivationPrefix: string, derivationSuffix: string): Promise<number[]> {
    const keyID = `${derivationPrefix} ${derivationSuffix}`
    const pub = await this.derivedPublicKey(keyID, 'self')
    return new P2PKH().lock(pub.toAddress()).toBinary()
  }

  /**
   * Produce the COMPLETE P2PKH unlocking script for one input:
   * `<push DER-sig+hashtypeByte> <push 33-byte compressed pubkey>`.
   * The 32-byte sighash is signed RAW by the backend (hashToDirectlySign).
   */
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
    const counterparty = unlockerPubKey.toString()

    const { signature } = await this.client.post<CreateSignatureResponse>('/createSignature', {
      protocolID: brc29ProtocolID,
      keyID,
      counterparty,
      hashToDirectlySign: sighash
    })
    if (!Array.isArray(signature) || signature.length === 0 || signature[0] !== 0x30) {
      throw new Error('MPC backend returned an invalid DER signature')
    }
    const der = normalizeLowS(signature)

    const pub = await this.derivedPublicKey(keyID, counterparty)
    const pubkeyForScript = pub.encode(true) as number[]
    if (pubkeyForScript.length !== 33) {
      throw new Error(`unexpected compressed public key length ${pubkeyForScript.length}, want 33`)
    }

    const sigForScript = [...der, sighashType & 0xff]
    return new UnlockingScript([
      { op: sigForScript.length, data: sigForScript },
      { op: pubkeyForScript.length, data: pubkeyForScript }
    ]).toBinary()
  }

  /** Fetch (and cache) the wallet's own derived key for keyID/counterparty (forSelf=true). */
  private async derivedPublicKey (keyID: string, counterparty: string): Promise<PublicKey> {
    const cacheKey = `${keyID}|${counterparty}`
    const cached = this.pubKeyCache.get(cacheKey)
    if (cached !== undefined) return cached
    const { publicKey } = await this.client.post<GetPublicKeyResponse>('/getPublicKey', {
      protocolID: brc29ProtocolID,
      keyID,
      counterparty,
      forSelf: true
    })
    const pub = PublicKey.fromString(publicKey)
    this.pubKeyCache.set(cacheKey, pub)
    return pub
  }
}

/**
 * Re-encode a DER signature enforcing low-S. The backend is expected to
 * return low-S already; this is cheap insurance because Spend.validate
 * rejects high-S outright.
 */
function normalizeLowS (der: number[]): number[] {
  const sig = Signature.fromDER(der)
  const curve = new Curve()
  if (sig.s.cmp(curve.n.shrn(1)) > 0) {
    sig.s = curve.n.sub(sig.s)
  }
  return sig.toDER() as number[]
}
