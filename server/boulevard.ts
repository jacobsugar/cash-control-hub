import crypto from "crypto";

const ADMIN_URL_BASE = "https://dashboard.boulevard.io/api/2020-01";

function getAdminAuth(): { url: string; authorization: string } | null {
  const businessId = process.env.BOULEVARD_BUSINESS_ID;
  const apiSecret = process.env.BOULEVARD_API_SECRET;
  const apiKey = process.env.BOULEVARD_API_KEY;

  if (!businessId || !apiSecret || !apiKey) {
    return null;
  }

  const prefix = "blvd-admin-v1";
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = `${prefix}${businessId}${timestamp}`;
  const rawKey = Buffer.from(apiSecret, "base64");
  const signature = crypto
    .createHmac("sha256", rawKey)
    .update(payload, "utf8")
    .digest("base64");
  const token = `${signature}${payload}`;
  const credentials = Buffer.from(`${apiKey}:${token}`, "utf8").toString("base64");

  return {
    url: `${ADMIN_URL_BASE}/${businessId}/admin`,
    authorization: `Basic ${credentials}`,
  };
}

async function graphql<T = any>(
  query: string,
  variables?: Record<string, any>,
  retries = 3
): Promise<T> {
  const auth = getAdminAuth();
  if (!auth) {
    throw new Error("Boulevard API credentials not configured");
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(auth.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: auth.authorization,
      },
      body: JSON.stringify({ query, variables }),
    });

    const text = await res.text();
    if (text.startsWith("<")) {
      throw new Error(`Boulevard API returned HTML (status ${res.status}) — auth may have expired`);
    }

    const json = JSON.parse(text);
    if (json.errors?.length) {
      const errMsg = json.errors[0].message;

      // Retry on rate limit errors
      if (errMsg.includes("API limit exceeded") && attempt < retries) {
        const waitMatch = errMsg.match(/wait (\d+)ms/);
        const waitMs = waitMatch ? parseInt(waitMatch[1]) + 100 : 1000;
        await new Promise(resolve => setTimeout(resolve, waitMs));
        continue;
      }

      throw new Error(`Boulevard GraphQL error: ${errMsg}`);
    }
    return json.data as T;
  }

  throw new Error("Boulevard API: max retries exceeded");
}

// Fetch all pages of a connection query
async function fetchAllPages<T>(
  queryTemplate: string,
  variables: Record<string, any>,
  connectionPath: string,
  maxPages = 50
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const vars: Record<string, any> = { ...variables, after: cursor };
    const data: any = await graphql(queryTemplate, vars);

    // Navigate to the connection in the response
    const connection: any = connectionPath.split(".").reduce((obj: any, key) => obj?.[key], data);
    if (!connection?.edges?.length) break;

    for (const edge of connection.edges) {
      items.push(edge.node);
    }

    if (!connection.pageInfo?.hasNextPage) break;
    cursor = connection.pageInfo.endCursor;
  }

  return items;
}

export interface BoulevardLocation {
  id: string;
  name: string;
  address?: { city: string; state: string };
}

export interface BoulevardStaff {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
}

export interface BoulevardCashOrder {
  orderId: string;
  orderNumber: string;
  closedAt: string;
  locationId: string;
  cashAmount: number; // in dollars
  totalAmount: number; // in dollars
  operatorName: string | null;
  clientName: string | null;
}

/**
 * Fetch all Boulevard locations
 */
export async function fetchLocations(): Promise<BoulevardLocation[]> {
  return fetchAllPages<BoulevardLocation>(
    `query($after: String) {
      locations(first: 50, after: $after) {
        edges { node { id name address { city state } } }
        pageInfo { hasNextPage endCursor }
      }
    }`,
    {},
    "locations"
  );
}

/**
 * Fetch orders with cash payments for a location since a given date.
 * Returns only orders that include at least one cash payment.
 *
 * Note: Boulevard's orders query doesn't support date filtering directly,
 * so we paginate backwards from newest and stop when we pass the cutoff date.
 */
