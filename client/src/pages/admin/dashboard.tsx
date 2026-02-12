import { useQuery } from "@tanstack/react-query";
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
} from "lucide-react";
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

export default function AdminDashboard() {
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/admin/dashboard"],
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
              title="Active Containers"
              value={stats?.totalContainers ?? 0}
              icon={Wallet}
              testId="stat-total-containers"
            />
          </>
        )}
      </div>

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
                      ${parseFloat(pos.expectedCash || pos.currentBalance).toFixed(2)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Wallet className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No containers configured</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
