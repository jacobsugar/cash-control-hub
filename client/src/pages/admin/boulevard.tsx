import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Search, Database, RefreshCw, CheckCircle2, AlertTriangle, Clock, Settings2 } from "lucide-react";
import type { BoulevardTransaction, Location } from "@shared/schema";

interface TransactionWithDetails extends BoulevardTransaction {
  locationName: string;
  marketName: string;
}

interface SyncStatus {
  lastSyncAt: string | null;
  lastSyncStatus: "success" | "error" | null;
  totalImportedRecently: number;
  syncFrequencyMinutes: number;
  operatingStartHour: number;
  operatingEndHour: number;
  currentlySyncing: boolean;
}

interface LocationSyncStatus {
  locationId: number;
  locationName: string;
  lastSyncAt: string | null;
  lastSyncStatus: "success" | "error" | null;
  lastImportCount: number;
}

interface SyncHistoryEntry {
  id: number;
  locationName: string;
  syncType: "auto" | "manual" | "count";
  status: "success" | "error";
  transactionsImported: number;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
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

export default function BoulevardPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState("all");

  const { data: syncStatus } = useQuery<SyncStatus>({
    queryKey: ["/api/admin/boulevard/sync-status"],
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const { data: locationStatuses } = useQuery<LocationSyncStatus[]>({
    queryKey: ["/api/admin/boulevard/location-sync-status"],
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const { data: syncHistory } = useQuery<SyncHistoryEntry[]>({
    queryKey: ["/api/admin/boulevard/sync-history"],
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const { data: transactions, isLoading } = useQuery<TransactionWithDetails[]>({
    queryKey: ["/api/admin/boulevard-transactions"],
  });

  const { data: locations } = useQuery<(Location & { marketName: string })[]>({
    queryKey: ["/api/locations/with-market"],
  });

  const syncAllMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/boulevard/sync-all");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/boulevard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/boulevard-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard"] });
      toast({ title: "Sync complete", description: `Imported ${data.totalImported} new transactions` });
    },
    onError: (err: Error) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });

