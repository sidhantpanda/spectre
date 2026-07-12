# Build context is the repo root (pnpm workspace), not ./web-ui.
# Build with: docker build -f web-ui/Dockerfile .

# ---- Build stage ----
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY web-ui/package.json ./web-ui/package.json
RUN pnpm install --frozen-lockfile --filter @spectre/web-ui...

COPY web-ui ./web-ui
RUN pnpm --filter @spectre/web-ui run build

# ---- Runtime stage ----
FROM nginx:1.29.4-alpine

ARG VERSION
ENV SPECTRE_WEB_UI_VERSION=$VERSION

COPY web-ui/nginx.conf /etc/nginx/conf.d/default.conf
COPY web-ui/docker-entrypoint.sh /docker-entrypoint.d/99-env.sh
COPY --from=build /repo/web-ui/dist /usr/share/nginx/html

RUN chmod +x /docker-entrypoint.d/99-env.sh

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
