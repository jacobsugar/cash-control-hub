import { eq, desc, and, gte, sql, inArray, ne, notInArray, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import {
  markets, locations, containers, estheticians, estheticianLocations, shiftCounts, receipts,
  boulevardTransactions, alerts, cashCollections, adminUsers, alertRecipients, appSettings,
  boulevardSyncHistory,
  type InsertMarket, type InsertLocation, type InsertContainer, type InsertEsthetician,
  type InsertShiftCount, type InsertReceipt, type InsertBoulevardTransaction,
  type InsertAlert, type InsertCashCollection, type InsertAdminUser,
  type InsertAlertRecipient, type InsertAppSetting, type InsertBoulevardSyncHistory,
  type Market, type Location, type Container, type Esthetician, type ShiftCount,
  type Receipt, type BoulevardTransaction, type Alert, type CashCollection,
  type AdminUser, type AlertRecipient, type AppSetting, type BoulevardSyncHistory as BoulevardSyncHistoryType,
} from "@shared/schema";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool);

export interface IStorage {
  // Markets
  getMarkets(): Promise<Market[]>;
  createMarket(data: InsertMarket): Promise<Market>;
  deleteMarket(id: number): Promise<void>;

  // Locations
  getLocations(): Promise<Location[]>;
  getLocation(id: number): Promise<(Location & { marketName: string }) | undefined>;
  getLocationsWithMarket(): Promise<(Location & { marketName: string })[]>;
  getLocationsWithContainers(): Promise<(Location & { marketName: string; containers: Container[] })[]>;
  createLocation(data: InsertLocation): Promise<Location>;
  updateLocation(id: number, data: Partial<InsertLocation>): Promise<void>;
  deleteLocation(id: number): Promise<void>;

  // Containers
  getContainersByLocation(locationId: number): Promise<Container[]>;
  getContainerOptions(): Promise<any[]>;
  getContainer(id: number): Promise<Container | undefined>;
  createContainer(data: InsertContainer): Promise<Container>;
  updateContainer(id: number, data: Partial<InsertContainer>): Promise<void>;
  updateContainerBalance(id: number, balance: string): Promise<void>;
  deleteContainer(id: number): Promise<void>;

  // Estheticians
  getEstheticians(): Promise<Esthetician[]>;
  getEsthetician(id: number): Promise<Esthetician | undefined>;
  getEstheticianByBoulevardId(boulevardStaffId: string): Promise<Esthetician | undefined>;
  getEstheticiansByLocation(locationId: number): Promise<Esthetician[]>;
  createEsthetician(data: InsertEsthetician): Promise<Esthetician>;
  updateEsthetician(id: number, data: Partial<InsertEsthetician>): Promise<void>;
  upsertEstheticianFromBoulevard(data: { name: string; boulevardStaffId: string }): Promise<Esthetician>;
  setEstheticianLocations(estheticianId: number, locationIds: number[]): Promise<void>;
  deactivateEstheticiansNotIn(boulevardStaffIds: string[]): Promise<number>;
  deleteEsthetician(id: number): Promise<void>;

  // Shift Counts
  getShiftCounts(): Promise<any[]>;
  createShiftCount(data: InsertShiftCount): Promise<ShiftCount>;
  getLastShiftCountForContainer(containerId: number): Promise<ShiftCount | undefined>;

  // Receipts
  getReceipts(): Promise<any[]>;
  createReceipt(data: InsertReceipt): Promise<Receipt>;
  getReceipt(id: number): Promise<Receipt | undefined>;
  getReceiptsTotalForContainer(containerId: number, since?: Date): Promise<number>;

  // Boulevard Transactions
  getBoulevardTransactions(): Promise<any[]>;
  createBoulevardTransaction(data: InsertBoulevardTransaction): Promise<BoulevardTransaction>;
  getBoulevardCashForLocation(locationId: number, since?: Date): Promise<number>;

  // Alerts
  getAlerts(): Promise<Alert[]>;
  getActiveAlertCounts(): Promise<{ variances: number; missingEndShifts: number }>;
  createAlert(data: InsertAlert): Promise<Alert>;
  updateAlertStatus(id: number, status: string): Promise<void>;
  hasAlertForShiftCount(shiftCountId: number, type: string): Promise<boolean>;

