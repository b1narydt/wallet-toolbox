import { MpcClient } from './MpcClient'

/**
 * BRC-100 crypto surface delegated to the rust-mpc backend. TS twin of the Go
 * MpcProtoWallet (go-wallet-toolbox/pkg/signer/mpc/proto_wallet.go).
 *
 * The rust-mpc backend IS a BRC-100 wallet server speaking the exact
 * HTTPWalletJSON wire shapes (number-array bytes, protocolID tuples,
 * counterparty as "self"/"anyone"/hex), so every method is a pass-through
 * POST of the args to the backend's matching route. This object replaces the
 * toolbox Wallet's internal `proto` (a local-key ProtoWallet), so
 * getPublicKey / encrypt / decrypt / createHmac / verifyHmac /
 * createSignature / verifySignature / reveal*KeyLinkage all route to MPC and
 * no local key is ever used.
 */
export class MpcProtoWallet {
  constructor (private readonly client: MpcClient) {}

  private async call<T> (method: string, args: object): Promise<T> {
    return await this.client.post<T>(`/${method}`, args ?? {})
  }

  async getPublicKey (args: object): Promise<{ publicKey: string }> {
    return await this.call('getPublicKey', args)
  }

  async encrypt (args: object): Promise<{ ciphertext: number[] }> {
    return await this.call('encrypt', args)
  }

  async decrypt (args: object): Promise<{ plaintext: number[] }> {
    return await this.call('decrypt', args)
  }

  async createHmac (args: object): Promise<{ hmac: number[] }> {
    return await this.call('createHmac', args)
  }

  async verifyHmac (args: object): Promise<{ valid: boolean }> {
    return await this.call('verifyHmac', args)
  }

  async createSignature (args: object): Promise<{ signature: number[] }> {
    return await this.call('createSignature', args)
  }

  async verifySignature (args: object): Promise<{ valid: boolean }> {
    return await this.call('verifySignature', args)
  }

  async revealCounterpartyKeyLinkage (args: object): Promise<object> {
    return await this.call('revealCounterpartyKeyLinkage', args)
  }

  async revealSpecificKeyLinkage (args: object): Promise<object> {
    return await this.call('revealSpecificKeyLinkage', args)
  }
}
