import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import multer from "multer";
import path from "path";
import fs from "fs";
import session from "express-session";
import OpenAI from "openai";
import * as boulevard from "./boulevard";

// Singleton OpenAI client — reused across requests
let openaiClient: OpenAI | null = null;
function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }
  return openaiClient;
}

function formatPhoneE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("1") && digits.length === 11) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

function buildAlertMessage(alertData: {
  type: string;
  staffName?: string | null;
  locationName?: string | null;
  containerName?: string | null;
  expectedAmount?: string | null;
  actualAmount?: string | null;
  note?: string | null;
}): string {
  const loc = alertData.locationName || "Unknown location";
  const container = alertData.containerName ? ` (${alertData.containerName})` : "";
  const staff = alertData.staffName || "Unknown";

  switch (alertData.type) {
    case "start_mismatch":
      return `CashControl Alert: Cash discrepancy at ${loc}${container}. Expected $${alertData.expectedAmount}, counted $${alertData.actualAmount} by ${staff}.${alertData.note ? ` Note: ${alertData.note}` : ""}`;
    case "receipt_submitted":
      return `CashControl: Receipt submitted at ${loc}${container} for $${alertData.actualAmount} by ${staff}.${alertData.note ? ` Note: ${alertData.note}` : ""}`;
    case "missing_end_shift":
      return `CashControl Alert: Missing end-of-shift count at ${loc}${container}. Started by ${staff} but no end count recorded.`;
    case "collection_mismatch":
      return `CashControl Alert: Collection discrepancy at ${loc}${container}. Expected $${alertData.expectedAmount}, collected $${alertData.actualAmount} by ${staff}.${alertData.note ? ` Note: ${alertData.note}` : ""}`;
    default:
      return `CashControl Alert: ${alertData.type} at ${loc}${container}.`;
  }
}

// Cache for OpenPhone userId resolution (rarely changes)
let cachedUserId: { value: string | undefined; expiresAt: number } | null = null;
const USER_ID_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