export async function fetchCashOrdersForLocation(
  locationId: string,
  since?: Date
): Promise<BoulevardCashOrder[]> {
  const cashOrders: BoulevardCashOrder[] = [];
  let cursor: string | null = null;
  const sinceTime = since?.getTime() || 0;

  for (let page = 0; page < 100; page++) {
    // Query 1: Get orders with payment info
    const ordersData: any = await graphql(
      `query($l: ID!, $after: String) {
        orders(first: 50, locationId: $l, after: $after) {
          edges {
            cursor
            node {
              id number closedAt
              closedBy { firstName lastName }
              client { firstName lastName }
              summary { currentTotal }
              paymentGroups {
                payments { __typename paidAmount }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { l: locationId, after: cursor }
    );

    const edges = ordersData.orders?.edges || [];
    if (edges.length === 0) break;

    // Collect order IDs that have cash payments
    const cashOrderNodes: any[] = [];
    let reachedCutoff = false;

    for (const edge of edges) {
      const order = edge.node;

      // Check if we've gone past the date cutoff
      if (order.closedAt && sinceTime > 0) {
        const closedTime = new Date(order.closedAt).getTime();
        if (closedTime < sinceTime) {
          reachedCutoff = true;
          break;
        }
      }

      // Skip unclosed orders
      if (!order.closedAt) continue;

      // Check for cash payments
      const payments = order.paymentGroups?.flatMap((g: any) => g.payments) || [];
      const cashPayments = payments.filter((p: any) => p.__typename === "OrderCashPayment");

      if (cashPayments.length > 0) {
        const cashAmount = cashPayments.reduce((sum: number, p: any) => sum + (p.paidAmount || 0), 0);
        cashOrderNodes.push({
          ...order,
          cashAmount: cashAmount / 100, // cents to dollars
          totalAmount: (order.summary?.currentTotal || 0) / 100,
        });
      }
    }

    // Add cash orders with staff name from closedBy and client name
    for (const order of cashOrderNodes) {
      const closedBy = order.closedBy;
      const operatorName = closedBy ? `${closedBy.firstName || ""} ${closedBy.lastName || ""}`.trim() : null;
      const client = order.client;
      const clientName = client ? `${client.firstName || ""} ${client.lastName || ""}`.trim() : null;
      cashOrders.push({
        orderId: order.id,
        orderNumber: order.number,
        closedAt: order.closedAt,
        locationId,
        cashAmount: order.cashAmount,
        totalAmount: order.totalAmount,
        operatorName,
        clientName,
      });
    }

    if (reachedCutoff || !ordersData.orders?.pageInfo?.hasNextPage) break;
    cursor = ordersData.orders.pageInfo.endCursor;
  }

  return cashOrders;
}


/**
 * Check if Boulevard API credentials are configured
 */
export interface BoulevardStaffWithLocations extends BoulevardStaff {
  locations: { id: string; name: string }[];
  role: { name: string } | null;
  appRole: { name: string } | null;
  active: boolean;
  mobilePhone: string | null;
  email: string | null;
}

/**
 * Fetch all staff with their location assignments.
 * Staff query doesn't support locationId filtering — we fetch all and filter locally.
 */
export async function fetchAllStaffWithLocations(): Promise<BoulevardStaffWithLocations[]> {
  const staff: BoulevardStaffWithLocations[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < 100; page++) {
    const data: any = await graphql(
      `query($after: String) {
        staff(first: 50, after: $after) {
          edges {
            node {
              id firstName lastName displayName active
              mobilePhone email
              role { name }
              appRole { name }
              locations { id name }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { after: cursor }
    );

    const edges = data.staff?.edges || [];
    if (edges.length === 0) break;

    for (const edge of edges) {
      staff.push(edge.node);
    }

    if (!data.staff?.pageInfo?.hasNextPage) break;
    cursor = data.staff.pageInfo.endCursor;
  }

  return staff;
}

export interface BoulevardAppointment {
  id: string;
  startAt: string;
  endAt: string;
  state: string;
  client?: { firstName: string; lastName: string } | null;
  appointmentServices: { staff: { id: string; firstName: string; lastName: string } }[];
}

/**
 * Fetch appointments for a location on a given date
 */
export async function fetchAppointmentsForLocation(
  locationId: string,
  date: Date
): Promise<BoulevardAppointment[]> {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  return fetchAllPages<BoulevardAppointment>(
    `query($locationId: ID!, $after: String) {
      appointments(first: 50, locationId: $locationId, after: $after) {
        edges {
          node {
            id startAt endAt state
            client { firstName lastName }
            appointmentServices {
              staff { id firstName lastName }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }`,
    { locationId },
    "appointments"
  );
}

export function isConfigured(): boolean {
  return !!(
    process.env.BOULEVARD_BUSINESS_ID &&
    process.env.BOULEVARD_API_SECRET &&
    process.env.BOULEVARD_API_KEY
  );
}

/**
 * Test the Boulevard API connection
 */
export async function testConnection(): Promise<{ success: boolean; businessName?: string; error?: string }> {
  try {
    const data = await graphql<{ business: { name: string } }>("{ business { name } }");
    return { success: true, businessName: data.business.name };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