  // Cash Collections
  getCollections(): Promise<any[]>;
  createCollection(data: InsertCashCollection): Promise<CashCollection>;
  getLastCollectionForContainer(containerId: number): Promise<CashCollection | undefined>;

  // Admin Users
  getAdminUsers(): Promise<AdminUser[]>;
  getAdminByEmail(email: string): Promise<AdminUser | undefined>;
  createAdminUser(data: InsertAdminUser): Promise<AdminUser>;
  deleteAdminUser(id: number): Promise<void>;

  // Alert Recipients
  getAlertRecipients(): Promise<AlertRecipient[]>;
  createAlertRecipient(data: InsertAlertRecipient): Promise<AlertRecipient>;
  updateAlertRecipient(id: number, data: Partial<InsertAlertRecipient>): Promise<void>;
  deleteAlertRecipient(id: number): Promise<void>;

  // App Settings
  getSettings(): Promise<AppSetting[]>;
  getSetting(key: string): Promise<string | null>;
  upsertSetting(key: string, value: string): Promise<void>;

  // Dashboard
  getDashboardStats(): Promise<any>;

  // Efficient queries for missing shift checks
  getOpenStartShifts(olderThan: Date): Promise<any[]>;
  getReceiptsCountSince(since: Date): Promise<number>;

  // Boulevard Sync History
  createSyncHistoryEntry(data: InsertBoulevardSyncHistory): Promise<BoulevardSyncHistoryType>;
  completeSyncHistoryEntry(id: number, status: "success" | "error", transactionsImported: number, errorMessage?: string): Promise<void>;
  getSyncHistory(limit?: number): Promise<BoulevardSyncHistoryType[]>;
  getLastSyncForLocation(locationId: number): Promise<BoulevardSyncHistoryType | undefined>;
  getLastSyncOverall(): Promise<BoulevardSyncHistoryType | undefined>;
  getRecentSyncStats(): Promise<{ totalImported: number; lastSyncAt: string | null }>;
}

export class DatabaseStorage implements IStorage {
  // Markets
  async getMarkets() {
    return db.select().from(markets).orderBy(markets.name);
  }

  async createMarket(data: InsertMarket) {
    const [market] = await db.insert(markets).values(data).returning();
    return market;
  }

  async deleteMarket(id: number) {
    const marketLocations = await db.select({ id: locations.id }).from(locations).where(eq(locations.marketId, id));
    for (const loc of marketLocations) {
      await this.deleteLocation(loc.id);
    }
    await db.delete(markets).where(eq(markets.id, id));
  }

  // Locations
  async getLocations() {
    return db.select().from(locations).orderBy(locations.name);
  }

  async getLocation(id: number) {
    const [result] = await db
      .select({
        id: locations.id,
        name: locations.name,
        marketId: locations.marketId,
        type: locations.type,
        timezone: locations.timezone,
        dailyFloat: locations.dailyFloat,
        boulevardLocationId: locations.boulevardLocationId,
        createdAt: locations.createdAt,
        marketName: markets.name,
      })
      .from(locations)
      .innerJoin(markets, eq(locations.marketId, markets.id))
      .where(eq(locations.id, id));
    return result as (Location & { marketName: string }) | undefined;
  }

  async getBoulevardMappedLocations() {
    const result = await db
      .select({
        id: locations.id,
        name: locations.name,
        boulevardLocationId: locations.boulevardLocationId,
      })
      .from(locations)
      .where(sql`${locations.boulevardLocationId} IS NOT NULL`);
    return result;
  }

  async getLocationsWithMarket() {
    const result = await db
      .select({
        id: locations.id,
        name: locations.name,
        marketId: locations.marketId,
        type: locations.type,
        timezone: locations.timezone,
        dailyFloat: locations.dailyFloat,
        createdAt: locations.createdAt,
        marketName: markets.name,
      })
      .from(locations)
      .innerJoin(markets, eq(locations.marketId, markets.id))
      .orderBy(markets.name, locations.name);
    return result as (Location & { marketName: string })[];
  }

