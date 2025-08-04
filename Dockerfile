ARG NODE_VERSION=22.11.0

# Debian-based image (glibc) instead of Alpine (musl)
FROM --platform=linux/amd64 node:${NODE_VERSION}-bookworm-slim AS debian-base
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Setup pnpm and turbo on the alpine base
FROM --platform=linux/amd64 debian-base as base
RUN npm install pnpm@10.0.0 turbo --global
RUN pnpm config set store-dir ~/.pnpm-store

# Prune projects
FROM --platform=linux/amd64 base AS pruner
ARG PROJECT

WORKDIR /app
COPY . .
RUN turbo prune --scope=${PROJECT} --docker

# Build the project
FROM --platform=linux/amd64 base AS builder
ARG PROJECT

WORKDIR /app

# Copy lockfile and package.json's of isolated subworkspace
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=pruner /app/out/json/ .

# First install the dependencies (as they change less often)
RUN --mount=type=cache,id=pnpm,target=~/.pnpm-store pnpm install --frozen-lockfile

# Copy source code of isolated subworkspace
COPY --from=pruner /app/out/full/ .

RUN turbo build --filter=${PROJECT}
RUN --mount=type=cache,id=pnpm,target=~/.pnpm-store pnpm prune --prod --no-optional
RUN rm -rf ./**/*/src

# Final image
FROM --platform=linux/amd64 debian-base AS runner
ARG PROJECT

# Clean up build dependencies in the final image
RUN apt-get purge -y make g++ git \
 && apt-get autoremove -y && apt-get clean

WORKDIR /app
COPY --from=builder /app .
WORKDIR /app/apps/${PROJECT}

# Create matrix storage directory
RUN mkdir -p matrix-storage

# ARG PORT=3000
# ENV PORT=${PORT}
# EXPOSE ${PORT}
ENV NODE_ENV=production

EXPOSE 3000

# CMD node --experimental-vm-modules dist/main
CMD NODE_OPTIONS='--experimental-require-module' node dist/main

# docker build -t api:latest --build-arg PROJECT=api .
# docker build -t ghcr.io/ixofoundation/ixo-ai-oracles:v0.0.2 --build-arg PROJECT=guru .
