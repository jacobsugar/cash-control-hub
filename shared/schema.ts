import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, decimal, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const locationTypeEnum = pgEnum("location_type", ["suite", "flagship"]);
export const shiftTypeEnum = pgEnum("shift_type", ["start", "end"]);
export const alertTypeEnum = pgEnum("alert_type", [
  "start_mismatch",
  "end_mismatch",
  "missing_end_shift",
  "missing_receipt",
  "receipt_submitted",
  "collection_mismatch",
]);
export const alertStatusEnum = pgEnum("alert_status", ["active", "resolved", "acknowledged"]);

export const markets = pgTable("markets", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const locations = pgTable("locations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  marketId: integer("market_id").notNull().references(() => markets.id),
  type: locationTypeEnum("type").notNull(),
  timezone: text("timezone").default("America/Chicago").notNull(),
  dailyFloat: decimal("daily_float", { precision: 10, scale: 2 }).default("20.00"),
  boulevardLocationId: text("boulevard_location_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const containers = pgTable("containers", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  locationId: integer("location_id").notNull().references(() => locations.id),
  currentBalance: decimal("current_balance", { precision: 10, scale: 2 }).default("0.00").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const estheticians = pgTable("estheticians", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const shiftCounts = pgTable("shift_counts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  containerId: integer("container_id").notNull().references(() => containers.id),
  estheticianId: integer("esthetician_id").notNull().references(() => estheticians.id),
  type: shiftTypeEnum("type").notNull(),
  countedAmount: decimal("counted_amount", { precision: 10, scale: 2 }).notNull(),
  expectedAmount: decimal("expected_amount", { precision: 10, scale: 2 }),
  discrepancyNote: text("discrepancy_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const receipts = pgTable("receipts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  containerId: integer("container_id").notNull().references(() => containers.id),
  shiftCountId: integer("shift_count_id").references(() => shiftCounts.id),
  estheticianId: integer("esthetician_id").notNull().references(() => estheticians.id),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  filePath: text("file_path").notNull(),
  fileName: text("file_name").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const boulevardTransactions = pgTable("boulevard_transactions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  date: timestamp("date").notNull(),
  locationId: integer("location_id").notNull().references(() => locations.id),
  orderId: text("order_id"),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  operatorName: text("operator_name"),
  clientName: text("client_name"),
  paymentMethod: text("payment_method").default("cash"),
  importedAt: timestamp("imported_at").defaultNow().notNull(),
});

export const alerts = pgTable("alerts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  type: alertTypeEnum("type").notNull(),
  status: alertStatusEnum("status").default("active").notNull(),
  staffName: text("staff_name"),
  marketName: text("market_name"),
  locationName: text("location_name"),
  containerName: text("container_name"),
  expectedAmount: decimal("expected_amount", { precision: 10, scale: 2 }),
  actualAmount: decimal("actual_amount", { precision: 10, scale: 2 }),
  note: text("note"),
  shiftCountId: integer("shift_count_id").references(() => shiftCounts.id),
  receiptId: integer("receipt_id").references(() => receipts.id),
  smsSent: boolean("sms_sent").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const cashCollections = pgTable("cash_collections", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  containerId: integer("container_id").notNull().references(() => containers.id),
  expectedAmount: decimal("expected_amount", { precision: 10, scale: 2 }).notNull(),
  collectedAmount: decimal("collected_amount", { precision: 10, scale: 2 }).notNull(),
  collectorName: text("collector_name").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const adminUsers = pgTable("admin_users", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  email: text("email").notNull().unique(),
  name: text("name"),
  role: text("role").default("manager").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const alertRecipients = pgTable("alert_recipients", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  phoneNumber: text("phone_number").notNull(),
  name: text("name"),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const appSettings = pgTable("app_settings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
});

export const boulevardSyncTypeEnum = pgEnum("boulevard_sync_type", ["auto", "manual", "count"]);
export const boulevardSyncStatusEnum = pgEnum("boulevard_sync_status", ["success", "error"]);

export const boulevardSyncHistory = pgTable("boulevard_sync_history", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  locationId: integer("location_id").notNull().references(() => locations.id),
  locationName: text("location_name").notNull(),
  syncType: boulevardSyncTypeEnum("sync_type").notNull(),
  status: boulevardSyncStatusEnum("status").notNull(),
  transactionsImported: integer("transactions_imported").default(0).notNull(),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at").notNull(),
  completedAt: timestamp("completed_at"),
});

// Insert schemas
export const insertMarketSchema = createInsertSchema(markets).omit({ id: true, createdAt: true });
export const insertLocationSchema = createInsertSchema(locations).omit({ id: true, createdAt: true });
export const insertContainerSchema = createInsertSchema(containers).omit({ id: true, createdAt: true });
export const insertEstheticianSchema = createInsertSchema(estheticians).omit({ id: true, createdAt: true });
export const insertShiftCountSchema = createInsertSchema(shiftCounts).omit({ id: true, createdAt: true });
export const insertReceiptSchema = createInsertSchema(receipts).omit({ id: true, createdAt: true });
export const insertBoulevardTransactionSchema = createInsertSchema(boulevardTransactions).omit({ id: true, importedAt: true });
export const insertAlertSchema = createInsertSchema(alerts).omit({ id: true, createdAt: true });
export const insertCashCollectionSchema = createInsertSchema(cashCollections).omit({ id: true, createdAt: true });
export const insertAdminUserSchema = createInsertSchema(adminUsers).omit({ id: true, createdAt: true });
export const insertAlertRecipientSchema = createInsertSchema(alertRecipients).omit({ id: true, createdAt: true });
export const insertAppSettingSchema = createInsertSchema(appSettings).omit({ id: true });
export const insertBoulevardSyncHistorySchema = createInsertSchema(boulevardSyncHistory).omit({ id: true });

// Insert types
export type InsertMarket = z.infer<typeof insertMarketSchema>;
export type InsertLocation = z.infer<typeof insertLocationSchema>;
export type InsertContainer = z.infer<typeof insertContainerSchema>;
export type InsertEsthetician = z.infer<typeof insertEstheticianSchema>;
export type InsertShiftCount = z.infer<typeof insertShiftCountSchema>;
export type InsertReceipt = z.infer<typeof insertReceiptSchema>;
export type InsertBoulevardTransaction = z.infer<typeof insertBoulevardTransactionSchema>;
export type InsertAlert = z.infer<typeof insertAlertSchema>;
export type InsertCashCollection = z.infer<typeof insertCashCollectionSchema>;
export type InsertAdminUser = z.infer<typeof insertAdminUserSchema>;
export type InsertAlertRecipient = z.infer<typeof insertAlertRecipientSchema>;
export type InsertAppSetting = z.infer<typeof insertAppSettingSchema>;

// Select types
export type Market = typeof markets.$inferSelect;
export type Location = typeof locations.$inferSelect;
export type Container = typeof containers.$inferSelect;
export type Esthetician = typeof estheticians.$inferSelect;
export type ShiftCount = typeof shiftCounts.$inferSelect;
export type Receipt = typeof receipts.$inferSelect;
export type BoulevardTransaction = typeof boulevardTransactions.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type CashCollection = typeof cashCollections.$inferSelect;
export type AdminUser = typeof adminUsers.$inferSelect;
export type AlertRecipient = typeof alertRecipients.$inferSelect;
export type AppSetting = typeof appSettings.$inferSelect;
export type BoulevardSyncHistory = typeof boulevardSyncHistory.$inferSelect;
export type InsertBoulevardSyncHistory = z.infer<typeof insertBoulevardSyncHistorySchema>;
