# HEYRAH web — React + Vite (TypeScript), served by a small Node server
# (server/serve.mjs) that injects route-specific SEO tags server-side and
# proxies /api, /assets/products, /sitemap.xml and /robots.txt to the API.
# Build context is the repository root (npm workspaces: one lockfile at the root).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci --workspace web --include-workspace-root=false
COPY web web
WORKDIR /app/web
# Same-origin API in production: the browser calls /api on the web origin.
ENV VITE_API_URL=""
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/web/dist ./dist
COPY web/server ./server
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:8080/healthz-web || exit 1
CMD ["node", "server/serve.mjs"]
