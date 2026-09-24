# Cloak API — production image. Build from the REPO ROOT:
#   docker build -f apps/server/Dockerfile -t cloak-api .
# Runtime config comes entirely from environment variables (see docs/DEPLOY.md).
# syntax=docker/dockerfile:1

FROM node:20-slim AS base
WORKDIR /app
# Prisma's query engine needs openssl at build and run time.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# ---- deps: install the full workspace (cached on lockfile changes) ----
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

# ---- build: generate Prisma client + bundle the server ----
FROM deps AS build
COPY . .
RUN npm --workspace @cloak/server run db:generate \
  && npm --workspace @cloak/server run build

# ---- runtime: minimal image running the bundled server ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/prisma ./apps/server/prisma
WORKDIR /app/apps/server
EXPOSE 4000
# Apply any pending migrations, then start the API. (For multi-instance
# deploys, run `npm run db:deploy` once as a release step and drop it here.)
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
