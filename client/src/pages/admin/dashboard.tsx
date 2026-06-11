import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Receipt,
  Wallet,
  TrendingDown,
  Bell,
  ArrowRight,
  RefreshCw,
  Database,
  DollarSign,
  MapPin,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { DashboardStats, AlertWithDetails, ContainerWithLocation } from "@/lib/types";

function StatCard({
  title,
  value,
  icon: Icon,
  variant = "default",
  testId,
}: {
  title: string;
  value: string | number;
  icon: any;
  variant?: "default" | "warning" | "success";
  testId: string;
}) {
  const colors = {
    default: "text-foreground",
    warning: "text-destructive",
    success: "text-primary",
  };

  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs text-muted-foreground">{title}</p>
            <p className={`text-2xl font-bold ${colors[variant]}`} data-testid={testId}>
              {value}
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AlertTypeLabel({ type }: { type: string }) {
  const labels: Record<string, { text: string; variant: "default" | "destructive" | "secondary" | "outline" }> = {
    start_mismatch: { text: "Start Mismatch", variant: "destructive" },
    end_mismatch: { text: "End Mismatch", variant: "destructive" },
    missing_end_shift: { text: "Missing End", variant: "secondary" },
    missing_receipt: { text: "Missing Receipt", variant: "outline" },
    receipt_submitted: { text: "Receipt", variant: "default" },
    collection_mismatch: { text: "Collection", variant: "destructive" },
  };
  const config = labels[type] || { text: type, variant: "secondary" as const };
  return <Badge variant={config.variant} data-testid={`badge-alert-type-${type}`}>{config.text}</Badge>;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function AdminDashboard() {
  const { toast } = useToast();
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/admin/dashboard"],
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const { data: syncStatus } = useQuery<{
    lastSyncAt: string | null;
    lastSyncStatus: "success" | "error" | null;
    totalImportedRecently: number;
    syncFrequencyMinutes: number;
  }>({
    queryKey: ["/api/admin/boulevard/sync-status"],
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const syncAllMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/boulevard/sync-all");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/boulevard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard"] });
      toast({ title: "Sync complete", description: `Imported ${data.totalImported} new transactions` });
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-dashboard-title">Dashboard</h1>
        <p className="text-muted-foreground">Cash operations overview</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-4 pb-4">
                <Skeleton className="h-14 w-full" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <StatCard
              title="Open Variances"
              value={stats?.openVariances ?? 0}
              icon={AlertTriangle}
              variant={stats?.openVariances ? "warning" : "success"}
              testId="stat-open-variances"
            />
            <StatCard
              title="Missing End Shifts"
              value={stats?.missingEndShifts ?? 0}
              icon={Clock}
              variant={stats?.missingEndShifts ? "warning" : "default"}
              testId="stat-missing-end-shifts"
            />
            <StatCard
              title="Receipts Today"
              value={stats?.receiptsToday ?? 0}
              icon={Receipt}
              testId="stat-receipts-today"
            />
            <StatCard
              title="Active Suites"
              value={stats?.totalContainers ?? 0}
              icon={Wallet}
              testId="stat-total-containers"
            />
          </>
        )}
      </div>

      {/* Boulevard Sync Card */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
                <Database className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium">Boulevard Sync</p>
                <p className="text-xs text-muted-foreground">
                  Last sync: {timeAgo(syncStatus?.lastSyncAt || null)}
                  {syncStatus?.lastSyncStatus === "success" && " · "}
                  {syncStatus?.lastSyncStatus === "success" && <span className="text-green-600">Healthy</span>}
                  {syncStatus?.lastSyncStatus === "error" && " · "}
                  {syncStatus?.lastSyncStatus === "error" && <span className="text-destructive">Error</span>}
                  {" · "}{syncStatus?.totalImportedRecently ?? 0} imported today
                  {" · Every "}{syncStatus?.syncFrequencyMinutes ?? 10}m
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => syncAllMutation.mutate()}
              disabled={syncAllMutation.isPending}
            >
              <RefreshCw className={`h-3 w-3 mr-1 ${syncAllMutation.isPending ? "animate-spin" : ""}`} />
              {syncAllMutation.isPending ? "Syncing..." : "Sync Now"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Cash Totals */}
      {!isLoading && stats?.cashPositions?.length ? (() => {
        const positions = stats.cashPositions;
        const totalCash = positions.reduce((sum, p) => sum + parseFloat(p.expectedCash || p.currentBalance || "0"), 0);
        const vegasTotal = positions.filter(p => p.marketName === "Las Vegas").reduce((sum, p) => sum + parseFloat(p.expectedCash || p.currentBalance || "0"), 0);
        const austinTotal = positions.filter(p => p.marketName === "Austin").reduce((sum, p) => sum + parseFloat(p.expectedCash || p.currentBalance || "0"), 0);
        const fmt = (n: number) => "$" + Math.round(n).toLocaleString();
        return (
          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Total Cash</p>
                    <p className="text-2xl font-bold" data-testid="stat-total-cash">{fmt(totalCash)}</p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                    <DollarSign className="h-5 w-5 text-muted-foreground" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Las Vegas</p>
                    <p className="text-2xl font-bold" data-testid="stat-vegas-cash">{fmt(vegasTotal)}</p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                    <MapPin className="h-5 w-5 text-muted-foreground" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Austin</p>
                    <p className="text-2xl font-bold" data-testid="stat-austin-cash">{fmt(austinTotal)}</p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                    <MapPin className="h-5 w-5 text-muted-foreground" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        );
      })() : null}

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-semibold text-sm">Recent Alerts</h3>
            </div>
            <Link href="/admin/alerts">
              <Button variant="ghost" size="sm" data-testid="link-view-all-alerts">
                View All
                <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : stats?.recentAlerts?.length ? (
              <div className="space-y-2">
                {stats.recentAlerts.slice(0, 5).map((alert) => (
                  <div
                    key={alert.id}
                    className="flex items-start gap-3 rounded-md border p-3"
                    data-testid={`alert-item-${alert.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <AlertTypeLabel type={alert.type} />
                        <span className="text-xs text-muted-foreground">
                          {new Date(alert.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm truncate">
                        {alert.staffName && <span className="font-medium">{alert.staffName}</span>}
                        {alert.locationName && <span className="text-muted-foreground"> at {alert.locationName}</span>}
                      </p>
                      {alert.expectedAmount && alert.actualAmount && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Expected ${alert.expectedAmount} / Actual ${alert.actualAmount}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <CheckCircle2 className="mx-auto h-8 w-8 text-primary mb-2" />
                <p className="text-sm text-muted-foreground">No recent alerts</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-semibold text-sm">Cash Positions</h3>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : stats?.cashPositions?.length ? (
              <div className="space-y-2">
                {stats.cashPositions.map((pos) => (
                  <div
                    key={pos.id}
                    className="flex items-center justify-between gap-2 rounded-md border p-3"
                    data-testid={`cash-position-${pos.id}`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{pos.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {pos.marketName} - {pos.locationName}
                      </p>
                    </div>
                    <p className="text-lg font-bold whitespace-nowrap">
                      ${Math.round(parseFloat(pos.expectedCash || pos.currentBalance)).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Wallet className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No suites configured</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
