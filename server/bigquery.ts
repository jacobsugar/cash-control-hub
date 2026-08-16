import { GoogleAuth } from "google-auth-library";

const PROJECT_ID = "even-affinity-388602";
const DATASET = "snowflake_data";
const TABLE = "vw_appointment_level_hello_sugar_raw";

let authClient: GoogleAuth | null = null;

function getAuth(): GoogleAuth {
  if (authClient) return authClient;

  const credentialsJson = process.env.GOOGLE_BIGQUERY_CREDENTIALS;
  if (!credentialsJson) {
    throw new Error("GOOGLE_BIGQUERY_CREDENTIALS env var not set");
  }

  const credentials = JSON.parse(credentialsJson);
  authClient = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/bigquery.readonly"],
  });

  return authClient;
}

interface BigQueryRow {
  APPOINTMENT_ID: string;
  APPOINTMENT_START_AT: string; // unix timestamp as string
  APPOINTMENT_STATE: string;
  LOCATION_ID: string;
  STAFF_ID: string;
  STAFF_NAME: string;
  CLIENT_NAME: string | null;
}

export interface BigQueryAppointment {
  id: string;
  startAt: string; // ISO string
  endAt: string; // ISO string (derived)
  state: string; // UPPERCASE
  staffBoulevardId: string;
  staffName: string;
  clientName: string;
}

async function runQuery(query: string, params: Record<string, string>): Promise<any[]> {
  const auth = getAuth();
  const client = await auth.getClient();
  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries`;

  const queryParameters = Object.entries(params).map(([name, value]) => ({
    name,
    parameterType: { type: "STRING" },
    parameterValue: { value },
  }));

  const res = await client.request({
    url,
    method: "POST",
    data: {
      query,
      useLegacySql: false,
      parameterMode: "NAMED",
      queryParameters,
      maxResults: 10000,
    },
  });

  const data = res.data as any;
  if (!data.jobComplete) {
    throw new Error("BigQuery query did not complete in time");
  }

  const fields = data.schema?.fields || [];
  const rows = data.rows || [];

  return rows.map((row: any) => {
    const obj: any = {};
    row.f.forEach((cell: any, i: number) => {
      obj[fields[i].name] = cell.v;
    });
    return obj;
  });
}

/**
 * Fetch today's appointments for a Boulevard location ID from BigQuery.
 * Derives endAt from the next appointment's start time per staff member,
 * using startAt + 30min as fallback for the last appointment.
 */
export async function fetchAppointmentsFromBigQuery(
  boulevardLocationId: string,
  date: Date,
  timezone: string = "America/Chicago"
): Promise<BigQueryAppointment[]> {
  const dateStr = date.toLocaleDateString("en-CA", { timeZone: timezone });

  const query = `
    SELECT APPOINTMENT_ID, APPOINTMENT_START_AT, APPOINTMENT_STATE,
           LOCATION_ID, STAFF_ID, STAFF_NAME, CLIENT_NAME
    FROM \`${PROJECT_ID}.${DATASET}.${TABLE}\`
    WHERE APPOINTMENT_ON = @date
      AND LOCATION_ID = @locationId
    ORDER BY STAFF_ID, APPOINTMENT_START_AT
  `;

  const rows: BigQueryRow[] = await runQuery(query, {
    date: dateStr,
    locationId: boulevardLocationId,
  });

  // Group by staff to derive endAt from next appointment's start
  const staffGroups = new Map<string, BigQueryRow[]>();
  for (const row of rows) {
    if (!row.STAFF_ID) continue;
    const group = staffGroups.get(row.STAFF_ID) || [];
    group.push(row);
    staffGroups.set(row.STAFF_ID, group);
  }

  const DEFAULT_DURATION_MS = 30 * 60 * 1000; // 30 minutes
  const appointments: BigQueryAppointment[] = [];

  for (const staffRows of Array.from(staffGroups.values())) {
    // Already sorted by APPOINTMENT_START_AT from the query
    for (let i = 0; i < staffRows.length; i++) {
      const row = staffRows[i];
      const startAtMs = parseFloat(row.APPOINTMENT_START_AT) * 1000;
      const startAt = new Date(startAtMs);

      // endAt = next appointment's start, or start + 30min for the last one
      let endAt: Date;
      if (i + 1 < staffRows.length) {
        const nextStartMs = parseFloat(staffRows[i + 1].APPOINTMENT_START_AT) * 1000;
        endAt = new Date(nextStartMs);
      } else {
        endAt = new Date(startAtMs + DEFAULT_DURATION_MS);
      }

      appointments.push({
        id: row.APPOINTMENT_ID,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        state: row.APPOINTMENT_STATE.toUpperCase(),
        staffBoulevardId: row.STAFF_ID,
        staffName: row.STAFF_NAME || "",
        clientName: row.CLIENT_NAME || "Walk-in",
      });
    }
  }

  return appointments;
}

export function isConfigured(): boolean {
  return !!process.env.GOOGLE_BIGQUERY_CREDENTIALS;
}
