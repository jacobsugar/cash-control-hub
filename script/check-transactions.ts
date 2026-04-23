import "dotenv/config";
import { db } from "../server/storage";
import { boulevardTransactions } from "@shared/schema";

async function run() {
  const all = await db.select().from(boulevardTransactions);
  console.log("Count:", all.length);
  for (const t of all.slice(0, 5)) {
    console.log("  op:", t.operatorName, "| cl:", t.clientName, "| amt:", t.amount, "| orderId:", t.orderId);
  }
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
