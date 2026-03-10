import { eq, desc, and, gte, sql, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import {
  markets, locations, containers, estheticians, shiftCounts, receipts,
  boulevardTransactions, boulevardCatalog, alerts, cashCollections, adminUsers, alertRecipients, appSettings,
  type InsertMarket, type InsertLocation, type InsertContainer, type InsertEsthetician,
  type InsertShiftCount, type InsertReceipt, type InsertBoulevardTransaction,
  type InsertBoulevardCatalogItem,
  type InsertAlert, type InsertCashCollection, type InsertAdminUser,
  type InsertAlertRecipient, type InsertAppSetting,
  type Market, type Location, type Container, type Esthetician, type ShiftCount,
  type Receipt, type BoulevardTransaction, type BoulevardCatalogItem, type Alert, type CashCollection,
  type AdminUser, type AlertRecipient, type AppSetting,
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
  getLocationsWithMarket(): Promise<(Location & { marketName: string })[]>;
  getLocationsWithContainers(): Promise<(Location & { marketName: string; containers: Container[] })[]>;
  createLocation(data: InsertLocation): Promise<Location>;
  deleteLocation(id: number): Promise<void>;

  // Containers
  getContainersByLocation(locationId: number): Promise<Container[]>;
  getContainerOptions(): Promise<any[]>;
  getContainer(id: number): Promise<Container | undefined>;
  createContainer(data: InsertContainer): Promise<Container>;
  updateContainerBalance(id: number, balance: string): Promise<void>;
  deleteContainer(id: number): Promise<void>;

  // Estheticians
  getEstheticians(): Promise<Esthetician[]>;
  createEsthetician(data: InsertEsthetician): Promise<Esthetician>;
  updateEsthetician(id: number, data: Partial<InsertEsthetician>): Promise<void>;
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
  getBoulevardCashForContainer(containerId: number, since?: Date): Promise<number>;

  // Alerts
  getAlerts(): Promise<Alert[]>;
  createAlert(data: InsertAlert): Promise<Alert>;
  updateAlertStatus(id: number, status: string): Promise<void>;

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

  // Boulevard Catalog
  getBoulevardCatalog(): Promise<BoulevardCatalogItem[]>;
  upsertBoulevardCatalogItem(data: InsertBoulevardCatalogItem): Promise<{ action: "created" | "updated" | "unchanged" }>;
  deleteBoulevardCatalogItem(id: number): Promise<void>;

  // App Settings
  getSettings(): Promise<AppSetting[]>;
  getSetting(key: string): Promise<string | null>;
  upsertSetting(key: string, value: string): Promise<void>;

  // Dashboard
  getDashboardStats(): Promise<any>;
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

  async createEsthetician(data: InsertEsthetician) {
    const [esth] = await db.insert(estheticians).values(data).returning();
    return esth;
  }

  async updateEsthetician(id: number, data: Partial<InsertEsthetician>) {
    await db.update(estheticians).set(data).where(eq(estheticians.id, id));
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

  async getBoulevardCashForContainer(containerId: number, since?: Date) {
    const container = await this.getContainer(containerId);
    if (!container) return 0;
    const conditions = [eq(boulevardTransactions.locationId, container.locationId)];
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
    const existing = await this.getSetting(key);
    if (existing !== null) {
      await db.update(appSettings).set({ value }).where(eq(appSettings.key, key));
    } else {
      await db.insert(appSettings).values({ key, value });
    }
  }

  // Boulevard Catalog
  async getBoulevardCatalog() {
    return db.select().from(boulevardCatalog).orderBy(boulevardCatalog.category, boulevardCatalog.name);
  }

  async upsertBoulevardCatalogItem(data: InsertBoulevardCatalogItem): Promise<{ action: "created" | "updated" | "unchanged" }> {
    const [existing] = await db.select().from(boulevardCatalog).where(sql`LOWER(${boulevardCatalog.name}) = LOWER(${data.name})`);
    if (!existing) {
      await db.insert(boulevardCatalog).values(data);
      return { action: "created" };
    }
    const normalizePrice = (v: string | null | undefined) => v != null ? parseFloat(v).toFixed(2) : null;
    const changes: Record<string, any> = {};
    if (data.category != null ? data.category !== existing.category : false) changes.category = data.category;
    if (normalizePrice(data.price) !== normalizePrice(existing.price)) {
      if (data.price != null) changes.price = data.price;
      else if (existing.price != null) changes.price = null;
    }
    if (data.duration != null ? data.duration !== existing.duration : false) changes.duration = data.duration;
    if (data.description != null ? data.description !== existing.description : false) changes.description = data.description;
    if (data.sku != null ? data.sku !== existing.sku : false) changes.sku = data.sku;
    if (data.itemType != null ? data.itemType !== existing.itemType : false) changes.itemType = data.itemType;
    if (Object.keys(changes).length === 0) return { action: "unchanged" };
    changes.updatedAt = new Date();
    await db.update(boulevardCatalog).set(changes).where(eq(boulevardCatalog.id, existing.id));
    return { action: "updated" };
  }

  async deleteBoulevardCatalogItem(id: number) {
    await db.delete(boulevardCatalog).where(eq(boulevardCatalog.id, id));
  }

  // Dashboard
  async getDashboardStats() {
    const allAlerts = await this.getAlerts();
    const activeAlerts = allAlerts.filter((a) => a.status === "active");
    const varianceAlerts = activeAlerts.filter((a) =>
      ["start_mismatch", "end_mismatch", "collection_mismatch"].includes(a.type)
    );
    const missingEndAlerts = activeAlerts.filter((a) => a.type === "missing_end_shift");

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const allReceipts = await this.getReceipts();
    const receiptsToday = allReceipts.filter((r) => new Date(r.createdAt) >= today);

    const containerOpts = await this.getContainerOptions();

    const cashPositions = await Promise.all(
      containerOpts.map(async (c) => {
        const lastShift = await this.getLastShiftCountForContainer(c.id);
        const lastCollection = await this.getLastCollectionForContainer(c.id);

        const shiftTime = lastShift?.createdAt ? new Date(lastShift.createdAt).getTime() : 0;
        const collectionTime = lastCollection?.createdAt ? new Date(lastCollection.createdAt).getTime() : 0;

        let baseAmount: string;
        let sinceDate: Date | undefined;

        if (collectionTime > shiftTime) {
          baseAmount = "0.00";
          sinceDate = new Date(lastCollection!.createdAt);
        } else {
          baseAmount = lastShift?.countedAmount || c.currentBalance || "0.00";
          sinceDate = lastShift?.createdAt ? new Date(lastShift.createdAt) : undefined;
        }

        const boulevardCash = await this.getBoulevardCashForContainer(c.id, sinceDate);
        const receiptSpent = await this.getReceiptsTotalForContainer(c.id, sinceDate);
        const expectedCash = (parseFloat(baseAmount) + boulevardCash - receiptSpent).toFixed(2);
        return { ...c, expectedCash };
      })
    );

    return {
      openVariances: varianceAlerts.length,
      missingEndShifts: missingEndAlerts.length,
      receiptsToday: receiptsToday.length,
      totalContainers: containerOpts.length,
      recentAlerts: allAlerts.slice(0, 10),
      cashPositions,
    };
  }
}

export const storage = new DatabaseStorage();
