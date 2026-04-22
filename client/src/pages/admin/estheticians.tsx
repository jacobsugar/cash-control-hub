import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Users, Plus, Trash2, RefreshCw, Link2, Search } from "lucide-react";

interface EsthLocation {
  locationId: number;
  locationName: string;
  marketName: string;
}

interface EstheticianWithLocations {
  id: number;
  name: string;
  active: boolean;
  boulevardStaffId: string | null;
  lastSyncedAt: string | null;
  locations: EsthLocation[];
}

export default function EstheticiansPage() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [marketFilter, setMarketFilter] = useState("all");
  const [showInactive, setShowInactive] = useState(false);

  const { data: estheticians, isLoading } = useQuery<EstheticianWithLocations[]>({
    queryKey: ["/api/admin/estheticians-with-locations"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string }) => {
      const res = await apiRequest("POST", "/api/estheticians", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/estheticians-with-locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/estheticians"] });
      setOpen(false);
      setName("");
      toast({ title: "Esthetician added" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      await apiRequest("PATCH", `/api/estheticians/${id}`, { active });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/estheticians-with-locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/estheticians"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/estheticians/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/estheticians-with-locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/estheticians"] });
      toast({ title: "Esthetician removed" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const syncStaffMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/boulevard/sync-staff");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/estheticians-with-locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/estheticians"] });
      toast({ title: "Staff synced from Boulevard", description: `${data.synced} estheticians across ${data.locations} locations` });
    },
    onError: (err: Error) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });

  // Get unique markets for filter
  const markets = useMemo(() => {
    if (!estheticians) return [];
    const marketSet = new Set<string>();
    estheticians.forEach(e => e.locations.forEach(l => marketSet.add(l.marketName)));
    return Array.from(marketSet).sort();
  }, [estheticians]);

  // Filter and group
  const filtered = useMemo(() => {
    if (!estheticians) return [];
    return estheticians.filter(e => {
      if (!showInactive && !e.active) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!e.name.toLowerCase().includes(q)) return false;
      }
      if (marketFilter !== "all") {
        if (!e.locations.some(l => l.marketName === marketFilter) && e.locations.length > 0) return false;
      }
      return true;
    });
  }, [estheticians, search, marketFilter]);

  // Group by market > location
  const grouped = useMemo(() => {
    const groups: Record<string, Record<string, EstheticianWithLocations[]>> = {};
    const unassigned: EstheticianWithLocations[] = [];

    for (const e of filtered) {
      if (e.locations.length === 0) {
        unassigned.push(e);
        continue;
      }
      for (const loc of e.locations) {
        if (!groups[loc.marketName]) groups[loc.marketName] = {};
        if (!groups[loc.marketName][loc.locationName]) groups[loc.marketName][loc.locationName] = [];
        // Avoid duplicates if esthetician is in multiple locations
        if (!groups[loc.marketName][loc.locationName].find(x => x.id === e.id)) {
          groups[loc.marketName][loc.locationName].push(e);
        }
      }
    }

    return { groups, unassigned };
  }, [filtered]);

  const totalSynced = estheticians?.filter(e => e.boulevardStaffId).length || 0;
  const totalManual = estheticians?.filter(e => !e.boulevardStaffId).length || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Estheticians</h1>
          <p className="text-muted-foreground">
            {totalSynced > 0 && `${totalSynced} synced from Boulevard`}
            {totalManual > 0 && `${totalSynced > 0 ? " · " : ""}${totalManual} added manually`}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={() => syncStaffMutation.mutate()}
            disabled={syncStaffMutation.isPending}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${syncStaffMutation.isPending ? "animate-spin" : ""}`} />
            {syncStaffMutation.isPending ? "Syncing..." : "Sync from Boulevard"}
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="secondary">
                <Plus className="mr-2 h-4 w-4" />
                Add Manually
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Esthetician Manually</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Full name"
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={!name.trim() || createMutation.isPending}
                  onClick={() => createMutation.mutate({ name: name.trim() })}
                >
                  {createMutation.isPending ? "Adding..." : "Add Esthetician"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={marketFilter} onValueChange={setMarketFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Markets" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Markets</SelectItem>
            {markets.map(m => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Switch id="show-inactive" checked={showInactive} onCheckedChange={setShowInactive} />
          <Label htmlFor="show-inactive" className="text-sm">Show inactive</Label>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : !estheticians?.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No estheticians yet. Click "Sync from Boulevard" to pull staff automatically.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped.groups).sort(([a], [b]) => a.localeCompare(b)).map(([marketName, locations]) => (
            <div key={marketName} className="space-y-3">
              <h2 className="text-lg font-semibold">{marketName}</h2>
              {Object.entries(locations).sort(([a], [b]) => a.localeCompare(b)).map(([locationName, staff]) => (
                <Card key={locationName}>
                  <CardHeader className="pb-2">
                    <h3 className="text-sm font-medium text-muted-foreground">{locationName}</h3>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    {staff.map(e => (
                      <div key={e.id} className="flex items-center justify-between gap-2 py-1.5">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{e.name}</p>
                          {!e.active && <Badge variant="secondary" className="text-xs">Inactive</Badge>}
                          {e.boulevardStaffId && (
                            <Badge variant="outline" className="text-xs gap-1">
                              <Link2 className="h-2.5 w-2.5" />
                              Boulevard
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={e.active}
                            onCheckedChange={(checked) => toggleMutation.mutate({ id: e.id, active: checked })}
                          />
                          {!e.boulevardStaffId && (
                            <Button size="icon" variant="ghost" className="h-7 w-7"
                              onClick={() => { if (confirm("Delete this esthetician?")) deleteMutation.mutate(e.id); }}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          ))}

          {grouped.unassigned.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-muted-foreground">Unassigned</h2>
              <Card>
                <CardContent className="pt-4 space-y-1">
                  {grouped.unassigned.map(e => (
                    <div key={e.id} className="flex items-center justify-between gap-2 py-1.5">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{e.name}</p>
                        {!e.active && <Badge variant="secondary" className="text-xs">Inactive</Badge>}
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={e.active}
                          onCheckedChange={(checked) => toggleMutation.mutate({ id: e.id, active: checked })}
                        />
                        <Button size="icon" variant="ghost" className="h-7 w-7"
                          onClick={() => { if (confirm("Delete this esthetician?")) deleteMutation.mutate(e.id); }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
