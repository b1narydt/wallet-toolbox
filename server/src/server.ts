/**
 * mpc-wallet-server — a @bsv/wallet-toolbox wallet as a hosted BRC-100 HTTP
 * server whose crypto + signing is delegated to a remote PARAGON rust-mpc
 * backend. TS twin of go-wallet-toolbox/cmd/mpc-wallet-server.
 *
 * The toolbox owns BEEF/UTXO state (SQLite on a local volume) and the full
 * BRC-100 surface; every key derivation, signature, HMAC and encrypt op is
 * delegated to the MPC signer over HTTP. The wallet holds NO private key
 * share.
 *
 * Wire surface mirrors the @bsv/sdk HTTPWalletJSON client convention:
 * POST /<method> with json(args) + an `Originator` header, BRC-100
 * number-array byte encoding. A stock WalletClient(HTTPWalletJSON) or curl
 * can drive it.
 *
 * Config (env): see env.ts — MPC_BACKEND_URL (required), MPC_API_KEY,
 * MPC_EDGE_IDENTITY, MPC_VAULT_ID, MPC_WALLET_NETWORK, MPC_WALLET_DB,
 * MPC_WALLET_LISTEN, plus MPC_SESSION_TOKEN / MPC_SESSION_SECRET for the
 * sign-scoped auth path.
 */
import express, { Request, Response } from 'express'
import { Wallet } from '@bsv/wallet-toolbox'
import { loadConfig } from './env'
import { buildWallet } from './buildWallet'

/**
 * The BRC-100 methods exposed over POST /<method>, mirroring the Go server's
 * route table exactly.
 */
const WALLET_METHODS = [
  // Crypto surface (delegated to MPC).
  'getPublicKey',
  'createSignature',
  'verifySignature',
  'createHmac',
  'verifyHmac',
  'encrypt',
  'decrypt',
  'revealCounterpartyKeyLinkage',
  'revealSpecificKeyLinkage',
  // Action / output surface (BEEF-managed locally, signed via MPC).
  'createAction',
  'signAction',
  'abortAction',
  'listActions',
  'internalizeAction',
  'listOutputs',
  'relinquishOutput',
  // Info surface.
  'getNetwork',
  'getHeight',
  'getVersion',
  'isAuthenticated',
  'getHeaderForHeight'
] as const

async function main (): Promise<void> {
  const cfg = loadConfig()
  console.log(`mpc-wallet-server starting: backend=${cfg.backendUrl} network=${cfg.network} db=${cfg.dbPath}`)

  const { wallet, vaultIdentity } = await buildWallet(cfg)
  console.log(`MPC signer reachable: vaultIdentity=${vaultIdentity}`)

  const app = express()
  app.use(express.json({ limit: '64mb' }))

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      vaultIdentity,
      backend: cfg.backendUrl,
      network: cfg.network
    })
  })

  for (const method of WALLET_METHODS) {
    app.post(`/${method}`, (req: Request, res: Response) => {
      const originator = req.header('Originator') ?? undefined
      const args = req.body ?? {}
      if (method !== 'getHeight' && method !== 'isAuthenticated') {
        console.log(`request: POST /${method} originator=${originator ?? ''}`)
      }
      const fn = (wallet as unknown as Record<string, (a: unknown, o?: string) => Promise<unknown>>)[method]
      fn.call(wallet, args, originator)
        .then(result => res.json(result))
        .catch((e: unknown) => {
          const err = e as { message?: string, code?: number, isError?: boolean }
          console.error(`error: POST /${method}: ${err.message ?? String(e)}`)
          res.status(500).json({
            status: 'error',
            code: 500,
            message: err.message ?? String(e)
          })
        })
    })
  }

  const server = app.listen(cfg.listenPort, cfg.listenHost, () => {
    console.log(`mpc-wallet-server listening on ${cfg.listenHost}:${cfg.listenPort}`)
  })

  const shutdown = (): void => {
    console.log('shutting down')
    server.close(() => {
      wallet.destroy().finally(() => process.exit(0))
    })
    // Hard-exit fallback if close hangs.
    setTimeout(() => process.exit(0), 5000).unref()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch(e => {
  console.error(`fatal: ${e instanceof Error ? e.stack ?? e.message : String(e)}`)
  process.exit(1)
})
