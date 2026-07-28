import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { Connector, AuthTypes, IpAddressTypes } from "@google-cloud/cloud-sql-connector";
import { ENV } from "./env";
import * as schema from "../drizzle/schema";

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

let _db: DrizzleDb | null = null;
let _pool: Pool | null = null;
let _connector: Connector | null = null;

/**
 * Lazily create the Drizzle instance so local tooling (lint, build) can
 * run without a live database. Two connection modes:
 *
 * 1. DATABASE_URL set -> plain node-postgres pool. Use this for local dev
 *    against a local Postgres, or a Cloud SQL instance with a public IP
 *    and IP allowlisting already configured.
 *
 * 2. INSTANCE_CONNECTION_NAME set (and DATABASE_URL not set) -> Cloud SQL
 *    connector with IAM database authentication. No password to manage;
 *    the app's runtime service account IAM role grants DB access. This
 *    is the recommended production path — see README "Database setup".
 */
export async function getDb(): Promise<DrizzleDb | null> {
  if (_db) return _db;

  try {
    if (ENV.DATABASE_URL) {
      _pool = new Pool({ connectionString: ENV.DATABASE_URL });
      _db = drizzle(_pool, { schema });
      return _db;
    }

    if (ENV.INSTANCE_CONNECTION_NAME) {
      _connector = new Connector();
      const clientOpts = await _connector.getOptions({
        instanceConnectionName: ENV.INSTANCE_CONNECTION_NAME,
        authType: AuthTypes.IAM,
        // avatar-foundry-db has no VPC peering / private IP configured (see
        // `gcloud sql instances describe` — ipv4Enabled only), so PRIVATE
        // would fail to find an address at connect time. The connector still
        // authenticates via IAM and encrypts the connection over public IP.
        ipType: IpAddressTypes.PUBLIC,
      });
      _pool = new Pool({
        ...clientOpts,
        user: ENV.DB_USER,
        database: ENV.DB_NAME,
        max: 5,
      });
      _db = drizzle(_pool, { schema });
      return _db;
    }

    console.warn(
      "[db] Neither DATABASE_URL nor INSTANCE_CONNECTION_NAME is set — running without a database."
    );
    return null;
  } catch (error) {
    console.error("[db] Failed to establish connection:", error);
    _db = null;
    return null;
  }
}

/** Call during graceful shutdown (e.g. in a server lifecycle hook) to avoid leaking connections. */
export async function closeDb(): Promise<void> {
  await _pool?.end();
  _connector?.close();
  _db = null;
  _pool = null;
  _connector = null;
}
