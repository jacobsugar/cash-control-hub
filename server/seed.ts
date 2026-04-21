import { db } from "./storage";
import {
  markets, locations, containers, adminUsers,
} from "@shared/schema";

export async function seed() {
  const existingMarkets = await db.select().from(markets);
  if (existingMarkets.length > 0) return;

  console.log("Seeding database with Hello Sugar locations...");

  // Markets
  const [lasVegas] = await db.insert(markets).values({ name: "Las Vegas" }).returning();
  const [austin] = await db.insert(markets).values({ name: "Austin" }).returning();

  // Las Vegas market locations
  const [springValley] = await db.insert(locations).values({
    name: "Spring Valley 077",
    marketId: lasVegas.id,
    type: "suite",
    timezone: "America/Los_Angeles",
    boulevardLocationId: "urn:blvd:Location:da3e4afb-8a87-4c09-832a-cd75136fbe11",
  }).returning();

  const [summerlin] = await db.insert(locations).values({
    name: "Summerlin 059",
    marketId: lasVegas.id,
    type: "suite",
    timezone: "America/Los_Angeles",
    boulevardLocationId: "urn:blvd:Location:a3d4dab0-8d00-417f-8d8b-905c56fbe705",
  }).returning();

  const [aliante] = await db.insert(locations).values({
    name: "Aliante 023",
    marketId: lasVegas.id,
    type: "suite",
    timezone: "America/Los_Angeles",
    boulevardLocationId: "urn:blvd:Location:4d3266af-76f3-41ef-b360-d4eca81901f7",
  }).returning();

  const [theDistrict] = await db.insert(locations).values({
    name: "The District 058",
    marketId: lasVegas.id,
    type: "suite",
    timezone: "America/Los_Angeles",
    boulevardLocationId: "urn:blvd:Location:33b869ca-375c-4a81-9933-bff91999d988",
  }).returning();

  const [greenValley] = await db.insert(locations).values({
    name: "Green Valley 014",
    marketId: lasVegas.id,
    type: "flagship",
    timezone: "America/Los_Angeles",
    dailyFloat: "20.00",
    boulevardLocationId: "urn:blvd:Location:22353906-d8d4-4068-9c1e-d474ca512f98",
  }).returning();

  // Austin market locations
  const [parkside] = await db.insert(locations).values({
    name: "Parkside 060",
    marketId: austin.id,
    type: "suite",
    timezone: "America/Chicago",
    boulevardLocationId: "urn:blvd:Location:0073dfb5-dc5d-4908-8533-9eb3d9f6e654",
  }).returning();

  const [allendale] = await db.insert(locations).values({
    name: "Allendale 025",
    marketId: austin.id,
    type: "suite",
    timezone: "America/Chicago",
    boulevardLocationId: "urn:blvd:Location:149753ed-48d9-45b7-bc6e-683bb6e8fa54",
  }).returning();

  const [roundRock] = await db.insert(locations).values({
    name: "Round Rock 051",
    marketId: austin.id,
    type: "suite",
    timezone: "America/Chicago",
    boulevardLocationId: "urn:blvd:Location:e9b2cecf-4003-4104-aeb7-eb6605796b8f",
  }).returning();

  const [cedarPark] = await db.insert(locations).values({
    name: "Cedar Park 217",
    marketId: austin.id,
    type: "suite",
    timezone: "America/Chicago",
    boulevardLocationId: "urn:blvd:Location:fb5acf9d-0725-4cbc-a4e4-d8560b4690e9",
  }).returning();

  // Containers — suites get rooms, flagship gets Main Till

  // 1-room suites
  for (const loc of [springValley, summerlin, theDistrict, parkside, cedarPark]) {
    await db.insert(containers).values({ name: "Suite 1", locationId: loc.id });
  }

  // 2-room suites
  for (const loc of [aliante, allendale, roundRock]) {
    await db.insert(containers).values([
      { name: "Suite 1", locationId: loc.id },
      { name: "Suite 2", locationId: loc.id },
    ]);
  }

  // Flagship — Main Till auto-created by createLocation, but seed inserts directly
  await db.insert(containers).values({
    name: "Main Till",
    locationId: greenValley.id,
    currentBalance: "20.00",
  });

  // Admin user
  await db.insert(adminUsers).values({
    email: "jacob@hellosugar.salon",
    name: "Jacob Parry",
    role: "owner",
  });

  console.log("Seed data inserted: 2 markets, 9 locations, 12 containers.");
}
