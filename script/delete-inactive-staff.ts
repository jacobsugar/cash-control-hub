import "dotenv/config";
import { db } from "../server/storage";
import { estheticians, estheticianLocations } from "@shared/schema";
import { eq } from "drizzle-orm";

async function run() {
  const inactive = await db.select().from(estheticians).where(eq(estheticians.active, false));
  console.log(`Deleting ${inactive.length} inactive staff...`);

  for (const e of inactive) {
    await db.delete(estheticianLocations).where(eq(estheticianLocations.estheticianId, e.id));
    await db.delete(estheticians).where(eq(estheticians.id, e.id));
  }

  const remaining = await db.select().from(estheticians);
  console.log(`Remaining: ${remaining.length} estheticians`);
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
