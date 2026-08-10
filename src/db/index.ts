import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Neon's HTTP driver rather than a TCP pool: serverless functions do not keep
 * connections alive between invocations, and a pool per invocation exhausts the
 * database's connection limit long before it does anything useful.
 */
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Run `vercel env pull .env.local` to fetch it.",
  );
}

export const db = drizzle(neon(connectionString), { schema });
export { schema };
