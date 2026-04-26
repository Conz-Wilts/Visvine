/**
 * Prisma Client singleton
 * Prevents multiple instances in development with hot reloading
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// Build connection string from individual parts or use DATABASE_URL directly
const connectionString =
  process.env.DIRECT_DATABASE_URL ||
  process.env.DATABASE_URL ||
  (process.env.DB_HOST
    ? `postgresql://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASSWORD ?? '')}@${process.env.DB_HOST}:${process.env.DB_PORT ?? 5432}/${process.env.DB_NAME}`
    : 'postgresql://postgres:postgres@localhost:5432/app');

const pool = new Pool({
  connectionString,
  max: 20,
  // Shorter than Cloud SQL Proxy's idle cutoff (~10 min) so we recycle
  // before the proxy silently drops the socket and Prisma hits P1017.
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

// Drop clients that error out so they don't get handed back to Prisma.
pool.on('error', () => {});

// Warm one connection so the first request doesn't pay the handshake cost
pool.query('SELECT 1').catch(() => {});
const adapter = new PrismaPg(pool);

const prismaClientSingleton = () => {
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });
};

declare global {
  var prismaGlobal: undefined | ReturnType<typeof prismaClientSingleton>;
}

const prisma = globalThis.prismaGlobal ?? prismaClientSingleton();

export default prisma;

if (process.env.NODE_ENV !== 'production') globalThis.prismaGlobal = prisma;
