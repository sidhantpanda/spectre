FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.29.4-alpine

ARG VERSION
ENV SPECTRE_WEB_UI_VERSION=$VERSION

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /docker-entrypoint.d/99-env.sh
COPY --from=build /app/dist /usr/share/nginx/html

RUN chmod +x /docker-entrypoint.d/99-env.sh

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
