import "dotenv/config";
import { defineConfig } from "prisma/config";

const { DATABASE_URL, DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME } = process.env;

const databaseUrl =
  DATABASE_URL ??
  (DB_USER && DB_PASSWORD && DB_HOST && DB_NAME
    ? `postgresql://${DB_USER}:${encodeURIComponent(DB_PASSWORD)}@${DB_HOST}:${DB_PORT ?? "5432"}/${DB_NAME}`
    : undefined);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrl,
  },
});
