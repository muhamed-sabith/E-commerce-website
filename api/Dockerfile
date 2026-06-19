# HEYRAH api — Express + TypeScript (Node.js)
FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
RUN npx prisma generate

COPY . .
RUN npm run build

EXPOSE 4000
CMD ["node", "dist/server.js"]
