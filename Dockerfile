# agentic-prezi control-plane (#1 skeleton) — runs the Node app behind the box's
# existing Coolify/Traefik proxy. NO bundler, NO npm deps (stdlib only, per #0):
# Node 26 type-strips the TypeScript at runtime (`node src/server.ts`).
#
# This image intentionally does NOT include a reverse proxy / TLS. On the target box,
# Coolify's Traefik owns :80/:443 and terminates TLS; this container just listens on
# $PORT on the internal Docker network and Traefik routes the Host to it.
#
# Pin the base by digest at deploy time (Coolify lets you set the exact tag/digest).
# `node:26-bookworm-slim` is Debian-based so node:sqlite's bundled SQLite works flag-free.
FROM node:26-bookworm-slim

# Non-root: the app never needs root. Coolify/Traefik handle privileged networking.
ENV NODE_ENV=production
WORKDIR /app

# Copy only what runs (see .dockerignore). Zero runtime npm deps, so there is no
# `npm ci` step — nothing to install. .npmrc is copied so any *future* dep install
# inherits the supply-chain gate (ignore-scripts, before=, save-exact).
COPY .npmrc package.json ./
COPY src ./src
COPY public ./public

# Writable data dir for the SQLite db + published artifacts. Mount a named volume
# here in Coolify so data survives redeploys: /app/data  ->  persistent volume.
RUN mkdir -p /app/data && chown -R node:node /app
USER node

ENV PORT=8787 \
    DATA_DIR=/app/data \
    DB_PATH=/app/data/app.db \
    PUBLIC_DIR=/app/public
EXPOSE 8787

# Healthcheck: the SPA index is served unauthenticated at / and returns 200.
# Pure stdlib node one-liner — no curl/wget dependency required in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.ts"]
