# Build context is the repo root (pnpm workspace), not ./server.
# Build with: docker build -f server/Dockerfile .

# ---- Build stage ----
FROM node:24-alpine AS builder
RUN corepack enable
WORKDIR /repo

# Install dependencies for just the server package (incl. dev deps for tsc).
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY server/package.json ./server/package.json
RUN pnpm install --frozen-lockfile --filter @spectre/server...

# Build.
COPY server ./server
RUN pnpm --filter @spectre/server run build

# Produce a self-contained, production-only deployment in /app.
RUN pnpm --filter @spectre/server deploy --legacy --prod /app

# ---- Runtime stage ----
FROM node:24-alpine
WORKDIR /app

ARG VERSION
ENV SPECTRE_SERVER_VERSION=$VERSION
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

EXPOSE 8080

CMD ["node", "dist/server.js"]
