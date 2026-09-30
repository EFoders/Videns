# syntax=docker/dockerfile:1
#
# Everything builds and runs in here; the host needs Docker and nothing else
# (VIDENS_SPEC.md section 5.2).
#
#   deps       npm ci, cached on the lockfile
#   source     sources plus the generated contract (types and standalone validators)
#   test       `npm test` -- what CI runs
#   build      typecheck, production bundle, bundle budget
#   mock-feed  the synthetic picture feed (dev and tests)
#   e2e        Playwright browser tests against running viewers
#   runtime    unprivileged nginx serving the bundle and proxying /picture/ (the default)

ARG NODE_IMAGE=node:24-alpine
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS source
COPY . .
RUN npm run gen

FROM source AS test
CMD ["npm", "test"]

FROM source AS build
RUN npm run typecheck && npm run build && node scripts/check-budget.ts

FROM source AS mock-feed
ENV NODE_ENV=production MOCK_PORT=8090
USER node
EXPOSE 8090
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8090/healthz >/dev/null || exit 1
CMD ["node", "tools/mock-feed/server.ts"]

# Browser tests: Playwright's image carries the browsers; the runner version is pinned to it.
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS e2e
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY playwright.config.ts tsconfig.json ./
COPY tests/e2e/ tests/e2e/
COPY fixtures/ fixtures/
CMD ["npx", "playwright", "test"]

FROM ${NGINX_IMAGE} AS runtime
# Our own nginx.conf: it includes server blocks from /tmp, where the entrypoint renders
# them, so the root filesystem can be read-only.
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/templates/ /etc/nginx/templates/
COPY --chmod=755 nginx/19-videns-env.envsh /docker-entrypoint.d/19-videns-env.envsh
COPY --chmod=755 nginx/40-videns-config.sh /docker-entrypoint.d/40-videns-config.sh
COPY --from=build /app/dist /usr/share/nginx/html
# The basemaps a reader may switch between. Mount a replacement over this file to change
# the list -- e.g. one with only "none", for no third-party requests at all.
COPY config/basemaps.json /etc/videns/basemaps.json
# The scenario editor's synthetic signature library. Mount a deployment's own over it.
COPY config/library/ /etc/videns/library/
# Default basemap: online street tiles, by decision for now (VIDENS_SPEC.md 8.1).
ENV NGINX_ENVSUBST_OUTPUT_DIR=/tmp \
    NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1 \
    VIDENS_FEED_UPSTREAM=http://mock-feed:8090 \
    VIDENS_FEED=/picture/v0 \
    VIDENS_BASEMAP=street \
    VIDENS_BASEMAPS_FILE=/etc/videns/basemaps.json \
    VIDENS_ELLIPSE_CONFIDENCE=0.95 \
    VIDENS_VIEW=null \
    VIDENS_TRUTH_OVERLAY=false
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