  async getLocationsWithContainers() {
    const locs = await this.getLocationsWithMarket();
    const allContainers = await db.select().from(containers).orderBy(containers.name);
    return locs.map((loc) => ({
      ...loc,
      containers: allContainers.filter((c) => c.locationId === loc.id),
    }));
  }

  async createLocation(data: InsertLocation) {
    const [location] = await db.insert(locations).values(data).returning();
    if (data.type === "flagship") {
      await db.insert(containers).values({
        name: "Main Till",
        locationId: location.id,
        currentBalance: data.dailyFloat || "20.00",
      });
    }
    return location;
  }

  async updateLocation(id: number, data: Partial<InsertLocation>) {
    await db.update(locations).set(data as any).where(eq(locations.id, id));
  }

  async deleteLocation(id: number) {
    const locationContainers = await db.select({ id: containers.id }).from(containers).where(eq(containers.locationId, id));
    for (const c of locationContainers) {
      await this.deleteContainer(c.id);
    }
    await db.delete(boulevardTransactions).where(eq(boulevardTransactions.locationId, id));
    await db.delete(locations).where(eq(locations.id, id));
  }

  // Containers
  async getContainersByLocation(locationId: number) {
    return db.select().from(containers).where(eq(containers.locationId, locationId)).orderBy(containers.name);
  }

  async getContainerOptions() {
    const result = await db
      .select({
        id: containers.id,
        name: containers.name,
        locationId: containers.locationId,
        currentBalance: containers.currentBalance,
        locationName: locations.name,
        marketName: markets.name,
      })
      .from(containers)
      .innerJoin(locations, eq(containers.locationId, locations.id))
      .innerJoin(markets, eq(locations.marketId, markets.id))
      .orderBy(markets.name, locations.name, containers.name);
    return result;
  }

  async getContainer(id: number) {
    const [container] = await db.select().from(containers).where(eq(containers.id, id));
    return container;
  }

  async createContainer(data: InsertContainer) {
    const [container] = await db.insert(containers).values(data).returning();
    return container;
  }

  async updateContainer(id: number, data: Partial<InsertContainer>) {
    await db.update(containers).set(data as any).where(eq(containers.id, id));
  }

  async updateContainerBalance(id: number, balance: string) {
    await db.update(containers).set({ currentBalance: balance }).where(eq(containers.id, id));
  }

  async deleteContainer(id: number) {
    const containerReceipts = await db.select({ id: receipts.id }).from(receipts).where(eq(receipts.containerId, id));
    const receiptIds = containerReceipts.map(r => r.id);
    if (receiptIds.length > 0) {
      await db.delete(alerts).where(inArray(alerts.receiptId, receiptIds));
    }
    const containerShifts = await db.select({ id: shiftCounts.id }).from(shiftCounts).where(eq(shiftCounts.containerId, id));
    const shiftIds = containerShifts.map(s => s.id);
    if (shiftIds.length > 0) {
      await db.delete(alerts).where(inArray(alerts.shiftCountId, shiftIds));
      await db.delete(receipts).where(inArray(receipts.shiftCountId, shiftIds));
    }
    await db.delete(receipts).where(eq(receipts.containerId, id));
    await db.delete(shiftCounts).where(eq(shiftCounts.containerId, id));
    await db.delete(cashCollections).where(eq(cashCollections.containerId, id));
    await db.delete(containers).where(eq(containers.id, id));
  }

  // Estheticians
  async getEstheticians() {
    return db.select().from(estheticians).orderBy(estheticians.name);
  }

  async getEstheticiansWithLocations() {
    const allEsth = await db.select().from(estheticians).orderBy(estheticians.name);
    const allAssignments = await db
      .select({
        estheticianId: estheticianLocations.estheticianId,
        locationId: estheticianLocations.locationId,
        locationName: locations.name,
        marketName: markets.name,
      })
      .from(estheticianLocations)
      .innerJoin(locations, eq(estheticianLocations.locationId, locations.id))
      .innerJoin(markets, eq(locations.marketId, markets.id));

    return allEsth.map(e => ({
      ...e,
      locations: allAssignments
        .filter(a => a.estheticianId === e.id)
        .map(a => ({ locationId: a.locationId, locationName: a.locationName, marketName: a.marketName })),
    }));
  }

