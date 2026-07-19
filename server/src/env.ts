/**
 * Environment configuration for mpc-wallet-server. Mirrors the Go reference
 * (go-wallet-toolbox/cmd/mpc-wallet-server/main.go) env names exactly:
 *
 *   MPC_BACKEND_URL       (required)  e.g. https://backend-production-35884.up.railway.app
 *   MPC_API_KEY                       Authorization: Bearer <key>  (apikey-mode backend)
 *   MPC_EDGE_IDENTITY                 x-mpc-caller-identity header (edge-mode backend)
 *   MPC_VAULT_ID                      X-Vault-Id header            e.g. stagingheal05
 *   MPC_WALLET_NETWORK                main | test                  (default main)
 *   MPC_WALLET_DB                     sqlite path                  (default ./mpc-wallet.sqlite)
 *   MPC_WALLET_LISTEN                 listen addr                  (default :3322)
 *
 * TS additions for the sign-scoped session-token auth path:
 *
 *   MPC_SESSION_TOKEN                 pre-minted session token (used as-is; cannot re-mint)
 *   MPC_SESSION_SECRET                hex HMAC secret (MPC_SESSION_SIGNING_SECRET on the
 *                                     backend). When set, sign-scoped tokens are minted
 *                                     locally and refreshed before expiry.
 */
export interface ServerConfig {
  backendUrl: string
  apiKey?: string
  edgeIdentity?: string
  vaultId?: string
  network: 'main' | 'test'
  dbPath: string
  listenHost: string
  listenPort: number
  sessionToken?: string
  sessionSecretHex?: string
}

function envOr (key: string, def: string): string {
  const v = (process.env[key] ?? '').trim()
  return v !== '' ? v : def
}

function envOpt (key: string): string | undefined {
  const v = (process.env[key] ?? '').trim()
  return v !== '' ? v : undefined
}

export function loadConfig (): ServerConfig {
  const backendUrl = envOpt('MPC_BACKEND_URL')
  if (backendUrl === undefined) {
    throw new Error('MPC_BACKEND_URL is required (the MPC signer backend)')
  }

  const network = envOr('MPC_WALLET_NETWORK', 'main')
  if (network !== 'main' && network !== 'test') {
    throw new Error(`MPC_WALLET_NETWORK must be "main" or "test", got "${network}"`)
  }

  // Go-style listen addr: ":3322", "0.0.0.0:3322" or a bare port.
  const listen = envOr('MPC_WALLET_LISTEN', ':3322')
  let listenHost = '0.0.0.0'
  let listenPort: number
  if (listen.includes(':')) {
    const idx = listen.lastIndexOf(':')
    const host = listen.slice(0, idx)
    if (host !== '') listenHost = host
    listenPort = Number(listen.slice(idx + 1))
  } else {
    listenPort = Number(listen)
  }
  if (!Number.isInteger(listenPort) || listenPort <= 0 || listenPort > 65535) {
    throw new Error(`MPC_WALLET_LISTEN has an invalid port: "${listen}"`)
  }

  return {
    backendUrl: backendUrl.replace(/\/+$/, ''),
    apiKey: envOpt('MPC_API_KEY'),
    edgeIdentity: envOpt('MPC_EDGE_IDENTITY'),
    vaultId: envOpt('MPC_VAULT_ID'),
    network,
    dbPath: envOr('MPC_WALLET_DB', './mpc-wallet.sqlite'),
    listenHost,
    listenPort,
    sessionToken: envOpt('MPC_SESSION_TOKEN'),
    sessionSecretHex: envOpt('MPC_SESSION_SECRET')
  }
}
