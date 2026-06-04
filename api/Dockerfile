FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY package*.json ./
ENV NODE_ENV=production
EXPOSE 4100
CMD ["node", "src/server.js"]
