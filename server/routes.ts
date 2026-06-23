import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage, db } from "./storage";
import { cleanlinessReports } from "@shared/schema";
import { eq } from "drizzle-orm";
import multer from "multer";
import path from "path";
import fs from "fs";
import session from "express-session";
import OpenAI from "openai";
import * as boulevard from "./boulevard";
import { getRecentLogs } from "./logBuffer";
import { OAuth2Client } from "google-auth-library";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Singleton OpenAI client — reused across requests
let openaiClient: OpenAI | null = null;
function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
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
    case "cleanliness_report":
      return `CashControl: Cleanliness issue reported at ${loc} by ${staff}.${alertData.note ? ` Note: ${alertData.note}` : ""}`;
    case "cleanliness_escalation":
      return `CashControl ESCALATION: Unresolved cleanliness report at ${loc} (reported by ${staff}) has been open for over 24 hours.${alertData.note ? ` Note: ${alertData.note}` : ""}`;
    default:
      return `CashControl Alert: ${alertData.type} at ${loc}${container}.`;
  }
}

// Cache for OpenPhone userId resolution (rarely changes)
let cachedUserId: { value: string | undefined; expiresAt: number } | null = null;
const USER_ID_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

async function sendAlertSms(alertData: {
  type: string;
  marketName?: string | null;
  staffName?: string | null;
  locationName?: string | null;
  containerName?: string | null;
  expectedAmount?: string | null;
  actualAmount?: string | null;
  note?: string | null;
}) {
  try {
    const [apiKey, fromNumberRaw, recipients, allMarkets] = await Promise.all([
      storage.getSetting("quo_api_key"),
      storage.getSetting("quo_from_number"),
      storage.getAlertRecipients(),
      storage.getMarkets(),
    ]);

    if (!apiKey || !fromNumberRaw) {
      console.log("SMS not sent: Quo API key or from number not configured");
      return;
    }

    // Filter recipients by active status AND alert type preference
    const alertTypeToField: Record<string, string> = {
      start_mismatch: "notifyStartMismatch",
      end_mismatch: "notifyEndMismatch",
      missing_end_shift: "notifyMissingEndShift",
      missing_receipt: "notifyMissingReceipt",
      receipt_submitted: "notifyReceiptSubmitted",
      collection_mismatch: "notifyCollectionMismatch",
      cleanliness_report: "notifyCleanlinessReport",
    };
    const fieldName = alertTypeToField[alertData.type] || null;
    let activeRecipients = recipients.filter((r: any) =>
      r.active && (fieldName ? r[fieldName] !== false : true)
    );

    // Filter by market assignment for managers
    if (alertData.marketName) {
      const marketId = allMarkets.find(m => m.name === alertData.marketName)?.id;
      const filtered = await Promise.all(activeRecipients.map(async (r: any) => {
        if (!r.adminUserId) return r; // no admin link = send all (legacy)
        const admin = await storage.getAdminUser(r.adminUserId);
        if (!admin) return r;
        if (admin.role === "owner") return r; // owners get everything
        const assignedMarkets = await storage.getAdminUserMarkets(r.adminUserId);
        if (assignedMarkets.length === 0) return r; // no markets assigned = send all
        return marketId && assignedMarkets.includes(marketId) ? r : null;
      }));
      activeRecipients = filtered.filter(Boolean);
    }

    if (activeRecipients.length === 0) {
      console.log(`SMS not sent: No active recipients for alert type ${alertData.type}`);
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

/**
 * Send a personal SMS to a specific phone number (for shift reminders to employees)
 */
async function sendPersonalSms(toPhone: string, message: string) {
  try {
    const [apiKey, fromNumberRaw] = await Promise.all([
      storage.getSetting("quo_api_key"),
      storage.getSetting("quo_from_number"),
    ]);
    if (!apiKey || !fromNumberRaw) return;

    const fromNumber = formatPhoneE164(fromNumberRaw);
    const toNumber = formatPhoneE164(toPhone);

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

    const body: any = { content: message, from: fromNumber, to: [toNumber] };
    if (userId) body.userId = userId;

    const sendRes = await fetch("https://api.openphone.com/v1/messages", {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (sendRes.ok) {
      console.log(`Personal SMS sent to ${toNumber}`);
    } else {
      const errText = await sendRes.text();
      console.error(`Personal SMS failed for ${toNumber}: ${sendRes.status} ${errText}`);
    }
  } catch (err) {
    console.error("Personal SMS error:", err);
  }
}

/**
 * Check for employees who haven't submitted start-of-shift cash counts
 * and send them a reminder text if their first appointment was 15+ minutes ago.
 * Only runs for locations with shift_reminders_enabled setting.
 */
async function checkShiftReminders() {
  try {
    const enabled = await storage.getSetting("shift_reminders_enabled");
    if (enabled !== "true") return;

    const mappedLocations = await storage.getBoulevardMappedLocations();
    const now = new Date();

    // Check per-location enable setting
    const enabledLocationsSetting = await storage.getSetting("shift_reminders_locations");
    const enabledLocationIds = enabledLocationsSetting
      ? new Set(enabledLocationsSetting.split(",").map(id => parseInt(id.trim())).filter(Boolean))
      : null; // null means all locations

    for (const loc of mappedLocations) {
      if (!loc.boulevardLocationId) continue;
      if (!loc.active) continue;
      if (enabledLocationIds && !enabledLocationIds.has(loc.id)) continue;

      // Get today's start in this location's timezone
      const tz = loc.timezone || "America/Chicago";
      const todayStr = now.toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD
      const todayStart = new Date(todayStr + "T00:00:00");

      let appointments;
      try {
        appointments = await boulevard.fetchAppointmentsForLocation(loc.boulevardLocationId, now);
      } catch (e) {
        console.warn(`Shift reminder: failed to fetch appointments for ${loc.name}:`, e);
        continue;
      }

      // Group by staff — find earliest appointment startAt per staff member
      const staffFirstAppt = new Map<string, Date>();
      for (const appt of appointments) {
        if (appt.state === "CANCELLED") continue;
        const startAt = new Date(appt.startAt);
        if (startAt.toLocaleDateString("en-CA", { timeZone: tz }) !== todayStr) continue;

        for (const svc of appt.appointmentServices) {
          const staffId = svc.staff?.id;
          if (!staffId) continue;
          const current = staffFirstAppt.get(staffId);
          if (!current || startAt < current) {
            staffFirstAppt.set(staffId, startAt);
          }
        }
      }

      const isFlagship = loc.type === "flagship";

      if (isFlagship) {
        // Flagship: check if anyone submitted a start count today
        const hasLocationStart = await storage.hasLocationStartCountToday(loc.id, todayStart);
        if (hasLocationStart) continue;

        // Find the earliest appointment time across all staff
        let earliestTime: Date | null = null;
        for (const [, time] of staffFirstAppt) {
          if (!earliestTime || time < earliestTime) earliestTime = time;
        }
        if (!earliestTime) continue;
        const reminderTime = new Date(earliestTime.getTime() + 15 * 60 * 1000);
        if (now < reminderTime) continue;

        // Find all staff with the earliest appointment (could be tied)
        const earliestStaffIds: string[] = [];
        for (const [staffId, time] of staffFirstAppt) {
          if (time.getTime() === earliestTime.getTime()) {
            earliestStaffIds.push(staffId);
          }
        }

        for (const staffBoulevardId of earliestStaffIds) {
          const esth = await storage.getEstheticianByBoulevardId(staffBoulevardId);
          if (!esth || !esth.active || !esth.phone) continue;

          const alreadySent = await storage.hasShiftReminderBeenSent(esth.id, loc.id, "late_start", todayStart);
          if (alreadySent) continue;

          await sendPersonalSms(
            esth.phone,
            `Hi ${esth.name.split(" ")[0]}, please submit the start-of-day cash count for ${loc.name}. Count the till and submit via CashControl.`
          );
          await storage.createShiftReminder({
            estheticianId: esth.id,
            locationId: loc.id,
            reminderType: "late_start",
            appointmentDate: earliestTime,
          });
          console.log(`Flagship start reminder sent to ${esth.name} at ${loc.name}`);
        }
      } else {
        // Suite: per-esthetician check
        for (const [staffBoulevardId, firstApptTime] of staffFirstAppt) {
          const reminderTime = new Date(firstApptTime.getTime() + 15 * 60 * 1000);
          if (now < reminderTime) continue;

          const esth = await storage.getEstheticianByBoulevardId(staffBoulevardId);
          if (!esth || !esth.active || !esth.phone) continue;

          const hasCount = await storage.hasStartShiftToday(esth.id, loc.id, todayStart);
          if (hasCount) continue;

          const alreadySent = await storage.hasShiftReminderBeenSent(esth.id, loc.id, "late_start", todayStart);
          if (alreadySent) continue;

          await sendPersonalSms(
            esth.phone,
            `Hi ${esth.name.split(" ")[0]}, please submit your start-of-shift cash count. Count your drawer and submit via CashControl.`
          );
          await storage.createShiftReminder({
            estheticianId: esth.id,
            locationId: loc.id,
            reminderType: "late_start",
            appointmentDate: firstApptTime,
          });
          console.log(`Shift reminder sent to ${esth.name} at ${loc.name}`);
        }
      }
    }
  } catch (err) {
    console.error("Shift reminder check error:", err);
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

function requireOwner(req: Request, res: Response, next: NextFunction) {
  if (req.session?.adminEmail && req.session?.adminRole === "owner") {
    return next();
  }
  res.status(403).json({ message: "Owner access required" });
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
  const blvdLocationIds = new Set(mappedLocations.map(l => l.boulevardLocationId).filter(Boolean));

  // Fetch all staff with their location assignments in one pass
  const allStaff = await boulevard.fetchAllStaffWithLocations();

  // Filter to estheticians assigned to our mapped locations (include "No Access" so we can deactivate them)
  const relevantStaff = allStaff.filter(s =>
    s.role?.name === "Aesthetician" &&
    s.locations.some(loc => blvdLocationIds.has(loc.id))
  );

  const allSeenStaffIds: string[] = [];
  const staffLocationMap = new Map<string, number[]>();

  for (const s of relevantStaff) {
    const name = `${s.firstName} ${s.lastName}`.trim() || s.displayName;
    const isActive = s.appRole?.name !== "No Access";
    await storage.upsertEstheticianFromBoulevard({
      name,
      boulevardStaffId: s.id,
      phone: s.mobilePhone || null,
      email: s.email || null,
      active: isActive,
    });
    allSeenStaffIds.push(s.id);

    // Map Boulevard location IDs to app location IDs
    const appLocationIds: number[] = [];
    for (const blvdLoc of s.locations) {
      const appLoc = mappedLocations.find(l => l.boulevardLocationId === blvdLoc.id);
      if (appLoc) appLocationIds.push(appLoc.id);
    }
    if (appLocationIds.length > 0) {
      staffLocationMap.set(s.id, appLocationIds);
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

  // Deactivate staff no longer in relevant locations
  if (allSeenStaffIds.length > 0) {
    await storage.deactivateEstheticiansNotIn(allSeenStaffIds);
  }

  return { synced: allSeenStaffIds.length, locations: mappedLocations.length };
}

function isWithinOperatingHours(startHour: number, endHour: number, timezone: string): boolean {
  const now = new Date();
  const timeStr = now.toLocaleString("en-US", { timeZone: timezone, hour: "numeric", hour12: false });
  const hour = parseInt(timeStr);
  // startHour=7, endHour=21 means operate between 7am-9pm
  return hour >= startHour && hour < endHour;
}

async function shouldSync(): Promise<boolean> {
  const startStr = await storage.getSetting("sync_operating_start_hour");
  const endStr = await storage.getSetting("sync_operating_end_hour");
  const startHour = parseInt(startStr || "7");
  const endHour = parseInt(endStr || "21");

  // Check both timezones — sync if ANY market is within operating hours
  return isWithinOperatingHours(startHour, endHour, "America/Los_Angeles") ||
         isWithinOperatingHours(startHour, endHour, "America/Chicago");
}

let boulevardSyncInterval: ReturnType<typeof setInterval> | null = null;
async function startBoulevardAutoSync() {
  if (boulevardSyncInterval) clearInterval(boulevardSyncInterval);

  const freqStr = await storage.getSetting("boulevard_sync_frequency_minutes");
  const minutes = parseInt(freqStr || "10") || 10;

  boulevardSyncInterval = setInterval(async () => {
    const withinOperatingHours = await shouldSync();

    // Boulevard sync only runs during operating hours
    if (withinOperatingHours) {
      try {
        const result = await syncAllBoulevardLocations("auto");
        if (result.totalImported > 0) {
          console.log(`Boulevard auto-sync: imported ${result.totalImported} transactions`);
        }
        await syncStaffFromBoulevard();
      } catch (err) {
        console.error("Boulevard auto-sync error:", err);
      }

      // Start-of-shift reminders (only during operating hours)
      try {
        await checkShiftReminders();
      } catch (err) {
        console.error("Shift reminder check error:", err);
      }
    }

    // End-of-shift checks and cleanliness escalations run ALWAYS
    // (estheticians may finish shifts after operating hours)
    try {
      await checkMissingEndShifts();
    } catch (err) {
      console.error("Missing end-shift check error:", err);
    }

    try {
      await checkUnresolvedCleanlinessReports();
    } catch (err) {
      console.error("Cleanliness escalation check error:", err);
    }
  }, minutes * 60 * 1000);

  console.log(`Boulevard auto-sync scheduled every ${minutes} minutes`);
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Trust reverse proxy (Replit/Railway) so secure cookies work behind HTTPS
  const isProduction = process.env.NODE_ENV === "production" || !!process.env.REPL_SLUG;
  if (isProduction) {
    app.set("trust proxy", 1);
  }

  // Session setup
  app.use(session({
    secret: process.env.SESSION_SECRET || "cashcontrol-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000,
      secure: isProduction,
      sameSite: "lax",
      httpOnly: true,
    },
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

  // Google OAuth login
  app.post("/api/admin/login/google", async (req, res) => {
    try {
      const { credential } = req.body;
      if (!credential) return res.status(400).json({ message: "No credential provided" });

      if (!GOOGLE_CLIENT_ID) {
        return res.status(500).json({ message: "Google OAuth not configured" });
      }

      // Verify the Google ID token
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      if (!payload?.email) {
        return res.status(400).json({ message: "Could not verify Google account" });
      }

      const email = payload.email.toLowerCase();

      // Check domain restriction
      if (!email.endsWith("@hellosugar.salon")) {
        return res.status(403).json({ message: "Only hellosugar.salon accounts are allowed" });
      }

      // Check if user is in admin list
      const admin = await storage.getAdminByEmail(email);
      if (!admin) {
        return res.status(403).json({ message: "Not authorized. Your email is not on the access list." });
      }

      // Update name from Google profile if not set
      if (!admin.name && payload.name) {
        await storage.updateAdminUser(admin.id, { name: payload.name });
      }

      req.session.adminEmail = admin.email;
      req.session.adminRole = admin.role;
      res.json({ email: admin.email, name: admin.name || payload.name, role: admin.role });
    } catch (err: any) {
      console.error("Google login error:", err);
      res.status(401).json({ message: "Google authentication failed" });
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

  // Missing end-shift checks now run on the same interval as Boulevard sync
  // (via checkMissingEndShifts called from the sync interval)

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
      // Only show active locations to estheticians
      res.json(data.filter((l: any) => l.active !== false));
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
        sinceDate = last?.createdAt ? new Date(last.createdAt) : (container.balanceUpdatedAt ? new Date(container.balanceUpdatedAt) : undefined);
      }

      const boulevardCash = await storage.getBoulevardCashForLocation(container.locationId, sinceDate);
      const receiptSpent = await storage.getReceiptsTotalForContainer(containerId, sinceDate);

      const expectedAmount = (
        parseFloat(priorAmount) + boulevardCash - receiptSpent
      ).toFixed(2);

      console.log(`Prior calc for container ${containerId}: lastShiftId=${last?.id}, priorAmount=${priorAmount}, sinceDate=${sinceDate?.toISOString()}, blvdCash=${boulevardCash}, receipts=${receiptSpent}, expected=${expectedAmount}`);

      res.json({ amount: priorAmount, expectedAmount });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Check if a start count exists today (for end-of-shift validation)
  app.get("/api/shift-counts/check-start", async (req, res) => {
    try {
      const estheticianId = parseInt(req.query.estheticianId as string);
      const locationId = parseInt(req.query.locationId as string);
      if (!estheticianId || !locationId) return res.status(400).json({ message: "Missing params" });

      const loc = await storage.getLocation(locationId);
      const tz = loc?.timezone || "America/Chicago";
      const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: tz });
      const todayStart = new Date(todayStr + "T00:00:00");

      // Flagship: check if anyone at the location submitted a start count
      // Suite: check if this specific esthetician did
      const hasStart = loc?.type === "flagship"
        ? await storage.hasLocationStartCountToday(locationId, todayStart)
        : await storage.hasStartShiftToday(estheticianId, locationId, todayStart);
      res.json({ hasStart });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Submit shift count
  app.post("/api/shift-counts", async (req, res) => {
    try {
      const { containerId, estheticianId, type, countedAmount, expectedAmount, discrepancyNote } = req.body;

      // Enforce whole dollar amounts only
      if (countedAmount && countedAmount.toString().includes(".")) {
        return res.status(400).json({ message: "Cash counts must be whole dollar amounts — do not include change." });
      }

      // End-of-shift validations
      if (type === "end") {
        const container = await storage.getContainer(containerId);
        if (container) {
          const loc = await storage.getLocation(container.locationId);
          const tz = loc?.timezone || "America/Chicago";
          const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: tz });
          const todayStart = new Date(todayStr + "T00:00:00");
          const isFlagship = loc?.type === "flagship";

          // Require a start count before end count
          // Flagship: anyone at the location can have done it
          // Suite: the same esthetician must have done it
          if (isFlagship) {
            const hasStart = await storage.hasLocationStartCountToday(container.locationId, todayStart);
            if (!hasStart) {
              return res.status(400).json({
                message: "A start-of-day count must be submitted before the end-of-day count.",
              });
            }
            // Flagship: only one end count per day
            const hasEnd = await storage.hasLocationEndCountToday(container.locationId, todayStart);
            if (hasEnd) {
              return res.status(400).json({
                message: "An end-of-day count has already been submitted for this location today.",
              });
            }
          } else {
            const hasStart = await storage.hasStartShiftToday(estheticianId, container.locationId, todayStart);
            if (!hasStart) {
              return res.status(400).json({
                message: "You must submit a start-of-shift count before submitting an end-of-shift count.",
              });
            }
          }

          // Enforce 60-minute window after last appointment
          try {
            if (loc?.boulevardLocationId) {
              const esth = await storage.getEsthetician(estheticianId);
              const appointments = await boulevard.fetchAppointmentsForLocation(loc.boulevardLocationId, new Date());

              let lastApptEnd: Date | null = null;
              for (const appt of appointments) {
                if (appt.state === "CANCELLED") continue;
                const startDate = new Date(appt.startAt).toLocaleDateString("en-CA", { timeZone: tz });
                if (startDate !== todayStr) continue;

                if (isFlagship) {
                  // Flagship: check ALL appointments at the location
                  const endAt = new Date(appt.endAt);
                  if (!lastApptEnd || endAt > lastApptEnd) lastApptEnd = endAt;
                } else if (esth?.boulevardStaffId) {
                  // Suite: check only this esthetician's appointments
                  for (const svc of appt.appointmentServices) {
                    if (svc.staff?.id === esth.boulevardStaffId) {
                      const endAt = new Date(appt.endAt);
                      if (!lastApptEnd || endAt > lastApptEnd) lastApptEnd = endAt;
                    }
                  }
                }
              }

              if (lastApptEnd) {
                const deadline = new Date(lastApptEnd.getTime() + 60 * 60 * 1000);
                if (new Date() > deadline) {
                  return res.status(400).json({
                    message: `The end-of-${isFlagship ? "day" : "shift"} count window has closed. The last appointment ended at ${lastApptEnd.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" })} and you had 60 minutes to submit. Please contact a manager.`,
                  });
                }
              }
            }
          } catch (e) {
            console.warn("End-shift window check failed:", e);
          }
        }
      }

      // Prevent duplicate start counts
      if (type === "start") {
        const container = await storage.getContainer(containerId);
        if (container) {
          const loc = await storage.getLocation(container.locationId);
          const tz = loc?.timezone || "America/Chicago";
          const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: tz });
          const todayStart = new Date(todayStr + "T00:00:00");

          if (loc?.type === "flagship") {
            // Flagship: one start count per location per day
            const hasStart = await storage.hasLocationStartCountToday(container.locationId, todayStart);
            if (hasStart) {
              return res.status(400).json({
                message: "A start-of-day count has already been submitted for this location today.",
              });
            }
          } else {
            // Suite: one start count per esthetician per location per day
            const hasStart = await storage.hasStartShiftToday(estheticianId, container.locationId, todayStart);
            if (hasStart) {
              return res.status(400).json({
                message: "You have already submitted a start-of-shift count today.",
              });
            }
          }
        }
      }

      const floatNote = req.body.floatNote || null;
      const shiftCount = await storage.createShiftCount({
        containerId,
        estheticianId,
        type,
        countedAmount,
        expectedAmount,
        discrepancyNote,
        floatNote,
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
          marketName: loc?.marketName || null,
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

  // Upload receipt (file is optional — "I don't have a receipt" triggers missing_receipt alert)
  app.post("/api/receipts", upload.single("file"), async (req, res) => {
    try {
      const { containerId, estheticianId, amount, note, shiftCountId, noReceipt } = req.body;
      const hasFile = !!req.file;
      const missingReceipt = noReceipt === "true" || noReceipt === true;

      if (!hasFile && !missingReceipt) {
        return res.status(400).send("No file uploaded");
      }

      const receipt = await storage.createReceipt({
        containerId: parseInt(containerId),
        estheticianId: parseInt(estheticianId),
        amount,
        filePath: hasFile ? req.file!.path : null,
        fileName: hasFile ? req.file!.originalname : null,
        hasReceipt: hasFile,
        note: note || null,
        shiftCountId: shiftCountId ? parseInt(shiftCountId) : null,
      });

      const [container, esth] = await Promise.all([
        storage.getContainer(parseInt(containerId)),
        storage.getEsthetician(parseInt(estheticianId)),
      ]);
      const loc = container ? await storage.getLocation(container.locationId) : undefined;

      if (missingReceipt) {
        // Missing receipt alert
        await storage.createAlert({
          type: "missing_receipt",
          staffName: esth?.name || null,
          marketName: loc?.marketName || null,
          locationName: loc?.name || null,
          containerName: container?.name || null,
          actualAmount: amount,
          note: note || "Cash spent without receipt",
          receiptId: receipt.id,
        });

        sendAlertSms({
          type: "missing_receipt",
          marketName: loc?.marketName || null,
          staffName: esth?.name || null,
          locationName: loc?.name || null,
          containerName: container?.name || null,
          actualAmount: amount,
          note: note || "Cash spent without receipt",
        });
      } else {
        // Normal receipt submission alert
        await storage.createAlert({
          type: "receipt_submitted",
          staffName: esth?.name || null,
          marketName: loc?.marketName || null,
          locationName: loc?.name || null,
          containerName: container?.name || null,
          actualAmount: amount,
          note: note || `Receipt: ${req.file!.originalname}`,
          receiptId: receipt.id,
        });

        sendAlertSms({
          type: "receipt_submitted",
          marketName: loc?.marketName || null,
          staffName: esth?.name || null,
          locationName: loc?.name || null,
          containerName: container?.name || null,
          actualAmount: amount,
          note: note || `Receipt: ${req.file!.originalname}`,
        });
      }

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

  // Serve cleanliness report photos
  app.get("/api/cleanliness-photos/:filename", (req, res) => {
    const filePath = path.join(uploadDir, req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: "File not found" });
    res.sendFile(filePath);
  });

  // Create cleanliness report (public - esthetician facing)
  app.post("/api/cleanliness-reports", upload.array("photos", 10), async (req, res) => {
    try {
      const { locationId, reportedByEstheticianId, note } = req.body;
      if (!locationId || !reportedByEstheticianId || !note) {
        return res.status(400).json({ message: "locationId, reportedByEstheticianId, and note are required" });
      }

      const locId = parseInt(locationId);
      const reporterId = parseInt(reportedByEstheticianId);

      const prev = await storage.getPreviousEstheticianAtLocation(locId);
      const previousEstheticianId = prev && prev.id !== reporterId ? prev.id : null;

      const report = await storage.createCleanlinessReport({
        locationId: locId,
        reportedByEstheticianId: reporterId,
        previousEstheticianId: previousEstheticianId,
        note,
      });

      const files = (req.files as Express.Multer.File[]) || [];
      for (const file of files) {
        let photoTakenAt: Date | null = null;
        try {
          photoTakenAt = fs.statSync(file.path).mtime;
        } catch { /* fallback: null */ }
        await storage.createCleanlinessReportPhoto({
          reportId: report.id,
          filePath: file.path,
          fileName: file.originalname,
          photoTakenAt,
        });
      }

      const [loc, reporter] = await Promise.all([
        storage.getLocation(locId),
        storage.getEsthetician(reporterId),
      ]);

      sendAlertSms({
        type: "cleanliness_report",
        marketName: loc?.marketName || null,
        staffName: reporter?.name || null,
        locationName: loc?.name || null,
        note,
      });

      res.json(report);
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

  app.delete("/api/markets/:id", requireAdmin, requireOwner, async (req, res) => {
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

  app.delete("/api/locations/:id", requireAdmin, requireOwner, async (req, res) => {
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

  app.delete("/api/containers/:id", requireAdmin, requireOwner, async (req, res) => {
    try {
      await storage.deleteContainer(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Estheticians
  // Estheticians with location assignments (admin view)
  app.get("/api/admin/estheticians-with-locations", requireAdmin, async (_req, res) => {
    try {
      const data = await storage.getEstheticiansWithLocations();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

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

  app.delete("/api/estheticians/:id", requireAdmin, requireOwner, async (req, res) => {
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

  app.patch("/api/admin/receipts/:id", requireAdmin, async (req, res) => {
    try {
      const { amount, note } = req.body;
      await storage.updateReceipt(parseInt(req.params.id), { amount, note });
      res.json({ success: true });
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

  app.delete("/api/admin/alerts/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deleteAlert(parseInt(req.params.id));
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
          marketName: loc?.marketName || null,
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

  // Operating hours configuration
  app.get("/api/admin/boulevard/operating-hours", requireAdmin, async (_req, res) => {
    try {
      const [startStr, endStr] = await Promise.all([
        storage.getSetting("sync_operating_start_hour"),
        storage.getSetting("sync_operating_end_hour"),
      ]);
      res.json({
        startHour: parseInt(startStr || "7"),
        endHour: parseInt(endStr || "21"),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/boulevard/operating-hours", requireAdmin, async (req, res) => {
    try {
      const { startHour, endHour } = req.body;
      if (startHour < 0 || startHour > 23 || endHour < 0 || endHour > 23) {
        return res.status(400).json({ message: "Hours must be between 0 and 23" });
      }
      await Promise.all([
        storage.upsertSetting("sync_operating_start_hour", String(startHour)),
        storage.upsertSetting("sync_operating_end_hour", String(endHour)),
      ]);
      res.json({ success: true, startHour, endHour });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Sync status overview
  app.get("/api/admin/boulevard/sync-status", requireAdmin, async (_req, res) => {
    try {
      const [lastSync, stats, freqStr, startStr, endStr] = await Promise.all([
        storage.getLastSyncOverall(),
        storage.getRecentSyncStats(),
        storage.getSetting("boulevard_sync_frequency_minutes"),
        storage.getSetting("sync_operating_start_hour"),
        storage.getSetting("sync_operating_end_hour"),
      ]);
      const syncing = await shouldSync();
      res.json({
        lastSyncAt: lastSync?.completedAt || null,
        lastSyncStatus: lastSync?.status || null,
        totalImportedRecently: stats.totalImported,
        syncFrequencyMinutes: parseInt(freqStr || "10"),
        operatingStartHour: parseInt(startStr || "7"),
        operatingEndHour: parseInt(endStr || "21"),
        currentlySyncing: syncing,
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

  // Admin User Market Assignments
  app.get("/api/admin/users/:id/markets", requireAdmin, async (req, res) => {
    try {
      const marketIds = await storage.getAdminUserMarkets(parseInt(req.params.id));
      res.json({ marketIds });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/admin/users/:id/markets", requireAdmin, async (req, res) => {
    try {
      await storage.setAdminUserMarkets(parseInt(req.params.id), req.body.marketIds || []);
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

  app.post("/api/admin/alert-recipients", requireAdmin, requireOwner, async (req, res) => {
    try {
      const r = await storage.createAlertRecipient(req.body);
      res.json(r);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/admin/alert-recipients/:id", requireAdmin, requireOwner, async (req, res) => {
    try {
      await storage.updateAlertRecipient(parseInt(req.params.id), req.body);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/admin/alert-recipients/:id", requireAdmin, requireOwner, async (req, res) => {
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

  app.post("/api/admin/settings", requireAdmin, requireOwner, async (req, res) => {
    try {
      await storage.upsertSetting(req.body.key, req.body.value);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Admin logs endpoint — supports session auth or token auth
  app.get("/api/admin/logs", async (req, res) => {
    const token = req.query.token as string;
    const logToken = process.env.LOG_ACCESS_TOKEN;

    // Allow access via session (admin) or token
    if (!req.session?.adminEmail && (!logToken || token !== logToken)) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const n = parseInt(req.query.n as string) || 200;
    res.json(getRecentLogs(n));
  });

  // Admin Cleanliness Reports
  app.get("/api/admin/cleanliness-reports", requireAdmin, async (_req, res) => {
    try {
      const data = await storage.getCleanlinessReports();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/cleanliness-reports/infractions", requireAdmin, async (_req, res) => {
    try {
      const data = await storage.getInfractionCounts();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/cleanliness-reports/:id", requireAdmin, async (req, res) => {
    try {
      const report = await storage.getCleanlinessReport(parseInt(req.params.id));
      if (!report) return res.status(404).json({ message: "Report not found" });
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/admin/cleanliness-reports/:id/resolve", requireAdmin, async (req, res) => {
    try {
      const { resolutionNote } = req.body;
      if (!resolutionNote || !resolutionNote.trim()) {
        return res.status(400).json({ message: "Resolution note is required" });
      }
      const adminEmail = req.session.adminEmail!;
      const admin = await storage.getAdminByEmail(adminEmail);
      if (!admin) return res.status(401).json({ message: "Admin not found" });

      await storage.resolveCleanlinessReport(parseInt(req.params.id), {
        resolutionNote: resolutionNote.trim(),
        resolvedByAdminId: admin.id,
      });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/admin/cleanliness-reports/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deleteCleanlinessReport(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Adjust container balance (expected amount)
  app.patch("/api/containers/:id/balance", requireAdmin, async (req, res) => {
    try {
      const { balance } = req.body;
      if (balance === undefined || balance === null) {
        return res.status(400).json({ message: "Balance is required" });
      }
      await storage.updateContainerBalance(parseInt(req.params.id), String(balance));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  return httpServer;
}

async function checkUnresolvedCleanlinessReports() {
  try {
    const unresolvedReports = await storage.getUnresolvedReportsOlderThan(24);
    for (const report of unresolvedReports) {
      const [loc, reporter] = await Promise.all([
        storage.getLocation(report.locationId),
        storage.getEsthetician(report.reportedByEstheticianId),
      ]);

      // Send escalation to owners only by using a special type
      // We reuse sendAlertSms but the market filtering + owner check handles it
      const [apiKey, fromNumberRaw, recipients, allMarkets] = await Promise.all([
        storage.getSetting("quo_api_key"),
        storage.getSetting("quo_from_number"),
        storage.getAlertRecipients(),
        storage.getMarkets(),
      ]);

      if (apiKey && fromNumberRaw) {
        const marketId = loc?.marketName ? allMarkets.find(m => m.name === loc.marketName)?.id : undefined;
        const ownerRecipients = [];
        for (const r of recipients) {
          if (!r.active) continue;
          if (!r.adminUserId) continue;
          const admin = await storage.getAdminUser(r.adminUserId);
          if (!admin || admin.role !== "owner") continue;
          if (marketId) {
            const assignedMarkets = await storage.getAdminUserMarkets(r.adminUserId);
            if (assignedMarkets.length > 0 && !assignedMarkets.includes(marketId)) continue;
          }
          ownerRecipients.push(r);
        }

        if (ownerRecipients.length > 0) {
          const message = buildAlertMessage({
            type: "cleanliness_escalation",
            staffName: reporter?.name || null,
            locationName: loc?.name || null,
            note: report.note,
          });
          const fromNumber = formatPhoneE164(fromNumberRaw);

          for (const recipient of ownerRecipients) {
            const toNumber = formatPhoneE164(recipient.phoneNumber);
            try {
              await fetch("https://api.openphone.com/v1/messages", {
                method: "POST",
                headers: { Authorization: apiKey, "Content-Type": "application/json" },
                body: JSON.stringify({ content: message, from: fromNumber, to: [toNumber] }),
              });
              console.log(`Escalation SMS sent to ${recipient.name} (${toNumber})`);
            } catch (err) {
              console.error(`Escalation SMS failed for ${recipient.name}:`, err);
            }
          }
        }
      }

      // Mark as escalated
      await db.update(cleanlinessReports)
        .set({ escalatedAt: new Date() })
        .where(eq(cleanlinessReports.id, report.id));
    }
  } catch (err) {
    console.error("Cleanliness escalation check error:", err);
  }
}

/**
 * Check for missing end-of-shift counts based on Boulevard appointment data.
 * Triggers 60 minutes after an esthetician's last appointment ends for the day.
 */
async function checkMissingEndShifts() {
  try {
    const mappedLocations = await storage.getBoulevardMappedLocations();
    const now = new Date();

    for (const loc of mappedLocations) {
      if (!loc.boulevardLocationId) continue;
      if (!loc.active) continue;

      const tz = loc.timezone || "America/Chicago";
      const todayStr = now.toLocaleDateString("en-CA", { timeZone: tz });
      const todayStart = new Date(todayStr + "T00:00:00");
      const isFlagship = loc.type === "flagship";

      let appointments;
      try {
        appointments = await boulevard.fetchAppointmentsForLocation(loc.boulevardLocationId, now);
      } catch (e) {
        console.warn(`Missing end-shift check: failed to fetch appointments for ${loc.name}:`, e);
        continue;
      }

      // Build per-staff last appointment end times for today
      const staffLastApptEnd = new Map<string, Date>();
      let locationLastApptEnd: Date | null = null;

      for (const appt of appointments) {
        if (appt.state === "CANCELLED") continue;
        const endAt = new Date(appt.endAt);
        const startDate = new Date(appt.startAt).toLocaleDateString("en-CA", { timeZone: tz });
        if (startDate !== todayStr) continue;

        if (!locationLastApptEnd || endAt > locationLastApptEnd) locationLastApptEnd = endAt;

        for (const svc of appt.appointmentServices) {
          const staffId = svc.staff?.id;
          if (!staffId) continue;
          const current = staffLastApptEnd.get(staffId);
          if (!current || endAt > current) {
            staffLastApptEnd.set(staffId, endAt);
          }
        }
      }

      if (isFlagship) {
        // Flagship: one end count per location per day
        if (!locationLastApptEnd) continue;

        const hasEndCount = await storage.hasLocationEndCountToday(loc.id, todayStart);
        if (hasEndCount) continue;

        // Find staff with the latest appointment (could be multiple if tied)
        const latestStaffIds: string[] = [];
        for (const [staffId, endTime] of staffLastApptEnd) {
          if (endTime.getTime() === locationLastApptEnd.getTime()) {
            latestStaffIds.push(staffId);
          }
        }

        const reminderTime = new Date(locationLastApptEnd.getTime() + 15 * 60 * 1000);
        const escalationTime = new Date(locationLastApptEnd.getTime() + 60 * 60 * 1000);

        // Stage 1: 15-minute soft reminder to esthetician only
        if (now >= reminderTime) {
          for (const staffBoulevardId of latestStaffIds) {
            const esth = await storage.getEstheticianByBoulevardId(staffBoulevardId);
            if (!esth || !esth.active) continue;

            const alreadySent = await storage.hasShiftReminderBeenSent(esth.id, loc.id, "missing_end_reminder", todayStart);
            if (alreadySent) continue;

            if (esth.phone) {
              await sendPersonalSms(
                esth.phone,
                `Hi ${esth.name.split(" ")[0]}, the last appointment at ${loc.name} has ended. Please submit the end-of-day cash count via CashControl.`
              );
            }
            await storage.createShiftReminder({
              estheticianId: esth.id,
              locationId: loc.id,
              reminderType: "missing_end_reminder",
              appointmentDate: locationLastApptEnd,
            });
            console.log(`15-min end-of-day reminder for ${esth.name} at ${loc.name} (flagship)`);
          }
        }

        // Stage 2: 60-minute escalation to esthetician + managers
        if (now >= escalationTime) {
          for (const staffBoulevardId of latestStaffIds) {
            const esth = await storage.getEstheticianByBoulevardId(staffBoulevardId);
            if (!esth || !esth.active) continue;

            const alreadySent = await storage.hasShiftReminderBeenSent(esth.id, loc.id, "missing_end", todayStart);
            if (alreadySent) continue;

            if (esth.phone) {
              await sendPersonalSms(
                esth.phone,
                `Hi ${esth.name.split(" ")[0]}, your end-of-day cash count at ${loc.name} is now overdue. Your manager has been notified. Please submit immediately via CashControl.`
              );
            }
            await storage.createShiftReminder({
              estheticianId: esth.id,
              locationId: loc.id,
              reminderType: "missing_end",
              appointmentDate: locationLastApptEnd,
            });
          }

          const staffNames = [];
          for (const sid of latestStaffIds) {
            const e = await storage.getEstheticianByBoulevardId(sid);
            if (e) staffNames.push(e.name);
          }
          await storage.createAlert({
            type: "missing_end_shift",
            staffName: staffNames.join(", ") || null,
            marketName: loc.marketName || null,
            locationName: loc.name || null,
            note: `No end-of-day count submitted at flagship. Last appointment ended at ${locationLastApptEnd.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" })}.`,
          });
          sendAlertSms({
            type: "missing_end_shift",
            marketName: loc.marketName || null,
            staffName: staffNames.join(", ") || null,
            locationName: loc.name || null,
          });
          console.log(`60-min end-of-day escalation at ${loc.name} (flagship)`);
        }

        continue;
      }

      // Suite locations: per-esthetician checks (two-stage)
      for (const [staffBoulevardId, lastApptEnd] of staffLastApptEnd) {
        const esth = await storage.getEstheticianByBoulevardId(staffBoulevardId);
        if (!esth || !esth.active) continue;

        const hasEndCount = await storage.hasEndShiftToday(esth.id, loc.id, todayStart);
        if (hasEndCount) continue;

        const reminderTime = new Date(lastApptEnd.getTime() + 15 * 60 * 1000);
        const escalationTime = new Date(lastApptEnd.getTime() + 60 * 60 * 1000);

        // Stage 1: 15-minute soft reminder to esthetician only
        if (now >= reminderTime) {
          const alreadySent = await storage.hasShiftReminderBeenSent(esth.id, loc.id, "missing_end_reminder", todayStart);
          if (!alreadySent) {
            if (esth.phone) {
              await sendPersonalSms(
                esth.phone,
                `Hi ${esth.name.split(" ")[0]}, your last appointment has ended. Please submit your end-of-shift cash count via CashControl.`
              );
            }
            await storage.createShiftReminder({
              estheticianId: esth.id,
              locationId: loc.id,
              reminderType: "missing_end_reminder",
              appointmentDate: lastApptEnd,
            });
            console.log(`15-min end-shift reminder for ${esth.name} at ${loc.name}`);
          }
        }

        // Stage 2: 60-minute escalation to esthetician + managers
        if (now >= escalationTime) {
          const alreadySent = await storage.hasShiftReminderBeenSent(esth.id, loc.id, "missing_end", todayStart);
          if (!alreadySent) {
            if (esth.phone) {
              await sendPersonalSms(
                esth.phone,
                `Hi ${esth.name.split(" ")[0]}, your end-of-shift cash count is now overdue. Your manager has been notified. Please submit immediately via CashControl.`
              );
            }

            await storage.createAlert({
              type: "missing_end_shift",
              staffName: esth.name,
              marketName: loc.marketName || null,
              locationName: loc.name || null,
              note: `No end-of-shift count submitted. Last appointment ended at ${lastApptEnd.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" })}.`,
            });
            sendAlertSms({
              type: "missing_end_shift",
              marketName: loc.marketName || null,
              staffName: esth.name,
              locationName: loc.name || null,
            });

            await storage.createShiftReminder({
              estheticianId: esth.id,
              locationId: loc.id,
              reminderType: "missing_end",
              appointmentDate: lastApptEnd,
            });
            console.log(`60-min end-shift escalation for ${esth.name} at ${loc.name}`);
          }
        }
      }
    }
  } catch (err) {
    console.error("Missing end-shift check error:", err);
  }
}