  async getEsthetician(id: number) {
    const [esth] = await db.select().from(estheticians).where(eq(estheticians.id, id));
    return esth;
  }

  async getEstheticianByBoulevardId(boulevardStaffId: string) {
    const [esth] = await db.select().from(estheticians).where(eq(estheticians.boulevardStaffId, boulevardStaffId));
    return esth;
  }

  async getEstheticiansByLocation(locationId: number) {
    const result = await db
      .select({ esthetician: estheticians })
      .from(estheticianLocations)
      .innerJoin(estheticians, eq(estheticianLocations.estheticianId, estheticians.id))
      .where(and(
        eq(estheticianLocations.locationId, locationId),
        eq(estheticians.active, true)
      ))
      .orderBy(estheticians.name);
    return result.map(r => r.esthetician);
  }

  async createEsthetician(data: InsertEsthetician) {
    const [esth] = await db.insert(estheticians).values(data).returning();
    return esth;
  }

  async updateEsthetician(id: number, data: Partial<InsertEsthetician>) {
    await db.update(estheticians).set(data).where(eq(estheticians.id, id));
  }

  async upsertEstheticianFromBoulevard(data: { name: string; boulevardStaffId: string }) {
    // Check if already linked by Boulevard ID
    let esth = await this.getEstheticianByBoulevardId(data.boulevardStaffId);
    if (esth) {
      // Update name if changed
      if (esth.name !== data.name || !esth.active) {
        await db.update(estheticians).set({
          name: data.name,
          active: true,
          lastSyncedAt: new Date(),
        } as any).where(eq(estheticians.id, esth.id));
      } else {
        await db.update(estheticians).set({
          lastSyncedAt: new Date(),
        } as any).where(eq(estheticians.id, esth.id));
      }
      return { ...esth, name: data.name, active: true };
    }

    // Try to match by name (for existing manually-added estheticians)
    const [nameMatch] = await db.select().from(estheticians)
      .where(and(
        eq(estheticians.name, data.name),
        sql`${estheticians.boulevardStaffId} IS NULL`
      ));
    if (nameMatch) {
      await db.update(estheticians).set({
        boulevardStaffId: data.boulevardStaffId,
        active: true,
        lastSyncedAt: new Date(),
      } as any).where(eq(estheticians.id, nameMatch.id));
      return { ...nameMatch, boulevardStaffId: data.boulevardStaffId, active: true };
    }

    // Create new
    const [created] = await db.insert(estheticians).values({
      name: data.name,
      boulevardStaffId: data.boulevardStaffId,
      active: true,
      lastSyncedAt: new Date(),
    } as any).returning();
    return created;
  }

  async setEstheticianLocations(estheticianId: number, locationIds: number[]) {
    // Remove existing assignments
    await db.delete(estheticianLocations).where(eq(estheticianLocations.estheticianId, estheticianId));
    // Add new assignments
    if (locationIds.length > 0) {
      await db.insert(estheticianLocations).values(
        locationIds.map(locationId => ({ estheticianId, locationId } as any))
      );
    }
  }

  async deactivateEstheticiansNotIn(boulevardStaffIds: string[]) {
    if (boulevardStaffIds.length === 0) return 0;
    // Deactivate estheticians that have a boulevardStaffId but are not in the list
    const result = await db.update(estheticians).set({ active: false })
      .where(and(
        sql`${estheticians.boulevardStaffId} IS NOT NULL`,
        boulevardStaffIds.length > 0
          ? sql`${estheticians.boulevardStaffId} NOT IN (${sql.join(boulevardStaffIds.map(id => sql`${id}`), sql`, `)})`
          : sql`TRUE`
      ));
    return 0; // Drizzle doesn't return affected count easily
  }

