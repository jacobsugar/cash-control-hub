import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import multer from "multer";
import path from "path";
import fs from "fs";
import { parse } from "csv-parse/sync";
import session from "express-session";

const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      cb(null, uniqueSuffix + path.extname(file.originalname));
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

declare module "express-session" {
  interface SessionData {
    adminEmail?: string;
    adminRole?: string;
  }
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.session?.adminEmail) {
    return next();
  }
  res.status(401).json({ message: "Unauthorized" });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Session setup
  app.use(session({
    secret: process.env.SESSION_SECRET || "cashcontrol-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 },
  }));

  // Admin login (email-based for MVP, Google OAuth can be added later)
  app.post("/api/admin/login", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ message: "Email required" });

      const admin = await storage.getAdminByEmail(email);
      if (!admin) return res.status(403).json({ message: "Not authorized. Email not on allowlist." });

      req.session.adminEmail = admin.email;
      req.session.adminRole = admin.role;
      res.json({ email: admin.email, name: admin.name, role: admin.role });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/me", async (req, res) => {
    if (!req.session?.adminEmail) return res.status(401).json({ message: "Not authenticated" });
    const admin = await storage.getAdminByEmail(req.session.adminEmail);
    if (!admin) return res.status(401).json({ message: "Not authorized" });
    res.json({ email: admin.email, name: admin.name, role: admin.role });
  });

  app.post("/api/admin/logout", (req, res) => {
    req.session.destroy(() => {});
    res.json({ success: true });
  });

  // Schedule missing end-of-shift check daily at 9 PM Pacific Time
  function scheduleDailyCheck() {
    const now = new Date();
    const pt = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
    const target = new Date(pt);
    target.setHours(21, 0, 0, 0);
    if (pt >= target) {
      target.setDate(target.getDate() + 1);
    }
    const ptOffset = pt.getTime() - now.getTime();
    const msUntilTarget = target.getTime() - pt.getTime();

    setTimeout(async () => {
      try {
        await checkMissingEndShifts();
      } catch (err) {
        console.error("Missing end shift check error:", err);
      }
      scheduleDailyCheck();
    }, msUntilTarget);

    const hours = Math.floor(msUntilTarget / 3600000);
    const mins = Math.floor((msUntilTarget % 3600000) / 60000);
    console.log(`Next missing-end-shift check scheduled in ${hours}h ${mins}m (9 PM PT)`);
  }
  scheduleDailyCheck();

  // ===== PUBLIC ROUTES (esthetician-facing, no auth) =====

  // Markets list
  app.get("/api/markets", async (_req, res) => {
    try {
      const data = await storage.getMarkets();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Estheticians list
  app.get("/api/estheticians", async (_req, res) => {
    try {
      const data = await storage.getEstheticians();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Locations with market name
  app.get("/api/locations/with-market", async (_req, res) => {
    try {
      const data = await storage.getLocationsWithMarket();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Containers by location
  app.get("/api/containers/:locationId", async (req, res) => {
    try {
      const data = await storage.getContainersByLocation(parseInt(req.params.locationId));
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Prior shift count for a container
  app.get("/api/containers/:containerId/prior", async (req, res) => {
    try {
      const containerId = parseInt(req.params.containerId);
      const container = await storage.getContainer(containerId);
      if (!container) return res.status(404).json({ message: "Container not found" });

      const last = await storage.getLastShiftCountForContainer(containerId);
      const priorAmount = last?.countedAmount || container.currentBalance || "0.00";
      const sinceDate = last?.createdAt || undefined;

      const boulevardCash = await storage.getBoulevardCashForContainer(containerId, sinceDate ? new Date(sinceDate) : undefined);
      const receiptSpent = await storage.getReceiptsTotalForContainer(containerId, sinceDate ? new Date(sinceDate) : undefined);

      const expectedAmount = (
        parseFloat(priorAmount) + boulevardCash - receiptSpent
      ).toFixed(2);

      res.json({ amount: priorAmount, expectedAmount });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Submit shift count
  app.post("/api/shift-counts", async (req, res) => {
    try {
      const { containerId, estheticianId, type, countedAmount, expectedAmount, discrepancyNote } = req.body;

      const shiftCount = await storage.createShiftCount({
        containerId,
        estheticianId,
        type,
        countedAmount,
        expectedAmount,
        discrepancyNote,
      });

      // Update container balance
      await storage.updateContainerBalance(containerId, countedAmount);

      // Check for mismatch and create alert
      if (expectedAmount && parseFloat(countedAmount) !== parseFloat(expectedAmount)) {
        const container = await storage.getContainer(containerId);
        const locationsWithMarket = await storage.getLocationsWithMarket();
        const loc = locationsWithMarket.find((l) => l.id === container?.locationId);
        const estheticianList = await storage.getEstheticians();
        const esth = estheticianList.find((e) => e.id === estheticianId);

        await storage.createAlert({
          type: type === "start" ? "start_mismatch" : "end_mismatch",
          staffName: esth?.name || null,
          marketName: loc?.marketName || null,
          locationName: loc?.name || null,
          containerName: container?.name || null,
          expectedAmount,
          actualAmount: countedAmount,
          note: discrepancyNote,
          shiftCountId: shiftCount.id,
        });
      }

      res.json(shiftCount);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Upload receipt
  app.post("/api/receipts", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).send("No file uploaded");

      const { containerId, estheticianId, amount, note, shiftCountId } = req.body;

      const receipt = await storage.createReceipt({
        containerId: parseInt(containerId),
        estheticianId: parseInt(estheticianId),
        amount,
        filePath: req.file.path,
        fileName: req.file.originalname,
        note: note || null,
        shiftCountId: shiftCountId ? parseInt(shiftCountId) : null,
      });

      // Create alert for receipt submission
      const container = await storage.getContainer(parseInt(containerId));
      const locationsWithMarket = await storage.getLocationsWithMarket();
      const loc = locationsWithMarket.find((l) => l.id === container?.locationId);
      const estheticianList = await storage.getEstheticians();
      const esth = estheticianList.find((e) => e.id === parseInt(estheticianId));

      await storage.createAlert({
        type: "receipt_submitted",
        staffName: esth?.name || null,
        marketName: loc?.marketName || null,
        locationName: loc?.name || null,
        containerName: container?.name || null,
        actualAmount: amount,
        note: note || `Receipt: ${req.file.originalname}`,
        receiptId: receipt.id,
      });

      res.json(receipt);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Serve receipt file
  app.get("/api/receipts/:id/file", async (req, res) => {
    try {
      const receipt = await storage.getReceipt(parseInt(req.params.id));
      if (!receipt) return res.status(404).json({ message: "Receipt not found" });
      if (!fs.existsSync(receipt.filePath)) return res.status(404).json({ message: "File not found" });
      res.sendFile(receipt.filePath);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ===== ADMIN ROUTES (protected) =====

  // Markets CRUD
  app.post("/api/markets", requireAdmin, async (req, res) => {
    try {
      const market = await storage.createMarket(req.body);
      res.json(market);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/markets/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deleteMarket(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      if (err.code === "23503") {
        res.status(409).json({ message: "Cannot delete this market because it still has locations. Please delete or reassign its locations first." });
      } else {
        res.status(500).json({ message: err.message });
      }
    }
  });

  // Locations
  app.post("/api/locations", requireAdmin, async (req, res) => {
    try {
      const location = await storage.createLocation(req.body);
      res.json(location);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/locations/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deleteLocation(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      if (err.code === "23503") {
        res.status(409).json({ message: "Cannot delete this location because it still has containers or related data. Please delete its containers first." });
      } else {
        res.status(500).json({ message: err.message });
      }
    }
  });

  // Containers
  app.post("/api/containers", requireAdmin, async (req, res) => {
    try {
      const container = await storage.createContainer(req.body);
      res.json(container);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/containers/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deleteContainer(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      if (err.code === "23503") {
        res.status(409).json({ message: "Cannot delete this container because it has shift counts or receipts linked to it. Please remove related data first." });
      } else {
        res.status(500).json({ message: err.message });
      }
    }
  });

  // Estheticians
  app.post("/api/estheticians", requireAdmin, async (req, res) => {
    try {
      const esth = await storage.createEsthetician(req.body);
      res.json(esth);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/estheticians/:id", requireAdmin, async (req, res) => {
    try {
      await storage.updateEsthetician(parseInt(req.params.id), req.body);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/estheticians/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deleteEsthetician(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      if (err.code === "23503") {
        res.status(409).json({ message: "Cannot delete this esthetician because they have shift counts or receipts linked to them." });
      } else {
        res.status(500).json({ message: err.message });
      }
    }
  });

  // Admin Dashboard
  app.get("/api/admin/dashboard", requireAdmin, async (_req, res) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Admin Shift Counts
  app.get("/api/admin/shift-counts", requireAdmin, async (_req, res) => {
    try {
      const data = await storage.getShiftCounts();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Admin Receipts
  app.get("/api/admin/receipts", requireAdmin, async (_req, res) => {
    try {
      const data = await storage.getReceipts();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Admin Alerts
  app.get("/api/admin/alerts", requireAdmin, async (_req, res) => {
    try {
      const data = await storage.getAlerts();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/admin/alerts/:id", requireAdmin, async (req, res) => {
    try {
      await storage.updateAlertStatus(parseInt(req.params.id), req.body.status);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Admin Collections
  app.get("/api/admin/collections", requireAdmin, async (_req, res) => {
    try {
      const data = await storage.getCollections();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/container-options", requireAdmin, async (_req, res) => {
    try {
      const data = await storage.getContainerOptions();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/collections", requireAdmin, async (req, res) => {
    try {
      const { containerId, expectedAmount, collectedAmount, collectorName, note } = req.body;

      const collection = await storage.createCollection({
        containerId,
        expectedAmount,
        collectedAmount,
        collectorName,
        note,
      });

      // Reset container balance to 0 after collection
      await storage.updateContainerBalance(containerId, "0.00");

      // Create alert if mismatch
      if (parseFloat(expectedAmount) !== parseFloat(collectedAmount)) {
        const container = await storage.getContainer(containerId);
        const locationsWithMarket = await storage.getLocationsWithMarket();
        const loc = locationsWithMarket.find((l) => l.id === container?.locationId);

        await storage.createAlert({
          type: "collection_mismatch",
          staffName: collectorName,
          marketName: loc?.marketName || null,
          locationName: loc?.name || null,
          containerName: container?.name || null,
          expectedAmount,
          actualAmount: collectedAmount,
          note,
        });
      }

      res.json(collection);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Admin Locations with containers
  app.get("/api/admin/locations-with-containers", requireAdmin, async (_req, res) => {
    try {
      const data = await storage.getLocationsWithContainers();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Boulevard transactions
  app.get("/api/admin/boulevard-transactions", requireAdmin, async (_req, res) => {
    try {
      const data = await storage.getBoulevardTransactions();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Boulevard CSV import
  app.post("/api/admin/boulevard/import", requireAdmin, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).send("No file uploaded");

      const fileContent = fs.readFileSync(req.file.path, "utf-8");
      const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      const locationsWithMarket = await storage.getLocationsWithMarket();
      let imported = 0;

      for (const record of records) {
        // Try to match common column names
        const dateStr = record.date || record.Date || record.transaction_date || record["Transaction Date"] || "";
        const locationStr = record.location || record.Location || record.location_name || record["Location Name"] || "";
        const appointmentId = record.appointment_id || record["Appointment ID"] || record.appointmentId || "";
        const amountStr = record.amount || record.Amount || record.total || record.Total || "0";
        const staffName = record.staff || record.Staff || record.staff_name || record["Staff Name"] || "";
        const clientName = record.client || record.Client || record.client_name || record["Client Name"] || "";
        const paymentType = record.payment_type || record["Payment Type"] || record.paymentType || record.type || "";

        // Skip non-cash if payment type is available
        if (paymentType && !paymentType.toLowerCase().includes("cash")) continue;

        // Match location
        const loc = locationsWithMarket.find(
          (l) => l.name.toLowerCase() === locationStr.toLowerCase() ||
                 `${l.marketName} - ${l.name}`.toLowerCase() === locationStr.toLowerCase()
        );

        if (!loc) continue;

        const amount = parseFloat(amountStr.replace(/[^0-9.-]/g, ""));
        if (isNaN(amount) || amount === 0) continue;

        const date = new Date(dateStr);
        if (isNaN(date.getTime())) continue;

        await storage.createBoulevardTransaction({
          date,
          locationId: loc.id,
          appointmentId: appointmentId || null,
          amount: amount.toFixed(2),
          staffName: staffName || null,
          clientName: clientName || null,
          paymentType: paymentType || "cash",
        });
        imported++;
      }

      // Clean up uploaded CSV
      fs.unlinkSync(req.file.path);

      res.json({ imported, total: records.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Admin Users
  app.get("/api/admin/users", requireAdmin, async (_req, res) => {
    try {
      const data = await storage.getAdminUsers();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/users", requireAdmin, async (req, res) => {
    try {
      const user = await storage.createAdminUser(req.body);
      res.json(user);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deleteAdminUser(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Alert Recipients
  app.get("/api/admin/alert-recipients", requireAdmin, async (_req, res) => {
    try {
      const data = await storage.getAlertRecipients();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/alert-recipients", requireAdmin, async (req, res) => {
    try {
      const r = await storage.createAlertRecipient(req.body);
      res.json(r);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/admin/alert-recipients/:id", requireAdmin, async (req, res) => {
    try {
      await storage.updateAlertRecipient(parseInt(req.params.id), req.body);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/admin/alert-recipients/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deleteAlertRecipient(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Settings
  app.get("/api/admin/settings", requireAdmin, async (_req, res) => {
    try {
      const data = await storage.getSettings();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/settings", requireAdmin, async (req, res) => {
    try {
      await storage.upsertSetting(req.body.key, req.body.value);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  return httpServer;
}

async function checkMissingEndShifts() {
  const shifts = await storage.getShiftCounts();
  const now = new Date();
  const maxShiftHours = 12;

  const startShifts = shifts.filter((s) => s.type === "start");

  for (const startShift of startShifts) {
    const startTime = new Date(startShift.createdAt!);
    const hoursSinceStart = (now.getTime() - startTime.getTime()) / (1000 * 60 * 60);

    if (hoursSinceStart < maxShiftHours) continue;

    const hasEndShift = shifts.some(
      (s) =>
        s.type === "end" &&
        s.containerId === startShift.containerId &&
        s.estheticianId === startShift.estheticianId &&
        new Date(s.createdAt!) > startTime
    );

    if (hasEndShift) continue;

    const existingAlerts = await storage.getAlerts();
    const alreadyAlerted = existingAlerts.some(
      (a) =>
        a.type === "missing_end_shift" &&
        a.shiftCountId === startShift.id
    );

    if (alreadyAlerted) continue;

    await storage.createAlert({
      type: "missing_end_shift",
      staffName: startShift.estheticianName || null,
      marketName: startShift.marketName || null,
      locationName: startShift.locationName || null,
      containerName: startShift.containerName || null,
      shiftCountId: startShift.id,
      note: `No end-of-shift count submitted within ${maxShiftHours} hours of start`,
    });
  }
}
