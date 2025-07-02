ARG NODE_VERSION=22.13.0

########################################
# 1) Base: Node + pnpm + turbo on Alpine
########################################
FROM --platform=linux/amd64 node:${NODE_VERSION}-alpine AS base

# Install build tools & git
RUN apk add --no-cache libc6-compat python3 make g++ gcc git

# Install pnpm, turbo, rimraf
RUN npm install -g pnpm@9.2.0 turbo rimraf \
 && pnpm config set store-dir ~/.pnpm-store

# Ensure Node picks up ESM-interop flag
ENV NODE_OPTIONS="--experimental-require-module"

WORKDIR /app

########################################
# 2) Prune: isolate only the "app" package
########################################
FROM base AS pruner
ARG PROJECT=app

COPY . .
RUN turbo prune --scope=${PROJECT} --docker

########################################
# 3) Builder: install prod deps + build
########################################
FROM base AS builder
ARG PROJECT=app

# Copy only lockfiles & workspace layout
COPY --from=pruner /app/out/pnpm-lock.yaml    ./pnpm-lock.yaml
COPY --from=pruner /app/out/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=pruner /app/out/json              ./

# Install (cached) & prune to prod only
RUN --mount=type=cache,target=/root/.pnpm-store pnpm install --frozen-lockfile

# Copy in your isolated workspace
COPY --from=pruner /app/out/full .

# Build & strip dev files
RUN turbo run build --filter=${PROJECT} \
 && pnpm prune --prod --no-optional \
 && rm -rf **/*.ts **/*.map

########################################
# 4) Runner: minimal prod image
########################################
FROM --platform=linux/amd64 node:${NODE_VERSION}-alpine AS runner

# Drop privileges
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nodejs -G nodejs
USER nodejs

WORKDIR /app

# Copy only what's needed at runtime
COPY --from=builder --chown=nodejs:nodejs /app/node_modules          ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/packages              ./packages
COPY --from=builder --chown=nodejs:nodejs /app/apps/app/dist        ./apps/app/dist
COPY --from=builder --chown=nodejs:nodejs /app/apps/app/package.json ./apps/app/package.json

WORKDIR /app/apps/app
ENV NODE_ENV=production

EXPOSE 3000

# Exec form so flags aren't mangled
CMD ["node", "dist/main.js"]
