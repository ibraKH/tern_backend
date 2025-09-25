FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim AS migrate
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev --omit=optional
COPY migrations ./migrations
COPY database.json ./
ENTRYPOINT ["npx","node-pg-migrate"]
CMD ["up","-m","migrations","-f","database.json","--config-value","dev"]

FROM node:20-bookworm-slim AS dev
WORKDIR /app
COPY package*.json ./
RUN npm ci                     
COPY tsconfig.json ./
ENV NODE_ENV=development
CMD ["npx","nodemon","--watch","src","--ext","ts,js,json","--exec","ts-node","src/index.ts"]

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node","dist/index.js"]