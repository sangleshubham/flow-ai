# syntax=docker/dockerfile:1
# AI Illustrated Reader image (W11, spec §17, docs/deploy.md). Two stages on Node 24 (spec D11):
# build the Next standalone server, then run it as a non-root user with ILLUS_DATA_DIR on a volume.
# No `turbo prune`: a filtered pnpm install does the same job without turbo reading the pnpm 10 lockfile.

FROM node:24-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app
# HUSKY=0: no .git in the context, so skip the git-hook install in the root `prepare` script.
ENV NEXT_TELEMETRY_DISABLED=1 HUSKY=0
RUN corepack enable
# .dockerignore keeps node_modules, build output, .env* and private books out of the context.
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @flow/reader...
# Built in replay mode with no secrets, like CI. Every ILLUS_* value is read at runtime.
RUN DOCKER=1 ILLUS_LLM_MODE=replay pnpm --filter @flow/reader build
# The reader prebuild runs W7's build:assets (wired by W9). Fail if that wiring breaks.
RUN test -s apps/reader/public/illus-trace-worker.mjs \
    && test -s apps/reader/public/illus-comlink.mjs \
    && test -s apps/reader/public/illus-tracer.py \
    && test -s apps/reader/public/pyodide/pyodide.mjs \
    && test -s apps/reader/public/pyodide/pyodide.asm.mjs \
    && test -s apps/reader/public/pyodide/pyodide-lock.json \
    && test -s apps/reader/public/pyodide/pyodide.asm.wasm \
    && test -s apps/reader/public/pyodide/python_stdlib.zip

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 ILLUS_DATA_DIR=/data ILLUS_LLM_MODE=replay ILLUS_FIXTURES_DIR=/fixtures/llm
# Token store and usage log live on a volume owned by the unprivileged `node` user (uid 1000).
RUN mkdir -p /data && chown node:node /data
COPY --from=builder --chown=node:node /app/apps/reader/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/reader/.next/static ./apps/reader/.next/static
# public/ holds the PWA files, theme-init.js, illus-sandbox.html and the self-hosted Pyodide assets
# (public/pyodide, public/illus-trace-worker.mjs and its bootstrap dependencies, W7);
# the standalone server does not include it.
COPY --from=builder --chown=node:node /app/apps/reader/public ./apps/reader/public
# Generates or loads the secrets and the owner from /data before starting server.js (ADR 0047).
COPY --from=builder --chown=node:node /app/apps/reader/docker-entrypoint.mjs ./apps/reader/docker-entrypoint.mjs
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -q -O /dev/null http://127.0.0.1:3000/login || exit 1
WORKDIR /app/apps/reader
CMD ["node", "docker-entrypoint.mjs"]
