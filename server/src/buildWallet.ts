import {
  Services,
  Setup,
  StorageKnex,
  Wallet,
  WalletStorageManager
} from '@bsv/wallet-toolbox'
import { MpcClient } from './MpcClient'
import { MpcProtoWallet } from './MpcProtoWallet'
import { RemoteKeyDeriver } from './RemoteKeyDeriver'
import { RemoteMpcSigningProvider } from './RemoteMpcSigningProvider'
import { ServerConfig } from './env'

export interface BuiltWallet {
  wallet: Wallet
  vaultIdentity: string
  storage: WalletStorageManager
  activeStorage: StorageKnex
}

/**
 * Assemble the hosted MPC wallet, mirroring the Go reference
 * (cmd/mpc-wallet-server/main.go) step for step:
 *
 *  1. MPC client → signing provider (eager identity fetch = liveness check)
 *     + delegated crypto surface (MpcProtoWallet).
 *  2. SQLite storage (the toolbox's own BEEF/UTXO state), migrated and
 *     authenticated as the MPC vault identity.
 *  3. Wallet with the MPC signing provider injected and its internal
 *     ProtoWallet replaced by the MPC-delegating one; the local keyDeriver is
 *     a throwaway that only carries the vault identity (no key material).
 */
export async function buildWallet (cfg: ServerConfig): Promise<BuiltWallet> {
  // ── 1. MPC client → signing + crypto providers ────────────────────────────
  const client = new MpcClient(cfg.backendUrl, {
    apiKey: cfg.apiKey,
    edgeIdentity: cfg.edgeIdentity,
    vaultId: cfg.vaultId,
    sessionToken: cfg.sessionToken,
    sessionSecretHex: cfg.sessionSecretHex
  })

  // Eagerly fetches the vault identity from the backend — this is also our
  // first liveness check against the MPC signer.
  const signingProvider = await RemoteMpcSigningProvider.create(client)
  const vaultIdentity = signingProvider.identityKeyHexString()

  // ── 2. SQLite storage (the toolbox's own BEEF/UTXO state) ─────────────────
  const knex = Setup.createSQLiteKnex(cfg.dbPath)
  const activeStorage = new StorageKnex({
    chain: cfg.network,
    knex,
    commissionSatoshis: 0,
    commissionPubKeyHex: undefined,
    feeModel: { model: 'sat/kb', value: 100 }
  })
  // Tie the local storage to the MPC vault identity. The storageIdentityKey
  // seeds the settings row on first migration only, so reusing the (stable)
  // vault identity keeps restarts idempotent.
  await activeStorage.migrate('mpc-wallet', vaultIdentity)
  await activeStorage.makeAvailable()

  const storage = new WalletStorageManager(vaultIdentity, activeStorage)
  await storage.makeAvailable()
  await activeStorage.findOrInsertUser(vaultIdentity)

  // ── 3. Build the wallet with MPC signing + crypto injected ────────────────
  const services = new Services(cfg.network)
  const keyDeriver = new RemoteKeyDeriver(vaultIdentity)
  const wallet = new Wallet({
    chain: cfg.network,
    keyDeriver,
    storage,
    services,
    signingProvider
  })
  // Replace the local-key ProtoWallet with the MPC-delegating crypto surface.
  // Constructed from the throwaway keyDeriver, the default proto must never
  // serve a request in this deployment mode.
  ;(wallet as unknown as { proto: unknown }).proto = new MpcProtoWallet(client)

  return { wallet, vaultIdentity, storage, activeStorage }
}
