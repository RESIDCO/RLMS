/**
 * Repair module DB access via node-postgres (local Postgres / pooler URL).
 * Keeps the module off Supabase PostgREST so local Postgres works without a branch.
 */
import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getRepairPool(): pg.Pool {
  if (pool) return pool;
  const url = process.env.DATABASE_URL || process.env.REPAIR_DATABASE_URL;
  if (!url) {
    throw new Error(
      "[repair/db] Set DATABASE_URL or REPAIR_DATABASE_URL for local Postgres",
    );
  }
  pool = new Pool({ connectionString: url });
  return pool;
}

export async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return getRepairPool().query<T>(text, params);
}

export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getRepairPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export const DEFAULT_TENANT_ID = "00000000-0000-4000-8000-000000000001";
