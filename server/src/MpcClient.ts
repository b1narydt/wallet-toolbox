import { createHmac } from 'node:crypto'

/**
 * Thin HTTP client for a PARAGON rust-mpc backend. TS twin of the Go
 * go-wallet-toolbox/pkg/signer/mpc Client: every request carries
 * `X-Vault-Id` and `x-mpc-caller-identity` (when configured) plus ONE
 * Authorization credential.
 *
 * Two credentials exist:
 *  - the static admin API key (`Authorization: Bearer <MPC_API_KEY>`), and
 *  - a sign-scoped session token (HMAC-SHA256 minted from
 *    MPC_SESSION_SECRET, or supplied pre-minted via MPC_SESSION_TOKEN).
 *
 * Backends differ in which routes accept which credential (deployments have
 * been observed 403-ing /createSignature on the static key). Sign-scoped
 * paths prefer the session token when one is available; on a 401/403 the
 * request is retried once with the other credential and the working choice
 * is remembered per path.
 */
export interface MpcClientOptions {
  apiKey?: string
  edgeIdentity?: string
  vaultId?: string
  /** Pre-minted session token, used as-is. */
  sessionToken?: string
  /** Hex HMAC secret; when set, sign-scoped tokens are minted and auto-refreshed. */
  sessionSecretHex?: string
}

type Credential = 'apiKey' | 'sessionToken'

/** Paths that prefer the sign-scoped session token when one is available. */
const SIGN_SCOPED_PATHS = new Set(['/createSignature'])

const SESSION_TOKEN_TTL_SECONDS = 3600
const SESSION_TOKEN_REFRESH_MARGIN_SECONDS = 60

export class MpcClient {
  private readonly baseUrl: string
  private readonly opts: MpcClientOptions
  private readonly pathCredential = new Map<string, Credential>()
  private mintedToken?: { token: string, exp: number }

  constructor (baseUrl: string, opts: MpcClientOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.opts = opts
  }

  hasSessionCredential (): boolean {
    return this.opts.sessionToken !== undefined || this.opts.sessionSecretHex !== undefined
  }

  /**
   * Mint (or return the cached / pre-supplied) sign-scoped session token.
   * Wire format matches the backend's session verifier:
   * `base64url_nopad(json({sub,scope:"sign",role:"admin",iat,exp})) + "." +
   *  base64url_nopad(hmac_sha256(secret, payload_b64))`.
   */
  private sessionToken (): string | undefined {
    if (this.opts.sessionSecretHex !== undefined) {
      const now = Math.floor(Date.now() / 1000)
      if (this.mintedToken === undefined || this.mintedToken.exp - now < SESSION_TOKEN_REFRESH_MARGIN_SECONDS) {
        const exp = now + SESSION_TOKEN_TTL_SECONDS
        const claims = { sub: 'mpc-wallet-server', scope: 'sign', role: 'admin', iat: now, exp }
        const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
        const sig = createHmac('sha256', Buffer.from(this.opts.sessionSecretHex, 'hex'))
          .update(payload)
          .digest()
          .toString('base64url')
        this.mintedToken = { token: `${payload}.${sig}`, exp }
      }
      return this.mintedToken.token
    }
    return this.opts.sessionToken
  }

  private availableCredentials (): Credential[] {
    const creds: Credential[] = []
    if (this.opts.apiKey !== undefined) creds.push('apiKey')
    if (this.hasSessionCredential()) creds.push('sessionToken')
    return creds
  }

  private headersFor (credential: Credential | undefined): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (credential === 'apiKey' && this.opts.apiKey !== undefined) {
      headers.Authorization = `Bearer ${this.opts.apiKey}`
    } else if (credential === 'sessionToken') {
      const token = this.sessionToken()
      if (token !== undefined) headers.Authorization = `Bearer ${token}`
    }
    if (this.opts.edgeIdentity !== undefined) headers['x-mpc-caller-identity'] = this.opts.edgeIdentity
    if (this.opts.vaultId !== undefined) headers['X-Vault-Id'] = this.opts.vaultId
    return headers
  }

  /** POST json(body) to `path`, returning the parsed JSON response. */
  async post<T> (path: string, body: unknown): Promise<T> {
    const creds = this.availableCredentials()
    const remembered = this.pathCredential.get(path)
    let order: Array<Credential | undefined>
    if (remembered !== undefined && creds.includes(remembered)) {
      order = [remembered, ...creds.filter(c => c !== remembered)]
    } else if (SIGN_SCOPED_PATHS.has(path) && creds.includes('sessionToken')) {
      order = ['sessionToken', ...creds.filter(c => c !== 'sessionToken')]
    } else if (creds.length > 0) {
      order = creds
    } else {
      order = [undefined] // no credential configured; edge identity headers only
    }

    let lastError: Error | undefined
    for (const credential of order) {
      const res = await fetch(this.baseUrl + path, {
        method: 'POST',
        headers: this.headersFor(credential),
        body: JSON.stringify(body)
      })
      const text = await res.text()
      if (res.ok) {
        if (credential !== undefined) this.pathCredential.set(path, credential)
        try {
          return JSON.parse(text) as T
        } catch (e) {
          throw new Error(`MPC backend returned non-JSON from ${path}: ${text.slice(0, 300)}`)
        }
      }
      lastError = new Error(`MPC backend returned ${res.status} from ${path}: ${text.slice(0, 500)}`)
      // Only auth failures are worth retrying with the other credential.
      if (res.status !== 401 && res.status !== 403) throw lastError
    }
    throw lastError ?? new Error(`MPC request to ${path} failed`)
  }
}
