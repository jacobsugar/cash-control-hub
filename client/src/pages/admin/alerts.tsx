import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useMemo } from "react";
import { Bell, Search, CheckCircle2, AlertTriangle, Clock, Receipt } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { AlertWithDetails } from "@/lib/types";

function getAlertIcon(type: string) {
  switch (type) {
    case "start_mismatch":
    case "end_mismatch":
    case "collection_mismatch":
      return AlertTriangle;
    case "missing_end_shift":
      return Clock;
    case "receipt_submitted":
    case "missing_receipt":
      return Receipt;
    default:
      return Bell;
  }
}

function getAlertLabel(type: string) {
  const labels: Record<string, string> = {
    start_mismatch: "Start Mismatch",
    end_mismatch: "End Mismatch",
    missing_end_shift: "Missing End Shift",
    missing_receipt: "Missing Receipt",
    receipt_submitted: "Receipt Submitted",
    collection_mismatch: "Collection Mismatch",
  };
  return labels[type] || type;
}

export default function AlertsPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  const { data: alerts, isLoading } = useQuery<AlertWithDetails[]>({
    queryKey: ["/api/admin/alerts"],
  });

  const acknowledgeMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("PATCH", `/api/admin/alerts/${id}`, { status: "acknowledged" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard"] });
      toast({ title: "Alert acknowledged" });
    },
  });

  const filtered = useMemo(() => alerts?.filter((a) => {
    if (search) {
      const q = search.toLowerCase();
      if (!(a.staffName || "").toLowerCase().includes(q) &&
          !(a.locationName || "").toLowerCase().includes(q) &&
          !(a.note || "").toLowerCase().includes(q)) return false;
    }
    if (statusFilter !== "all" && a.status !== statusFilter) return false;
    if (typeFilter !== "all" && a.type !== typeFilter) return false;
    return true;
  }) || [], [alerts, search, statusFilter, typeFilter]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-alerts-title">Alerts</h1>
        <p className="text-muted-foreground">Cash discrepancy alerts and notifications</p>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search alerts..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-alert-search"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]" data-testid="select-alert-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="acknowledged">Acknowledged</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[170px]" data-testid="select-alert-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="start_mismatch">Start Mismatch</SelectItem>
                <SelectItem value="end_mismatch">End Mismatch</SelectItem>
                <SelectItem value="missing_end_shift">Missing End</SelectItem>
                <SelectItem value="receipt_submitted">Receipt</SelectItem>
                <SelectItem value="collection_mismatch">Collection</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle2 className="mx-auto h-10 w-10 text-primary mb-3" />
              <p className="text-muted-foreground">No alerts found</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((alert) => {
                const Icon = getAlertIcon(alert.type);
                return (
                  <div
                    key={alert.id}
                    className="rounded-md border p-4"
                    data-testid={`alert-detail-${alert.id}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-md ${
                        alert.status === "active" ? "bg-destructive/10" : "bg-muted"
                      }`}>
                        <Icon className={`h-4 w-4 ${alert.status === "active" ? "text-destructive" : "text-muted-foreground"}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-medium text-sm">{getAlertLabel(alert.type)}</span>
                          <Badge variant={
                            alert.status === "active" ? "destructive" :
                            alert.status === "acknowledged" ? "secondary" : "default"
                          }>
                            {alert.status}
                          </Badge>
                          {alert.smsSent && <Badge variant="outline">SMS Sent</Badge>}
                        </div>
                        <div className="text-sm text-muted-foreground space-y-0.5">
                          {alert.staffName && <p>Staff: {alert.staffName}</p>}
                          <p>
                            {[alert.marketName, alert.locationName, alert.containerName]
                              .filter(Boolean)
                              .join(" / ")}
                          </p>
                          {alert.expectedAmount && alert.actualAmount && (
                            <p className="font-mono">
                              Expected ${alert.expectedAmount} / Actual ${alert.actualAmount}
                              <span className={parseFloat(alert.actualAmount) !== parseFloat(alert.expectedAmount) ? "text-destructive ml-2" : "text-primary ml-2"}>
                                ({(parseFloat(alert.actualAmount) - parseFloat(alert.expectedAmount) >= 0 ? "+" : "")}
                                ${(parseFloat(alert.actualAmount) - parseFloat(alert.expectedAmount)).toFixed(2)})
                              </span>
                            </p>
                          )}
                          {alert.note && <p className="italic">"{alert.note}"</p>}
                          <p className="text-xs">{new Date(alert.createdAt).toLocaleString()}</p>
                        </div>
                      </div>
                      {alert.status === "active" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => acknowledgeMutation.mutate(alert.id)}
                          disabled={acknowledgeMutation.isPending}
                          data-testid={`button-ack-${alert.id}`}
                        >
                          Acknowledge
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