  async deleteEsthetician(id: number) {
    const esthReceipts = await db.select({ id: receipts.id }).from(receipts).where(eq(receipts.estheticianId, id));
    const receiptIds = esthReceipts.map(r => r.id);
    if (receiptIds.length > 0) {
      await db.delete(alerts).where(inArray(alerts.receiptId, receiptIds));
    }
    const esthShifts = await db.select({ id: shiftCounts.id }).from(shiftCounts).where(eq(shiftCounts.estheticianId, id));
    const shiftIds = esthShifts.map(s => s.id);
    if (shiftIds.length > 0) {
      await db.delete(alerts).where(inArray(alerts.shiftCountId, shiftIds));
      await db.delete(receipts).where(inArray(receipts.shiftCountId, shiftIds));
    }
    await db.delete(receipts).where(eq(receipts.estheticianId, id));
    await db.delete(shiftCounts).where(eq(shiftCounts.estheticianId, id));
    await db.delete(estheticians).where(eq(estheticians.id, id));
  }

  // Shift Counts
  async getShiftCounts() {
    const result = await db
      .select({
        id: shiftCounts.id,
        containerId: shiftCounts.containerId,
        estheticianId: shiftCounts.estheticianId,
        type: shiftCounts.type,
        countedAmount: shiftCounts.countedAmount,
        expectedAmount: shiftCounts.expectedAmount,
        discrepancyNote: shiftCounts.discrepancyNote,
        createdAt: shiftCounts.createdAt,
        containerName: containers.name,
        locationName: locations.name,
        marketName: markets.name,
        estheticianName: estheticians.name,
      })
      .from(shiftCounts)
      .innerJoin(containers, eq(shiftCounts.containerId, containers.id))
      .innerJoin(locations, eq(containers.locationId, locations.id))
      .innerJoin(markets, eq(locations.marketId, markets.id))
      .innerJoin(estheticians, eq(shiftCounts.estheticianId, estheticians.id))
      .orderBy(desc(shiftCounts.createdAt));
    return result;
  }

  async createShiftCount(data: InsertShiftCount) {
    const [sc] = await db.insert(shiftCounts).values(data).returning();
    return sc;
  }

  async getLastShiftCountForContainer(containerId: number) {
    const [last] = await db
      .select()
      .from(shiftCounts)
      .where(eq(shiftCounts.containerId, containerId))
      .orderBy(desc(shiftCounts.createdAt))
      .limit(1);
    return last;
  }

  // Receipts
  async getReceipts() {
    const result = await db
      .select({
        id: receipts.id,
        containerId: receipts.containerId,
        shiftCountId: receipts.shiftCountId,
        estheticianId: receipts.estheticianId,
        amount: receipts.amount,
        filePath: receipts.filePath,
        fileName: receipts.fileName,
        note: receipts.note,
        createdAt: receipts.createdAt,
        containerName: containers.name,
        locationName: locations.name,
        marketName: markets.name,
        estheticianName: estheticians.name,
      })
      .from(receipts)
      .innerJoin(containers, eq(receipts.containerId, containers.id))
      .innerJoin(locations, eq(containers.locationId, locations.id))
      .innerJoin(markets, eq(locations.marketId, markets.id))
      .innerJoin(estheticians, eq(receipts.estheticianId, estheticians.id))
      .orderBy(desc(receipts.createdAt));
    return result;
  }

  async createReceipt(data: InsertReceipt) {
    const [receipt] = await db.insert(receipts).values(data).returning();
    return receipt;
  }

  async getReceipt(id: number) {
    const [receipt] = await db.select().from(receipts).where(eq(receipts.id, id));
    return receipt;
  }

  async getReceiptsTotalForContainer(containerId: number, since?: Date) {
    const conditions = [eq(receipts.containerId, containerId)];
    if (since) conditions.push(gte(receipts.createdAt, since));
    const result = await db
      .select({ total: sql<string>`COALESCE(SUM(${receipts.amount}::numeric), 0)` })
      .from(receipts)
      .where(and(...conditions));
    return parseFloat(result[0]?.total || "0");
  }

