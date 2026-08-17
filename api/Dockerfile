# HEYRAH api — Express + TypeScript (Node.js)
# Build context is the repository root (npm workspaces: one lockfile at the root).
FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci --workspace api --include-workspace-root=false

COPY api api
WORKDIR /app/api
RUN npx prisma generate && npm run build

ENV NODE_ENV=production
RUN mkdir -p /app/api/uploads && chown -R node:node /app/api/uploads
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --retries=6 CMD wget -qO- http://127.0.0.1:4000/healthz || exit 1
# Apply pending migrations (never `migrate dev`/`reset`), then start; exec so
# the Node process receives SIGTERM directly for graceful shutdown.
# Seeding is a dev/demo step, never automatic.
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/server.js"]
