import { KeyDeriverApi, PrivateKey, PublicKey, SymmetricKey, WalletProtocol } from '@bsv/sdk'

type Counterparty = PublicKey | string

/**
 * KeyDeriverApi stand-in for a wallet that holds NO private key.
 *
 * The toolbox Wallet constructor requires a keyDeriver whose identityKey
 * matches the storage auth identity; here that identity is the MPC vault's
 * identity key. `rootKey` is a throwaway random key used ONLY for cosmetic
 * internals that never leave the process (beef "userParty" naming) — it is
 * NOT the wallet key and nothing is ever signed with it: signing goes
 * through RemoteMpcSigningProvider and the crypto surface through
 * MpcProtoWallet, both of which delegate to the MPC backend.
 *
 * Every derive/reveal method throws: any code path that would require local
 * key material is a bug in this deployment mode. Known consequence:
 * internalizeAction "wallet payment" (which verifies the BRC-29 lock via
 * keyDeriver.derivePrivateKey) is unavailable; "basket insertion" works.
 */
export class RemoteKeyDeriver implements KeyDeriverApi {
  readonly rootKey: PrivateKey
  readonly identityKey: string

  constructor (vaultIdentityKeyHex: string) {
    this.rootKey = PrivateKey.fromRandom()
    this.identityKey = vaultIdentityKeyHex
  }

  private unavailable (op: string): never {
    throw new Error(
      `RemoteKeyDeriver.${op}: local key derivation is not available — ` +
      'this wallet holds no key material; all key operations are delegated to the MPC backend'
    )
  }

  derivePublicKey (_protocolID: WalletProtocol, _keyID: string, _counterparty: Counterparty, _forSelf?: boolean): PublicKey {
    this.unavailable('derivePublicKey')
  }

  derivePrivateKey (_protocolID: WalletProtocol, _keyID: string, _counterparty: Counterparty): PrivateKey {
    this.unavailable('derivePrivateKey')
  }

  deriveSymmetricKey (_protocolID: WalletProtocol, _keyID: string, _counterparty: Counterparty): SymmetricKey {
    this.unavailable('deriveSymmetricKey')
  }

  revealCounterpartySecret (_counterparty: Counterparty): number[] {
    this.unavailable('revealCounterpartySecret')
  }

  revealSpecificSecret (_counterparty: Counterparty, _protocolID: WalletProtocol, _keyID: string): number[] {
    this.unavailable('revealSpecificSecret')
  }
}
