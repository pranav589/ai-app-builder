import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

const globalForDb = globalThis as unknown as {
  pgClient?: ReturnType<typeof postgres>;
};

// One small pool per process, reused across Next.js hot reloads.
// DATABASE_URL goes through PgBouncer (transaction mode), so prepared statements are off.
const client =
  globalForDb.pgClient ??
  postgres(process.env.DATABASE_URL!, { max: 5, prepare: false });

if (process.env.NODE_ENV !== "production") globalForDb.pgClient = client;

export const db = drizzle({ client, schema });
export * from "@/db/schema";
