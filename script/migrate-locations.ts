/**
 * One-time migration script to set up Vegas & Austin locations in production.
 *
 * Run with:
 *   npx tsx script/migrate-locations.ts
 *
 * This script:
 * 1. Removes Dallas and Houston markets (and their locations/containers/data)
 * 2. Creates Las Vegas and Austin markets (if not already present)
 * 3. Creates the 9 Hello Sugar locations with Boulevard mappings
 * 4. Creates containers (suites/tills) for each location
 */
import "dotenv/config";
import { db } from "../server/storage";
import {
  markets, locations, containers, shiftCounts, receipts, alerts,
  cashCollections, boulevardTransactions,
} from "@shared/schema";
import { eq, inArray, sql } from "drizzle-orm";

async function migrate() {
  console.log("Starting location migration...\n");

  // Step 1: Add boulevard_location_id column if it doesn't exist
  console.log("1. Ensuring boulevard_location_id column exists...");
  await db.execute(sql`
    ALTER TABLE locations ADD COLUMN IF NOT EXISTS boulevard_location_id TEXT
  `);
  console.log("   Done.\n");

  // Step 2: Check for and remove Dallas/Houston markets
  console.log("2. Checking for markets to remove...");
  const existingMarkets = await db.select().from(markets);
  const marketsToRemove = existingMarkets.filter(
    (m) => m.name === "Dallas" || m.name === "Houston"
  );

  for (const market of marketsToRemove) {
    console.log(`   Removing market: ${market.name}`);
    // Get locations in this market
    const marketLocations = await db
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.marketId, market.id));

    for (const loc of marketLocations) {
      // Get containers for this location
      const locContainers = await db
        .select({ id: containers.id })
        .from(containers)
        .where(eq(containers.locationId, loc.id));
      const containerIds = locContainers.map((c) => c.id);

      if (containerIds.length > 0) {
        // Delete related data
        await db.delete(cashCollections).where(inArray(cashCollections.containerId, containerIds));

        const containerShifts = await db.select({ id: shiftCounts.id }).from(shiftCounts).where(inArray(shiftCounts.containerId, containerIds));
        const shiftIds = containerShifts.map(s => s.id);
        if (shiftIds.length > 0) {
          await db.delete(alerts).where(inArray(alerts.shiftCountId, shiftIds));
        }

        const containerReceipts = await db.select({ id: receipts.id }).from(receipts).where(inArray(receipts.containerId, containerIds));
        const receiptIds = containerReceipts.map(r => r.id);
        if (receiptIds.length > 0) {
          await db.delete(alerts).where(inArray(alerts.receiptId, receiptIds));
        }

        await db.delete(receipts).where(inArray(receipts.containerId, containerIds));
        await db.delete(shiftCounts).where(inArray(shiftCounts.containerId, containerIds));
        await db.delete(containers).where(inArray(containers.id, containerIds));
      }

      await db.delete(boulevardTransactions).where(eq(boulevardTransactions.locationId, loc.id));
      await db.delete(locations).where(eq(locations.id, loc.id));
    }

    await db.delete(markets).where(eq(markets.id, market.id));
    console.log(`   Removed ${market.name} and its ${marketLocations.length} locations.`);
  }

  // Step 3: Create/find Las Vegas and Austin markets
  console.log("\n3. Setting up markets...");
  let [lasVegas] = await db.select().from(markets).where(eq(markets.name, "Las Vegas"));
  if (!lasVegas) {
    [lasVegas] = await db.insert(markets).values({ name: "Las Vegas" }).returning();
    console.log("   Created Las Vegas market.");
  } else {
    console.log("   Las Vegas market already exists.");
  }

  let [austin] = await db.select().from(markets).where(eq(markets.name, "Austin"));
  if (!austin) {
    [austin] = await db.insert(markets).values({ name: "Austin" }).returning();
    console.log("   Created Austin market.");
  } else {
    console.log("   Austin market already exists.");
  }

  // Step 4: Create locations
  console.log("\n4. Creating locations...");

  const locationDefs = [
    // Las Vegas market
    { name: "Spring Valley 077", marketId: lasVegas.id, type: "suite" as const, timezone: "America/Los_Angeles", blvdId: "urn:blvd:Location:da3e4afb-8a87-4c09-832a-cd75136fbe11", rooms: 1 },
    { name: "Summerlin 059", marketId: lasVegas.id, type: "suite" as const, timezone: "America/Los_Angeles", blvdId: "urn:blvd:Location:a3d4dab0-8d00-417f-8d8b-905c56fbe705", rooms: 1 },
    { name: "Aliante 023", marketId: lasVegas.id, type: "suite" as const, timezone: "America/Los_Angeles", blvdId: "urn:blvd:Location:4d3266af-76f3-41ef-b360-d4eca81901f7", rooms: 2 },
    { name: "The District 058", marketId: lasVegas.id, type: "suite" as const, timezone: "America/Los_Angeles", blvdId: "urn:blvd:Location:33b869ca-375c-4a81-9933-bff91999d988", rooms: 1 },
    { name: "Green Valley 014", marketId: lasVegas.id, type: "flagship" as const, timezone: "America/Los_Angeles", blvdId: "urn:blvd:Location:22353906-d8d4-4068-9c1e-d474ca512f98", rooms: 0 },
    // Austin market
    { name: "Parkside 060", marketId: austin.id, type: "suite" as const, timezone: "America/Chicago", blvdId: "urn:blvd:Location:0073dfb5-dc5d-4908-8533-9eb3d9f6e654", rooms: 1 },
    { name: "Allendale 025", marketId: austin.id, type: "suite" as const, timezone: "America/Chicago", blvdId: "urn:blvd:Location:149753ed-48d9-45b7-bc6e-683bb6e8fa54", rooms: 2 },
    { name: "Round Rock 051", marketId: austin.id, type: "suite" as const, timezone: "America/Chicago", blvdId: "urn:blvd:Location:e9b2cecf-4003-4104-aeb7-eb6605796b8f", rooms: 2 },
    { name: "Cedar Park 217", marketId: austin.id, type: "suite" as const, timezone: "America/Chicago", blvdId: "urn:blvd:Location:fb5acf9d-0725-4cbc-a4e4-d8560b4690e9", rooms: 1 },
  ];

  for (const def of locationDefs) {
    // Check if location already exists (by boulevard ID)
    const [existing] = await db
      .select()
      .from(locations)
      .where(eq(locations.boulevardLocationId, def.blvdId));

    if (existing) {
      console.log(`   ${def.name} already exists, skipping.`);
      continue;
    }

    const [loc] = await db.insert(locations).values({
      name: def.name,
      marketId: def.marketId,
      type: def.type,
      timezone: def.timezone,
      dailyFloat: def.type === "flagship" ? "20.00" : undefined,
      boulevardLocationId: def.blvdId,
    } as any).returning();

    // Create containers
    if (def.type === "flagship") {
      await db.insert(containers).values({
        name: "Main Till",
        locationId: loc.id,
        currentBalance: "20.00",
      } as any);
      console.log(`   Created ${def.name} (flagship) with Main Till.`);
    } else if (def.rooms === 1) {
      await db.insert(containers).values({
        name: "Suite 1",
        locationId: loc.id,
      } as any);
      console.log(`   Created ${def.name} (1 suite).`);
    } else {
      for (let i = 1; i <= def.rooms; i++) {
        await db.insert(containers).values({
          name: `Suite ${i}`,
          locationId: loc.id,
        } as any);
      }
      console.log(`   Created ${def.name} (${def.rooms} suites).`);
    }
  }

  // Summary
  console.log("\n--- Migration complete ---");
  const finalMarkets = await db.select().from(markets);
  const finalLocations = await db.select().from(locations);
  const finalContainers = await db.select().from(containers);
  console.log(`Markets: ${finalMarkets.length}`);
  console.log(`Locations: ${finalLocations.length}`);
  console.log(`Containers: ${finalContainers.length}`);

  process.exit(0);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
