import type { Config } from "drizzle-kit";

export default {
  schema: "./drizzle/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // For local dev / drizzle-kit CLI use only. The running app connects
    // via server/db.ts, which uses the Cloud SQL connector in production
    // instead of a bare connection string. See README "Database setup".
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/avatar_foundry",
  },
} satisfies Config;
