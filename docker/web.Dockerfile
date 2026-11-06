# syntax=docker/dockerfile:1.7
# Next.js web app (apps/web). Build from the repo root:
#   docker build -f docker/web.Dockerfile --target runtime .
# Stages used by CI: `test` and `runtime` (same contract as node-service.Dockerfile; SERVICE is ignored).

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY apps/web/package.json apps/web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY apps/web/ ./

FROM deps AS test
RUN npm run typecheck && npm test

FROM deps AS build
# Configuration is read at request time, so the image is the same for every environment.
RUN npm run build

# Distroless, uid 65532. The standalone output carries only the node_modules the server needs.
FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=8080
COPY --from=build --chown=65532:65532 /app/.next/standalone ./
COPY --from=build --chown=65532:65532 /app/.next/static ./.next/static
EXPOSE 8080
CMD ["server.js"]
