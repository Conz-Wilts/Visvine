-- Shared rate-limit state. One row per limit key; the row IS the token bucket,
-- refilled from `updated_at` and spent in a single statement so concurrent
-- takers serialize on its lock (lib/rateLimit/index.ts).
--
-- `key` is a truncated SHA-256 of the caller-derived key, so it is fixed-width,
-- carries no email or address, and gives a caller no influence over index
-- layout. The updated_at index serves the sweep that reclaims idle buckets.
CREATE TABLE "rate_limit_buckets" (
    "key" TEXT NOT NULL,
    "tokens" DOUBLE PRECISION NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "rate_limit_buckets_updated_at_idx" ON "rate_limit_buckets"("updated_at");
