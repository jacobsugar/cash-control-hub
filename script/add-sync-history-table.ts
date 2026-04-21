/**
 * Add boulevard_sync_history table to the database.
 *
 * Run from Replit shell:
 *   npx tsx script/add-sync-history-table.ts
 *
 * For production:
 *   DATABASE_URL="<prod_url>" npx tsx script/add-sync-history-table.ts
 */
import "dotenv/config";
import { db } from "../server/storage";
import { sql } from "drizzle-orm";

async function migrate() {
  console.log("Adding boulevard_sync_history table...");

  // Create enums (IF NOT EXISTS not supported for enums, so we catch errors)
  try {
    await db.execute(sql`CREATE TYPE boulevard_sync_type AS ENUM ('auto', 'manual', 'count')`);
    console.log("  Created boulevard_sync_type enum.");
  } catch {
    console.log("  boulevard_sync_type enum already exists.");
  }

  try {
    await db.execute(sql`CREATE TYPE boulevard_sync_status AS ENUM ('success', 'error')`);
    console.log("  Created boulevard_sync_status enum.");
  } catch {
    console.log("  boulevard_sync_status enum already exists.");
  }

  // Create table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS boulevard_sync_history (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      location_id INTEGER NOT NULL REFERENCES locations(id),
      location_name TEXT NOT NULL,
      sync_type boulevard_sync_type NOT NULL,
      status boulevard_sync_status NOT NULL,
      transactions_imported INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      started_at TIMESTAMP NOT NULL,
      completed_at TIMESTAMP
    )
  `);
  console.log("  Created boulevard_sync_history table.");

  console.log("Done.");
  process.exit(0);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
