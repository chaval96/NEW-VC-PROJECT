FROM node:22-bookworm-slim AS build
WORKDIR /app

# Install dependencies and build once.
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build


# Runtime image with browser execution support.
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_GLOBAL_MODULE_PATH=/usr/local/lib/node_modules/playwright

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates wget dumb-init \
  && rm -rf /var/lib/apt/lists/*

# Install Playwright globally and provision Chromium + system deps.
RUN npm install -g playwright@1.52.0 \
  && npx playwright install --with-deps chromium

# Security: non-root runtime user.
RUN addgroup --system vcreach \
  && adduser --system --ingroup vcreach --home /home/vcreach vcreach

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/server/db ./server/db
COPY --from=build /app/public ./public

# Ensure runtime write access for JSON state and evidence screenshots.
RUN mkdir -p /app/server/data/evidence \
  && chown -R vcreach:vcreach /app /home/vcreach

USER vcreach

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8787/api/health || exit 1

CMD ["dumb-init", "node", "dist-server/server/index.js"]
