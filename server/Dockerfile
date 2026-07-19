# mpc-wallet-server — hosted BRC-100 HTTP wallet, signing delegated to the
# PARAGON rust-mpc backend. Build context is the wallet-toolbox REPO ROOT
# (the server needs the toolbox built from source):
#
#   cd wallet-toolbox && docker build -f server/Dockerfile -t mpc-wallet-server .
#
# Run (staging example):
#
#   docker run -p 3322:3322 -v mpc-wallet-data:/data \
#     -e MPC_BACKEND_URL=https://backend-production-35884.up.railway.app \
#     -e MPC_API_KEY=... -e MPC_EDGE_IDENTITY=... -e MPC_VAULT_ID=stagingheal05 \
#     -e MPC_SESSION_SECRET=... \
#     mpc-wallet-server

FROM node:20-slim AS build
WORKDIR /toolbox

# better-sqlite3 compiles a native addon via node-gyp — slim lacks the toolchain.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# ── toolbox: install + compile (out/src is what the server links against) ──
COPY package.json package-lock.json tsconfig.json tsconfig.all.json ./
COPY src ./src
# --ignore-scripts skips the toolbox's `prepublish` hook (a full root `tsc --build`
# that references the client/mobile projects we don't ship) AND better-sqlite3's
# native build — so rebuild that one addon explicitly (toolchain is present above).
RUN npm ci --ignore-scripts && npm rebuild better-sqlite3
# Build ONLY the main library (out/src/index.js) — not client/mobile.
RUN npx tsc --build tsconfig.all.json

# ── server: nested package, depends on the toolbox via file:.. ─────────────
WORKDIR /toolbox/server
COPY server/package.json server/tsconfig.json ./
RUN npm install --no-package-lock
COPY server/src ./src
RUN npm run build

# ── runtime ────────────────────────────────────────────────────────────────
FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /toolbox
COPY --from=build /toolbox ./
WORKDIR /toolbox/server

# SQLite BEEF/UTXO state lives at /data (attach a Railway Volume here for
# persistence; ephemeral otherwise). Railway rejects the Dockerfile VOLUME
# directive, so just ensure the dir exists.
RUN mkdir -p /data
ENV MPC_WALLET_DB=/data/mpc-wallet.sqlite
ENV MPC_WALLET_LISTEN=:3322
EXPOSE 3322

CMD ["node", "out/src/server.js"]
