/**
 * Add per-alert-type notification toggles to alert_recipients
 * and has_receipt field to receipts.
 *
 * Run: npx tsx script/add-alert-routing.ts
 */
import "dotenv/config";
import { db } from "../server/storage";
import { sql } from "drizzle-orm";

async function migrate() {
  console.log("Adding alert routing columns and receipt fields...");

  // Alert recipient notification toggles
  const cols = [
    "notify_start_mismatch",
    "notify_end_mismatch",
    "notify_missing_end_shift",
    "notify_missing_receipt",
    "notify_receipt_submitted",
    "notify_collection_mismatch",
  ];
  for (const col of cols) {
    await db.execute(sql.raw(`ALTER TABLE alert_recipients ADD COLUMN IF NOT EXISTS ${col} BOOLEAN NOT NULL DEFAULT TRUE`));
  }
  console.log("  Added notification toggle columns to alert_recipients.");

  // Receipt fields
  await db.execute(sql`ALTER TABLE receipts ALTER COLUMN file_path DROP NOT NULL`);
  await db.execute(sql`ALTER TABLE receipts ALTER COLUMN file_name DROP NOT NULL`);
  await db.execute(sql.raw(`ALTER TABLE receipts ADD COLUMN IF NOT EXISTS has_receipt BOOLEAN NOT NULL DEFAULT TRUE`));
  console.log("  Updated receipts table (nullable file fields, has_receipt flag).");

  console.log("Done.");
  process.exit(0);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
