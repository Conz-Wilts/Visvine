// Imported first by run.ts, so it runs before anything constructs the Prisma
// client: the seed writes thousands of rows, and logging every query in dev is
// most of its runtime. Set PRISMA_QUERY_LOG=on to see them anyway.
process.env.PRISMA_QUERY_LOG ??= 'off'
