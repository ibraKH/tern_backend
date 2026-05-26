FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS migrate
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --omit=optional
COPY migrations ./migrations
COPY database.json ./
ENTRYPOINT ["/app/node_modules/.bin/node-pg-migrate"]
CMD ["up","-m","migrations","-f","database.json","--config-value","production"]

FROM node:22-bookworm-slim AS dev
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
ENV NODE_ENV=development
CMD ["npx","nodemon","--watch","src","--ext","ts,js,json","--exec","ts-node","src/index.ts"]

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY database.json ./
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"
USER appuser
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node","dist/index.js"]
