FROM node:22-alpine AS build
WORKDIR /app

# Install dependencies first (layer caching optimization)
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# Copy source and build
COPY . .
RUN npm run build

# ── Production runtime ────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

# Security: run as non-root user
RUN addgroup -S vcreach && adduser -S vcreach -G vcreach

ENV NODE_ENV=production

# Copy only production artifacts
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/server/db ./server/db

# Switch to non-root user
USER vcreach

EXPOSE 8787

# Health check: verify the API responds
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8787/api/health || exit 1

CMD ["node", "dist-server/server/index.js"]
