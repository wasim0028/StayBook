# syntax=docker/dockerfile:1.7
# Shared Dockerfile for every Node service in services/*.
# Build from the repo root:
#   docker build -f docker/node-service.Dockerfile --build-arg SERVICE=listing-svc --target runtime .
# Stages used by CI: `test` (typecheck + unit/integration tests) and `runtime` (the shipped image).

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS deps
ARG SERVICE
WORKDIR /repo
COPY . .
RUN --mount=type=cache,target=/root/.npm \
    test -n "$SERVICE" && test -d "services/$SERVICE" \
 && npm ci --workspace "services/$SERVICE" --include-workspace-root --no-audit --no-fund

FROM deps AS test
ARG SERVICE
# Integration tests run against moto's DynamoDB server (it supports transactions; dynalite doesn't).
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/moto \
 && /opt/moto/bin/pip install --no-cache-dir "moto[server,dynamodb]==5.1.22"
ENV PATH="/opt/moto/bin:${PATH}"
RUN npm run typecheck --workspace packages/shared \
 && npm run typecheck --workspace "services/$SERVICE" \
 && npm test --workspace packages/shared \
 && npm test --workspace "services/$SERVICE"

FROM deps AS build
ARG SERVICE
RUN npm run build --workspace "services/$SERVICE" \
 && mkdir -p /out \
 && cp "services/$SERVICE/dist/server.cjs" "services/$SERVICE/dist/server.cjs.map" /out/

# Distroless: no shell, no package manager, runs as uid 65532.
# The bundle is self-contained (AWS SDK included), so no node_modules ship.
FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runtime
WORKDIR /app
COPY --from=build /out/ ./
ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps \
    PORT=8080
EXPOSE 8080
USER nonroot
CMD ["server.cjs"]
