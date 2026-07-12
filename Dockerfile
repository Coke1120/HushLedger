# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build:cloudflare

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV CI=true \
    NODE_ENV=production

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.open-next ./.open-next
COPY --from=build --chown=node:node /app/custom-worker.ts ./custom-worker.ts
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/tsconfig.json ./tsconfig.json
COPY --from=build --chown=node:node /app/wrangler.jsonc ./wrangler.jsonc
COPY --from=build --chown=node:node /app/migrations ./migrations
COPY --from=build --chown=node:node /app/src/lib ./src/lib
COPY --from=build --chown=node:node /app/worker ./worker

RUN mkdir /data && chown node:node /app /data

USER node

EXPOSE 8787
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["sh", "-c", "./node_modules/.bin/wrangler d1 migrations apply hushledger --local --persist-to=/data && exec ./node_modules/.bin/wrangler dev --local --ip=0.0.0.0 --port=8787 --persist-to=/data"]
