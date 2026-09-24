FROM mirror.gcr.io/library/node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate

# ── Install dependencies ───────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/package.json ./packages/config/
COPY packages/tokens/package.json ./packages/tokens/
COPY packages/ui/package.json ./packages/ui/
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
# pnpm links a workspace package's own dependencies (clsx, @visvine/tokens)
# under that package, and .dockerignore drops every node_modules from the
# context, so the shared UI's has to come from deps too.
COPY --from=deps /app/packages/ui/node_modules ./packages/ui/node_modules
COPY . .
# TOOLS_ORIGIN is deliberately NOT a build arg. The Content-Security-Policy is
# built per request in proxy.ts, so `frame-src` reads the runtime environment on
# every response — setting the origin on Cloud Run takes effect on the next
# revision, with no rebuild and nothing baked into the image.
RUN pnpm --filter @visvine/web exec prisma generate
RUN pnpm --filter @visvine/web build

# ── Runtime image ─────────────────────────────────────────────────────────────
FROM mirror.gcr.io/library/node:22-alpine AS runner
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
