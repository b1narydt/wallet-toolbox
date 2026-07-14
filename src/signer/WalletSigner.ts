import { KeyDeriverApi } from '@bsv/sdk'
import { WalletStorageManager } from '../storage/WalletStorageManager'
import { Chain } from '../sdk/types'
import type { SigningProvider } from './SigningProvider'

export class WalletSigner {
  isWalletSigner: true = true

  chain: Chain
  keyDeriver: KeyDeriverApi
  storage: WalletStorageManager
  signingProvider?: SigningProvider

  constructor (chain: Chain, keyDeriver: KeyDeriverApi, storage: WalletStorageManager, signingProvider?: SigningProvider) {
    this.chain = chain
    this.keyDeriver = keyDeriver
    this.storage = storage
    this.signingProvider = signingProvider
  }
}
