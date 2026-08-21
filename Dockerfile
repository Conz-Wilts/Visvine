FROM mirror.gcr.io/library/node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate

# ── Install dependencies ───────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/package.json ./packages/config/
COPY apps/web/package.json ./apps/web/
# Every workspace importer in the lockfile must be present for --frozen-lockfile
# to validate; the filter keeps Electron and the rest of the desktop tree out.
COPY apps/desktop/package.json ./apps/desktop/
RUN pnpm install --frozen-lockfile --filter @visvine/web...

# ── Build ─────────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY . .
# next.config.ts#headers() runs once, HERE, at `next build` time — its output is
# baked into .next/routes-manifest.json, which the standalone server.js serves
# from directly and never re-evaluates. TOOLS_ORIGIN therefore has to be present
# in THIS shell to reach frame-src; a Cloud Run runtime `--set-env-vars` alone
# (set after this image already exists) cannot change it. See docs/tools.md's
# Ops runbook for the matching deploy.yml build-arg.
ARG TOOLS_ORIGIN=""
ENV TOOLS_ORIGIN=$TOOLS_ORIGIN
RUN pnpm --filter @visvine/web exec prisma generate
RUN pnpm --filter @visvine/web build

# ── Runtime image ─────────────────────────────────────────────────────────────
FROM mirror.gcr.io/library/node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3080
ENV PORT=3080
ENV HOSTNAME="0.0.0.0"

CMD ["node", "apps/web/server.js"]
