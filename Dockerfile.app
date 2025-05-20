ARG NODE_VERSION=22.11.0

# Alpine image
FROM --platform=linux/amd64 node:${NODE_VERSION}-alpine AS alpine
RUN apk update
RUN apk add --no-cache libc6-compat python3 make g++ gcc git

# Setup pnpm and turbo on the alpine base
FROM --platform=linux/amd64 alpine AS base
RUN npm install -g pnpm@9.2.0 turbo rimraf
RUN pnpm config set store-dir ~/.pnpm-store

# Prune projects
FROM --platform=linux/amd64 base AS pruner
ARG PROJECT=app

WORKDIR /app
COPY . .
RUN turbo prune --scope=${PROJECT} --docker

# Build the project
FROM --platform=linux/amd64 base AS builder
ARG PROJECT=app

WORKDIR /app

# Copy lockfile and package.json's of isolated subworkspace
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=pruner /app/out/json/ .

# First install the dependencies (as they change less often)
RUN --mount=type=cache,id=pnpm,target=~/.pnpm-store pnpm install --frozen-lockfile

# Copy source code of isolated subworkspace
COPY --from=pruner /app/out/full/ .

ENV NODE_OPTION='--experimental-require-module'
RUN turbo run build --filter=@ixo/common && turbo build --filter=${PROJECT}
RUN --mount=type=cache,id=pnpm,target=~/.pnpm-store pnpm prune --prod --no-optional
RUN rm -rf ./**/*/src

# Final image
FROM --platform=linux/amd64 alpine AS runner
ARG PROJECT=app

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs
USER nodejs

WORKDIR /app
COPY --from=builder --chown=nodejs:nodejs /app .
WORKDIR /app/apps/${PROJECT}

ENV NODE_ENV=production
ENV NODE_OPTION='--experimental-require-module'

EXPOSE 3000

CMD ["node", "dist/main"]

# Run with:
# docker build -t app:latest -f Dockerfile.app .
# docker run -p 3000:3000 app:latest 