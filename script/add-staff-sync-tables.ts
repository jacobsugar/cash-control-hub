/**
 * Add staff sync columns and esthetician_locations table.
 *
 * Run from Replit shell:
 *   npx tsx script/add-staff-sync-tables.ts
 *
 * For production:
 *   DATABASE_URL="<prod_url>" npx tsx script/add-staff-sync-tables.ts
 */
import "dotenv/config";
import { db } from "../server/storage";
import { sql } from "drizzle-orm";

async function migrate() {
  console.log("Adding staff sync columns and tables...");

  // Add columns to estheticians table
  await db.execute(sql`ALTER TABLE estheticians ADD COLUMN IF NOT EXISTS boulevard_staff_id TEXT UNIQUE`);
  console.log("  Added boulevard_staff_id column to estheticians.");

  await db.execute(sql`ALTER TABLE estheticians ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP`);
  console.log("  Added last_synced_at column to estheticians.");

  // Create esthetician_locations join table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS esthetician_locations (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      esthetician_id INTEGER NOT NULL REFERENCES estheticians(id),
      location_id INTEGER NOT NULL REFERENCES locations(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  console.log("  Created esthetician_locations table.");

  console.log("Done.");
  process.exit(0);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
