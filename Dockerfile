# syntax=docker/dockerfile:1.7
#
# Two-stage image for memento (Recorder).
#
# Stage 1 builds both workspace artifacts (api-server + test-builder) on a
# clean Node 24 image. Stage 2 uses the official Playwright runtime image so
# Chromium and every system library it needs are already present — much
# simpler than recreating the apt-get list on a vanilla base.
#
# The runtime entrypoint is the bundled api-server (`dist/index.mjs`), which
# in production also serves the built SPA from disk. See `artifacts/api-server/src/app.ts`.

# ---------- Stage 1: build ----------
FROM node:24-bookworm-slim AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Don't try to download Chromium during install — the runtime image has it.
ENV SKIP_PLAYWRIGHT_INSTALL=1
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN corepack enable

WORKDIR /workspace

# Copy lockfile + every workspace package.json first so `pnpm install` can
# be cached when only application source changes.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY artifacts/api-server/package.json     artifacts/api-server/package.json
COPY artifacts/test-builder/package.json   artifacts/test-builder/package.json
COPY lib/api-client-react/package.json     lib/api-client-react/package.json
COPY lib/api-spec/package.json             lib/api-spec/package.json
COPY lib/api-zod/package.json              lib/api-zod/package.json
COPY lib/db/package.json                   lib/db/package.json
COPY lib/kernel/package.json               lib/kernel/package.json
COPY scripts/package.json                  scripts/package.json

# Skip lifecycle scripts here: the api-server's `postinstall` runs
# `node ./scripts/install-chromium.mjs`, but the `scripts/` directory hasn't
# been copied into the image yet (only package.json files have, to keep this
# layer cacheable). Chromium is provided by the Playwright runtime base image
# in the final stage, so there's nothing to install here anyway.
ENV CI=true
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# Now bring in the rest of the source and build both artifacts.
COPY . .

# Build the api-server bundle (esbuild → dist/index.mjs) and the SPA bundle
# (Vite → artifacts/test-builder/dist/public). PORT/BASE_PATH are required
# by the Vite config at build time even though they have no runtime effect
# on the produced static assets.
ENV NODE_ENV=production
ENV PORT=8080
ENV BASE_PATH=/

RUN pnpm --filter @workspace/api-server   run build \
 && pnpm --filter @workspace/test-builder run build

# Trim node_modules down to production-only for the runtime stage.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts


# ---------- Stage 2: runtime ----------
# Match the playwright version pinned in artifacts/api-server/package.json
# (see "playwright": "^1.59.1"). Bumping that dep means bumping this tag.
FROM mcr.microsoft.com/playwright:v1.60.0-noble AS runtime

ENV NODE_ENV=production
ENV PORT=8080
ENV APP_ENVIRONMENT=production
# Tell the api-server where the SPA bundle lives inside the image.
ENV SPA_DIST_DIR=/app/artifacts/test-builder/dist/public
# Default writable location for generated workspaces, traces, screenshots.
# fly.toml mounts a volume here so this state survives restarts.
ENV WORKSPACE_DIR=/data

WORKDIR /app

# Production node_modules first (largest layer; rarely changes).
COPY --from=builder /workspace/node_modules ./node_modules
COPY --from=builder /workspace/artifacts/api-server/node_modules   ./artifacts/api-server/node_modules
COPY --from=builder /workspace/artifacts/test-builder/node_modules ./artifacts/test-builder/node_modules
COPY --from=builder /workspace/lib                                 ./lib
COPY --from=builder /workspace/package.json                        ./package.json
COPY --from=builder /workspace/pnpm-workspace.yaml                 ./pnpm-workspace.yaml

# Built artifacts.
COPY --from=builder /workspace/artifacts/api-server/dist           ./artifacts/api-server/dist
COPY --from=builder /workspace/artifacts/api-server/package.json   ./artifacts/api-server/package.json
COPY --from=builder /workspace/artifacts/test-builder/dist         ./artifacts/test-builder/dist
COPY --from=builder /workspace/artifacts/test-builder/package.json ./artifacts/test-builder/package.json

# Make sure /data exists so the api-server can write to it on first boot
# even before the Fly volume is mounted (e.g. when running locally with
# `docker run` without -v).
RUN mkdir -p /data && chown -R pwuser:pwuser /data /app

USER pwuser

EXPOSE 8080

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
