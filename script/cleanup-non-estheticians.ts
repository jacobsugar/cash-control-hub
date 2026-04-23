/**
 * Delete staff from the database that are NOT estheticians in Boulevard.
 * Keeps only those with the "Aesthetician" role at mapped locations.
 *
 * Run: npx tsx script/cleanup-non-estheticians.ts
 */
import "dotenv/config";
import { db } from "../server/storage";
import { estheticians, estheticianLocations, shiftCounts, receipts, alerts } from "@shared/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import * as boulevard from "../server/boulevard";

async function run() {
  // Get the correct list of esthetician Boulevard IDs
  const mappedLocations = await db.execute(
    sql`SELECT boulevard_location_id FROM locations WHERE boulevard_location_id IS NOT NULL`
  );
  const rows = (mappedLocations as any).rows || mappedLocations;
  const blvdLocationIds = new Set((rows as any[]).map((r: any) => r.boulevard_location_id));

  console.log("Fetching staff from Boulevard...");
  const allStaff = await boulevard.fetchAllStaffWithLocations();
  const validStaffIds = new Set(
    allStaff
      .filter(s => s.active && s.role?.name === "Aesthetician" && s.locations.some(l => blvdLocationIds.has(l.id)))
      .map(s => s.id)
  );
  console.log(`${validStaffIds.size} valid estheticians in Boulevard.`);

  // Get all estheticians in the database
  const allEsth = await db.select().from(estheticians);
  console.log(`${allEsth.length} estheticians in the database.`);

  // Find ones to delete: have a boulevardStaffId that's NOT in the valid set, OR have no boulevardStaffId at all
  const toDelete = allEsth.filter(e =>
    (e.boulevardStaffId && !validStaffIds.has(e.boulevardStaffId)) ||
    (!e.boulevardStaffId)
  );
  console.log(`${toDelete.length} to delete (not estheticians in Boulevard).`);

  for (const e of toDelete) {
    console.log(`  Deleting: ${e.name} (${e.boulevardStaffId})`);
    // Clean up FK references
    await db.delete(estheticianLocations).where(eq(estheticianLocations.estheticianId, e.id));

    // Check for shift counts or receipts referencing this esthetician
    const hasShifts = await db.select({ id: shiftCounts.id }).from(shiftCounts).where(eq(shiftCounts.estheticianId, e.id));
    const hasReceipts = await db.select({ id: receipts.id }).from(receipts).where(eq(receipts.estheticianId, e.id));

    if (hasShifts.length > 0 || hasReceipts.length > 0) {
      // Can't delete — deactivate instead
      console.log(`    (has ${hasShifts.length} shifts, ${hasReceipts.length} receipts — deactivating instead)`);
      await db.update(estheticians).set({ active: false }).where(eq(estheticians.id, e.id));
    } else {
      await db.delete(estheticians).where(eq(estheticians.id, e.id));
    }
  }

  const remaining = await db.select().from(estheticians).where(eq(estheticians.active, true));
  console.log(`\nDone. ${remaining.length} active estheticians remaining.`);
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