  // Boulevard
  async getBoulevardTransactions() {
    const result = await db
      .select({
        id: boulevardTransactions.id,
        date: boulevardTransactions.date,
        locationId: boulevardTransactions.locationId,
        orderId: boulevardTransactions.orderId,
        amount: boulevardTransactions.amount,
        operatorName: boulevardTransactions.operatorName,
        clientName: boulevardTransactions.clientName,
        paymentMethod: boulevardTransactions.paymentMethod,
        importedAt: boulevardTransactions.importedAt,
        locationName: locations.name,
        marketName: markets.name,
      })
      .from(boulevardTransactions)
      .innerJoin(locations, eq(boulevardTransactions.locationId, locations.id))
      .innerJoin(markets, eq(locations.marketId, markets.id))
      .orderBy(desc(boulevardTransactions.date));
    return result;
  }

  async createBoulevardTransaction(data: InsertBoulevardTransaction) {
    const [tx] = await db.insert(boulevardTransactions).values(data).returning();
    return tx;
  }

  async getBoulevardCashForLocation(locationId: number, since?: Date) {
    const conditions = [eq(boulevardTransactions.locationId, locationId)];
    if (since) conditions.push(gte(boulevardTransactions.date, since));
    const result = await db
      .select({ total: sql<string>`COALESCE(SUM(${boulevardTransactions.amount}::numeric), 0)` })
      .from(boulevardTransactions)
      .where(and(...conditions));
    return parseFloat(result[0]?.total || "0");
  }

  // Alerts
  async getAlerts() {
    return db.select().from(alerts).orderBy(desc(alerts.createdAt));
  }

  async getActiveAlertCounts() {
    const result = await db
      .select({
        type: alerts.type,
        count: sql<string>`COUNT(*)`,
      })
      .from(alerts)
      .where(eq(alerts.status, "active"))
      .groupBy(alerts.type);

    let variances = 0;
    let missingEndShifts = 0;
    for (const row of result) {
      const count = parseInt(row.count);
      if (["start_mismatch", "end_mismatch", "collection_mismatch"].includes(row.type)) {
        variances += count;
      } else if (row.type === "missing_end_shift") {
        missingEndShifts += count;
      }
    }
    return { variances, missingEndShifts };
  }

  async hasAlertForShiftCount(shiftCountId: number, type: string) {
    const [result] = await db
      .select({ count: sql<string>`COUNT(*)` })
      .from(alerts)
      .where(and(eq(alerts.shiftCountId, shiftCountId), eq(alerts.type, type as any)));
    return parseInt(result?.count || "0") > 0;
  }

  async createAlert(data: InsertAlert) {
    const [alert] = await db.insert(alerts).values(data).returning();
    return alert;
  }

  async updateAlertStatus(id: number, status: string) {
    await db.update(alerts).set({ status: status as any }).where(eq(alerts.id, id));
  }

  // Collections
  async getCollections() {
    const result = await db
      .select({
        id: cashCollections.id,
        containerId: cashCollections.containerId,
        expectedAmount: cashCollections.expectedAmount,
        collectedAmount: cashCollections.collectedAmount,
        collectorName: cashCollections.collectorName,
        note: cashCollections.note,
        createdAt: cashCollections.createdAt,
        containerName: containers.name,
        locationName: locations.name,
        marketName: markets.name,
      })
      .from(cashCollections)
      .innerJoin(containers, eq(cashCollections.containerId, containers.id))
      .innerJoin(locations, eq(containers.locationId, locations.id))
      .innerJoin(markets, eq(locations.marketId, markets.id))
      .orderBy(desc(cashCollections.createdAt));
    return result;
  }

  async createCollection(data: InsertCashCollection) {
    const [collection] = await db.insert(cashCollections).values(data).returning();
    return collection;
  }

  async getLastCollectionForContainer(containerId: number) {
    const [last] = await db
      .select()
      .from(cashCollections)
      .where(eq(cashCollections.containerId, containerId))
      .orderBy(desc(cashCollections.createdAt))
      .limit(1);
    return last;
  }

  // Admin Users
  async getAdminUsers() {
    return db.select().from(adminUsers).orderBy(adminUsers.email);
  }

  async getAdminByEmail(email: string) {
    const [user] = await db.select().from(adminUsers).where(eq(adminUsers.email, email));
    return user;
  }