  const syncLocationMutation = useMutation({
    mutationFn: async (locationId: number) => {
      const res = await apiRequest("POST", "/api/admin/boulevard/sync", { locationId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/boulevard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/boulevard-transactions"] });
      toast({ title: "Location synced" });
    },
    onError: (err: Error) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });

  const frequencyMutation = useMutation({
    mutationFn: async (minutes: number) => {
      const res = await apiRequest("POST", "/api/admin/boulevard/sync-frequency", { minutes });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/boulevard/sync-status"] });
      toast({ title: "Sync frequency updated", description: `Now syncing every ${data.minutes} minutes` });
    },
  });

  const operatingHoursMutation = useMutation({
    mutationFn: async ({ startHour, endHour }: { startHour: number; endHour: number }) => {
      const res = await apiRequest("POST", "/api/admin/boulevard/operating-hours", { startHour, endHour });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/boulevard/sync-status"] });
      toast({ title: "Operating hours updated" });
    },
  });

  const filtered = useMemo(() => transactions?.filter((t) => {
    if (search) {
      const q = search.toLowerCase();
      if (!(t.operatorName || "").toLowerCase().includes(q) &&
          !(t.clientName || "").toLowerCase().includes(q) &&
          !(t.orderId || "").toLowerCase().includes(q) &&
          !(t.locationName || "").toLowerCase().includes(q) &&
          !(t.marketName || "").toLowerCase().includes(q)) return false;
    }
    if (locationFilter !== "all" && String(t.locationId) !== locationFilter) return false;
    return true;
  }) || [], [transactions, search, locationFilter]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Boulevard Sync</h1>
          <p className="text-muted-foreground">Cash transactions synced from Boulevard</p>
        </div>
        <Button
          onClick={() => syncAllMutation.mutate()}
          disabled={syncAllMutation.isPending}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${syncAllMutation.isPending ? "animate-spin" : ""}`} />
          {syncAllMutation.isPending ? "Syncing..." : "Sync All Now"}
        </Button>
      </div>

      {/* Sync Overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground">Last Sync</p>
            <p className="text-lg font-bold">{timeAgo(syncStatus?.lastSyncAt || null)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground">Status</p>
            <div className="flex items-center gap-2 mt-1">
              {syncStatus?.lastSyncStatus === "success" ? (
                <><CheckCircle2 className="h-4 w-4 text-green-500" /><span className="font-medium">Healthy</span></>
              ) : syncStatus?.lastSyncStatus === "error" ? (
                <><AlertTriangle className="h-4 w-4 text-destructive" /><span className="font-medium">Error</span></>
              ) : (
                <><Clock className="h-4 w-4 text-muted-foreground" /><span className="font-medium">No syncs yet</span></>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground">Imported (24h)</p>
            <p className="text-lg font-bold">{syncStatus?.totalImportedRecently ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Sync Frequency</p>
                <p className="text-lg font-bold">{syncStatus?.syncFrequencyMinutes ?? 10}m</p>
              </div>
              <Select
                value={String(syncStatus?.syncFrequencyMinutes ?? 10)}
                onValueChange={(v) => frequencyMutation.mutate(parseInt(v))}
              >
                <SelectTrigger className="w-[80px] h-8">
                  <Settings2 className="h-3 w-3" />
                </SelectTrigger>
                <SelectContent>
                  {[5, 10, 15, 30, 60].map((m) => (
                    <SelectItem key={m} value={String(m)}>{m} min</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Operating Hours</p>
                <p className="text-sm font-medium">
                  {syncStatus?.operatingStartHour ?? 7}:00 - {syncStatus?.operatingEndHour ?? 21}:00
                  {syncStatus && !syncStatus.currentlySyncing && (
                    <span className="text-xs text-muted-foreground ml-1">(paused)</span>
                  )}
                </p>
              </div>
              <div className="flex gap-1">
                <Select
                  value={String(syncStatus?.operatingStartHour ?? 7)}
                  onValueChange={(v) => operatingHoursMutation.mutate({
                    startHour: parseInt(v),
                    endHour: syncStatus?.operatingEndHour ?? 21,
                  })}
                >
                  <SelectTrigger className="w-[70px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, i) => (
                      <SelectItem key={i} value={String(i)}>{i}:00</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="self-center text-xs text-muted-foreground">to</span>
                <Select
                  value={String(syncStatus?.operatingEndHour ?? 21)}
                  onValueChange={(v) => operatingHoursMutation.mutate({
                    startHour: syncStatus?.operatingStartHour ?? 7,
                    endHour: parseInt(v),
                  })}
                >
                  <SelectTrigger className="w-[70px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, i) => (
                      <SelectItem key={i} value={String(i)}>{i}:00</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Per-Location Sync Status */}
      <Card>
        <CardHeader className="pb-2">
          <h3 className="font-semibold text-sm">Location Sync Status</h3>
        </CardHeader>
        <CardContent>
          {!locationStatuses ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <div className="space-y-2">
              {locationStatuses.map((loc) => (
                <div key={loc.locationId} className="flex items-center justify-between gap-2 rounded-md border p-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {loc.lastSyncStatus === "success" ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                    ) : loc.lastSyncStatus === "error" ? (
                      <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                    ) : (
                      <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{loc.locationName}</p>
                      <p className="text-xs text-muted-foreground">
                        {timeAgo(loc.lastSyncAt)}
                        {loc.lastImportCount > 0 && ` · ${loc.lastImportCount} imported`}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={syncLocationMutation.isPending}
                    onClick={() => syncLocationMutation.mutate(loc.locationId)}
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Sync
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sync History */}
      <Card>
        <CardHeader className="pb-2">
          <h3 className="font-semibold text-sm">Sync History</h3>
        </CardHeader>
        <CardContent>
          {!syncHistory ? (
            <Skeleton className="h-24 w-full" />
          ) : syncHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No sync history yet</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Imported</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {syncHistory.slice(0, 20).map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {entry.completedAt ? new Date(entry.completedAt).toLocaleString() : "In progress..."}
                      </TableCell>
                      <TableCell className="text-sm">{entry.locationName}</TableCell>
                      <TableCell>
                        <Badge variant={entry.syncType === "auto" ? "secondary" : entry.syncType === "manual" ? "default" : "outline"}>
                          {entry.syncType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {entry.status === "success" ? (
                          <Badge variant="default" className="bg-green-500">success</Badge>
                        ) : (
                          <Badge variant="destructive">error</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">{entry.transactionsImported}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Imported Transactions */}
      <Card>
        <CardHeader className="pb-2">
          <h3 className="font-semibold text-sm">Imported Cash Transactions</h3>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search transactions..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={locationFilter} onValueChange={setLocationFilter}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="All Locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Locations</SelectItem>
                {locations?.map((l) => (
                  <SelectItem key={l.id} value={String(l.id)}>
                    {l.marketName} - {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <Database className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-muted-foreground">No cash transactions imported yet. Click "Sync All Now" to pull from Boulevard.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Operator</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {new Date(t.date).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">{t.marketName}</span>
                        <br />{t.locationName}
                      </TableCell>
                      <TableCell>{t.operatorName || "-"}</TableCell>
                      <TableCell>{t.clientName || "-"}</TableCell>
                      <TableCell className="text-right font-mono">${t.amount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
