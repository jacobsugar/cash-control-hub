import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Building2, Plus, Trash2, Box, ExternalLink, Copy } from "lucide-react";
import type { Market, Location, Container } from "@shared/schema";

interface LocationWithDetails extends Location {
  marketName: string;
  containers: Container[];
}

export default function LocationsPage() {
  const { toast } = useToast();
  const [openLoc, setOpenLoc] = useState(false);
  const [openContainer, setOpenContainer] = useState(false);
  const [locName, setLocName] = useState("");
  const [locMarket, setLocMarket] = useState("");
  const [locType, setLocType] = useState<"suite" | "flagship">("suite");
  const [locTimezone, setLocTimezone] = useState("America/Chicago");
  const [locFloat, setLocFloat] = useState("20.00");
  const [containerName, setContainerName] = useState("");
  const [containerLocation, setContainerLocation] = useState("");

  const { data: markets } = useQuery<Market[]>({ queryKey: ["/api/markets"] });
  const { data: locations, isLoading } = useQuery<LocationWithDetails[]>({
    queryKey: ["/api/admin/locations-with-containers"],
  });

  const createLocMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/locations", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/locations-with-containers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/locations/with-market"] });
      setOpenLoc(false);
      setLocName("");
      setLocMarket("");
      toast({ title: "Location created" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const createContainerMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/containers", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/locations-with-containers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/container-options"] });
      setOpenContainer(false);
      setContainerName("");
      setContainerLocation("");
      toast({ title: "Suite created" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteLocMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/locations/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/locations-with-containers"] });
      toast({ title: "Location deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteContainerMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/containers/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/locations-with-containers"] });
      toast({ title: "Suite deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const timezones = [
    "America/New_York", "America/Chicago", "America/Denver",
    "America/Los_Angeles", "America/Phoenix",
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-locations-title">Locations</h1>
          <p className="text-muted-foreground">Manage locations and suites</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Dialog open={openContainer} onOpenChange={setOpenContainer}>
            <DialogTrigger asChild>
              <Button variant="outline" data-testid="button-add-container">
                <Box className="mr-2 h-4 w-4" />
                Add Suite
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Suite</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div className="space-y-2">
                  <Label>Location</Label>
                  <Select value={containerLocation} onValueChange={setContainerLocation}>
                    <SelectTrigger data-testid="select-container-location">
                      <SelectValue placeholder="Select location" />
                    </SelectTrigger>
                    <SelectContent>
                      {locations?.map((l) => (
                        <SelectItem key={l.id} value={String(l.id)}>
                          {l.marketName} - {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Suite Name</Label>
                  <Input
                    value={containerName}
                    onChange={(e) => setContainerName(e.target.value)}
                    placeholder="e.g. Suite A, Main Till"
                    data-testid="input-container-name"
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={!containerName.trim() || !containerLocation || createContainerMutation.isPending}
                  onClick={() => createContainerMutation.mutate({
                    name: containerName.trim(),
                    locationId: parseInt(containerLocation),
                  })}
                  data-testid="button-submit-container"
                >
                  {createContainerMutation.isPending ? "Creating..." : "Create Suite"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={openLoc} onOpenChange={setOpenLoc}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-location">
                <Plus className="mr-2 h-4 w-4" />
                Add Location
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Location</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div className="space-y-2">
                  <Label>Market</Label>
                  <Select value={locMarket} onValueChange={setLocMarket}>
                    <SelectTrigger data-testid="select-loc-market">
                      <SelectValue placeholder="Select market" />
                    </SelectTrigger>
                    <SelectContent>
                      {markets?.map((m) => (
                        <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Location Name</Label>
                  <Input
                    value={locName}
                    onChange={(e) => setLocName(e.target.value)}
                    placeholder="e.g. Uptown"
                    data-testid="input-location-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={locType} onValueChange={(v) => setLocType(v as "suite" | "flagship")}>
                    <SelectTrigger data-testid="select-loc-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="suite">Suite (separate suites)</SelectItem>
                      <SelectItem value="flagship">Flagship (pooled till, daily reset)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Timezone</Label>
                  <Select value={locTimezone} onValueChange={setLocTimezone}>
                    <SelectTrigger data-testid="select-loc-timezone">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {timezones.map((tz) => (
                        <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {locType === "flagship" && (
                  <div className="space-y-2">
                    <Label>Daily Float ($)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={locFloat}
                      onChange={(e) => setLocFloat(e.target.value)}
                      data-testid="input-loc-float"
                    />
                  </div>
                )}
                <Button
                  className="w-full"
                  disabled={!locName.trim() || !locMarket || createLocMutation.isPending}
                  onClick={() => createLocMutation.mutate({
                    name: locName.trim(),
                    marketId: parseInt(locMarket),
                    type: locType,
                    timezone: locTimezone,
                    dailyFloat: locType === "flagship" ? locFloat : "0",
                  })}
                  data-testid="button-submit-location"
                >
                  {createLocMutation.isPending ? "Creating..." : "Create Location"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : !locations?.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Building2 className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No locations yet. Add a market first, then create locations.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {locations.map((loc) => (
            <Card key={loc.id}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
                      <Building2 className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium" data-testid={`text-location-${loc.id}`}>{loc.name}</p>
                        <Badge variant={loc.type === "flagship" ? "default" : "secondary"}>
                          {loc.type}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {loc.marketName} &middot; {loc.timezone}
                        {loc.type === "flagship" && ` · $${loc.dailyFloat} daily float`}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      if (confirm("Delete this location and all its suites?")) {
                        deleteLocMutation.mutate(loc.id);
                      }
                    }}
                    data-testid={`button-delete-location-${loc.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex items-center gap-2 ml-12 mb-3">
                  <code className="text-xs bg-muted px-2 py-1 rounded-md flex-1 min-w-0 truncate" data-testid={`text-location-url-${loc.id}`}>
                    {window.location.origin}/count/{loc.id}
                  </code>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/count/${loc.id}`);
                      toast({ title: "Copied", description: "Location URL copied to clipboard." });
                    }}
                    data-testid={`button-copy-url-${loc.id}`}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => window.open(`/count/${loc.id}`, "_blank")}
                    data-testid={`button-open-url-${loc.id}`}
                  >
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                </div>
                {loc.containers.length > 0 && (
                  <div className="ml-12 space-y-1">
                    {loc.containers.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between gap-2 rounded-md border p-2"
                        data-testid={`container-item-${c.id}`}
                      >
                        <div className="flex items-center gap-2">
                          <Box className="h-3 w-3 text-muted-foreground" />
                          <span className="text-sm">{c.name}</span>
                          <span className="text-xs text-muted-foreground font-mono">
                            ${parseFloat(c.currentBalance).toFixed(2)}
                          </span>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            if (confirm("Delete this suite?")) {
                              deleteContainerMutation.mutate(c.id);
                            }
                          }}
                          data-testid={`button-delete-container-${c.id}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