  async createAdminUser(data: InsertAdminUser) {
    const [user] = await db.insert(adminUsers).values(data).returning();
    return user;
  }

  async deleteAdminUser(id: number) {
    await db.delete(adminUsers).where(eq(adminUsers.id, id));
  }

  // Alert Recipients
  async getAlertRecipients() {
    return db.select().from(alertRecipients).orderBy(alertRecipients.name);
  }

  async createAlertRecipient(data: InsertAlertRecipient) {
    const [r] = await db.insert(alertRecipients).values(data).returning();
    return r;
  }

  async updateAlertRecipient(id: number, data: Partial<InsertAlertRecipient>) {
    await db.update(alertRecipients).set(data).where(eq(alertRecipients.id, id));
  }

  async deleteAlertRecipient(id: number) {
    await db.delete(alertRecipients).where(eq(alertRecipients.id, id));
  }

  // Settings
  async getSettings() {
    return db.select().from(appSettings);
  }

  async getSetting(key: string) {
    const [setting] = await db.select().from(appSettings).where(eq(appSettings.key, key));
    return setting?.value ?? null;
  }

  async upsertSetting(key: string, value: string) {
    await db
      .insert(appSettings)
      .values({ key, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value } });
  }

  // Dashboard
  async getDashboardStats() {
    // Efficient: get alert counts with a single grouped query
    const alertCounts = await this.getActiveAlertCounts();

    // Efficient: count today's receipts directly in SQL
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const receiptsTodayCount = await this.getReceiptsCountSince(today);

    // Recent alerts (only fetch 10)
    const recentAlerts = await db.select().from(alerts).orderBy(desc(alerts.createdAt)).limit(10);

    const containerOpts = await this.getContainerOptions();

    // Batch fetch last shift counts and collections for all containers
    const containerIds = containerOpts.map(c => c.id);

    // Get last shift count per container using a single query with DISTINCT ON
    const lastShifts = containerIds.length > 0 ? await db.execute(sql`
      SELECT DISTINCT ON (container_id) *
      FROM shift_counts
      WHERE container_id = ANY(${sql.raw(`ARRAY[${containerIds.join(",")}]`)})
      ORDER BY container_id, created_at DESC
    `) : [];

    const lastCollections = containerIds.length > 0 ? await db.execute(sql`
      SELECT DISTINCT ON (container_id) *
      FROM cash_collections
      WHERE container_id = ANY(${sql.raw(`ARRAY[${containerIds.join(",")}]`)})
      ORDER BY container_id, created_at DESC
    `) : [];

    // Index by container ID for O(1) lookups
    const shiftsByContainer = new Map<number, any>();
    for (const row of lastShifts as any[]) {
      shiftsByContainer.set(row.container_id, row);
    }
    const collectionsByContainer = new Map<number, any>();
    for (const row of lastCollections as any[]) {
      collectionsByContainer.set(row.container_id, row);
    }

    // Calculate cash positions — still need per-container boulevard/receipt sums
    // but avoid refetching container data
    const cashPositions = await Promise.all(
      containerOpts.map(async (c) => {
        const lastShift = shiftsByContainer.get(c.id);
        const lastCollection = collectionsByContainer.get(c.id);

        const shiftTime = lastShift?.created_at ? new Date(lastShift.created_at).getTime() : 0;
        const collectionTime = lastCollection?.created_at ? new Date(lastCollection.created_at).getTime() : 0;

        let baseAmount: string;
        let sinceDate: Date | undefined;

        if (collectionTime > shiftTime) {
          baseAmount = "0.00";
          sinceDate = new Date(lastCollection.created_at);
        } else {
          baseAmount = lastShift?.counted_amount || c.currentBalance || "0.00";
          sinceDate = lastShift?.created_at ? new Date(lastShift.created_at) : undefined;
        }

        const boulevardCash = await this.getBoulevardCashForLocation(c.locationId, sinceDate);
        const receiptSpent = await this.getReceiptsTotalForContainer(c.id, sinceDate);
        const expectedCash = (parseFloat(baseAmount) + boulevardCash - receiptSpent).toFixed(2);
        return { ...c, expectedCash };
      })
    );

    return {
      openVariances: alertCounts.variances,
      missingEndShifts: alertCounts.missingEndShifts,
      receiptsToday: receiptsTodayCount,
      totalContainers: containerOpts.length,
      recentAlerts,
      cashPositions,
    };
  }

  // Efficient query: count receipts since a given date
  async getReceiptsCountSince(since: Date) {
    const [result] = await db
      .select({ count: sql<string>`COUNT(*)` })
      .from(receipts)
      .where(gte(receipts.createdAt, since));
    return parseInt(result?.count || "0");
  }

  // Efficient query: find start shifts older than a given date with no matching end shift
  async getOpenStartShifts(olderThan: Date) {
    // Get start shifts that are old enough and haven't been closed
    const result = await db
      .select({
        id: shiftCounts.id,
        containerId: shiftCounts.containerId,
        estheticianId: shiftCounts.estheticianId,
        createdAt: shiftCounts.createdAt,
        containerName: containers.name,
        locationName: locations.name,
        marketName: markets.name,
        estheticianName: estheticians.name,
      })
      .from(shiftCounts)
      .innerJoin(containers, eq(shiftCounts.containerId, containers.id))
      .innerJoin(locations, eq(containers.locationId, locations.id))
      .innerJoin(markets, eq(locations.marketId, markets.id))
      .innerJoin(estheticians, eq(shiftCounts.estheticianId, estheticians.id))
      .where(and(
        eq(shiftCounts.type, "start"),
        lt(shiftCounts.createdAt, olderThan)
      ));

    // Filter out those that have a corresponding end shift after the start
    const openShifts = [];
    for (const startShift of result) {
      const [endShift] = await db
        .select({ id: shiftCounts.id })
        .from(shiftCounts)
        .where(and(
          eq(shiftCounts.type, "end"),
          eq(shiftCounts.containerId, startShift.containerId),
          eq(shiftCounts.estheticianId, startShift.estheticianId),
          gte(shiftCounts.createdAt, startShift.createdAt!)
        ))
        .limit(1);

      if (!endShift) {
        openShifts.push(startShift);
      }
    }
    return openShifts;
  }

  // Boulevard Sync History
  async createSyncHistoryEntry(data: InsertBoulevardSyncHistory) {
    const [entry] = await db.insert(boulevardSyncHistory).values(data as any).returning();
    return entry;
  }

  async completeSyncHistoryEntry(id: number, status: "success" | "error", transactionsImported: number, errorMessage?: string) {
    await db.update(boulevardSyncHistory).set({
      status: status as any,
      transactionsImported,
      errorMessage: errorMessage || null,
      completedAt: new Date(),
    }).where(eq(boulevardSyncHistory.id, id));
  }

  async getSyncHistory(limit = 50) {
    return db.select().from(boulevardSyncHistory).orderBy(desc(boulevardSyncHistory.startedAt)).limit(limit);
  }

  async getLastSyncForLocation(locationId: number) {
    const [last] = await db.select().from(boulevardSyncHistory)
      .where(eq(boulevardSyncHistory.locationId, locationId))
      .orderBy(desc(boulevardSyncHistory.startedAt))
      .limit(1);
    return last;
  }

  async getLastSyncOverall() {
    const [last] = await db.select().from(boulevardSyncHistory)
      .orderBy(desc(boulevardSyncHistory.startedAt))
      .limit(1);
    return last;
  }

  async getRecentSyncStats() {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [result] = await db.select({
      totalImported: sql<string>`COALESCE(SUM(${boulevardSyncHistory.transactionsImported}), 0)`,
      lastSyncAt: sql<string>`MAX(${boulevardSyncHistory.completedAt})`,
    }).from(boulevardSyncHistory)
      .where(and(
        eq(boulevardSyncHistory.status, "success"),
        gte(boulevardSyncHistory.startedAt, oneDayAgo)
      ));
    return {
      totalImported: parseInt(result?.totalImported || "0"),
      lastSyncAt: result?.lastSyncAt || null,
    };
  }
}

export const storage = new DatabaseStorage();
