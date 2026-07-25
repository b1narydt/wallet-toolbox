# mpc-wallet-server (TypeScript)

> **DEPRECATED (2026-07-24) — out of the path, do not deploy or build on.**
> Owner decision (rust-mpc#147): this was a throwaway test harness for the hosted
> WaaS birth mint, and it minted a non-canonical 3-field DID token (it passed a
> pre-built ownerSig field *and* let `PushDrop.lock`'s `includeSignature` append
> another → `[serial, ownerSig, createSig]`, which every policy-conforming cosigner
> rejects — the canonical anchor is exactly `[serial, ownerSig]`). It was removed
> from the staging environment (deployment down, endpoints 404). The WaaS/staging
> birth mint now lives in the **Paragon-desktop TS wallet-toolbox** (the client owns
> the mint; the coordinator seals via `POST /api/v1/vaults/{id}/seal`); the
> in-process Rust mint is enterprise-profile-only and is the authoritative 2-field
> format. Kept read-only as prior art for the `SigningProvider`-over-HTTP seam
> below. See rust-mpc#147 and the PARAGON project `CLAUDE.md`.

A `@bsv/wallet-toolbox` wallet run as a hosted BRC-100 HTTP server whose
crypto + signing is delegated to a remote PARAGON rust-mpc backend. TS twin
of `go-wallet-toolbox/cmd/mpc-wallet-server` — same contract:

- the toolbox owns BEEF/UTXO state (SQLite on a local volume) and the full
  BRC-100 surface;
- every key derivation, signature, HMAC and encrypt op is delegated to the
  MPC signer over HTTP;
- the wallet holds NO private key share.

Wire surface mirrors the `@bsv/sdk` `HTTPWalletJSON` convention:
`POST /<method>` with `json(args)` + an `Originator` header, BRC-100
number-array byte encoding. A stock `WalletClient(new HTTPWalletJSON(...))`
or curl can drive it.

## How it plugs into the toolbox

- `RemoteMpcSigningProvider` (implements the toolbox `SigningProvider` seam):
  change-script derivation via `POST /getPublicKey` (BRC-29,
  counterparty=`self`, `forSelf:true`) and raw-sighash input signing via
  `POST /createSignature` (`hashToDirectlySign`, DER back, low-S enforced).
- `MpcProtoWallet` replaces the Wallet's internal local-key `ProtoWallet`:
  getPublicKey / encrypt / decrypt / createHmac / verifyHmac /
  createSignature / verifySignature / reveal*KeyLinkage are pass-through
  POSTs to the backend (which speaks the same wire shapes).
- `RemoteKeyDeriver` carries the vault identity for storage auth; every
  local derive/reveal throws (no key material in-process). Known limit:
  `internalizeAction` "wallet payment" (needs local `derivePrivateKey`) is
  unavailable; "basket insertion" works.
- Storage: toolbox `StorageKnex` on better-sqlite3 at `MPC_WALLET_DB`,
  migrated + authenticated as the vault identity.

## Env (mirrors the Go server)

| Var | Meaning | Default |
| --- | --- | --- |
| `MPC_BACKEND_URL` | rust-mpc backend (required) | — |
| `MPC_API_KEY` | `Authorization: Bearer <key>` | — |
| `MPC_EDGE_IDENTITY` | `x-mpc-caller-identity` header | — |
| `MPC_VAULT_ID` | `X-Vault-Id` header | — |
| `MPC_WALLET_NETWORK` | `main` \| `test` | `main` |
| `MPC_WALLET_DB` | sqlite path | `./mpc-wallet.sqlite` |
| `MPC_WALLET_LISTEN` | listen addr | `:3322` |
| `MPC_SESSION_SECRET` | hex HMAC secret; mints sign-scoped session tokens locally (auto-refresh) | — |
| `MPC_SESSION_TOKEN` | pre-minted session token (used as-is) | — |

Auth: sign-scoped paths (`/createSignature`) prefer the session token when
one is configured; on 401/403 the client retries once with the other
credential and remembers what worked per path.

## Build & run

```bash
# toolbox first (from repo root)
npm ci && npm run build
# then the server
cd server && npm install && npm run build
MPC_BACKEND_URL=... MPC_API_KEY=... MPC_VAULT_ID=... npm start
```

Docker: see `Dockerfile` (build context = repo root):
`docker build -f server/Dockerfile -t mpc-wallet-server .`

## Smoke

```bash
curl localhost:3322/health
curl -X POST localhost:3322/getPublicKey -H 'Content-Type: application/json' \
  -H 'Originator: example.com' -d '{"identityKey":true}'
curl -X POST localhost:3322/createSignature -H 'Content-Type: application/json' \
  -H 'Originator: example.com' \
  -d '{"protocolID":[2,"smoke test"],"keyID":"k1","counterparty":"self","hashToDirectlySign":[/* 32 bytes */]}'
```
