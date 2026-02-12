import { db } from "./storage";
import {
  markets, locations, containers, estheticians, adminUsers,
  shiftCounts, alerts, boulevardTransactions,
} from "@shared/schema";
import { eq } from "drizzle-orm";

export async function seed() {
  const existingMarkets = await db.select().from(markets);
  if (existingMarkets.length > 0) return;

  console.log("Seeding database with sample data...");

  // Markets
  const [dallas] = await db.insert(markets).values({ name: "Dallas" }).returning();
  const [houston] = await db.insert(markets).values({ name: "Houston" }).returning();
  const [austin] = await db.insert(markets).values({ name: "Austin" }).returning();

  // Locations
  const [uptown] = await db.insert(locations).values({
    name: "Uptown",
    marketId: dallas.id,
    type: "suite",
    timezone: "America/Chicago",
  }).returning();

  const [deepEllum] = await db.insert(locations).values({
    name: "Deep Ellum",
    marketId: dallas.id,
    type: "flagship",
    timezone: "America/Chicago",
    dailyFloat: "20.00",
  }).returning();

  const [montrose] = await db.insert(locations).values({
    name: "Montrose",
    marketId: houston.id,
    type: "suite",
    timezone: "America/Chicago",
  }).returning();

  const [domainLoc] = await db.insert(locations).values({
    name: "The Domain",
    marketId: austin.id,
    type: "suite",
    timezone: "America/Chicago",
  }).returning();

  // Containers
  const [suiteA] = await db.insert(containers).values({
    name: "Suite A",
    locationId: uptown.id,
    currentBalance: "145.00",
  }).returning();

  const [suiteB] = await db.insert(containers).values({
    name: "Suite B",
    locationId: uptown.id,
    currentBalance: "80.00",
  }).returning();

  const [mainTill] = await db.insert(containers).values({
    name: "Main Till",
    locationId: deepEllum.id,
    currentBalance: "20.00",
  }).returning();

  const [montroseSuiteA] = await db.insert(containers).values({
    name: "Suite A",
    locationId: montrose.id,
    currentBalance: "210.00",
  }).returning();

  const [domainSuiteA] = await db.insert(containers).values({
    name: "Suite A",
    locationId: domainLoc.id,
    currentBalance: "65.00",
  }).returning();

  // Estheticians
  const [sarah] = await db.insert(estheticians).values({ name: "Sarah Johnson" }).returning();
  const [maria] = await db.insert(estheticians).values({ name: "Maria Garcia" }).returning();
  const [jessica] = await db.insert(estheticians).values({ name: "Jessica Chen" }).returning();
  const [ashley] = await db.insert(estheticians).values({ name: "Ashley Williams" }).returning();
  const [taylor] = await db.insert(estheticians).values({ name: "Taylor Brown" }).returning();

  // Admin users
  await db.insert(adminUsers).values({
    email: "admin@hellosugar.salon",
    name: "Admin",
    role: "owner",
  });

  // Sample shift counts
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(9, 0, 0, 0);

  await db.insert(shiftCounts).values([
    {
      containerId: suiteA.id,
      estheticianId: sarah.id,
      type: "start",
      countedAmount: "100.00",
      expectedAmount: "100.00",
    },
    {
      containerId: suiteA.id,
      estheticianId: sarah.id,
      type: "end",
      countedAmount: "145.00",
      expectedAmount: "145.00",
    },
    {
      containerId: suiteB.id,
      estheticianId: maria.id,
      type: "start",
      countedAmount: "50.00",
      expectedAmount: "50.00",
    },
    {
      containerId: suiteB.id,
      estheticianId: maria.id,
      type: "end",
      countedAmount: "80.00",
      expectedAmount: "85.00",
      discrepancyNote: "Could not find the $5 difference, may have miscounted earlier",
    },
    {
      containerId: montroseSuiteA.id,
      estheticianId: jessica.id,
      type: "start",
      countedAmount: "200.00",
      expectedAmount: "200.00",
    },
  ]);

  // Sample Boulevard transactions
  const today = new Date();
  await db.insert(boulevardTransactions).values([
    {
      date: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10, 30),
      locationId: uptown.id,
      appointmentId: "APT-001",
      amount: "25.00",
      staffName: "Sarah Johnson",
      clientName: "Emily Davis",
      paymentType: "cash",
    },
    {
      date: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 11, 15),
      locationId: uptown.id,
      appointmentId: "APT-002",
      amount: "45.00",
      staffName: "Sarah Johnson",
      clientName: "Rachel Kim",
      paymentType: "cash",
    },
    {
      date: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 14, 0),
      locationId: montrose.id,
      appointmentId: "APT-003",
      amount: "35.00",
      staffName: "Jessica Chen",
      clientName: "Amanda Torres",
      paymentType: "cash",
    },
    {
      date: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 45),
      locationId: deepEllum.id,
      appointmentId: "APT-004",
      amount: "60.00",
      staffName: "Ashley Williams",
      clientName: "Nicole Baker",
      paymentType: "cash",
    },
  ]);

  // Sample alerts
  await db.insert(alerts).values([
    {
      type: "end_mismatch",
      status: "active",
      staffName: "Maria Garcia",
      marketName: "Dallas",
      locationName: "Uptown",
      containerName: "Suite B",
      expectedAmount: "85.00",
      actualAmount: "80.00",
      note: "Could not find the $5 difference",
    },
    {
      type: "missing_end_shift",
      status: "active",
      staffName: "Jessica Chen",
      marketName: "Houston",
      locationName: "Montrose",
      containerName: "Suite A",
      note: "Start shift submitted but no end shift recorded",
    },
  ]);

  console.log("Seed data inserted successfully.");
}
