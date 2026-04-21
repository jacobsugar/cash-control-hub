export interface LocationWithMarket {
  id: number;
  name: string;
  marketId: number;
  marketName: string;
  type: "suite" | "flagship";
  timezone: string;
  dailyFloat: string;
}

export interface ContainerWithLocation {
  id: number;
  name: string;
  locationId: number;
  locationName: string;
  marketName: string;
  locationType: "suite" | "flagship";
  currentBalance: string;
  expectedCash?: string;
}

export interface ShiftCountWithDetails {
  id: number;
  containerId: number;
  containerName: string;
  locationName: string;
  marketName: string;
  estheticianId: number;
  estheticianName: string;
  type: "start" | "end";
  countedAmount: string;
  expectedAmount: string | null;
  discrepancyNote: string | null;
  createdAt: string;
}

export interface AlertWithDetails {
  id: number;
  type: string;
  status: string;
  staffName: string | null;
  marketName: string | null;
  locationName: string | null;
  containerName: string | null;
  expectedAmount: string | null;
  actualAmount: string | null;
  note: string | null;
  smsSent: boolean;
  createdAt: string;
}

export interface DashboardStats {
  openVariances: number;
  missingEndShifts: number;
  receiptsToday: number;
  totalContainers: number;
  recentAlerts: AlertWithDetails[];
  cashPositions: ContainerWithLocation[];
}
