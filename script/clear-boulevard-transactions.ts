import "dotenv/config";
import { db } from "../server/storage";
import { boulevardTransactions } from "@shared/schema";

async function run() {
  const r = await db.delete(boulevardTransactions).returning();
  console.log(`Deleted ${r.length} transactions`);
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