async function sendAlertSms(alertData: {
  type: string;
  staffName?: string | null;
  locationName?: string | null;
  containerName?: string | null;
  expectedAmount?: string | null;
  actualAmount?: string | null;
  note?: string | null;
}) {
  try {
    const [apiKey, fromNumberRaw, recipients] = await Promise.all([
      storage.getSetting("quo_api_key"),
      storage.getSetting("quo_from_number"),
      storage.getAlertRecipients(),
    ]);

    if (!apiKey || !fromNumberRaw) {
      console.log("SMS not sent: Quo API key or from number not configured");
      return;
    }

    const activeRecipients = recipients.filter((r) => r.active);
    if (activeRecipients.length === 0) {
      console.log("SMS not sent: No active alert recipients");
      return;
    }

    const message = buildAlertMessage(alertData);
    const fromNumber = formatPhoneE164(fromNumberRaw);

    // Resolve userId with caching
    let userId: string | undefined;
    if (cachedUserId && Date.now() < cachedUserId.expiresAt) {
      userId = cachedUserId.value;
    } else {
      const phoneNumbersRes = await fetch("https://api.openphone.com/v1/phone-numbers", {
        headers: { Authorization: apiKey },
      });
      if (phoneNumbersRes.ok) {
        const phoneData = await phoneNumbersRes.json();
        const matchingNumber = phoneData.data?.find((pn: any) => {
          const formatted = formatPhoneE164(pn.formattedNumber || pn.phoneNumber || "");
          return formatted === fromNumber;
        });
        userId = matchingNumber?.users?.[0]?.id;
      }
      cachedUserId = { value: userId, expiresAt: Date.now() + USER_ID_CACHE_TTL_MS };
    }

    // Send to all recipients in parallel
    const sendPromises = activeRecipients.map(async (recipient) => {
      const toNumber = formatPhoneE164(recipient.phoneNumber);
      const body: any = {
        content: message,
        from: fromNumber,
        to: [toNumber],
      };
      if (userId) body.userId = userId;

      const sendRes = await fetch("https://api.openphone.com/v1/messages", {
        method: "POST",
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (sendRes.ok) {
        console.log(`SMS sent to ${recipient.name} (${toNumber})`);
      } else {
        const errText = await sendRes.text();
        console.error(`SMS failed for ${recipient.name} (${toNumber}): ${sendRes.status} ${errText}`);
      }
    });

    await Promise.allSettled(sendPromises);
  } catch (err) {
    console.error("SMS sending error:", err);
  }
}

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

async function syncBoulevardLocation(blvdLocationId: string, appLocationId: number, sinceDays: number) {
  const since = new Date();
  since.setDate(since.getDate() - sinceDays);

  const cashOrders = await boulevard.fetchCashOrdersForLocation(blvdLocationId, since);

  // Check which orders we've already imported (by orderId)
  const existingTransactions = await storage.getBoulevardTransactions();
  const existingOrderIds = new Set(existingTransactions.map((t: any) => t.orderId).filter(Boolean));

  let imported = 0;
  let skipped = 0;

  for (const order of cashOrders) {
    if (existingOrderIds.has(order.orderId)) {
      skipped++;
      continue;
    }

    await storage.createBoulevardTransaction({
      date: new Date(order.closedAt),
      locationId: appLocationId,
      orderId: order.orderId,
      amount: order.cashAmount.toFixed(2),
      operatorName: order.operatorName,
      clientName: order.clientName,
      paymentMethod: "cash",
    });
    imported++;
  }

  return { imported, skipped, total: cashOrders.length };
}

async function syncBoulevardLocationWithHistory(
  blvdLocationId: string,
  appLocationId: number,
  locationName: string,
  syncType: "auto" | "manual" | "count",
  sinceDays: number
) {
  const entry = await storage.createSyncHistoryEntry({
    locationId: appLocationId,
    locationName,
    syncType,
    status: "success",
    startedAt: new Date(),
  });

  try {
    const result = await syncBoulevardLocation(blvdLocationId, appLocationId, sinceDays);
    await storage.completeSyncHistoryEntry(entry.id, "success", result.imported);
    return result;
  } catch (err: any) {
    await storage.completeSyncHistoryEntry(entry.id, "error", 0, err.message);
    throw err;
  }
}

async function syncAllBoulevardLocations(syncType: "auto" | "manual" = "auto") {
  const mappedLocations = await storage.getBoulevardMappedLocations();
  const results: { locationName: string; imported: number; skipped: number; error?: string }[] = [];
  let totalImported = 0;

  for (const loc of mappedLocations) {
    try {
      const result = await syncBoulevardLocationWithHistory(
        loc.boulevardLocationId!, loc.id, loc.name, syncType, 2
      );
      results.push({ locationName: loc.name, imported: result.imported, skipped: result.skipped });
      totalImported += result.imported;
    } catch (err: any) {
      console.error(`Boulevard sync failed for ${loc.name}:`, err.message);
      results.push({ locationName: loc.name, imported: 0, skipped: 0, error: err.message });
    }
  }

  return { totalImported, locations: results };
}

async function syncStaffFromBoulevard() {
  const mappedLocations = await storage.getBoulevardMappedLocations();
  const allSeenStaffIds: string[] = [];
  const staffLocationMap = new Map<string, number[]>(); // boulevardStaffId -> locationIds[]
  let created = 0;
  let updated = 0;

  for (const loc of mappedLocations) {
    if (!loc.boulevardLocationId) continue;
    try {
      const staff = await boulevard.fetchStaffForLocation(loc.boulevardLocationId);
      for (const s of staff) {
        const name = `${s.firstName} ${s.lastName}`.trim() || s.displayName;
        const esth = await storage.upsertEstheticianFromBoulevard({
          name,
          boulevardStaffId: s.id,
        });
        allSeenStaffIds.push(s.id);

        // Track location assignments
        const existing = staffLocationMap.get(s.id) || [];
        existing.push(loc.id);
        staffLocationMap.set(s.id, existing);
      }
    } catch (err: any) {
      console.error(`Staff sync failed for ${loc.name}:`, err.message);
    }
  }

  // Set location assignments
  const staffEntries = Array.from(staffLocationMap.entries());
  for (const [staffId, locationIds] of staffEntries) {
    const esth = await storage.getEstheticianByBoulevardId(staffId);
    if (esth) {
      await storage.setEstheticianLocations(esth.id, locationIds);
    }
  }

  // Deactivate staff no longer in Boulevard
  await storage.deactivateEstheticiansNotIn(allSeenStaffIds);

  return { synced: allSeenStaffIds.length, locations: mappedLocations.length };
}

let boulevardSyncInterval: ReturnType<typeof setInterval> | null = null;
async function startBoulevardAutoSync() {
  if (boulevardSyncInterval) clearInterval(boulevardSyncInterval);

  const freqStr = await storage.getSetting("boulevard_sync_frequency_minutes");
  const minutes = parseInt(freqStr || "10") || 10;

  boulevardSyncInterval = setInterval(async () => {
    try {
      const result = await syncAllBoulevardLocations("auto");
      if (result.totalImported > 0) {
        console.log(`Boulevard auto-sync: imported ${result.totalImported} transactions`);
      }
      // Also sync staff
      await syncStaffFromBoulevard();
    } catch (err) {
      console.error("Boulevard auto-sync error:", err);
    }
  }, minutes * 60 * 1000);

  console.log(`Boulevard auto-sync scheduled every ${minutes} minutes`);
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

  // OCR rate limiting: max 10 requests per IP per minute
  const ocrRateMap = new Map<string, number[]>();
  // Periodically clean up stale rate-limit entries to prevent memory leak
  setInterval(() => {
    const now = Date.now();
    ocrRateMap.forEach((timestamps, ip) => {
      if (timestamps.length === 0 || now - timestamps[timestamps.length - 1] > 60000) {
        ocrRateMap.delete(ip);
      }
    });
  }, 5 * 60 * 1000); // every 5 minutes

  app.post("/api/ocr/receipt", upload.single("file"), async (req, res) => {
    const ip = req.ip || "unknown";
    const now = Date.now();
    const windowMs = 60000;
    const maxRequests = 10;
    const timestamps = (ocrRateMap.get(ip) || []).filter((t) => now - t < windowMs);
    if (timestamps.length >= maxRequests) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(429).json({ amount: null, message: "Too many requests" });
    }
    timestamps.push(now);
    ocrRateMap.set(ip, timestamps);
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const filePath = req.file.path;
      const mimeType = req.file.mimetype;

      if (!mimeType.startsWith("image/")) {
        fs.unlinkSync(filePath);
        return res.json({ amount: null, message: "OCR only works on images, not PDFs" });
      }

      const imageBuffer = fs.readFileSync(filePath);
      const base64Image = imageBuffer.toString("base64");
      const dataUrl = `data:${mimeType};base64,${base64Image}`;

      fs.unlinkSync(filePath);

      const openai = getOpenAIClient();

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a receipt OCR assistant. Extract the total amount from the receipt image. Return ONLY a JSON object with a single field 'amount' containing the numeric total as a string (e.g. {\"amount\": \"25.99\"}). If you cannot determine the total, return {\"amount\": null}. Do not include currency symbols in the amount. Look for fields labeled 'Total', 'Grand Total', 'Amount Due', 'Balance Due', or similar. If there are multiple totals, use the final/grand total.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract the total amount from this receipt." },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        max_completion_tokens: 100,
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content || "{}";
      const parsed = JSON.parse(content);
      res.json({ amount: parsed.amount || null });
    } catch (err: any) {
      console.error("OCR error:", err);
      res.json({ amount: null, message: "Could not read receipt" });
    }
  });

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

  // Estheticians list (optionally filtered by location)
  app.get("/api/estheticians", async (req, res) => {
    try {
      const locationId = req.query.locationId ? parseInt(req.query.locationId as string) : null;
      if (locationId) {
        const data = await storage.getEstheticiansByLocation(locationId);
        // Fall back to all active if no location assignments exist
        if (data.length === 0) {
          const all = await storage.getEstheticians();
          res.json(all.filter((e: any) => e.active));
        } else {
          res.json(data);
        }
      } else {
        const data = await storage.getEstheticians();
        res.json(data);
      }
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
      const lastCollection = await storage.getLastCollectionForContainer(containerId);

      const shiftTime = last?.createdAt ? new Date(last.createdAt).getTime() : 0;
      const collectionTime = lastCollection?.createdAt ? new Date(lastCollection.createdAt).getTime() : 0;

      let priorAmount: string;
      let sinceDate: Date | undefined;

      if (collectionTime > shiftTime) {
        priorAmount = "0.00";
        sinceDate = new Date(lastCollection!.createdAt);
      } else {
        priorAmount = last?.countedAmount || container.currentBalance || "0.00";
        sinceDate = last?.createdAt ? new Date(last.createdAt) : undefined;
      }

      const boulevardCash = await storage.getBoulevardCashForLocation(container.locationId, sinceDate);
      const receiptSpent = await storage.getReceiptsTotalForContainer(containerId, sinceDate);

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

      // Check for mismatch and create alert (only for start-of-shift counts)
      if (type === "start" && expectedAmount && parseFloat(countedAmount) !== parseFloat(expectedAmount)) {
        const [container, esth] = await Promise.all([
          storage.getContainer(containerId),
          storage.getEsthetician(estheticianId),
        ]);
        const loc = container ? await storage.getLocation(container.locationId) : undefined;

        await storage.createAlert({
          type: "start_mismatch",
          staffName: esth?.name || null,
          marketName: loc?.marketName || null,
          locationName: loc?.name || null,
          containerName: container?.name || null,
          expectedAmount,
          actualAmount: countedAmount,
          note: discrepancyNote,
          shiftCountId: shiftCount.id,
        });

        sendAlertSms({
          type: "start_mismatch",
          staffName: esth?.name || null,
          locationName: loc?.name || null,
          containerName: container?.name || null,
          expectedAmount,
          actualAmount: countedAmount,
          note: discrepancyNote,
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
      const [container, esth] = await Promise.all([
        storage.getContainer(parseInt(containerId)),
        storage.getEsthetician(parseInt(estheticianId)),
      ]);
      const loc = container ? await storage.getLocation(container.locationId) : undefined;

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

      sendAlertSms({
        type: "receipt_submitted",
        staffName: esth?.name || null,
        locationName: loc?.name || null,
        containerName: container?.name || null,
        actualAmount: amount,
        note: note || `Receipt: ${req.file!.originalname}`,
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
      res.status(500).json({ message: err.message });
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

  app.patch("/api/locations/:id", requireAdmin, async (req, res) => {
    try {
      await storage.updateLocation(parseInt(req.params.id), req.body);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/locations/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deleteLocation(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Containers
  app.patch("/api/containers/:id", requireAdmin, async (req, res) => {
    try {
      await storage.updateContainer(parseInt(req.params.id), req.body);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

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
      res.status(500).json({ message: err.message });
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
      res.status(500).json({ message: err.message });
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
        const loc = container ? await storage.getLocation(container.locationId) : undefined;

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

        sendAlertSms({
          type: "collection_mismatch",
          staffName: collectorName,
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

  // Boulevard API integration
  app.get("/api/admin/boulevard/status", requireAdmin, async (_req, res) => {
    try {
      if (!boulevard.isConfigured()) {
        return res.json({ configured: false, message: "Boulevard API credentials not set" });
      }
      const result = await boulevard.testConnection();
      res.json({ configured: true, ...result });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/boulevard/locations", requireAdmin, async (_req, res) => {
    try {
      if (!boulevard.isConfigured()) {
        return res.status(400).json({ message: "Boulevard API not configured" });
      }
      const locations = await boulevard.fetchLocations();
      res.json(locations);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Manual sync for a single location
  app.post("/api/admin/boulevard/sync", requireAdmin, async (req, res) => {
    try {
      if (!boulevard.isConfigured()) {
        return res.status(400).json({ message: "Boulevard API not configured" });
      }

      const { locationId, sinceDays } = req.body;
      if (!locationId) {
        return res.status(400).json({ message: "locationId is required" });
      }

      const location = await storage.getLocation(parseInt(locationId));
      if (!location?.boulevardLocationId) {
        return res.status(400).json({ message: "Location not mapped to Boulevard" });
      }

      const result = await syncBoulevardLocationWithHistory(
        location.boulevardLocationId, location.id, location.name, "manual", sinceDays || 7
      );
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Manual trigger to sync all mapped locations
  app.post("/api/admin/boulevard/sync-all", requireAdmin, async (_req, res) => {
    try {
      if (!boulevard.isConfigured()) {
        return res.status(400).json({ message: "Boulevard API not configured" });
      }
      const result = await syncAllBoulevardLocations("manual");
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Sync frequency configuration
  app.post("/api/admin/boulevard/sync-frequency", requireAdmin, async (req, res) => {
    try {
      const { minutes } = req.body;
      if (![5, 10, 15, 30, 60].includes(minutes)) {
        return res.status(400).json({ message: "Invalid frequency. Options: 5, 10, 15, 30, 60" });
      }
      await storage.upsertSetting("boulevard_sync_frequency_minutes", String(minutes));
      await startBoulevardAutoSync();
      res.json({ success: true, minutes });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Sync status overview
  app.get("/api/admin/boulevard/sync-status", requireAdmin, async (_req, res) => {
    try {
      const [lastSync, stats, freqStr] = await Promise.all([
        storage.getLastSyncOverall(),
        storage.getRecentSyncStats(),
        storage.getSetting("boulevard_sync_frequency_minutes"),
      ]);
      res.json({
        lastSyncAt: lastSync?.completedAt || null,
        lastSyncStatus: lastSync?.status || null,
        totalImportedRecently: stats.totalImported,
        syncFrequencyMinutes: parseInt(freqStr || "10"),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Per-location sync status
  app.get("/api/admin/boulevard/location-sync-status", requireAdmin, async (_req, res) => {
    try {
      const mappedLocations = await storage.getBoulevardMappedLocations();
      const statuses = await Promise.all(
        mappedLocations.map(async (loc) => {
          const lastSync = await storage.getLastSyncForLocation(loc.id);
          return {
            locationId: loc.id,
            locationName: loc.name,
            boulevardLocationId: loc.boulevardLocationId,
            lastSyncAt: lastSync?.completedAt || null,
            lastSyncStatus: lastSync?.status || null,
            lastImportCount: lastSync?.transactionsImported || 0,
          };
        })
      );
      res.json(statuses);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Sync history log
  app.get("/api/admin/boulevard/sync-history", requireAdmin, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const history = await storage.getSyncHistory(limit);
      res.json(history);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Staff sync from Boulevard
  app.post("/api/admin/boulevard/sync-staff", requireAdmin, async (_req, res) => {
    try {
      if (!boulevard.isConfigured()) {
        return res.status(400).json({ message: "Boulevard API not configured" });
      }
      const result = await syncStaffFromBoulevard();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Count-triggered sync (public, no auth — called before esthetician counts)
  app.post("/api/boulevard/sync-for-location", async (req, res) => {
    try {
      const { locationId } = req.body;
      if (!locationId) return res.status(400).json({ message: "locationId required" });

      if (!boulevard.isConfigured()) {
        return res.json({ synced: false, reason: "Boulevard not configured" });
      }

      const location = await storage.getLocation(parseInt(locationId));
      if (!location?.boulevardLocationId) {
        return res.json({ synced: false, reason: "Location not mapped to Boulevard" });
      }

      const result = await syncBoulevardLocationWithHistory(
        location.boulevardLocationId, location.id, location.name, "count", 1
      );
      res.json({ synced: true, imported: result.imported });
    } catch (err: any) {
      console.error("Count-triggered sync error:", err);
      res.json({ synced: false, reason: err.message });
    }
  });

  // Start auto-sync
  if (boulevard.isConfigured()) {
    startBoulevardAutoSync();
  }

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
  const maxShiftHours = 12;
  const cutoff = new Date(Date.now() - maxShiftHours * 60 * 60 * 1000);

  // Single efficient query: get open start shifts older than cutoff
  const openShifts = await storage.getOpenStartShifts(cutoff);

  for (const startShift of openShifts) {
    // Check if alert already exists for this shift (single targeted query)
    const alreadyAlerted = await storage.hasAlertForShiftCount(startShift.id, "missing_end_shift");
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

    sendAlertSms({
      type: "missing_end_shift",
      staffName: startShift.estheticianName || null,
      locationName: startShift.locationName || null,
      containerName: startShift.containerName || null,
    });
  }
}
